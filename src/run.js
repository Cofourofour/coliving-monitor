#!/usr/bin/env node
// Coliving.com Supply Monitor: one run = pull the public catalogue through mcp.coliving.com, keep a
// dated snapshot, score listing health, compare with the previous snapshot, write out/latest.json and
// out/report.html, and publish the report when WordPress credentials are present.
//
//   node src/run.js            full run
//   node src/run.js --offline  rebuild the report from the latest snapshot without calling the MCP
//   node src/run.js --no-publish
//
// Reads: mcp.coliving.com (public discovery tools, about 150 calls, at most 50 a minute; the server
// allows 60). Writes: data/snapshots/YYYY-MM-DD.json.gz, out/latest.json, out/report.html, and one page
// on laurensborrey.com when LB_WP_URL / LB_WP_USER / LB_WP_APP_PASSWORD are set. Nothing else.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { call, pullCatalogue, pullByCountries, stats } = require('./mcp');
const { countries } = require('./countries');
const { score, markets, currencyLabels, median } = require('./health');
const { diff } = require('./diff');
const { render } = require('./report');

const ROOT = path.resolve(__dirname, '..');
// A plain .env next to package.json (KEY=VALUE, optional quotes) fills process.env without a shell:
// WordPress application passwords contain spaces, which `. .env` in cron cannot carry.
(() => {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
})();
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const OUT = process.env.OUT_DIR || path.join(ROOT, 'out');
const SNAP = path.join(DATA, 'snapshots');
const OFFLINE = process.argv.includes('--offline');
const NO_PUBLISH = process.argv.includes('--no-publish');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function readSnapshot(file) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }
function listSnapshots() { return fs.existsSync(SNAP) ? fs.readdirSync(SNAP).filter((f) => f.endsWith('.json.gz')).sort() : []; }

// The two availability scopes of search_listings (FINDINGS.md, "Two catalogues"):
// - available_soon, the server default: without dates, listings available within 30 days. This is what
//   an assistant gets when it searches without naming a scope.
// - all_published: every indexed published listing, whatever its availability date.
const SCOPE_ALL = { availability_scope: 'all_published' };

// Pull dates (the 06:10 UTC daily snapshots in data/snapshots) on which each defect was last seen and
// first seen gone. Today's status is recomputed live in defectChecks, so a regression shows as open.
const FIX_HISTORY = {
  currency: { last_seen: '2026-10-29', fixed_seen: '2026-10-30' },
  cap: { last_seen: '2026-10-29', fixed_seen: '2026-10-30' },
  country: { last_seen: '2026-11-03', fixed_seen: '2026-11-04', note: 'empty on 1,146 of 1,147 cards on 29 Oct, on 3 from 30 Oct to 3 Nov, on none since 4 Nov' },
  no_city: { last_seen: '2026-11-03', fixed_seen: '2026-11-04' },
  location_tree: { last_seen: '2026-11-03', fixed_seen: '2026-11-04' },
};

// What a city search (search_locations) reports against what each scope holds for that city.
async function probeLocations(items, limit = 25) {
  const all = {}, def = {};
  for (const x of items) { const k = x.location_display; if (!k) continue; all[k] = (all[k] || 0) + 1; if (x.in_default_scope) def[k] = (def[k] || 0) + 1; }
  const top = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const rows = [];
  for (const [city, published] of top) {
    const r = await call('search_locations', { query: city });
    const head = city.split(',')[0].trim().toLowerCase();
    const exact = (r.locations || []).find((l) => l.type === 'city' && l.name && l.name.toLowerCase().startsWith(head))
      || (r.locations || []).find((l) => l.name && l.name.toLowerCase() === head);
    rows.push({ city, published, default_scope: def[city] || 0, search_reports: exact ? exact.listings_count : null, location_id: exact ? exact.location_id : null, resolved_name: exact ? exact.name : null });
  }
  return rows;
}

// get_host for the host of a well-reviewed listing (FINDINGS.md 4): does the trust signal carry numbers?
const HOST_PROBE = 'yfkkibzf';
async function hostCheck(items) {
  const card = items.find((x) => x.unique_id === HOST_PROBE);
  const r = await call('get_host', { unique_id: HOST_PROBE });
  const text = r._text || JSON.stringify(r);
  const rate = (text.match(/Response Rate\**:\s*([^\n]+)/i) || [])[1] || null;
  const time = (text.match(/Average Response Time\**:\s*([^\n]+)/i) || [])[1] || null;
  const clean = (s) => (s ? s.replace(/\*/g, '').trim() : null);
  return { unique_id: HOST_PROBE, listing: card ? card.card_display_name || card.name : null, url: card ? card.url : `https://coliving.com/spaces/${HOST_PROBE}`, review_count: card ? card.review_count : null, response_rate: clean(rate), response_time: clean(time) };
}

// Island regions under their country: the country walk must return a listing in that place.
const TREE_CHECKS = [['Indonesia', 'Ubud / Bali', /ubud|bali/i], ['Spain', 'Tenerife', /tenerife/i], ['Portugal', 'Funchal / Madeira', /funchal|madeira/i], ['Italy', 'Catania / Sicily', /catania|sicily/i]];

function defectChecks(items, scopes) {
  const n = items.length;
  const nonUsd = items.filter((x) => x.source_currency && x.source_currency !== 'USD').length;
  const countryNull = items.filter((x) => !x.country).length;
  const noCity = items.filter((x) => !x.location).length;
  const sc = ['available_soon', 'all_published'].map((s) => ({ s, ...scopes[s] }));
  const capOk = sc.every((x) => x.reported_total != null && !x.short && x.walk_returned === x.reported_total);
  const tree = TREE_CHECKS.map(([country, place, re]) => ({ country, place, found: items.filter((x) => x.found_under === country && re.test(x.location_display || '')).length }));
  const treeOk = tree.every((t) => t.found > 0);
  const st = (ok, key) => ({ status: ok ? 'fixed' : 'open', ...FIX_HISTORY[key] });
  return {
    currency: { ...st(nonUsd === 0, 'currency'), today: `${nonUsd.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} cards carry a non-USD currency label` },
    cap: { ...st(capOk, 'cap'), today: sc.map((x) => `${x.s}: server reports ${Number(x.reported_total).toLocaleString('en-US')}, the walk returned ${Number(x.walk_returned).toLocaleString('en-US')}`).join('; ') },
    country: { ...st(countryNull === 0, 'country'), today: `country empty on ${countryNull.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} cards` },
    no_city: { ...st(noCity === 0, 'no_city'), today: `${noCity} cards without a city` },
    location_tree: { ...st(treeOk, 'location_tree'), today: tree.map((t) => `${t.country} returns ${t.found} in ${t.place}`).join('; '), detail: tree },
  };
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
    const byCountry = await pullByCountries(list, { filters: SCOPE_ALL, onCountry: (c) => { if (c.reported !== c.pulled) log(`${c.name}: reported ${c.reported}, pulled ${c.pulled}`); } });
    const mismatched = byCountry.perCountry.filter((c) => c.reported !== c.pulled);
    log(`pulled ${byCountry.items.length} published listings country by country in ${Math.round((Date.now() - t0) / 1000)}s; ${mismatched.length} countries where pulled differs from reported`);
    const rep = (p, n, r) => { if (n === 0 || p % 10 === 0) log(`page ${p}: ${n} items (server reports ${r.total} over ${r.pages} pages)`); };
    log('unfiltered walk, all_published');
    const openAll = await pullCatalogue(SCOPE_ALL, { onPage: rep });
    log(`all_published: server reports ${openAll.reported.total}, walk returned ${openAll.items.length}${openAll.short ? ' (SHORT)' : ''}`);
    log('unfiltered walk, default scope (available_soon)');
    const openDef = await pullCatalogue({}, { onPage: rep });
    log(`default scope: server reports ${openDef.reported.total}, walk returned ${openDef.items.length}${openDef.short ? ' (SHORT)' : ''}`);

    const defIds = new Set(openDef.items.map((x) => x.unique_id));
    const openIds = new Set(openAll.items.map((x) => x.unique_id));
    const byId = new Map(byCountry.items.map((x) => [x.unique_id, x]));
    let onlyOpen = 0;
    for (const x of openAll.items) if (!byId.has(x.unique_id)) { byId.set(x.unique_id, { ...x, country_resolved: x.country || null, found_under: null }); onlyOpen++; }
    let defaultNotPublished = 0;
    for (const x of openDef.items) if (!byId.has(x.unique_id)) { byId.set(x.unique_id, { ...x, country_resolved: x.country || null, found_under: null }); defaultNotPublished++; }
    const items = [...byId.values()].map((x) => ({ ...x, in_default_scope: defIds.has(x.unique_id) }));
    const placeOnly = byCountry.items.filter((x) => !openIds.has(x.unique_id)).length;
    log(`${onlyOpen} only in the unfiltered walk (under no country in the list); ${placeOnly} only reachable with a place filter; ${defaultNotPublished} default-scope listings absent from all_published; ${items.length} in total`);
    const locations = await probeLocations(items);
    const host = await hostCheck(items);
    const scopes = {
      available_soon: { reported_total: openDef.reported.total, reported_pages: openDef.reported.pages, walk_returned: openDef.items.length, short: openDef.short, in_snapshot: items.filter((x) => x.in_default_scope).length },
      all_published: { reported_total: openAll.reported.total, reported_pages: openAll.reported.pages, walk_returned: openAll.items.length, short: openAll.short, by_country: byCountry.items.length, only_open: onlyOpen, unfiltered_missing: placeOnly, countries_mismatched: mismatched.length, default_not_published: defaultNotPublished, in_snapshot: items.length },
    };
    snapshot = { version: 2, date: today, pulled_at: new Date().toISOString(), scope_basis: 'all_published', scopes, client: stats(), host, per_country: byCountry.perCountry, items, locations };
    fs.writeFileSync(path.join(SNAP, `${today}.json.gz`), zlib.gzipSync(JSON.stringify(snapshot)));
    log(`snapshot saved (${snapshot.client.requests} requests, ${snapshot.client.retries} retries, ${snapshot.client.rate_limited} rate-limited replies, paced at ${snapshot.client.per_minute} a minute)`);
  }

  const files = listSnapshots().filter((f) => f < `${snapshot.date}.json.gz`);
  const previous = files.length ? readSnapshot(path.join(SNAP, files[files.length - 1])) : null;
  const v2 = snapshot.scope_basis === 'all_published';
  const items = snapshot.items;
  const inDefault = v2 ? items.filter((x) => x.in_default_scope) : items;
  const publishedIds = new Set(items.map((x) => x.unique_id));
  const health = score(items);
  const market = markets(items);
  const labels = currencyLabels(items);

  // Changes. Snapshots before 9 Nov 2026 hold the default scope only, so the published catalogue can be
  // compared from the second all_published snapshot on. The default-scope comparison always works, and
  // every listing that left it is checked against today's published catalogue: a listing that moved
  // beyond the 30-day window is not a listing that is gone.
  let changes = null;
  if (previous) {
    const prevV2 = previous.scope_basis === 'all_published';
    const prevDefault = prevV2 ? previous.items.filter((x) => x.in_default_scope) : previous.items;
    const def = diff(prevDefault, inDefault);
    const leftStillPublished = v2 ? def.removed.filter((x) => publishedIds.has(x.unique_id)).length : null;
    const leftUnpublished = v2 ? def.removed.filter((x) => !publishedIds.has(x.unique_id)) : null;
    const prevIds = new Set(previous.items.map((x) => x.unique_id));
    const pub = prevV2 && v2 ? diff(previous.items, items) : null;
    const base = pub || def;
    changes = {
      previous_scope: prevV2 ? 'all_published' : 'available_soon',
      basis: pub ? 'all_published' : 'available_soon',
      default_scope: { entered: def.added.length, entered_already_published: prevV2 ? def.added.filter((x) => prevIds.has(x.unique_id)).length : null, left: def.removed.length, left_still_published: leftStillPublished, left_unpublished: leftUnpublished ? leftUnpublished.length : null },
      added: pub ? pub.added : def.added,
      removed: pub ? pub.removed : (leftUnpublished || def.removed),
      priceChanged: base.priceChanged,
      smallPriceMoves: base.smallPriceMoves,
      minPricePct: base.minPricePct,
      availabilityChanged: base.availabilityChanged,
    };
  }

  const scopes = snapshot.scopes || { available_soon: { reported_total: snapshot.reported?.total ?? null, reported_pages: snapshot.reported?.pages ?? null, walk_returned: snapshot.reported?.unfiltered_reachable ?? items.length, short: (snapshot.reported?.unfiltered_reachable ?? 0) < (snapshot.reported?.total ?? 0), in_snapshot: items.length } };
  const checks = v2 ? defectChecks(items, scopes) : null;
  const nameVariants = (() => { const base = {}; for (const x of items) { const l = x.location_display; if (!l) continue; const b = l.split(',')[0].trim().toLowerCase(); base[b] = base[b] || new Set(); base[b].add(l); } return Object.values(base).filter((s) => s.size > 1).map((s) => [...s]); })();
  const probe = snapshot.locations || [];

  const latest = {
    generated_at: new Date().toISOString(),
    snapshot_date: snapshot.date,
    previous_date: previous ? previous.date : null,
    scope_basis: v2 ? 'all_published' : 'available_soon',
    scopes,
    client: snapshot.client || null,
    host: snapshot.host || null,
    checks,
    reach: { by_country: scopes.all_published?.by_country ?? null, unfiltered_missing: scopes.all_published?.unfiltered_missing ?? null, only_open: scopes.all_published?.only_open ?? null, countries_mismatched: scopes.all_published?.countries_mismatched ?? null },
    currency: { non_usd_labels: items.filter((x) => x.source_currency && x.source_currency !== 'USD').length, by_label: labels },
    per_country: snapshot.per_country || [],
    location: { country_null: items.filter((x) => !x.country).length, no_city: items.filter((x) => !x.location).length, name_variants: nameVariants, probe },
    health: { issue_counts: health.issueCounts, labels: health.labels, listings_with_issues: health.scored.filter((s) => s.penalty > 0).length, worst: health.scored.filter((s) => s.penalty > 0).sort((a, b) => b.penalty - a.penalty || b.issues.length - a.issues.length).slice(0, 40) },
    markets: market,
    changes,
    totals: {
      listings: items.length,
      default_scope: inDefault.length,
      cities: new Set(items.map((x) => x.location_display).filter(Boolean)).size,
      available_now: items.filter((x) => x.availability_status === 'available_now').length,
      with_reviews: items.filter((x) => x.review_count > 0).length,
      median_usd: Math.round(median(items.map((x) => x.monthly_price_from).filter((p) => typeof p === 'number' && p > 0))),
    },
    history: listSnapshots().map((f) => f.slice(0, 10)),
  };
  fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(latest, null, 1));
  const html = render(latest);
  fs.writeFileSync(path.join(OUT, 'report.html'), html);
  log(`report written: ${items.length} listings in the snapshot (${inDefault.length} in the default scope), ${latest.health.listings_with_issues} with an open fix`);

  if (!NO_PUBLISH && process.env.LB_WP_URL && process.env.LB_WP_APP_PASSWORD) {
    const { publish } = require('./publish');
    const link = await publish(html);
    log('published', link);
  } else log('publish skipped (no LB_WP_* credentials or --no-publish)');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
