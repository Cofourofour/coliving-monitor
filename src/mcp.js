// Coliving.com public MCP client (https://mcp.coliving.com/mcp).
// Discovery tools need no token. Rate limit observed: 60 requests/minute (x-ratelimit-limit header),
// so every call sleeps a second; one full catalogue pull is ~50 calls and takes about a minute.
'use strict';

const URL = process.env.COLIVING_MCP_URL || 'https://mcp.coliving.com/mcp';
const MIN_GAP_MS = Number(process.env.COLIVING_MCP_GAP_MS || 1100);

let sessionId = null;
let nextId = 1;
let lastCallAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(body) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.headers.get('mcp-session-id')) sessionId = res.headers.get('mcp-session-id');
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch {
    // Streamable HTTP may answer as SSE; the last data: frame carries the result.
    const frames = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
    return frames[frames.length - 1] || null;
  }
}

async function init() {
  if (sessionId) return;
  await rpc({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'coliving-monitor', version: '0.1.0' } } });
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

// Calls one tool. Returns the parsed JSON the tool put in its text content, or { _text } when it is Markdown.
async function call(name, args = {}, { retries = 3 } = {}) {
  await init();
  for (let attempt = 1; ; attempt++) {
    const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    try {
      const r = await rpc({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
      if (r?.error) throw new Error(`${name}: ${r.error.message || JSON.stringify(r.error)}`);
      const text = (r?.result?.content || []).map((c) => c.text || '').join('\n');
      if (r?.result?.isError) throw new Error(`${name}: ${text.slice(0, 200)}`);
      try { return JSON.parse(text); } catch { return { _text: text }; }
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(2000 * attempt);
      sessionId = null; // a fresh session after a failure
    }
  }
}

// Walks search_listings with the given filters until a page comes back empty or the server says there
// is no next page. Returns the items and what the server reported on page one, so a caller can see
// when the two disagree (the unfiltered walk reports 1,142 but stops handing out items after 1,000).
async function walk(filters = {}, { perPage = 20, onPage } = {}) {
  const items = [];
  let reported = null;
  for (let page = 1; ; page++) {
    const r = await call('search_listings', { ...filters, limit: perPage, page });
    const got = r?.items || [];
    if (reported === null) reported = { total: r?.pagination?.total ?? null, pages: r?.pagination?.total_pages ?? null };
    if (onPage) onPage(page, got.length, reported);
    if (!got.length) break;
    items.push(...got);
    if (r?.pagination && r.pagination.has_next_page === false) break;
  }
  return { items, reported };
}

// The unfiltered catalogue walk (what an assistant gets when it searches without a place).
async function pullCatalogue(opts = {}) { return walk({}, opts); }

// The whole catalogue, one country at a time. Cards come back with country: null, so the country the
// listing was found under is written onto the card as `country_resolved`.
async function pullByCountries(countries, { onCountry } = {}) {
  const byId = new Map();
  const perCountry = [];
  for (const c of countries) {
    const { items, reported } = await walk({ location_id: c.location_id });
    let fresh = 0;
    for (const x of items) { if (!byId.has(x.unique_id)) { fresh++; byId.set(x.unique_id, { ...x, country_resolved: c.name }); } }
    perCountry.push({ name: c.name, location_id: c.location_id, reported: reported?.total ?? null, pulled: items.length, new: fresh });
    if (onCountry) onCountry(perCountry[perCountry.length - 1]);
  }
  return { items: [...byId.values()], perCountry };
}

module.exports = { call, walk, pullCatalogue, pullByCountries, sleep };
