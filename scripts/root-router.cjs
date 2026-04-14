/**
 * Root-route redirect logic for the static index.html stub.
 *
 * The live site ships a minimal index.html whose only job is to route
 * visitors to either about.html (search engines) or app.html (everyone
 * else), while faithfully forwarding the URL's search and hash so share
 * payloads like /?z=... survive the redirect.
 *
 * Exports:
 *   routerDecision({ search, hash, referrer }) → { target: string }
 *       Pure decision function. Unit-tested.
 *   ROUTER_INLINE_SCRIPT
 *       The <script> body embedded inside the generated index.html. Kept
 *       in lockstep with routerDecision — any change here must be
 *       mirrored in both places (and is covered by the unit test).
 */

const SEARCH_ENGINE_HOST_RE =
  /^https?:\/\/([^/]+\.)?(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|startpage|qwant|kagi)\./i;
const SHARE_PARAM_RE = /[?&](z|b)=/;

function routerDecision({ search = "", hash = "", referrer = "" } = {}) {
  const hasShare = SHARE_PARAM_RE.test(search);
  const fromSearch = SEARCH_ENGINE_HOST_RE.test(referrer);
  const page = !hasShare && fromSearch ? "about.html" : "app.html";
  return { target: page + search + hash };
}

// Inline version embedded into the generated index.html. Uses a
// doubly-escaped regex because this string is later injected into a
// template literal — `\\/` reaches the browser as `\/`, a valid regex.
const ROUTER_INLINE_SCRIPT =
  '(function(){' +
  'var s=location.search||"";' +
  'var h=location.hash||"";' +
  'var hasShare=/[?&](z|b)=/.test(s);' +
  'var r=document.referrer||"";' +
  'var fromSearch=/^https?:\\/\\/([^/]+\\.)?(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|startpage|qwant|kagi)\\./i.test(r);' +
  'var target=(!hasShare&&fromSearch)?"about.html":"app.html";' +
  'location.replace(target+s+h);' +
  '})();';

module.exports = { routerDecision, ROUTER_INLINE_SCRIPT };
