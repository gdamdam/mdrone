# mdrone-share Worker

Cloudflare Worker that powers `s.mdrone.org` — short-URL service for mdrone
scene share links, plus a small usage dashboard.

> **1.20.32 — OG card rendering removed.** The talisman / sigil / tarot /
> tessera scene cards (and their `resvg-wasm` rasteriser) were stripped along
> with the in-app share-card UI. Sharing is now a utility: short link in,
> 302 redirect out, no per-scene preview image. Link unfurls in messengers
> show no image; the recipient lands on the same drone landscape on the
> app side regardless.

- **Entry:** `worker.ts`
- **Config:** `wrangler.toml` (name `mdrone-share`, route on `s.mdrone.org`)
- **Bindings:** `SHORT` (KV) for short IDs and counters; `DASHBOARD_USER` /
  `DASHBOARD_PASS` secrets for `/mddashboard` basic-auth.

## Routes

| Method | Path                | Purpose                                                        |
| ------ | ------------------- | -------------------------------------------------------------- |
| GET    | `/health`           | Liveness probe. Returns `{ ok: true, v: <pkg.version> }`.      |
| GET    | `/?z=<payload>`     | 302 to `https://mdrone.org/?z=<payload>` (long-form share link). |
| GET    | `/?b=<payload>`     | Same, plain-base64 fallback.                                   |
| GET    | `/`                 | 302 to `https://mdrone.org` when no payload.                   |
| GET    | `/<id>`             | Resolve a 6-char short ID → 302 to its stored URL.             |
| POST   | `/shorten`          | Create / dedupe a short ID for a scene URL.                    |
| POST   | `/track`            | Bump `sc:{id}` (share count) from the client.                  |
| GET    | `/mddashboard`      | HTML table of per-id share/play counts (basic-auth).           |
| GET    | `/stats`            | JSON view of the same counters (basic-auth).                   |

## How to deploy

```bash
cd worker
npx wrangler deploy            # deploys with the bound KV + route
npx wrangler secret put DASHBOARD_USER
npx wrangler secret put DASHBOARD_PASS
```

## Diagnostics

Three layers — pick the smallest one that answers your question.

### 1. Health & version (instant)

```bash
curl https://s.mdrone.org/health
# → {"ok":true,"v":"1.20.8"}
```

The `v` field is read from `package.json` at build time, so it's the fastest
way to confirm a deploy actually shipped.

### 2. Live tail (real-time logs)

The worker emits structured `console.warn` calls; tail them with Wrangler.

```bash
cd worker
npx wrangler tail mdrone-share --format pretty

# only slow OG renders (>8ms)
npx wrangler tail mdrone-share --search SLOW_OG

# only errors (5xx)
npx wrangler tail mdrone-share --status error

# only POSTs (e.g. /shorten, /track)
npx wrangler tail mdrone-share --method POST
```

Currently emitted log events:

- **`SLOW_OG`** — `{ duration_ms, path }`. Logged whenever an OG HTML or PNG
  render exceeds 8ms. Useful for spotting resvg/wasm regressions.
- **Unhandled exceptions** — surface as red entries in `tail` with a stack
  trace pointing at compiled `worker.js` (no source maps yet, see below).

### 3. Usage analytics (KV counters + dashboard)

Counters live in the `SHORT` KV namespace and mirror the mpump worker so the
dashboard format is shared.

| Key       | Meaning                                                              |
| --------- | -------------------------------------------------------------------- |
| `u:{id}`  | id → original URL (the redirect map).                                |
| `sc:{id}` | Share count. Bumped by client `POST /track` on copy / native share.  |
| `pc:{id}` | Play count. Bumped server-side on non-bot loads (UA-filtered).       |

The bot filter (`BOT_RE` in `worker.ts`) excludes Slack/Signal/iMessage/etc.
unfurl fetches so link previews don't inflate `pc:`.

```bash
# Human view (HTTP basic-auth with DASHBOARD_USER/DASHBOARD_PASS)
open https://s.mdrone.org/dashboard

# Machine view
curl -u "$USER:$PASS" https://s.mdrone.org/stats | jq
```

### 4. Cloudflare dashboard metrics (built-in, no code)

`Workers & Pages → mdrone-share → Metrics` shows requests / errors / CPU time
/ subrequest counts per colo. Always available, no config required.

## What's NOT wired up (yet)

These are deliberate gaps — flip them on if you need them:

- **Workers Logs (persisted, queryable):** add to `wrangler.toml`:
  ```toml
  [observability]
  enabled = true
  head_sampling_rate = 1.0
  ```
  Then `Workers & Pages → mdrone-share → Logs` gives you a searchable
  history of every `console.*` call. `wrangler tail` only shows live traffic.
- **Source maps:** stack traces currently point at compiled JS. Set
  `upload_source_maps = true` in `wrangler.toml` to get original `worker.ts`
  line numbers in tail/log output.
- **External sinks (Sentry, Datadog, Analytics Engine):** none configured.
  Use a Tail Worker or `@sentry/cloudflare` if you need long-term retention
  or alerting.

## Local development

```bash
cd worker
npx wrangler dev               # local Miniflare, KV state in .wrangler/state
npx wrangler dev --remote      # runs on the edge, logs stream to your shell
```

## Implementation notes

- The PNG card is built by `src/shareCard/svgBuilder.ts` and rasterised by
  `@resvg/resvg-wasm`. The wasm module is bundled as a `CompiledWasm` binding
  (see `wrangler.toml`-adjacent comment in `worker.ts`) so init is one-shot
  and cached across requests.
- resvg-wasm cannot see host fonts; it falls back to its internal defaults
  for "Georgia, serif" and "ui-monospace, monospace".
- KV namespace `SHORT` uses the same id for prod and `preview_id` — create a
  separate one with `wrangler kv namespace create SHORT --preview` if you
  want dev/prod isolation.
