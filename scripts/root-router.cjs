/**
 * Root-route redirect logic for the static index.html stub.
 *
 * The live site ships a minimal index.html whose only job is to route
 * visitors to either about.html (search engines + crawlers + social
 * preview bots) or app.html (everyone else), while faithfully
 * forwarding the URL's search and hash so share payloads like /?z=...
 * survive the redirect.
 *
 * Two signals send a visit to about.html:
 *   1. Referrer matches a known search engine — user clicked a result.
 *   2. User-Agent matches a known crawler / social preview bot —
 *      Googlebot, Bingbot, Twitterbot, etc. This is the SEO-critical
 *      path: Googlebot itself sends an empty referrer, so without UA
 *      detection it would route to app.html (the SPA shell) and never
 *      see the marketing landing meant to be indexed.
 *
 * Share payloads (?z= / ?b=) always go to app.html regardless of how
 * the visitor arrived — the link's purpose is to play that scene.
 *
 * Exports:
 *   routerDecision({ search, hash, referrer, userAgent }) → { target }
 *       Pure decision function. Unit-tested.
 *   ROUTER_INLINE_SCRIPT
 *       The <script> body embedded inside the generated index.html. Kept
 *       in lockstep with routerDecision — any change here must be
 *       mirrored in both places (and is covered by the unit test).
 */

const SEARCH_ENGINE_HOST_RE =
  /^https?:\/\/([^/]+\.)?(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|startpage|qwant|kagi)\./i;
const SHARE_PARAM_RE = /[?&](z|b)=/;
// Known indexing crawlers and social-unfurl bots. Conservative list —
// the cost of a false positive is "this user lands on about.html
// instead of app.html", which is the marketing splash they could have
// reached via the About link anyway.
const CRAWLER_UA_RE =
  /Googlebot|Bingbot|DuckDuckBot|Slurp|YandexBot|Baiduspider|Applebot|facebookexternalhit|Twitterbot|LinkedInBot|Pinterestbot|WhatsApp|TelegramBot|Discordbot|SkypeUriPreview|MastodonBot/i;

function routerDecision({ search = "", hash = "", referrer = "", userAgent = "" } = {}) {
  const hasShare = SHARE_PARAM_RE.test(search);
  const fromSearch = SEARCH_ENGINE_HOST_RE.test(referrer);
  const isCrawler = CRAWLER_UA_RE.test(userAgent);
  const page = !hasShare && (fromSearch || isCrawler) ? "about.html" : "app.html";
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
  'var u=(navigator&&navigator.userAgent)||"";' +
  'var fromSearch=/^https?:\\/\\/([^/]+\\.)?(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|startpage|qwant|kagi)\\./i.test(r);' +
  'var isCrawler=/Googlebot|Bingbot|DuckDuckBot|Slurp|YandexBot|Baiduspider|Applebot|facebookexternalhit|Twitterbot|LinkedInBot|Pinterestbot|WhatsApp|TelegramBot|Discordbot|SkypeUriPreview|MastodonBot/i.test(u);' +
  'var target=(!hasShare&&(fromSearch||isCrawler))?"about.html":"app.html";' +
  'location.replace(target+s+h);' +
  '})();';

module.exports = { routerDecision, ROUTER_INLINE_SCRIPT };
