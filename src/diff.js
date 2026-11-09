// Day-over-day changes between two catalogue snapshots.
//
// Two things the raw fields do that are not changes, both seen in the daily pulls from 28 Oct 2026:
// - `available_from` on an "available now" listing is the pull date, so it moves every day on ~95% of
//   the catalogue. Only a status change, or a different future date, counts as an availability change.
// - Prices are converted to USD upstream, so most cards drift by a fraction of a percent a day. A move
//   counts as a price change at MIN_PRICE_PCT or more; smaller moves are counted separately.
'use strict';

const MIN_PRICE_PCT = 2;

function index(items) { const m = new Map(); for (const x of items) m.set(x.unique_id, x); return m; }

function diff(prevItems, curItems, { minPricePct = MIN_PRICE_PCT } = {}) {
  const prev = index(prevItems || []);
  const cur = index(curItems || []);
  const added = [], removed = [], priceChanged = [], availabilityChanged = [];
  let smallPriceMoves = 0;
  for (const [id, x] of cur) {
    const p = prev.get(id);
    if (!p) { added.push(brief(x)); continue; }
    if (typeof p.monthly_price_from === 'number' && typeof x.monthly_price_from === 'number' && p.monthly_price_from > 0 && Math.abs(p.monthly_price_from - x.monthly_price_from) >= 1) {
      const pctChange = (100 * (x.monthly_price_from - p.monthly_price_from)) / p.monthly_price_from;
      if (Math.abs(pctChange) >= minPricePct) priceChanged.push({ ...brief(x), from_usd: Math.round(p.monthly_price_from), to_usd: Math.round(x.monthly_price_from), change_pct: +pctChange.toFixed(1) });
      else smallPriceMoves++;
    }
    const bothNow = p.availability_status === 'available_now' && x.availability_status === 'available_now';
    if (!bothNow && (p.availability_status !== x.availability_status || p.available_from !== x.available_from)) {
      availabilityChanged.push({ ...brief(x), from: `${p.availability_status} ${p.available_from}`, to: `${x.availability_status} ${x.available_from}` });
    }
  }
  for (const [id, p] of prev) if (!cur.has(id)) removed.push(brief(p));
  return { added, removed, priceChanged: priceChanged.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct)), availabilityChanged, smallPriceMoves, minPricePct };
}

function brief(x) { return { unique_id: x.unique_id, name: x.card_display_name || x.name, city: x.location_display, url: x.url, price_usd: typeof x.monthly_price_from === 'number' ? Math.round(x.monthly_price_from) : null, available_from: x.available_from || null, availability_status: x.availability_status || null }; }

module.exports = { diff, MIN_PRICE_PCT };
