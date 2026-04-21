/**
 * mdrone share-card Worker — per-scene OG tags + PNG card.
 *
 * Routes (host: s.mdrone.org):
 *   GET /health           → { ok, v }
 *   GET /?z=<payload>     → OG HTML stub, then meta-redirect to the app
 *   GET /?b=<payload>     → same, plain-b64 fallback
 *   GET /img?z=<payload>  → 800×800 PNG scene card
 *   GET /                 → 302 to the app
 *
 * The card itself is now SVG, built once by `src/shareCard/svgBuilder.ts`
 * and rasterised via @resvg/resvg-wasm. This replaces the old hand-rolled
 * pixel port — the client preview and the server card now share a single
 * source of truth for the art.
 */

// @ts-expect-error — wrangler resolves the .wasm import to a CompiledWasm binding
import resvgWasmModule from "@resvg/resvg-wasm/index_bg.wasm";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

import {
  buildShareCardSvg,
  resolveSceneCardStyle,
  SCENE_CARD_HEIGHT,
  SCENE_CARD_WIDTH,
  type SceneCardStyle,
  type SceneCardStyleChoice,
} from "../src/shareCard/svgBuilder";
import { normalizePortableScene, type PortableScene } from "../src/session";

const APP_ORIGIN = "https://mdrone.org";
const VERSION = "1.8.0";

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

/* ─── resvg-wasm init ─────────────────────────────────────────────────── */

// Initialise once per isolate — the module keeps the WebAssembly.Instance
// alive across requests. Each fetch just reuses it.
let resvgReady: Promise<void> | null = null;
function ensureResvgReady(): Promise<void> {
  if (!resvgReady) {
    resvgReady = initWasm(resvgWasmModule as WebAssembly.Module);
  }
  return resvgReady;
}

async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureResvgReady();
  const renderer = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    fitTo: { mode: "width", value: SCENE_CARD_WIDTH },
    font: {
      // resvg-wasm cannot see host fonts in a Worker; it will fall back to
      // its internal defaults for generic families. Our SVGs reference
      // "Georgia, serif" and "ui-monospace, monospace" which resvg maps to
      // its bundled fallbacks.
      loadSystemFonts: false,
    },
  });
  const pngData = renderer.render();
  const bytes = pngData.asPng();
  pngData.free();
  renderer.free();
  return bytes;
}

/* ─── payload codec (mirrors src/shareCodec.ts) ───────────────────────── */

async function decodePayload(raw: string, compressed: boolean): Promise<unknown> {
  try {
    const b64 = raw
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    let jsonBytes = bytes;
    if (compressed) {
      const ds = new DecompressionStream("deflate");
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      jsonBytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    const json = new TextDecoder().decode(jsonBytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ─── scene normalisation ─────────────────────────────────────────────── */

/**
 * Share-link scene normaliser. Delegates to the client's
 * `normalizePortableScene` (src/session.ts) so the OG card, the PNG
 * card, and the app itself all agree on the exact same clamps and
 * defaults. A partial or malformed payload used to render one scene in
 * the worker and load a different one in the app — this keeps them in
 * lockstep.
 *
 * The client normaliser returns `null` when `drone` or `mixer` are
 * missing from the input; we preserve the worker's forgiving behavior
 * (never 500 on a weird payload) by filling in empty records as a
 * baseline before delegating.
 */
function normalizeScene(decoded: unknown): PortableScene {
  const record = (decoded && typeof decoded === "object")
    ? (decoded as Record<string, unknown>)
    : {};
  const droneIn = (record.drone && typeof record.drone === "object")
    ? record.drone
    : {};
  const mixerIn = (record.mixer && typeof record.mixer === "object")
    ? record.mixer
    : {};
  // With drone + mixer guaranteed to be records, normalizePortableScene
  // never returns null — the non-null assertion is load-bearing.
  return normalizePortableScene({
    ...record,
    drone: droneIn,
    mixer: mixerIn,
  })!;
}

/* ─── description helpers for OG text ─────────────────────────────────── */

const SCALE_LABELS: Record<string, string> = {
  drone: "DRONE",
  major: "MAJOR",
  minor: "MINOR",
  dorian: "DORIAN",
  phrygian: "PHRYGIAN",
  just5: "JUST5",
  pentatonic: "PENTA",
  meantone: "MEANTONE",
  harmonics: "HARMONICS",
  "maqam-rast": "RAST",
  slendro: "SLENDRO",
};

const TUNING_LABELS: Record<string, string> = {
  equal: "12-TET",
  just5: "JUST5",
  meantone: "MEANTONE",
  harmonics: "HARMONICS",
  "maqam-rast": "RAST",
  slendro: "SLENDRO",
};

function metaTitle(scene: PortableScene): string {
  const drone = scene.drone;
  // Show tuning label when microtuning is active, else legacy scale label
  const label = (drone.tuningId && TUNING_LABELS[drone.tuningId])
    ? TUNING_LABELS[drone.tuningId]
    : (SCALE_LABELS[drone.scale] ?? "DRONE");
  return `${drone.root}${drone.octave} ${label}`;
}

function activeVoiceSummary(scene: PortableScene): string {
  const layers = scene.drone.voiceLayers;
  const levels = scene.drone.voiceLevels;
  const active = (Object.keys(layers) as Array<keyof typeof layers>)
    .filter((v) => layers[v] && levels[v] > 0.08);
  return active.length > 0 ? active.join("+").toUpperCase() : "TANPURA";
}

/* ─── style choice compat shim ────────────────────────────────────────── */

// Old style names from the legacy card codec. Map them all to "auto" so
// previously shared URLs still render — just using the new art.
function sanitiseStyleChoice(raw: string | null): SceneCardStyleChoice {
  if (!raw) return "auto";
  if (raw === "auto" || raw === "sigil" || raw === "tarot" || raw === "fractal") {
    return raw;
  }
  return "auto";
}

/* ─── HTML builder ────────────────────────────────────────────────────── */

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escJs(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

interface OgParams {
  title: string;
  desc: string;
  shareUrl: string;
  appUrl: string;
  imgUrl: string;
  width: number;
  height: number;
}

function buildOgHtml(p: OgParams): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>${esc(p.title)} — mdrone</title>
<meta name="description" content="${esc(p.desc)}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:url" content="${esc(p.shareUrl)}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="mdrone">
<meta property="og:image" content="${esc(p.imgUrl)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${p.width}">
<meta property="og:image:height" content="${p.height}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.desc)}">
<meta name="twitter:image" content="${esc(p.imgUrl)}">
</head><body><p>Opening <a href="${esc(p.appUrl)}">mdrone</a>…</p>
<script>window.location.replace("${escJs(p.appUrl)}");</script>
<noscript><meta http-equiv="refresh" content="1;url=${esc(p.appUrl)}"></noscript>
</body></html>`;
}
/* ─── share counters ──────────────────────────────────────────────────── */

/**
 * Counter scheme (mirrors mpump's worker so the dashboard reads the same):
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
 * short IDs can only redirect to our own share-card origin.
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

  if (url.pathname === "/img" || url.pathname === "/img/") {
    const z = url.searchParams.get("z");
    const b = url.searchParams.get("b");
    const raw = z || b;
    if (!raw) return new Response("Missing payload", { status: 400 });
    const decoded = await decodePayload(raw, !!z);
    if (!decoded) return new Response("Bad payload", { status: 400 });
    const scene = normalizeScene(decoded);
    const styleChoice = sanitiseStyleChoice(
      url.searchParams.get("cs") || url.searchParams.get("s"),
    );
    const { svg } = buildShareCardSvg(scene, scene.name, styleChoice);
    const png = await svgToPng(svg);
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  }

  if (url.pathname === "/" || url.pathname === "") {
    const z = url.searchParams.get("z");
    const b = url.searchParams.get("b");
    const raw = z || b;
    if (!raw) return Response.redirect(APP_ORIGIN, 302);

    const decoded = await decodePayload(raw, !!z);
    if (!decoded) {
      const paramKey = z ? "z" : "b";
      return Response.redirect(`${APP_ORIGIN}/?${paramKey}=${raw}`, 302);
    }
    const scene = normalizeScene(decoded);
    const styleChoice = sanitiseStyleChoice(url.searchParams.get("cs"));
    const resolvedStyle: SceneCardStyle = resolveSceneCardStyle(styleChoice, scene, scene.name);
    const title = scene.name;
    const desc = `${metaTitle(scene)} · ${activeVoiceSummary(scene)} — a drone landscape from mdrone.`;
    const paramKey = z ? "z" : "b";
    const csParam = styleChoice !== "auto" ? `&cs=${resolvedStyle}` : "";
    const shareUrl = `https://s.mdrone.org/?${paramKey}=${raw}${csParam}`;
    const appUrl = `${APP_ORIGIN}/?${paramKey}=${raw}${csParam}`;
    const imgUrl = `https://s.mdrone.org/img?${paramKey}=${raw}${csParam}`;

    const html = buildOgHtml({
      title,
      desc,
      shareUrl,
      appUrl,
      imgUrl,
      width: SCENE_CARD_WIDTH,
      height: SCENE_CARD_HEIGHT,
    });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
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
