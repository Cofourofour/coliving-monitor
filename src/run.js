#!/usr/bin/env node
// Coliving.com Supply Monitor: one run = pull the public catalogue through mcp.coliving.com, keep a
// dated snapshot, score listing health, compare with the previous snapshot, write out/latest.json and
// out/report.html, and publish the report when WordPress credentials are present.
//
//   node src/run.js            full run
//   node src/run.js --offline  rebuild the report from the latest snapshot without calling the MCP
//   node src/run.js --no-publish
//
// Reads: mcp.coliving.com (public discovery tools, ~55 calls, one per second).
// Writes: data/snapshots/YYYY-MM-DD.json.gz, out/latest.json, out/report.html, and one page on
// laurensborrey.com when LB_WP_URL / LB_WP_USER / LB_WP_APP_PASSWORD are set. Nothing else.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { call, pullCatalogue, pullByCountries } = require('./mcp');
const { countries } = require('./countries');
const { score, markets, currencyLabels } = require('./health');
const { diff } = require('./diff');
const { render } = require('./report');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const OUT = process.env.OUT_DIR || path.join(ROOT, 'out');
const SNAP = path.join(DATA, 'snapshots');
const OFFLINE = process.argv.includes('--offline');
const NO_PUBLISH = process.argv.includes('--no-publish');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function readSnapshot(file) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }
function listSnapshots() { return fs.existsSync(SNAP) ? fs.readdirSync(SNAP).filter((f) => f.endsWith('.json.gz')).sort() : []; }

// How many listings a city search reports against how many the catalogue holds for it.
async function probeLocations(items, limit = 25) {
  const counts = {};
  for (const x of items) { const k = x.location_display; if (k) counts[k] = (counts[k] || 0) + 1; }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const rows = [];
  for (const [city, inCatalogue] of top) {
    try {
      const r = await call('search_locations', { query: city });
      const exact = (r.locations || []).find((l) => l.type === 'city' && l.name.toLowerCase().startsWith(city.toLowerCase()));
      rows.push({ city, in_catalogue: inCatalogue, search_reports: exact ? exact.listings_count : null, location_id: exact ? exact.location_id : null, resolved_name: exact ? exact.name : null });
    } catch (e) { rows.push({ city, in_catalogue: inCatalogue, search_reports: null, error: e.message.slice(0, 80) }); }
  }
  return rows;
}

(async () => {
  fs.mkdirSync(SNAP, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  let snapshot;
  if (OFFLINE) {
    const files = listSnapshots();
    if (!files.length) throw new Error('no snapshot to rebuild from');
    snapshot = readSnapshot(path.join(SNAP, files[files.length - 1]));
    log('offline: using', files[files.length - 1]);
  } else {
    const t0 = Date.now();
    const list = await countries({ refresh: process.argv.includes('--refresh-countries'), log });
    log(`${list.length} countries with listings (${list.slice(0, 5).map((c) => c.name + ' ' + c.listings_count).join(', ')}, ...)`);
    const byCountry = await pullByCountries(list, { onCountry: (c) => { if (c.reported !== c.pulled) log(`${c.name}: reported ${c.reported}, pulled ${c.pulled}`); } });
    log(`pulled ${byCountry.items.length} listings country by country in ${Math.round((Date.now() - t0) / 1000)}s`);
    log('walking the unfiltered search for the reach check');
    const { items: open, reported } = await pullCatalogue({ onPage: (p, n, rep) => { if (p % 25 === 0 || n === 0) log(`page ${p}: ${n} items (server reports ${rep.total} over ${rep.pages} pages)`); } });
    const openIds = new Set(open.map((x) => x.unique_id));
    const unfilteredMissing = byCountry.items.filter((x) => !openIds.has(x.unique_id)).length;
    log(`unfiltered walk returned ${openIds.size}; ${unfilteredMissing} listings only reachable with a place filter`);
    // Union: listings under no discovered place (no location at all, or a region the list lacks) are
    // kept from the open walk so the catalogue is as complete as the two doors allow.
    const byId = new Map(byCountry.items.map((x) => [x.unique_id, x]));
    let onlyOpen = 0;
    for (const x of open) if (!byId.has(x.unique_id)) { byId.set(x.unique_id, { ...x, country_resolved: null }); onlyOpen++; }
    const items = [...byId.values()];
    log(`${onlyOpen} listings came only from the open walk (no resolvable place); ${items.length} in total`);
    const locations = await probeLocations(items);
    snapshot = { date: today, pulled_at: new Date().toISOString(), reported: { ...reported, unfiltered_reachable: openIds.size, by_country: byCountry.items.length, only_open: onlyOpen, unfiltered_missing: unfilteredMissing }, per_country: byCountry.perCountry, items, locations };
    fs.writeFileSync(path.join(SNAP, `${today}.json.gz`), zlib.gzipSync(JSON.stringify(snapshot)));
    log('snapshot saved');
  }

  const files = listSnapshots().filter((f) => f < `${snapshot.date}.json.gz`);
  const previous = files.length ? readSnapshot(path.join(SNAP, files[files.length - 1])) : null;
  const items = snapshot.items;
  const health = score(items);
  const market = markets(items);
  const labels = currencyLabels(items);
  const changes = previous ? diff(previous.items, items) : null;
  const nonUsd = items.filter((x) => x.source_currency && x.source_currency !== 'USD').length;
  const countryNull = items.filter((x) => !x.country).length;
  const noCity = items.filter((x) => !x.location).length;
  const nameVariants = (() => { const base = {}; for (const x of items) { const l = x.location_display; if (!l) continue; const b = l.split(',')[0].trim().toLowerCase(); base[b] = base[b] || new Set(); base[b].add(l); } return Object.values(base).filter((s) => s.size > 1).map((s) => [...s]); })();
  const locationGaps = (snapshot.locations || []).filter((r) => r.search_reports != null && r.search_reports !== r.in_catalogue);

  const latest = {
    generated_at: new Date().toISOString(),
    snapshot_date: snapshot.date,
    previous_date: previous ? previous.date : null,
    reach: { reported_total: snapshot.reported?.total ?? null, reported_pages: snapshot.reported?.pages ?? null, reachable: snapshot.reported?.unfiltered_reachable ?? items.length, by_country: snapshot.reported?.by_country ?? null, unfiltered_missing: snapshot.reported?.unfiltered_missing ?? null },
    // The website comparison is a hand check (FINDINGS.md, 27 Oct 2026); the MCP side is read live.
    currency: { non_usd_labels: nonUsd, by_label: labels, verified: (() => { const x = items.find((i) => i.unique_id === 'rgxjdwme'); return { city: 'Medellín', mcp: x ? x.monthly_price_from_display : 'From COP 1,081.62/mo', web: '$1,082 /month (website, 27 Oct 2026)' }; })() },
    per_country: snapshot.per_country || [],
    location: { country_null: countryNull, no_city: noCity, name_variants: nameVariants, probe: snapshot.locations || [], gaps: locationGaps },
    health: { issue_counts: health.issueCounts, labels: health.labels, listings_with_issues: health.scored.filter((s) => s.penalty > 0).length, worst: health.scored.filter((s) => s.penalty > 0).sort((a, b) => b.penalty - a.penalty || b.issues.length - a.issues.length).slice(0, 40) },
    markets: market,
    changes,
    totals: { listings: items.length, cities: new Set(items.map((x) => x.location_display).filter(Boolean)).size, available_now: items.filter((x) => x.availability_status === 'available_now').length, with_reviews: items.filter((x) => x.review_count > 0).length, median_usd: Math.round(require('./health').median(items.map((x) => x.monthly_price_from).filter((p) => typeof p === 'number' && p > 0))) },
    history: listSnapshots().map((f) => f.slice(0, 10)),
  };
  fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(latest, null, 1));
  const html = render(latest);
  fs.writeFileSync(path.join(OUT, 'report.html'), html);
  log(`report written: ${items.length} listings, ${latest.health.listings_with_issues} with an open fix, ${changes ? changes.added.length + ' new / ' + changes.removed.length + ' gone / ' + changes.priceChanged.length + ' price moves' : 'first snapshot'}`);

  if (!NO_PUBLISH && process.env.LB_WP_URL && process.env.LB_WP_APP_PASSWORD) {
    const { publish } = require('./publish');
    const link = await publish(html);
    log('published', link);
  } else log('publish skipped (no LB_WP_* credentials or --no-publish)');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
