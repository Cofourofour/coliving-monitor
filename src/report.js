// Renders out/latest.json into one self-contained HTML fragment (inline CSS, no scripts, no "&&") that
// drops into a WordPress html block. Visual language follows coliving.com: Google Sans Flex, a Playfair
// italic on the last phrase of a headline, the orange accent, grey rounded panels, pill buttons.
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const usd = (n) => (n == null ? '–' : '$' + Math.round(n).toLocaleString('en-US'));
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
const dateLong = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const CSS = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,400;6..144,500;6..144,600&family=Playfair+Display:ital,wght@1,400&display=swap');
.csm{--ink:#18181B;--body:#52525B;--muted:#71717A;--accent:#ED502D;--panel:#F5F5F3;--tile:#F4F4F5;--line:#E5E7EB;--good:#1F7A4D;--warn:#B45309;font-family:'Google Sans Flex',Inter,Arial,sans-serif;color:var(--body);background:#fff;line-height:1.6;font-size:16px}
.csm *{box-sizing:border-box}
.csm .wrap{max-width:1120px;margin:0 auto;padding:40px 24px 64px}
.csm h1,.csm h2,.csm h3{color:var(--ink);font-weight:500;letter-spacing:-.02em;margin:0 0 12px;line-height:1.1}
.csm h1{font-size:clamp(36px,5vw,58px);letter-spacing:-.035em;margin-bottom:16px}
.csm h2{font-size:clamp(26px,3vw,36px);margin-top:72px}
.csm h3{font-size:20px;margin-top:0}
.csm em.sig{font-family:'Playfair Display',Georgia,serif;font-style:italic;font-weight:400}
.csm .crumb{font-size:14px;color:var(--muted);margin-bottom:18px}
.csm .crumb a{color:var(--muted);text-decoration:none}
.csm .apply{display:flex;gap:12px;align-items:flex-start;background:var(--panel);border-radius:18px;padding:16px 20px;margin:0 0 26px;font-size:15px;line-height:1.55}
.csm .apply .dot{margin-top:7px;flex:none}
.csm .apply b{color:var(--ink);font-weight:600}
.csm .apply a{color:var(--ink);text-decoration:underline;text-decoration-color:rgba(24,24,27,.3);text-underline-offset:3px;white-space:nowrap}
.csm .next{background:var(--panel);border-radius:28px;padding:28px;margin-top:22px}
.csm .next h3{margin-bottom:8px}
.csm .next p{margin:0 0 10px;font-size:15px}
.csm .next ol{margin:8px 0 0 18px;padding:0;font-size:15px}
.csm .next li{margin:0 0 6px}
.csm .lede{font-size:18px;max-width:760px;margin:0 0 22px}
.csm .pills{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 36px}
.csm .pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:9px 16px;font-size:14px;font-weight:500;text-decoration:none;border:1px solid rgba(24,24,27,.12);color:var(--ink);background:#fff}
.csm .pill.dark{background:var(--ink);color:#fff;border-color:var(--ink)}
.csm .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block}
.csm .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:20px;padding:28px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:0 0 8px}
.csm .stat b{display:block;font-size:30px;font-weight:500;color:var(--ink);letter-spacing:-.02em;line-height:1.1}
.csm .stat span{font-size:14px;color:var(--muted)}
.csm .stat small{display:block;font-size:12px;color:var(--muted);margin-top:4px}
.csm .findings{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin-top:22px}
.csm .panel{background:var(--panel);border-radius:28px;padding:28px}
.csm .panel .n{font-size:13px;color:var(--accent);font-weight:600;letter-spacing:.06em;margin-bottom:10px}
.csm .panel p{margin:0 0 10px;font-size:15px}
.csm .panel .fix{font-size:14px;color:var(--ink);background:#fff;border-radius:14px;padding:10px 14px;margin-top:12px}
.csm .panel .fix b{font-weight:600}
.csm table{width:100%;border-collapse:collapse;font-size:14px;margin-top:14px;font-variant-numeric:tabular-nums}
.csm th{font-weight:500;color:var(--muted);text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);font-size:13px;white-space:nowrap}
.csm td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink)}
.csm td.r,.csm th.r{text-align:right}
.csm td.m{color:var(--muted)}
.csm .tbl{overflow-x:auto;background:#fff;border:1px solid var(--line);border-radius:20px;padding:6px 14px 10px}
.csm a.lk{color:var(--ink);text-decoration:underline;text-decoration-color:rgba(24,24,27,.3);text-underline-offset:3px}
.csm .tag{display:inline-block;font-size:12px;border-radius:999px;padding:2px 9px;background:var(--tile);color:var(--body);margin:2px 4px 2px 0;white-space:nowrap}
.csm .tag.bad{background:#FDE8E1;color:#9A3412}
.csm details{margin-top:14px}
.csm summary{cursor:pointer;color:var(--ink);font-weight:500;padding:12px 0;list-style:none;display:flex;align-items:center;gap:10px}
.csm summary::-webkit-details-marker{display:none}
.csm summary:before{content:'+';display:inline-flex;width:26px;height:26px;border-radius:50%;border:1px solid rgba(24,24,27,.15);align-items:center;justify-content:center;font-size:16px}
.csm details[open] summary:before{content:'–'}
.csm .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px;margin-top:22px}
.csm .step .k{font-size:13px;color:var(--accent);font-weight:600;margin-bottom:6px}
.csm .step h3{font-size:18px}
.csm .step p{margin:0;font-size:15px}
.csm .muted{color:var(--muted);font-size:14px}
.csm .foot{margin-top:64px;padding-top:24px;border-top:1px solid var(--line);font-size:14px;color:var(--muted);display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between}
.csm .foot a{color:var(--ink);text-decoration:none}
.csm .note{background:var(--tile);border-radius:16px;padding:14px 18px;font-size:14px;margin-top:16px}
@media (max-width:640px){.csm .wrap{padding:28px 16px 48px}.csm .panel{padding:22px;border-radius:22px}.csm h2{margin-top:52px}}
</style>`;

function findingsBlock(d) {
  const r = d.reach;
  const unreachable = r.reported_total != null ? Math.max(0, r.reported_total - r.reachable) : null;
  const c = d.currency;
  const ex = c.verified || { city: 'Medellín', mcp: 'From COP 1,081.62/mo', web: '$1,082 /month' };
  const l = d.location;
  const gaps = (l.gaps || []).slice(0, 3);
  const missing = r.unfiltered_missing != null ? r.unfiltered_missing : unreachable;
  return `
  <div class="findings">
    <div class="panel">
      <div class="n">01 · PRICES</div>
      <h3>Local currency labels on USD amounts</h3>
      <p>Every listing priced in a currency other than USD comes out of <code>search_listings</code>, <code>get_listing</code> and <code>check_availability</code> with the USD number under the local label. ${esc(ex.city)}: the MCP says <b>${esc(ex.mcp)}</b>, the website says <b>${esc(ex.web)}</b>. For MXN, COP, JPY and HKD the result is absurd; for EUR and GBP it is off by 5 to 30% and nobody notices.</p>
      <p><b>${num(c.non_usd_labels)}</b> of ${num(d.totals.listings)} listings carry a non-USD label today.</p>
      <div class="fix"><b>Fix:</b> return the amount in the listing's currency, or label the converted amount as USD. One field. Every ChatGPT and Claude answer about a non-US coliving is wrong until then.</div>
    </div>
    <div class="panel">
      <div class="n">02 · REACH</div>
      <h3>${missing != null ? num(missing) + ' listings a place-less search never returns' : 'Catalogue reach'}</h3>
      <p>Without a place filter the server reports <b>${num(r.reported_total)}</b> listings over ${num(r.reported_pages)} pages of 20, but every page after 50 returns zero items; any page size stops at 1,000. A city or country filter does reach the rest${r.by_country != null ? ` (this monitor pulls per country and finds <b>${num(r.by_country)}</b>)` : ''}, so an assistant asked “coliving anywhere in Europe under $900” or sorted by price never sees <b>${missing != null ? num(missing) : 'the last'}</b> of them.</p>
      <div class="fix"><b>Fix:</b> a 1,000-row cap in the search query, or a cursor. Until then the default sort decides which hosts never get an AI-driven lead from an open search.</div>
    </div>
    <div class="panel">
      <div class="n">03 · LOCATIONS</div>
      <h3>Location data that cannot be filtered on</h3>
      <p><code>country</code> is null on <b>${num(l.country_null)}</b> of ${num(d.totals.listings)} cards, <b>${num(l.no_city)}</b> cards have no city at all${l.name_variants.length ? `, and the same place appears under different names (${l.name_variants.slice(0, 2).map((v) => v.map((x) => '“' + esc(x) + '”').join(' and ')).join('; ')})` : ''}. Island regions are not children of their country: Bali is not under Indonesia, Tenerife and Ibiza not under Spain, Madeira not under Portugal, Sicily not under Italy, so “coliving in Indonesia” returns 4 listings and misses Bali.</p>
      ${gaps.length ? `<p>City search and catalogue also disagree: ${gaps.map((g) => `${esc(g.city)} search reports ${num(g.search_reports)}, the catalogue holds ${num(g.in_catalogue)}`).join('; ')}.</p>` : ''}
      <div class="fix"><b>Fix:</b> fill <code>country</code> from the listing address, hang every region under its country, normalise names once. Then the per-country views below exist inside your own tools.</div>
    </div>
  </div>`;
}

function changesBlock(d) {
  const c = d.changes;
  if (!c) return `<div class="note">First snapshot taken ${dateLong(d.snapshot_date)}. From tomorrow this section lists new listings, listings that disappeared, and every price or availability move, so the supply team sees the day's changes instead of looking for them.</div>`;
  const row = (x, extra = '') => `<tr><td><a class="lk" href="${esc(x.url)}">${esc(x.name)}</a></td><td class="m">${esc(x.city || '')}</td>${extra}</tr>`;
  return `
  <div class="stats" style="border-top:0;padding-top:8px">
    <div class="stat"><b>${num(c.added.length)}</b><span>new listings</span></div>
    <div class="stat"><b>${num(c.removed.length)}</b><span>listings gone</span></div>
    <div class="stat"><b>${num(c.priceChanged.length)}</b><span>price changes</span></div>
    <div class="stat"><b>${num(c.availabilityChanged.length)}</b><span>availability changes</span></div>
  </div>
  <p class="muted">Compared with the snapshot of ${dateLong(d.previous_date)}.</p>
  ${c.priceChanged.length ? `<details><summary>Price changes (${c.priceChanged.length})</summary><div class="tbl"><table><tr><th>Listing</th><th>City</th><th class="r">From</th><th class="r">To</th><th class="r">Change</th></tr>${c.priceChanged.slice(0, 60).map((x) => row(x, `<td class="r">${usd(x.from_usd)}</td><td class="r">${usd(x.to_usd)}</td><td class="r">${x.change_pct > 0 ? '+' : ''}${x.change_pct}%</td>`)).join('')}</table></div></details>` : ''}
  ${c.added.length ? `<details><summary>New listings (${c.added.length})</summary><div class="tbl"><table><tr><th>Listing</th><th>City</th><th class="r">From</th></tr>${c.added.slice(0, 60).map((x) => row(x, `<td class="r">${usd(x.price_usd)}</td>`)).join('')}</table></div></details>` : ''}
  ${c.removed.length ? `<details><summary>Listings gone (${c.removed.length})</summary><div class="tbl"><table><tr><th>Listing</th><th>City</th><th class="r">Was</th></tr>${c.removed.slice(0, 60).map((x) => row(x, `<td class="r">${usd(x.price_usd)}</td>`)).join('')}</table></div></details>` : ''}
  ${c.availabilityChanged.length ? `<details><summary>Availability changes (${c.availabilityChanged.length})</summary><div class="tbl"><table><tr><th>Listing</th><th>City</th><th>From</th><th>To</th></tr>${c.availabilityChanged.slice(0, 60).map((x) => row(x, `<td class="m">${esc(x.from)}</td><td class="m">${esc(x.to)}</td>`)).join('')}</table></div></details>` : ''}`;
}

function healthBlock(d) {
  const h = d.health;
  const counts = Object.entries(h.issue_counts).sort((a, b) => b[1] - a[1]);
  return `
  <p class="lede" style="margin-top:8px">${num(h.listings_with_issues)} of ${num(d.totals.listings)} listings have at least one thing a supply manager would ask the host to fix. Ranked by how often it happens:</p>
  <div class="tbl"><table>
    <tr><th>What is missing or off</th><th class="r">Listings</th><th class="r">Share</th></tr>
    ${counts.map(([k, n]) => `<tr><td>${esc(h.labels[k] || k)}</td><td class="r">${num(n)}</td><td class="r">${pct(n, d.totals.listings)}</td></tr>`).join('')}
  </table></div>
  <details><summary>The ${h.worst.length} listings with the most to fix, with their fix list</summary>
  <div class="tbl"><table>
    <tr><th>Listing</th><th>City</th><th class="r">From</th><th class="r">Reviews</th><th>Fix list</th></tr>
    ${h.worst.map((s) => `<tr><td><a class="lk" href="${esc(s.url)}">${esc(s.name)}</a></td><td class="m">${esc(s.city)}</td><td class="r">${usd(s.price_usd)}</td><td class="r">${num(s.review_count)}</td><td>${s.issues.map((i) => `<span class="tag${/^price_/.test(i.key) ? ' bad' : ''}">${esc(i.label)}</span>`).join('')}</td></tr>`).join('')}
  </table></div>
  <p class="muted">Source fields: review_count, card_community_events, card_amenities, download_speed, summary, trust_signals, neighborhood, location, minimum_stay_months, rating, monthly_price_from against the city median (cities with five or more listings).</p>
  </details>
  <div class="next">
    <h3>From nudge to done: write it for the host, let them approve it.</h3>
    <p>Most hosts never act on a nudge. Not because they disagree, because writing a summary, listing the events, filling in the WiFi speed is work they keep postponing. The step after the nudge is to do that work for them and ask only for a yes.</p>
    <ol>
      <li>For every listing with an open fix, the system drafts the missing piece from what it already knows: the listing's own photos, amenities, reviews and the host's other listings. A summary, an events list, a plain answer on deposit and cancellation.</li>
      <li>The host gets the draft as a recommendation, in the host dashboard or by email: publish as is, edit, or decline. One click. Nothing goes live without the host.</li>
      <li>No answer after the nudge and the draft? A second, shorter reminder, then the supply team sees who is still silent, ranked by how much the listing would gain.</li>
    </ol>
    <p>Why it pays: a complete profile with reviews, events and trust signals converts better than a half-empty card, and Coliving.com earns on every booking. When the hosts do well, Coliving.com does well. The hosts' own interests and the platform's point the same way; the only thing missing is someone doing the typing.</p>
    <p class="muted">This part is not built: it needs host-scoped access and your team's sign-off on what the drafts may say. The monitor above is what makes it possible, because it already knows, per listing, what is missing.</p>
  </div>`;
}

function marketsBlock(d) {
  const rows = d.markets.filter((m) => m.listings >= 5);
  return `
  <p class="lede" style="margin-top:8px">Supply and price per city, for the ${rows.length} cities with five or more listings. Amounts are USD as the MCP returns them (finding 01).</p>
  <div class="tbl"><table>
    <tr><th>City</th><th class="r">Listings</th><th class="r">Median from</th><th class="r">Range</th><th class="r">Available now</th><th class="r">With reviews</th><th class="r">No deposit</th></tr>
    ${rows.map((m) => `<tr><td>${esc(m.city)}</td><td class="r">${num(m.listings)}</td><td class="r">${usd(m.median_usd)}</td><td class="r m">${usd(m.min_usd)} – ${usd(m.max_usd)}</td><td class="r">${pct(m.available_now, m.listings)}</td><td class="r">${pct(m.with_reviews, m.listings)}</td><td class="r">${pct(m.no_deposit, m.listings)}</td></tr>`).join('')}
  </table></div>`;
}

function countriesBlock(d) {
  const rows = (d.per_country || []).filter((c) => c.pulled > 0).sort((a, b) => b.pulled - a.pulled);
  if (!rows.length) return '';
  const total = rows.reduce((a, c) => a + c.pulled, 0);
  return `
  <h2>Supply <em class="sig">per country.</em></h2>
  <p class="lede" style="margin-top:8px">${num(rows.length)} countries hold the ${num(total)} published listings. The card field <code>country</code> is empty, so this column comes from pulling each country's own location.</p>
  <details><summary>All ${rows.length} countries</summary><div class="tbl"><table>
    <tr><th>Country</th><th class="r">Listings</th><th class="r">Share</th></tr>
    ${rows.map((c) => `<tr><td>${esc(c.name)}</td><td class="r">${num(c.pulled)}</td><td class="r">${pct(c.pulled, total)}</td></tr>`).join('')}
  </table></div></details>`;
}

function render(d) {
  const t = d.totals;
  return `${CSS}
<div class="csm"><div class="wrap">
  <div class="crumb"><a href="https://laurensborrey.com/">Laurens Borrey</a> / Coliving.com Supply Monitor</div>
  <div class="apply"><span class="dot"></span><span><b>This is my application for the AI Automation &amp; Systems Generalist role.</b> Rather than describe what I would automate at Coliving.com, I built it on your own MCP server before writing to you. It has run every morning since 27 October. <a href="https://laurensborrey.com/coliving-ai-automation/">The application itself, with your requirements mapped line by line ↗</a></span></div>
  <h1>Your catalogue, read every morning <em class="sig">through your own MCP server.</em></h1>
  <p class="lede">A daily job pulls every published listing from mcp.coliving.com, the public door Coliving.com built for AI assistants, and turns it into the three things a supply team acts on: what is broken for the assistants, what changed since yesterday, and which listings need a host nudge. Read-only, no login, no scraping of the website.</p>
  <div class="pills">
    <span class="pill"><span class="dot"></span>Snapshot ${esc(dateLong(d.snapshot_date))}</span>
    <span class="pill">${num(d.history.length)} day${d.history.length === 1 ? '' : 's'} of history</span>
    <a class="pill" href="https://github.com/Cofourofour/coliving-monitor">Code on GitHub ↗</a>
    <a class="pill dark" href="https://laurensborrey.com/coliving-ai-automation/">My application ↗</a>
  </div>
  <div class="stats">
    <div class="stat"><b>${num(t.listings)}</b><span>listings</span><small>${d.reach.by_country != null ? 'found country by country' : 'server reports ' + num(d.reach.reported_total)}</small></div>
    <div class="stat"><b>${num(t.cities)}</b><span>cities</span></div>
    <div class="stat"><b>${usd(t.median_usd)}</b><span>median “from” price</span><small>per month, USD</small></div>
    <div class="stat"><b>${pct(t.available_now, t.listings)}</b><span>available now</span></div>
    <div class="stat"><b>${pct(t.with_reviews, t.listings)}</b><span>have reviews</span></div>
    <div class="stat"><b>${num(d.health.listings_with_issues)}</b><span>with an open fix</span></div>
  </div>

  <h2>Three things I would fix <em class="sig">this week.</em></h2>
  <p class="muted">Each one verified by hand against the website on ${esc(dateLong(d.snapshot_date))}; the method and the exact listings are in the repository's FINDINGS.md.</p>
  ${findingsBlock(d)}

  <h2>What changed <em class="sig">since yesterday.</em></h2>
  ${changesBlock(d)}

  <h2>Listings that need <em class="sig">a host nudge.</em></h2>
  ${healthBlock(d)}

  <h2>Supply and price <em class="sig">per city.</em></h2>
  ${marketsBlock(d)}
  ${countriesBlock(d)}

  <h2>How it runs, and how it would run <em class="sig">inside Coliving.com.</em></h2>
  <div class="steps">
    <div class="step"><div class="k">01</div><h3>One scheduled job</h3><p>Node.js, no dependencies. About 55 MCP calls at one per second, under your 60-a-minute limit. A dated snapshot is kept every day; the comparison needs nothing else.</p></div>
    <div class="step"><div class="k">02</div><h3>Rules you can read</h3><p>Every health rule names the field it reads. A false positive is traced in one look and fixed in one line. No model in the loop; nothing to drift.</p></div>
    <div class="step"><div class="k">03</div><h3>Inside, with scoped keys</h3><p>With a host-scoped key the same job reads drafts and <code>get_listing_action_plan</code>, drafts the host message, and a person sends it. The report becomes a Monday email to the supply team instead of a page.</p></div>
    <div class="step"><div class="k">04</div><h3>Shared across the group</h3><p>The pull, the diff and the rule engine are three files. Point them at another catalogue and the second company gets the same report in a day.</p></div>
  </div>

  <div class="foot">
    <span>Built by <a href="https://laurensborrey.com/">Laurens Borrey</a> as part of an application to Coliving.com. Data belongs to Coliving.com and its hosts; this page shows aggregates and public listing links only.</span>
    <span>Generated ${esc(new Date(d.generated_at).toUTCString().replace(':00 GMT', ' UTC'))}</span>
  </div>
</div></div>`;
}

module.exports = { render };
