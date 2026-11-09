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
// the daily date roll on an available-now listing and sub-2% price drift are not changes
const drift = diff([card({ unique_id: 'a', available_from: '2026-11-08', monthly_price_from: 1000 })], [card({ unique_id: 'a', available_from: '2026-11-09', monthly_price_from: 1012 })]);
ok(drift.availabilityChanged.length === 0, 'available_from roll on available_now is not a change');
ok(drift.priceChanged.length === 0 && drift.smallPriceMoves === 1, '1.2% drift counted as a small move only');
const moved = diff([card({ unique_id: 'a', availability_status: 'available_from_date', available_from: '2026-12-01' })], [card({ unique_id: 'a', availability_status: 'available_from_date', available_from: '2027-01-01' })]);
ok(moved.availabilityChanged.length === 1, 'a different future date is a change');

// report renders, has no && and no emoji, carries the key numbers and the defect status
const checks = {
  currency: { status: 'fixed', last_seen: '2026-10-29', fixed_seen: '2026-10-30', today: '0 of 2,067 cards carry a non-USD currency label' },
  cap: { status: 'fixed', last_seen: '2026-10-29', fixed_seen: '2026-10-30', today: 'available_soon: server reports 1,241, the walk returned 1,241' },
  country: { status: 'open', last_seen: '2026-11-03', fixed_seen: '2026-11-04', today: 'country empty on 12 of 2,067 cards' },
  no_city: { status: 'fixed', last_seen: '2026-11-03', fixed_seen: '2026-11-04', today: '0 cards without a city' },
  location_tree: { status: 'fixed', last_seen: '2026-11-03', fixed_seen: '2026-11-04', today: 'Indonesia returns 2 in Ubud / Bali' },
};
const latest = {
  generated_at: '2026-11-09T06:00:00Z', snapshot_date: '2026-11-09', previous_date: null, scope_basis: 'all_published',
  scopes: { available_soon: { reported_total: 1241, walk_returned: 1241 }, all_published: { reported_total: 2067, walk_returned: 2067, by_country: 2063, only_open: 4 } },
  client: { requests: 150, retries: 0, rate_limited: 0, per_minute: 50 }, checks,
  host: { unique_id: 'yfkkibzf', listing: 'Baixa', url: 'u', review_count: 58, response_rate: '0%', response_time: '0 hours' },
  reach: { by_country: 2063, unfiltered_missing: 0, only_open: 4, countries_mismatched: 0 },
  currency: { non_usd_labels: 0, by_label: [] },
  location: { country_null: 12, no_city: 0, name_variants: [], probe: [{ city: 'Paris, France', published: 188, default_scope: 56, search_reports: 56 }] },
  health: { issue_counts: { no_reviews: 248 }, labels: { no_reviews: 'No reviews yet' }, listings_with_issues: 700, worst: [{ unique_id: 'i', name: 'N', url: 'u', city: 'C', price_usd: 900, review_count: 0, issues: [{ key: 'no_reviews', label: 'No reviews yet' }] }] },
  markets: [{ city: 'C', listings: 6, median_usd: 900, min_usd: 500, max_usd: 1200, available_now: 3, with_reviews: 2, no_deposit: 1 }],
  per_country: [{ name: 'Spain', pulled: 227, new: 227 }],
  changes: null, totals: { listings: 2067, default_scope: 1241, cities: 439, available_now: 1033, with_reviews: 1232, median_usd: 1300 }, history: ['2026-11-09'],
};
const html = render(latest);
ok(!html.includes('&&'), 'no && in report');
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), 'no emoji in report');
ok(html.includes('2,067') && html.includes('1,241'), 'both scopes in report');
ok((html.match(/FIXED · first seen fixed/g) || []).length === 4 && html.includes('OPEN TODAY'), 'fixed and open defects labelled');
ok(html.includes('30 Oct 2026') && html.includes('4 Nov 2026'), 'fix dates shown');
ok(html.includes('Paris, France reports 56'), 'location count follows default scope');
ok(!/every page after 50 returns zero items|carry a non-USD label today\.<\/p>/.test(html), 'no stale defect claims');
ok(html.includes('First snapshot'), 'first-snapshot note when no previous');
const ch = { basis: 'available_soon', previous_scope: 'available_soon', default_scope: { entered: 3, left: 5, left_still_published: 4, left_unpublished: 1 }, added: d.added, removed: d.removed, priceChanged: d.priceChanged, smallPriceMoves: 7, minPricePct: 2, availabilityChanged: d.availabilityChanged };
const html2 = render({ ...latest, previous_date: '2026-11-08', changes: ch });
ok(html2.includes('Price changes (1)') && html2.includes('7 smaller moves not counted'), 'changes rendered');
ok(html2.includes('4 are still published'), 'left-the-window listings separated from gone');

console.log(`ok: ${n} checks`);
