/**
 * linkBridge — client for the mpump Link Bridge companion app.
 *
 * The companion app runs a WebSocket server on localhost:19876 that
 * bridges Ableton Link (UDP multicast) to the browser. Browsers can't
 * speak Link directly (no UDP / multicast), so the bridge is the only
 * practical way to sync tempo with Ableton Live, Logic, Bitwig, etc.
 *
 * This module is lifted verbatim from mpump (server/src/utils/
 * linkBridge.ts) — the same bridge and protocol serve both
 * instruments, so downloading the companion once covers both. See
 * github.com/gdamdam/mpump/releases.
 *
 * Connection strategy
 * -------------------
 *   Tries ws://127.0.0.1, ws://[::1], ws://localhost (Safari blocks
 *   some from HTTPS pages). Auto-detect mode: tries once on page
 *   load, silently gives up if the bridge isn't running. Explicit
 *   mode (user opted in via Settings): retries every 5 s until
 *   connected, reconnects on drop.
 *
 * No internet connections are made — all traffic stays on localhost.
 */

export interface LinkState {
  tempo: number;      // BPM from the Link session
  beat: number;       // current beat position
  phase: number;      // phase within a bar (0..3.999 for 4/4)
  playing: boolean;   // whether the Link session is playing
  peers: number;      // other Link peers (Ableton Live, Bitwig, …)
  clients: number;    // browser clients connected to the bridge
  connected: boolean; // whether we're connected to the bridge
}

type LinkListener = (state: LinkState) => void;

const WS_URLS = ["ws://127.0.0.1:19876", "ws://[::1]:19876", "ws://localhost:19876"];
const RETRY_MS = 5000;
let wsUrlIdx = 0;

let ws: WebSocket | null = null;
let retryTimer: number | null = null;
let listeners: LinkListener[] = [];
let lastState: LinkState = {
  tempo: 120,
  beat: 0,
  phase: 0,
  playing: false,
  peers: 0,
  clients: 0,
  connected: false,
};
let enabled = false;
let autoMode = false;

function notify(): void {
  for (const fn of listeners) fn(lastState);
}

function connect(): void {
  if (ws) return;
  try {
    ws = new WebSocket(WS_URLS[wsUrlIdx]);

    ws.onopen = () => {
      enabled = true;
      lastState = { ...lastState, connected: true };
      notify();
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "link") {
          lastState = {
            tempo: msg.tempo ?? lastState.tempo,
            beat: msg.beat ?? lastState.beat,
            phase: msg.phase ?? lastState.phase,
            playing: msg.playing ?? lastState.playing,
            peers: msg.peers ?? lastState.peers,
            clients: msg.clients ?? lastState.clients,
            connected: true,
          };
          notify();
        }
      } catch { /* ignore malformed JSON */ }
    };

    ws.onclose = () => {
      ws = null;
      if (lastState.connected) {
        lastState = { ...lastState, connected: false, peers: 0 };
        notify();
      }
      if (enabled && !autoMode) scheduleRetry();
    };

    ws.onerror = () => {
      wsUrlIdx = (wsUrlIdx + 1) % WS_URLS.length;
      ws?.close();
    };
  } catch {
    wsUrlIdx = (wsUrlIdx + 1) % WS_URLS.length;
    if (enabled && !autoMode) scheduleRetry();
  }
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = window.setTimeout(connect, RETRY_MS);
}

export function enableLinkBridge(on: boolean): void {
  enabled = on;
  autoMode = false;
  if (on) {
    connect();
  } else {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (ws) { ws.close(); ws = null; }
    lastState = { ...lastState, connected: false, peers: 0 };
    notify();
  }
}

export function onLinkState(fn: LinkListener): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

export function sendLinkTempo(tempo: number): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "set_tempo", tempo }));
  }
}

export function sendLinkPlaying(playing: boolean): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "set_playing", playing }));
  }
}

export function getLinkState(): LinkState {
  return lastState;
}

/**
 * Auto-detect: try connecting once on page load.
 * If the bridge is running, stays connected. If not, silently gives up.
 * Does not retry — use enableLinkBridge(true) for persistent connection.
 */
export function autoDetectLinkBridge(): void {
  if (enabled || ws) return;
  autoMode = true;
  connect();
}
