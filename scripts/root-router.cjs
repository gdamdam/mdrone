/**
 * Root-route redirect logic for the static index.html stub.
 *
 * The live site ships a minimal index.html whose only job is to forward
 * every visitor to app.html (the instrument), faithfully preserving the
 * URL's search and hash so share payloads like /?z=... survive the
 * redirect.
 *
 * NOTE: this stub deliberately does NOT vary its destination by referrer
 * or User-Agent. An earlier version sent search engines and crawler UAs
 * to about.html while sending humans to app.html — that is cloaking
 * (serving Googlebot different content than users) and is against
 * search-engine guidelines. Discoverability now relies on about.html
 * being a standalone, indexed, keyword-optimised page that is linked
 * from the app and listed in sitemap.xml — not on bot detection.
 *
 * Exports:
 *   routerDecision({ search, hash }) → { target }
 *       Pure decision function. Unit-tested.
 *   ROUTER_INLINE_SCRIPT
 *       The <script> body embedded inside the generated index.html. Kept
 *       in lockstep with routerDecision — any change here must be
 *       mirrored in both places (and is covered by the unit test).
 */

function routerDecision({ search = "", hash = "" } = {}) {
  return { target: "app.html" + search + hash };
}

// Inline version embedded into the generated index.html. Kept
// behaviourally identical to routerDecision above (verified by the unit
// test): forward search + hash to app.html, nothing else.
const ROUTER_INLINE_SCRIPT =
  '(function(){' +
  'var s=location.search||"";' +
  'var h=location.hash||"";' +
  'location.replace("app.html"+s+h);' +
  '})();';

module.exports = { routerDecision, ROUTER_INLINE_SCRIPT };
