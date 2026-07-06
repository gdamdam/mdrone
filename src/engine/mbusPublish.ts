/**
 * mbusPublish — offer the drone's master output to the mbus patchbay.
 *
 * Module-scope singleton mirroring linkBridge.ts's shape: plain functions over
 * module state, no React. The mbus client (see src/transport/mbus) rides the
 * same localhost link-bridge socket namespace as Ableton Link but is a
 * separate connection; publishing is off by default and session-transient —
 * until enabled no client exists and no socket is opened, so behavior is
 * unchanged. With the bridge absent the client retries quietly.
 *
 * The engine registers its master tap (MasterBus's analyser — the same node
 * MasterRecorder and LoopBouncer capture from) on construction and withdraws
 * it on dispose; the Header's BUS button flips the user intent. The two are
 * reconciled here so either can change in any order.
 */
import { createMbusClient, type MbusClient, type Publication } from "../transport/mbus";

let client: MbusClient | null = null;
let pub: Publication | null = null;
let wanted = false;
let tap: AudioNode | null = null;

/** Engine lifecycle: the current master tap node, or null when disposed. */
export function registerMbusTap(node: AudioNode | null): void {
  tap = node;
  apply();
}

/** User intent from the Header's BUS button. Not persisted — off by default. */
export function enableMbusPublish(on: boolean): void {
  wanted = on;
  apply();
}

export function isMbusPublishEnabled(): boolean {
  return wanted;
}

function apply(): void {
  if (wanted && tap) {
    if (pub) return;
    client ??= createMbusClient();
    client.connect();
    pub = client.publishOutput(tap, "mdrone");
  } else {
    // Not runnable: stop announcing. Drop the socket only when the user turned
    // it off — a vanished tap (engine rebuild/HMR) keeps the client so the
    // re-registered tap republishes without a reconnect round-trip.
    pub?.stop();
    pub = null;
    if (!wanted) client?.disconnect();
  }
}
