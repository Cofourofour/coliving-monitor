// Offline checks for the MCP client: a failed call is an error, never an empty result; 429 and
// Retry-After are honoured; walks never end early on a bad page; default pace is at most 50 a minute.
// Run: npm test
'use strict';
process.env.COLIVING_MCP_GAP_MS = '1';
process.env.COLIVING_MCP_BACKOFF_MS = '1';
process.env.COLIVING_MCP_ATTEMPTS = '4';
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const mcp = require('../src/mcp');

let n = 0;
const ok = (c, m) => { assert(c, m); n++; };

// A scripted server. Each reply: { status, body, headers }. initialize and notifications are answered
// automatically; `tools` is the queue of tools/call replies, consumed in order.
function server(tools) {
  const log = [];
  mcp.reset();
  mcp.setTransport(async (url, opts) => {
    const body = JSON.parse(opts.body);
    log.push({ method: body.method, args: body.params && body.params.arguments, at: Date.now() });
    let r;
    if (body.method === 'initialize') r = { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26' } }), headers: { 'mcp-session-id': 's1' } };
    else if (body.method === 'notifications/initialized') r = { status: 202, body: '' };
    else r = tools.shift() || { status: 500, body: 'script exhausted' };
    const h = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return { status: r.status, headers: { get: (k) => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) }, text: async () => r.body };
  });
  return log;
}
const result = (obj, id = 1) => ({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(obj) }] } }) });
const sse = (obj) => ({ status: 200, body: `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(obj) }] } })}\n\n` });
const tooMany = (headers = { 'retry-after': '0' }) => ({ status: 429, body: '{"message":"Too Many Attempts."}', headers });
const page = (ids, { total, next }) => result({ items: ids.map((id) => ({ unique_id: id })), pagination: { total, total_pages: Math.ceil(total / 2), has_next_page: next } });
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(err.message), `${m} (got ${err ? err.message : 'no error'})`); return err; };

(async () => {
  // Retry-After parsing
  const H = (o) => ({ get: (k) => (o[k] ?? null) });
  ok(mcp.retryAfterMs(H({ 'retry-after': '3' })) === 3000, 'retry-after seconds');
  ok(mcp.retryAfterMs(H({ 'retry-after': new Date(Date.now() + 5000).toUTCString() })) > 3000, 'retry-after http date');
  ok(mcp.retryAfterMs(H({ 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 10) })) > 8000, 'x-ratelimit-reset epoch');
  ok(mcp.retryAfterMs(H({})) === null, 'no header, no wait');

  // a normal reply, JSON and SSE
  server([result({ a: 1 }), sse({ b: 2 })]);
  ok((await mcp.call('t')).a === 1, 'json reply');
  ok((await mcp.call('t')).b === 2, 'sse reply');

  // 429 is retried, then succeeds; the retry waits for Retry-After
  let log = server([tooMany({ 'retry-after': '0.15' }), result({ ok: true })]);
  const t0 = Date.now();
  ok((await mcp.call('t')).ok === true, '429 then success');
  ok(Date.now() - t0 >= 140, 'Retry-After honoured before the retry');
  ok(mcp.stats().rate_limited === 1 && mcp.stats().retries === 1, '429 counted');
  ok(log.filter((l) => l.method === 'initialize').length === 1, '429 does not restart the session');

  // 429 every time: an error, never an empty result
  server([tooMany(), tooMany(), tooMany(), tooMany()]);
  await rejects(mcp.call('search_listings', { page: 1 }), /429/, 'persistent 429 throws');

  // empty body, non-JSON body, JSON without a result, tool reply with no text, 5xx: all errors
  server(Array(4).fill({ status: 200, body: '' }));
  await rejects(mcp.call('t'), /empty body/, 'empty body throws');
  server(Array(4).fill({ status: 200, body: '<html>oops</html>' }));
  await rejects(mcp.call('t'), /not JSON-RPC/, 'html body throws');
  server(Array(4).fill({ status: 200, body: '{"message":"Too Many Attempts."}' }));
  await rejects(mcp.call('t'), /no result/, '429 body under a 200 status throws');
  server(Array(4).fill({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [] } }) }));
  await rejects(mcp.call('t'), /no text/, 'empty tool content throws');
  server(Array(4).fill({ status: 502, body: 'bad gateway' }));
  await rejects(mcp.call('t'), /HTTP 502/, '5xx throws after retries');

  // a tool error is not retried
  log = server([{ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'unique_id is required' }] } }) }]);
  const e = await rejects(mcp.call('get_host', {}), /after 1 attempt.*tool error/, 'tool error fails at once with the right count');
  ok(e.name === 'McpError', 'typed error');

  // x-ratelimit-remaining 0 makes the next request wait for the window
  server([{ ...result({ a: 1 }), headers: { 'x-ratelimit-remaining': '0', 'retry-after': '0.12' } }, result({ a: 2 })]);
  await mcp.call('t');
  const t1 = Date.now();
  await mcp.call('t');
  ok(Date.now() - t1 >= 100, 'remaining 0 waits for the reset');

  // walk: a rate-limited page in the middle is retried, the walk returns everything
  server([page(['a', 'b'], { total: 5, next: true }), tooMany(), page(['c', 'd'], { total: 5, next: true }), page(['e'], { total: 5, next: false })]);
  let w = await mcp.walk({}, { perPage: 2 });
  ok(w.items.length === 5 && !w.short && w.reported.total === 5, 'walk survives a 429 mid-walk');

  // walk: a page without items/pagination is retried, then fails the walk instead of ending it
  server([page(['a', 'b'], { total: 4, next: true }), ...Array(4).fill(result({ message: 'Too Many Attempts.' }))]);
  await rejects(mcp.walk({}, { perPage: 2 }), /no items array/, 'malformed page fails the walk');

  // walk: an honest empty page with has_next_page true ends the walk and is flagged short (the old cap)
  server([page(['a', 'b'], { total: 4, next: true }), page([], { total: 4, next: true })]);
  w = await mcp.walk({}, { perPage: 2 });
  ok(w.items.length === 2 && w.short === true, 'cap-like walk flagged short');

  // walk: duplicate ids across pages are counted once
  server([page(['a', 'b'], { total: 3, next: true }), page(['b', 'c'], { total: 3, next: false })]);
  w = await mcp.walk({}, { perPage: 2 });
  ok(w.items.length === 3, 'duplicates removed');

  // pullByCountries passes the scope filter and records found_under
  log = server([page(['a'], { total: 1, next: false }), page(['a', 'b'], { total: 2, next: false })]);
  const pc = await mcp.pullByCountries([{ name: 'Spain', location_id: 1 }, { name: 'Portugal', location_id: 2 }], { filters: { availability_scope: 'all_published' } });
  ok(pc.items.length === 2 && pc.items.find((x) => x.unique_id === 'b').found_under === 'Portugal', 'found_under recorded');
  ok(log.filter((l) => l.method === 'tools/call').every((l) => l.args.availability_scope === 'all_published'), 'scope passed on every page');

  // default pace without overrides: at most 50 requests a minute
  const gap = Number(execFileSync(process.execPath, ['-e', "process.stdout.write(String(require('./src/mcp').MIN_GAP_MS))"], { cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH } }).toString());
  ok(gap >= 1200, `default gap ${gap} ms is at least 1,200 ms (50 a minute)`);

  // pacing is applied to every HTTP request, initialize and notifications included
  log = server([result({ a: 1 })]);
  await mcp.call('t');
  ok(log.length === 3, 'three HTTP requests for the first call (initialize, notification, call)');

  console.log(`ok: ${n} mcp checks`);
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
