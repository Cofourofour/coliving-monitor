// Coliving.com public MCP client (https://mcp.coliving.com/mcp).
// Discovery tools need no token. The server allows 60 requests a minute (x-ratelimit-limit: 60) and
// counts every HTTP request, including initialize and notifications. An over-limit request gets
// HTTP 429 with {"message":"Too Many Attempts."}: no JSON-RPC result at all.
//
// Rules this client keeps, because a silent gap in a catalogue pull reads as "listings gone":
// - every HTTP request is paced, by default at most 50 a minute (1.2 s apart);
// - 429, any non-2xx status, an empty body where a reply is expected, a body that is not JSON-RPC,
//   and a tool reply with no text are errors, never an empty result;
// - errors are retried with exponential backoff, honouring Retry-After / X-RateLimit-Reset, and when
//   x-ratelimit-remaining reaches 0 the next request waits for the window to reset;
// - walk() checks every page has `items` and `pagination`, so a malformed page throws instead of
//   ending the walk early.
'use strict';

const URL = process.env.COLIVING_MCP_URL || 'https://mcp.coliving.com/mcp';
const PER_MINUTE = Number(process.env.COLIVING_MCP_PER_MIN || 50);
const MIN_GAP_MS = Number(process.env.COLIVING_MCP_GAP_MS || Math.ceil(60000 / PER_MINUTE));
const MAX_ATTEMPTS = Number(process.env.COLIVING_MCP_ATTEMPTS || 6);
const BACKOFF_MS = Number(process.env.COLIVING_MCP_BACKOFF_MS || 2000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class McpError extends Error {
  constructor(message, { status = null, retryAfterMs = null, retryable = true, session = false } = {}) {
    super(message);
    this.name = 'McpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.retryable = retryable;
    this.session = session; // the session is probably gone: start a new one before retrying
  }
}

const state = { sessionId: null, nextId: 1, lastAt: 0, notBefore: 0, requests: 0, retries: 0, rateLimited: 0 };
// Tests swap the transport; production uses global fetch.
let transport = (url, opts) => fetch(url, opts);
function setTransport(fn) { transport = fn || ((url, opts) => fetch(url, opts)); }
function reset() { Object.assign(state, { sessionId: null, nextId: 1, lastAt: 0, notBefore: 0, requests: 0, retries: 0, rateLimited: 0 }); }
function stats() { return { requests: state.requests, retries: state.retries, rate_limited: state.rateLimited, per_minute: Math.floor(60000 / MIN_GAP_MS) }; }

// Seconds or an HTTP date in Retry-After; X-RateLimit-Reset as epoch seconds or seconds from now.
function retryAfterMs(headers, now = Date.now()) {
  const ra = headers.get('retry-after');
  if (ra != null && ra !== '') {
    if (/^\d+(\.\d+)?$/.test(ra.trim())) return Math.ceil(Number(ra) * 1000);
    const t = Date.parse(ra);
    if (!Number.isNaN(t)) return Math.max(0, t - now);
  }
  const reset = headers.get('x-ratelimit-reset');
  if (reset != null && /^\d+$/.test(reset.trim())) {
    const n = Number(reset);
    return n > 1e9 ? Math.max(0, n * 1000 - now) : n * 1000;
  }
  return null;
}

async function pace() {
  const wait = Math.max(MIN_GAP_MS - (Date.now() - state.lastAt), state.notBefore - Date.now());
  if (wait > 0) await sleep(wait);
  state.lastAt = Date.now();
}

function parseBody(text) {
  try { return JSON.parse(text); } catch { /* fall through to SSE */ }
  // Streamable HTTP may answer as SSE; the last data: frame carries the result.
  const frames = text.split(/\r?\n/).filter((l) => l.startsWith('data:'));
  if (!frames.length) return undefined;
  try { return JSON.parse(frames[frames.length - 1].slice(5)); } catch { return undefined; }
}

// One HTTP request. `expectReply` is false only for notifications (the server answers 202, no body).
async function rpc(body, { expectReply = true } = {}) {
  await pace();
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (state.sessionId) headers['mcp-session-id'] = state.sessionId;
  state.requests++;
  let res;
  try { res = await transport(URL, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (e) { throw new McpError(`network: ${e.message}`); }
  const sid = res.headers.get('mcp-session-id');
  if (sid) state.sessionId = sid;
  const remaining = res.headers.get('x-ratelimit-remaining');
  const after = retryAfterMs(res.headers);
  if (remaining != null && Number(remaining) <= 0) state.notBefore = Date.now() + (after ?? 60000);
  const text = await res.text();
  if (res.status === 429) {
    state.rateLimited++;
    const wait = after ?? 60000;
    state.notBefore = Math.max(state.notBefore, Date.now() + wait);
    throw new McpError(`HTTP 429 rate limited: ${text.slice(0, 120)}`, { status: 429, retryAfterMs: wait });
  }
  if (res.status < 200 || res.status >= 300) {
    throw new McpError(`HTTP ${res.status}: ${text.slice(0, 120)}`, { status: res.status, retryAfterMs: after, session: res.status === 400 || res.status === 404, retryable: res.status >= 500 || res.status === 400 || res.status === 404 || res.status === 408 });
  }
  if (!expectReply) return null;
  if (!text || !text.trim()) throw new McpError(`empty body (HTTP ${res.status})`, { status: res.status });
  const msg = parseBody(text);
  if (!msg || typeof msg !== 'object') throw new McpError(`not JSON-RPC: ${text.slice(0, 120)}`, { status: res.status });
  if (msg.error) {
    const m = msg.error.message || JSON.stringify(msg.error);
    throw new McpError(`JSON-RPC error: ${m}`, { status: res.status, session: /session/i.test(m) });
  }
  if (!('result' in msg)) throw new McpError(`no result in reply: ${text.slice(0, 120)}`, { status: res.status });
  return msg.result;
}

async function init() {
  if (state.sessionId) return;
  await rpc({ jsonrpc: '2.0', id: state.nextId++, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'coliving-monitor', version: '0.2.0' } } });
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { expectReply: false });
}

// Calls one tool. Returns the parsed JSON the tool put in its text content, or { _text } when it is
// Markdown. `validate(result)` may throw to reject a reply that parsed but is not what was asked for;
// that counts as a failed attempt and is retried. Never returns an empty stand-in for a failure.
async function call(name, args = {}, { attempts = MAX_ATTEMPTS, validate } = {}) {
  let last;
  let tried = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    tried = attempt;
    try {
      await init();
      const r = await rpc({ jsonrpc: '2.0', id: state.nextId++, method: 'tools/call', params: { name, arguments: args } });
      const text = (r?.content || []).map((c) => c.text || '').join('\n');
      if (r?.isError) throw new McpError(`${name}: tool error: ${text.slice(0, 200)}`, { retryable: false });
      if (!text.trim()) throw new McpError(`${name}: tool reply has no text`);
      let out;
      try { out = JSON.parse(text); } catch { out = { _text: text }; }
      if (validate) {
        try { validate(out); } catch (e) { throw new McpError(`${name}: ${e.message}`); }
      }
      return out;
    } catch (e) {
      last = e instanceof McpError ? e : new McpError(e.message);
      if (!last.retryable || attempt >= attempts) break;
      state.retries++;
      if (last.session) state.sessionId = null;
      const backoff = BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(Math.max(backoff, last.retryAfterMs || 0));
    }
  }
  last.message = `${name} ${JSON.stringify(args)} failed after ${tried} attempt(s): ${last.message}`;
  throw last;
}

function validatePage(r) {
  if (!r || !Array.isArray(r.items)) throw new Error('page has no items array');
  if (!r.pagination || typeof r.pagination !== 'object') throw new Error('page has no pagination');
}

// Walks search_listings with the given filters until the server says there is no next page or a page
// comes back empty. Every page is validated, so a failed call throws instead of ending the walk.
// Returns the items, what the server reported on page one, and `short` when the walk returned fewer
// unique items than the server reported (the old 1,000-item cap looked like that).
async function walk(filters = {}, { perPage = 100, onPage, maxPages = 500 } = {}) {
  const items = [];
  const seen = new Set();
  let reported = null;
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const r = await call('search_listings', { ...filters, limit: perPage, page }, { validate: validatePage });
    pages = page;
    const got = r.items;
    if (reported === null) reported = { total: r.pagination.total ?? null, pages: r.pagination.total_pages ?? null };
    if (onPage) onPage(page, got.length, reported);
    if (!got.length) break;
    for (const x of got) if (!seen.has(x.unique_id)) { seen.add(x.unique_id); items.push(x); }
    if (r.pagination.has_next_page === false) break;
  }
  const short = reported && reported.total != null ? items.length < reported.total : false;
  return { items, reported, pages, short };
}

// The unfiltered catalogue walk (what an assistant gets when it searches without a place).
async function pullCatalogue(filters = {}, opts = {}) { return walk(filters, opts); }

// The whole catalogue, one country at a time. The country the listing was found under is written onto
// the card as `country_resolved` (the card's own `country` is used when it has one).
async function pullByCountries(countries, { filters = {}, onCountry } = {}) {
  const byId = new Map();
  const perCountry = [];
  for (const c of countries) {
    const { items, reported, short } = await walk({ ...filters, location_id: c.location_id });
    let fresh = 0;
    for (const x of items) { if (!byId.has(x.unique_id)) { fresh++; byId.set(x.unique_id, { ...x, country_resolved: x.country || c.name, found_under: c.name }); } }
    perCountry.push({ name: c.name, location_id: c.location_id, reported: reported?.total ?? null, pulled: items.length, new: fresh, short });
    if (onCountry) onCountry(perCountry[perCountry.length - 1]);
  }
  return { items: [...byId.values()], perCountry };
}

module.exports = { call, walk, pullCatalogue, pullByCountries, sleep, McpError, retryAfterMs, setTransport, reset, stats, MIN_GAP_MS };
