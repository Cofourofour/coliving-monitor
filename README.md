# Coliving.com Supply Monitor

A daily, read-only monitor of the Coliving.com catalogue built on the company's own public MCP server
(`mcp.coliving.com`). It answers three questions a supply team asks every morning:

1. What is broken for the AI assistants that use the MCP server (see [FINDINGS.md](FINDINGS.md)).
2. What changed since yesterday: new listings, listings gone, price and availability moves.
3. Which listings need a host nudge, with the fix list per listing.

Live report: https://laurensborrey.com/coliving-supply-monitor/

Built by Laurens Borrey as part of an application for the AI Automation & Systems Generalist role.
No login, no scraping of the website, about 150 MCP requests a day at most 50 a minute (the server allows 60).

## Run

```
node src/run.js                # pull, snapshot, score, diff, report, publish (if LB_WP_* set)
node src/run.js --no-publish   # same, keep the report local
node src/run.js --offline      # rebuild the report from the latest snapshot, no network
npm test                       # offline checks for the rules, the diff, the report and the MCP client
```

Node 20+, no dependencies. Snapshots go to `data/snapshots/YYYY-MM-DD.json.gz` (about 150 KB a day),
the report to `out/report.html`, the numbers to `out/latest.json`.

Each run pulls both availability scopes of `search_listings`: the default `available_soon` (listings
available within 30 days, what an assistant gets when it names no scope) and `all_published` (every
published listing). Snapshots from 9 November 2026 hold all published listings with an
`in_default_scope` flag; earlier snapshots hold the default scope only.

Publishing needs `LB_WP_URL`, `LB_WP_USER` and `LB_WP_APP_PASSWORD` in the environment (a WordPress
application password). They are never in the repository.

## Files

| File | What it does |
|---|---|
| `src/mcp.js` | JSON-RPC client for the MCP server: session, paced at 50 requests a minute, 429 / Retry-After handling, retries with backoff, validated catalogue walk (a failed page is an error, never an empty page) |
| `src/health.js` | Listing health rules (each names the field it reads), city medians, price outliers, market table |
| `src/diff.js` | Day-over-day comparison of two snapshots (ignores the daily `available_from` roll and sub-2% price drift) |
| `src/report.js` | The HTML report, inline CSS, no scripts |
| `src/publish.js` | Updates one WordPress page through the REST API |
| `src/run.js` | The daily job |
| `deploy/cron` | The cron line used on the server (06:10 UTC) |
| `FINDINGS.md` | The verified defects with listing IDs and the website comparison |

## What it does not do

It never writes to Coliving.com, never calls the OAuth tools, and never stores anything about a
resident or a host beyond what the public listing card already shows.
