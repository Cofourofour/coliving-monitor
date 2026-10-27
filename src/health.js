// Listing health: what a human on the Coliving.com supply team would fix, computed from the public card
// fields only. Every rule names the field it reads so a false positive can be traced in one look.
'use strict';

const RULES = [
  // [key, label for the fix list, test, weight]
  ['no_reviews', 'No reviews yet', (x) => !x.review_count, 2],
  ['no_events', 'No community events listed', (x) => !(x.card_community_events && x.card_community_events.total_count), 2],
  ['few_amenities', 'Fewer than 8 amenities listed', (x) => (x.card_amenities && x.card_amenities.total_count || 0) < 8, 1],
  ['no_speed', 'No WiFi download speed', (x) => x.download_speed == null, 1],
  // summary and trust_signals are empty on most cards; they read as platform fields, not host work,
  // so they are counted (weight 0) but never put a listing on the fix list by themselves.
  ['no_summary', 'No summary text on the card', (x) => !x.summary, 0],
  ['no_trust', 'No trust signal (deposit, cancellation, verification)', (x) => !(x.trust_signals && x.trust_signals.length), 0],
  ['no_neighborhood', 'No neighborhood', (x) => !x.neighborhood, 1],
  ['no_location', 'No city', (x) => !x.location, 3],
  ['long_min_stay', 'Minimum stay of 6 months or more', (x) => (x.minimum_stay_months || 0) >= 6, 1],
  ['five_star_thin', 'Rating 5.0 on fewer than 3 reviews', (x) => x.rating === 5 && (x.review_count || 0) < 3, 0],
  ['rating_without_reviews', 'Rating shown but review count is 0', (x) => x.rating != null && !x.review_count && x.rating_source === 'review_rating', 1],
];

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// The MCP returns USD amounts whatever the label says (verified against the website, see FINDINGS),
// so prices are comparable across cities as they are. If that is ever fixed upstream the label will
// match the number and this helper will need a real FX step: it checks for that case and refuses.
function usdPrice(x) {
  return typeof x.monthly_price_from === 'number' && x.monthly_price_from > 0 ? x.monthly_price_from : null;
}

function score(items) {
  const byCity = {};
  for (const x of items) { const k = x.location_display || '(no city)'; (byCity[k] = byCity[k] || []).push(x); }
  const cityMedian = {};
  for (const [k, arr] of Object.entries(byCity)) cityMedian[k] = arr.length >= 5 ? median(arr.map(usdPrice).filter(Boolean)) : null;

  const scored = items.map((x) => {
    const issues = [];
    let penalty = 0;
    for (const [key, label, test, weight] of RULES) {
      let hit = false;
      try { hit = !!test(x); } catch { hit = false; }
      if (hit) { issues.push({ key, label }); penalty += weight; }
    }
    const city = x.location_display || '(no city)';
    const m = cityMedian[city];
    const p = usdPrice(x);
    let priceRatio = null;
    if (m && p) {
      priceRatio = +(p / m).toFixed(2);
      if (priceRatio >= 2.5) { issues.push({ key: 'price_high', label: `Price ${priceRatio}x the ${city} median` }); penalty += 2; }
      else if (priceRatio <= 0.4) { issues.push({ key: 'price_low', label: `Price ${priceRatio}x the ${city} median` }); penalty += 2; }
    }
    return { unique_id: x.unique_id, name: x.card_display_name || x.name, url: x.url, city, country: x.country || null, source_currency: x.source_currency, price_usd: p, price_ratio: priceRatio, review_count: x.review_count || 0, rating: x.rating, available_from: x.available_from, availability_status: x.availability_status, issues, penalty };
  });

  const issueCounts = {};
  for (const s of scored) for (const i of s.issues) issueCounts[i.key] = (issueCounts[i.key] || 0) + 1;
  const labels = Object.fromEntries(RULES.map(([k, l]) => [k, l]));
  labels.price_high = 'Price 2.5x or more above the city median';
  labels.price_low = 'Price 0.4x or less of the city median';
  return { scored, issueCounts, labels, cityMedian };
}

function markets(items) {
  const byCity = {};
  for (const x of items) { const k = x.location_display || '(no city)'; (byCity[k] = byCity[k] || []).push(x); }
  const rows = Object.entries(byCity).map(([city, arr]) => {
    const prices = arr.map(usdPrice).filter(Boolean);
    return {
      city,
      listings: arr.length,
      median_usd: prices.length ? Math.round(median(prices)) : null,
      min_usd: prices.length ? Math.round(Math.min(...prices)) : null,
      max_usd: prices.length ? Math.round(Math.max(...prices)) : null,
      available_now: arr.filter((x) => x.availability_status === 'available_now').length,
      with_reviews: arr.filter((x) => x.review_count > 0).length,
      no_deposit: arr.filter((x) => x.has_no_security_deposit).length,
      currencies: [...new Set(arr.map((x) => x.source_currency))].sort(),
    };
  });
  return rows.sort((a, b) => b.listings - a.listings);
}

// Currency label check: a listing whose label is not USD but whose number sits inside the USD range
// of its city is carrying a USD amount under a local label. We report the count per label; the proof
// is the website comparison kept in FINDINGS.md, not this heuristic.
function currencyLabels(items) {
  const by = {};
  for (const x of items) { const k = x.source_currency || '(none)'; by[k] = by[k] || { label: k, listings: 0, example: null }; by[k].listings++; if (!by[k].example) by[k].example = { unique_id: x.unique_id, url: x.url, display: x.monthly_price_from_display, city: x.location_display }; }
  return Object.values(by).sort((a, b) => b.listings - a.listings);
}

module.exports = { score, markets, currencyLabels, median, RULES };
