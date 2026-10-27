// Day-over-day changes between two catalogue snapshots.
'use strict';

function index(items) { const m = new Map(); for (const x of items) m.set(x.unique_id, x); return m; }

function diff(prevItems, curItems) {
  const prev = index(prevItems || []);
  const cur = index(curItems || []);
  const added = [], removed = [], priceChanged = [], availabilityChanged = [];
  for (const [id, x] of cur) {
    const p = prev.get(id);
    if (!p) { added.push(brief(x)); continue; }
    if (typeof p.monthly_price_from === 'number' && typeof x.monthly_price_from === 'number' && Math.abs(p.monthly_price_from - x.monthly_price_from) >= 1) {
      priceChanged.push({ ...brief(x), from_usd: Math.round(p.monthly_price_from), to_usd: Math.round(x.monthly_price_from), change_pct: +((100 * (x.monthly_price_from - p.monthly_price_from)) / p.monthly_price_from).toFixed(1) });
    }
    if (p.availability_status !== x.availability_status || p.available_from !== x.available_from) {
      availabilityChanged.push({ ...brief(x), from: `${p.availability_status} ${p.available_from}`, to: `${x.availability_status} ${x.available_from}` });
    }
  }
  for (const [id, p] of prev) if (!cur.has(id)) removed.push(brief(p));
  return { added, removed, priceChanged: priceChanged.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct)), availabilityChanged };
}

function brief(x) { return { unique_id: x.unique_id, name: x.card_display_name || x.name, city: x.location_display, url: x.url, price_usd: typeof x.monthly_price_from === 'number' ? Math.round(x.monthly_price_from) : null }; }

module.exports = { diff };
