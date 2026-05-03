/**
 * Centralised debug-flag check for dev-only globals (`__engine`,
 * `__measureAllPresets`, `__auditArrival`, `__presetCert`, …).
 *
 * Sources, in order:
 *   1. `?debug` query param (also `?debug=1` / `?debug=true`)
 *   2. `localStorage["mdrone-debug"]` set to a truthy value
 *   3. `window.__mdroneDebug === true` (handy for tests)
 *
 * The flag is intentionally *not* enabled by `import.meta.env.DEV`
 * because we want production builds to be inspectable when an end
 * user opts in (e.g. while writing a bug report) without polluting
 * the global namespace by default.
 */
const DEBUG_LOCAL_STORAGE_KEY = "mdrone-debug";

function truthy(value: string | null | undefined): boolean {
  if (value == null) return false;
  const v = value.trim().toLowerCase();
  return v === "" || v === "1" || v === "true" || v === "yes" || v === "on";
}

export function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("debug") && truthy(params.get("debug"))) return true;
  } catch { /* malformed URL — ignore */ }
  try {
    if (truthy(window.localStorage.getItem(DEBUG_LOCAL_STORAGE_KEY))) return true;
  } catch { /* private mode / storage disabled — ignore */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).__mdroneDebug === true) return true;
  return false;
}

export const DEBUG_STORAGE_KEY = DEBUG_LOCAL_STORAGE_KEY;
