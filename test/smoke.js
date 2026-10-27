// Offline checks for the rule engine, the diff and the report. Run: npm test
'use strict';
const assert = require('assert');
const { score, markets, currencyLabels, median } = require('../src/health');
const { diff } = require('../src/diff');
const { render } = require('../src/report');

const card = (o) => ({ unique_id: 'x', name: 'X', url: 'https://coliving.com/spaces/x', location: 'Lisbon', location_display: 'Lisbon', country: null, neighborhood: 'Baixa', monthly_price_from: 1000, source_currency: 'EUR', review_count: 10, rating: 4.5, rating_source: 'review_rating', card_community_events: { total_count: 3 }, card_amenities: { total_count: 20 }, download_speed: 100, summary: 's', trust_signals: [{ key: 'k' }], minimum_stay_months: 1, availability_status: 'available_now', available_from: '2026-10-01', has_no_security_deposit: true, ...o });

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };

// median
ok(median([3, 1, 2]) === 2, 'median odd');
ok(median([1, 2, 3, 4]) === 2.5, 'median even');

// a clean listing has no issues
let r = score([card({})]);
ok(r.scored[0].issues.length === 0, 'clean card has no issues');

// each rule fires on its field
r = score([card({ review_count: 0, rating: null })]);
ok(r.scored[0].issues.some((i) => i.key === 'no_reviews'), 'no_reviews fires');
r = score([card({ card_community_events: { total_count: 0 } })]);
ok(r.scored[0].issues.some((i) => i.key === 'no_events'), 'no_events fires');
r = score([card({ download_speed: null })]);
ok(r.scored[0].issues.some((i) => i.key === 'no_speed'), 'no_speed fires');
r = score([card({ location: null, location_display: null })]);
ok(r.scored[0].issues.some((i) => i.key === 'no_location'), 'no_location fires');
r = score([card({ rating: 5, review_count: 2 })]);
ok(r.scored[0].issues.some((i) => i.key === 'five_star_thin'), 'five_star_thin fires');

// price outliers need five listings in the city
const five = [900, 1000, 1100, 1000, 950].map((p, i) => card({ unique_id: 'c' + i, monthly_price_from: p }));
r = score([...five, card({ unique_id: 'hi', monthly_price_from: 3000 })]);
ok(r.scored.find((s) => s.unique_id === 'hi').issues.some((i) => i.key === 'price_high'), 'price_high fires at 3x median');
r = score([card({ unique_id: 'a', monthly_price_from: 100 }), card({ unique_id: 'b', monthly_price_from: 3000 })]);
ok(!r.scored.some((s) => s.issues.some((i) => /^price_/.test(i.key))), 'no price rule below five listings');

// markets
const m = markets([...five]);
ok(m[0].city === 'Lisbon' && m[0].listings === 5 && m[0].median_usd === 1000, 'markets row');
ok(currencyLabels([card({}), card({ source_currency: 'USD' })]).length === 2, 'currency labels grouped');

// diff
const prev = [card({ unique_id: 'a', monthly_price_from: 1000 }), card({ unique_id: 'gone' })];
const cur = [card({ unique_id: 'a', monthly_price_from: 1100, availability_status: 'available_from_date' }), card({ unique_id: 'new' })];
const d = diff(prev, cur);
ok(d.added.length === 1 && d.added[0].unique_id === 'new', 'added');
ok(d.removed.length === 1 && d.removed[0].unique_id === 'gone', 'removed');
ok(d.priceChanged.length === 1 && d.priceChanged[0].change_pct === 10, 'price change 10%');
ok(d.availabilityChanged.length === 1, 'availability change');

// report renders, has no && and no emoji, carries the key numbers
const latest = {
  generated_at: '2026-10-27T06:00:00Z', snapshot_date: '2026-10-27', previous_date: null,
  reach: { reported_total: 1142, reported_pages: 58, reachable: 1000 },
  currency: { non_usd_labels: 672, by_label: [{ label: 'COP', listings: 35, example: { display: 'From COP 1,081.62/mo', city: 'Medellin', url: 'u', unique_id: 'i' } }] },
  location: { country_null: 999, no_city: 4, name_variants: [['Peniche', 'Peniche, Portugal']], probe: [], gaps: [] },
  health: { issue_counts: { no_reviews: 248 }, labels: { no_reviews: 'No reviews yet' }, listings_with_issues: 700, worst: [{ unique_id: 'i', name: 'N', url: 'u', city: 'C', price_usd: 900, review_count: 0, issues: [{ key: 'no_reviews', label: 'No reviews yet' }] }] },
  markets: [{ city: 'C', listings: 6, median_usd: 900, min_usd: 500, max_usd: 1200, available_now: 3, with_reviews: 2, no_deposit: 1 }],
  changes: null, totals: { listings: 1000, cities: 200, available_now: 825, with_reviews: 752, median_usd: 1300 }, history: ['2026-10-27'],
};
const html = render(latest);
ok(!html.includes('&&'), 'no && in report');
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), 'no emoji in report');
ok(html.includes('1,142') && html.includes('1,000') && html.includes('672'), 'key numbers in report');
ok(html.includes('First snapshot'), 'first-snapshot note when no previous');
const html2 = render({ ...latest, previous_date: '2026-10-26', changes: d });
ok(html2.includes('Price changes (1)'), 'changes rendered');

console.log(`ok: ${n} checks`);
