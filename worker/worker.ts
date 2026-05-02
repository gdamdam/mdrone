/**
 * mdrone share Worker — short-URL service for scene share links.
 *
 * Routes (host: s.mdrone.org):
 *   GET  /health           → { ok, v }
 *   POST /shorten          → create / dedupe a short id for a scene URL
 *   POST /track            → bump the share counter for a short id
 *   GET  /<id>             → 302 to the stored long URL (bumps play counter)
 *   GET  /?z=<payload>     → 302 to the app preserving the payload
 *   GET  /?b=<payload>     → same, plain-b64 fallback
 *   GET  /                 → 302 to the app
 *   GET  /stats            → JSON share counts (basic-auth)
 *   GET  /mddashboard      → HTML dashboard (basic-auth)
 *
 * Per-scene OG cards (talisman/sigil/tarot/tessera) were removed in
 * 1.20.32 alongside the in-app talisman UI. Sharing is a utility now —
 * the link unfurls without a per-scene preview image; the recipient
 * still lands in the same drone landscape on the app side.
 */

import pkg from "../package.json" with { type: "json" };

const APP_ORIGIN = "https://mdrone.org";
const VERSION = pkg.version;

interface Env {
  SHORT: KVNamespace;
  DASHBOARD_USER?: string;
  DASHBOARD_PASS?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ID_RE = /^[a-z0-9]{6}$/;

// User-agents we treat as link-preview crawlers — excluded from play counts
// so a Slack/Signal/iMessage unfurl doesn't inflate `pc:`.
const BOT_RE = /bot|crawl|spider|preview|fetch|slack|discord|telegram|whatsapp|facebook|twitter|linkedin|signal|mastodon|bluesky|cardyb|okhttp|cfnetwork/i;

function genId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let n = 0;
  for (const b of bytes) n = n * 256 + b;
  return n.toString(36).padStart(6, "0").slice(-6);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ─── HTML escape (used by dashboard) ─────────────────────────────────── */

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ─── share counters ──────────────────────────────────────────────────── */

/**
 * Counter scheme:
 *   sc:{id} — share count, bumped by client POST /track when a user copies
 *             the short link or invokes the native share sheet.
 *   pc:{id} — play count, bumped server-side when a non-bot UA loads the
 *             short URL (skipped if `?nc` is present, e.g. dashboard links).
 */

async function listShortKeys(env: Env, prefix?: string): Promise<{ name: string }[]> {
  const out: { name: string }[] = [];
  let cursor: string | undefined;
  do {
    const page: { keys: { name: string }[]; list_complete: boolean; cursor?: string } =
      await env.SHORT.list({ prefix, cursor, limit: 1000 });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function handleTrack(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json<{ id?: unknown }>();
    const id = typeof body.id === "string" ? body.id : "";
    if (!id || !ID_RE.test(id)) {
      return new Response(JSON.stringify({ error: "Invalid id" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    const key = `sc:${id}`;
    const cur = parseInt((await env.SHORT.get(key)) || "0", 10);
    ctx.waitUntil(env.SHORT.put(key, String(cur + 1)));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}

interface StatRow { id: string; shares: number; plays: number; }
interface StatsPayload {
  rows: StatRow[];
  totals: { shares: number; plays: number };
  count: number;
}

async function collectStats(env: Env): Promise<StatsPayload> {
  const keys = await listShortKeys(env);
  const ids = new Set<string>();
  for (const { name } of keys) {
    if (name.startsWith("u:")) ids.add(name.slice(2));
  }
  const rows = await Promise.all([...ids].map(async (id) => {
    const [shares, plays] = await Promise.all([
      env.SHORT.get(`sc:${id}`).then((v) => parseInt(v || "0", 10)),
      env.SHORT.get(`pc:${id}`).then((v) => parseInt(v || "0", 10)),
    ]);
    return { id, shares, plays };
  }));
  rows.sort((a, b) => (b.shares + b.plays) - (a.shares + a.plays));
  const totals = rows.reduce(
    (t, r) => ({ shares: t.shares + r.shares, plays: t.plays + r.plays }),
    { shares: 0, plays: 0 },
  );
  return { rows, totals, count: rows.length };
}

function requireBasicAuth(request: Request, env: Env): Response | null {
  const user = env.DASHBOARD_USER;
  const pass = env.DASHBOARD_PASS;
  if (!user || !pass) {
    return new Response("Dashboard auth not configured", { status: 503 });
  }
  const header = request.headers.get("Authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const [u, p] = atob(header.slice(6)).split(":");
      if (u === user && p === pass) return null;
    } catch {
      // fall through to 401
    }
  }
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="mddashboard", charset="UTF-8"' },
  });
}

async function handleStats(env: Env): Promise<Response> {
  try {
    const data = await collectStats(env);
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}

const DASHBOARD_STYLE = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:24px}
  h1{font-size:20px;margin-bottom:8px;color:#fff}
  .sub{font-size:12px;color:#555;margin-bottom:20px}
  .cards{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}
  .card{background:#1a1a2e;border-radius:12px;padding:20px 24px;min-width:120px}
  .card .num{font-size:32px;font-weight:700;color:#6c5ce7}
  .card .label{font-size:12px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:1px}
  .toolbar{display:flex;gap:10px;align-items:center;margin-bottom:14px}
  .search{background:#1a1a2e;border:1px solid #333;border-radius:6px;color:#e0e0e0;padding:6px 12px;font-size:13px;width:240px;outline:none}
  .search:focus{border-color:#6c5ce7}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th[data-col]{cursor:pointer;user-select:none}
  th[data-col]:hover{color:#ccc}
  th{text-align:left;padding:8px 12px;border-bottom:1px solid #333;color:#888;font-weight:500;text-transform:uppercase;font-size:11px;letter-spacing:1px;white-space:nowrap}
  th.sorted-asc::after{content:' ▲'}
  th.sorted-desc::after{content:' ▼'}
  td{padding:8px 12px;border-bottom:1px solid #1a1a2e;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  tr:hover{background:#1a1a2e}
  a{color:#6c5ce7;text-decoration:none}
  a:hover{text-decoration:underline}
  .empty{color:#555;font-size:14px;padding:32px 0}
  .updated{color:#333;font-size:11px;margin-top:24px}
`;

const DASHBOARD_SCRIPT = `<script>
(function(){
  var t=document.getElementById('data-table');if(!t)return;
  var tb=t.querySelector('tbody'),ths=t.querySelectorAll('th[data-col]');
  var sc=-1,sa=true;
  function gv(r,c){var td=r.cells[c];return td?(td.dataset.val||td.textContent.trim()):'';}
  function sort(c){
    if(sc===c)sa=!sa;else{sc=c;sa=true;}
    var rows=Array.prototype.slice.call(tb.querySelectorAll('tr:not([style*="none"])'));
    rows.sort(function(a,b){var va=gv(a,c),vb=gv(b,c);var na=parseFloat(va),nb=parseFloat(vb);
      var cmp=(!isNaN(na)&&!isNaN(nb))?na-nb:va.localeCompare(vb);return sa?cmp:-cmp;});
    rows.forEach(function(r){tb.appendChild(r);});
    ths.forEach(function(th){th.classList.remove('sorted-asc','sorted-desc');});
    var a=t.querySelector('th[data-col="'+c+'"]');if(a)a.classList.add(sa?'sorted-asc':'sorted-desc');
  }
  ths.forEach(function(th){th.addEventListener('click',function(){sort(+th.dataset.col);});});
  var s=document.getElementById('search');if(s){s.addEventListener('input',function(){
    var q=this.value.toLowerCase();
    tb.querySelectorAll('tr').forEach(function(r){r.style.display=r.textContent.toLowerCase().includes(q)?'':'none';});
  });}
})();
</script>`;

async function handleDashboard(env: Env): Promise<Response> {
  let data: StatsPayload;
  try {
    data = await collectStats(env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return new Response(`Stats error: ${esc(msg)}`, { status: 500 });
  }

  const rows = data.rows.map((r) => {
    const total = r.shares + r.plays;
    return `<tr>
      <td><a href="https://s.mdrone.org/${esc(r.id)}?nc" target="_blank" rel="noopener">${esc(r.id)}</a></td>
      <td data-val="${r.plays}">${r.plays}</td>
      <td data-val="${r.shares}">${r.shares}</td>
      <td data-val="${total}">${total}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mdrone share stats</title>
<style>${DASHBOARD_STYLE}</style>
</head><body>
<h1>mdrone share stats</h1>
<p class="sub">v${VERSION} · counters from KV namespace SHORT</p>
<div class="cards">
  <div class="card"><div class="num">${data.count}</div><div class="label">Shared</div></div>
  <div class="card"><div class="num">${data.totals.plays}</div><div class="label">Plays</div></div>
  <div class="card"><div class="num">${data.totals.shares}</div><div class="label">Shares</div></div>
</div>
${data.count === 0
  ? '<p class="empty">No short links yet.</p>'
  : `<div class="toolbar"><input id="search" class="search" placeholder="search ID…"></div>
<table id="data-table">
  <thead><tr>
    <th data-col="0">ID</th>
    <th data-col="1">Plays</th>
    <th data-col="2">Shares</th>
    <th data-col="3">Total</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`}
<p class="updated">Updated ${new Date().toISOString().slice(0, 19)} UTC</p>
${DASHBOARD_SCRIPT}
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

/* ─── shorten endpoint ────────────────────────────────────────────────── */

/**
 * POST /shorten — create a short URL for a scene share link.
 * Dedupes by SHA-256 of the submitted URL. Scoped to s.mdrone.org so
 * short IDs can only redirect to our own short-link origin.
 */
async function handleShorten(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ url?: unknown }>();
    const target = typeof body.url === "string" ? body.url : "";
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing url" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    let parsed: URL;
    try { parsed = new URL(target); } catch {
      return new Response(JSON.stringify({ error: "Invalid url" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    if (parsed.host !== "s.mdrone.org") {
      return new Response(JSON.stringify({ error: "Host not allowed" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const hashHex = await sha256Hex(target);
    const existing = await env.SHORT.get(`h:${hashHex}`);
    if (existing) {
      return new Response(
        JSON.stringify({ id: existing, short: `https://s.mdrone.org/${existing}` }),
        { headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    // Generate a non-colliding ID. Three attempts is ample at 6 base36 chars.
    let id = "";
    for (let i = 0; i < 3; i++) {
      const candidate = genId();
      if (!(await env.SHORT.get(`u:${candidate}`))) { id = candidate; break; }
    }
    if (!id) {
      return new Response(JSON.stringify({ error: "ID allocation failed" }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    await Promise.all([
      env.SHORT.put(`u:${id}`, target),
      env.SHORT.put(`h:${hashHex}`, id),
    ]);
    return new Response(
      JSON.stringify({ id, short: `https://s.mdrone.org/${id}` }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch {
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}

/* ─── routes ──────────────────────────────────────────────────────────── */

async function handleRequest(
  url: URL,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ ok: true, v: VERSION }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
    });
  }

  if (url.pathname === "/shorten" && request.method === "POST") {
    return handleShorten(request, env);
  }

  if (url.pathname === "/track" && request.method === "POST") {
    return handleTrack(request, env, ctx);
  }

  if (url.pathname === "/stats" && request.method === "GET") {
    const unauthorized = requireBasicAuth(request, env);
    if (unauthorized) return unauthorized;
    return handleStats(env);
  }

  if (url.pathname === "/mddashboard" && request.method === "GET") {
    const unauthorized = requireBasicAuth(request, env);
    if (unauthorized) return unauthorized;
    return handleDashboard(env);
  }

  // Short-URL lookup — must come before the `/` + no-payload root handler
  // so a short ID isn't swallowed as a root redirect. 6 base36 chars.
  const firstSegment = url.pathname.slice(1);
  if (ID_RE.test(firstSegment)) {
    const dest = await env.SHORT.get(`u:${firstSegment}`);
    if (dest) {
      // Bump play counter for non-bot loads. `?nc` opts out (used by the
      // dashboard's own links so reviewing stats doesn't perturb them).
      const ua = request.headers.get("user-agent") || "";
      if (!BOT_RE.test(ua) && !url.searchParams.has("nc")) {
        const key = `pc:${firstSegment}`;
        const cur = parseInt((await env.SHORT.get(key)) || "0", 10);
        ctx.waitUntil(env.SHORT.put(key, String(cur + 1)));
      }
      return Response.redirect(dest, 302);
    }
    return new Response("Not found", { status: 404, headers: CORS });
  }

  if (url.pathname === "/" || url.pathname === "") {
    // Long-form share URLs ?z=… or ?b=… used to render an OG HTML stub
    // here. With the talisman card system removed, we just bounce the
    // payload to the app — the recipient's browser opens the same scene.
    const z = url.searchParams.get("z");
    const b = url.searchParams.get("b");
    if (z) return Response.redirect(`${APP_ORIGIN}/?z=${z}`, 302);
    if (b) return Response.redirect(`${APP_ORIGIN}/?b=${b}`, 302);
    return Response.redirect(APP_ORIGIN, 302);
  }

  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(new URL(request.url), request, env, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return new Response(`Error: ${msg}`, { status: 500 });
    }
  },
};
