/**
 * Service worker registration + update-lifecycle plumbing.
 *
 * Shipped by mdrone as a hand-written worker (public/sw.js), version
 * stamped at build time. This module handles the *client side* of the
 * install/waiting/activate lifecycle and surfaces a single
 * `mdrone:update-available` CustomEvent on `window` when a new SW is
 * installed and waiting. Layout.tsx listens for it and flips the
 * existing "update available" banner — we reuse one UI path instead
 * of owning two.
 *
 * Skipped on localhost, file://, and when Service Workers are
 * unsupported. Dev servers never register so the SW can't cache a
 * stale HMR bundle.
 */

export type UpdateClickHandler = () => void;

const isDev = (): boolean => {
  const h = location.hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    location.protocol === "file:"
  );
};

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (isDev()) return;

  // Defer registration to after load so SW install never competes
  // with first-paint / first-tone on arrival.
  const run = () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        // New SW already waiting from a previous tab.
        if (reg.waiting && navigator.serviceWorker.controller) {
          dispatchUpdateAvailable();
        }

        reg.addEventListener("updatefound", () => {
          const incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener("statechange", () => {
            if (
              incoming.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              dispatchUpdateAvailable();
            }
          });
        });

        // When the active SW changes (after SKIP_WAITING), reload once
        // so the new precache is the one answering fetches.
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return;
          reloaded = true;
          location.reload();
        });
      })
      .catch(() => { /* silent — offline, insecure ctx, etc. */ });
  };

  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}

function dispatchUpdateAvailable(): void {
  window.dispatchEvent(new CustomEvent("mdrone:update-available"));
}

/**
 * Called by the update banner's reload affordance. If there is a
 * waiting SW, tell it to skip waiting; the controllerchange listener
 * above will reload. If no SW (e.g. first-run update-banner path
 * driven by version.json polling alone), just reload directly.
 */
export function applyUpdateAndReload(): void {
  if (!("serviceWorker" in navigator)) {
    location.reload();
    return;
  }
  navigator.serviceWorker
    .getRegistration()
    .then((reg) => {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } else {
        location.reload();
      }
    })
    .catch(() => location.reload());
}
