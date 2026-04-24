/**
 * Arrival-preset audit — cycles through ARRIVAL_PRESET_IDS applying
 * each preset for a fixed dwell so you can sit and listen in one go.
 *
 * Invoked from the browser console:
 *   await __auditArrival()            // 10 s per preset (default)
 *   await __auditArrival(6000)        // 6 s per preset
 *   __auditArrival.stop()             // abort the in-progress run
 *
 * Prints a timestamped log line on every step; the stop() handle is
 * installed on the returned promise as well as on the function itself,
 * so you can always kill it from the console.
 */

import { ARRIVAL_PRESET_IDS } from "../engine/presets";
import { showNotification } from "../notifications";

export interface AuditArrivalHooks {
  applyPresetById: (id: string) => void;
  ensurePlaying: () => void;
}

let stopRequested = false;

export async function auditArrival(
  hooks: AuditArrivalHooks,
  dwellMs = 10_000,
): Promise<void> {
  stopRequested = false;
  hooks.ensurePlaying();
  for (let i = 0; i < ARRIVAL_PRESET_IDS.length; i++) {
    if (stopRequested) {
      console.log("[audit-arrival] stopped");
      showNotification("Arrival audit stopped", "info");
      return;
    }
    const id = ARRIVAL_PRESET_IDS[i];
    const label = `${i + 1}/${ARRIVAL_PRESET_IDS.length}  ${id}`;
    console.log(`[audit-arrival] ${label}`);
    showNotification(`✦ ${label}`, "info");
    hooks.applyPresetById(id);
    await sleep(dwellMs);
  }
  console.log("[audit-arrival] done");
  showNotification("Arrival audit complete", "info");
}

auditArrival.stop = () => { stopRequested = true; };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
