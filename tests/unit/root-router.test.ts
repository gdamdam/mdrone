/**
 * Production root-redirect tests.
 *
 * The deployed site ships a minimal index.html whose inline script
 * decides whether to send the visitor to about.html or app.html, and
 * must preserve the URL's search+hash so share-URLs like /?z=ABC keep
 * their payload. Regression coverage for the prior bug where that
 * redirect dropped location.search entirely on shared scene links.
 */
import { describe, it, expect } from "vitest";
import vm from "node:vm";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { routerDecision, ROUTER_INLINE_SCRIPT } = require("../../scripts/root-router.cjs") as {
  routerDecision: (i: { search?: string; hash?: string; referrer?: string; userAgent?: string }) => { target: string };
  ROUTER_INLINE_SCRIPT: string;
};

function runInlineScript(input: { search: string; hash: string; referrer: string; userAgent?: string }): string {
  let replaced: string | null = null;
  const sandbox = {
    location: {
      search: input.search,
      hash: input.hash,
      replace: (u: string) => { replaced = u; },
    },
    document: { referrer: input.referrer },
    navigator: { userAgent: input.userAgent ?? "" },
  };
  vm.createContext(sandbox);
  vm.runInContext(ROUTER_INLINE_SCRIPT, sandbox);
  if (replaced === null) throw new Error("inline router did not call location.replace");
  return replaced;
}

describe("root router: pure decision", () => {
  it("sends direct traffic with a share payload to app.html with query intact", () => {
    expect(routerDecision({ search: "?z=ABC123", referrer: "" }).target)
      .toBe("app.html?z=ABC123");
  });

  it("sends a plain-b64 share payload to app.html with query intact", () => {
    expect(routerDecision({ search: "?b=DEF", referrer: "" }).target)
      .toBe("app.html?b=DEF");
  });

  it("preserves an extra cs=style parameter alongside the share payload", () => {
    expect(routerDecision({ search: "?z=ABC&cs=tarot", referrer: "" }).target)
      .toBe("app.html?z=ABC&cs=tarot");
  });

  it("preserves a trailing hash fragment", () => {
    expect(routerDecision({ search: "?z=ABC", hash: "#play", referrer: "" }).target)
      .toBe("app.html?z=ABC#play");
  });

  it("forces app.html even for search-engine referrers when a share payload is present", () => {
    expect(
      routerDecision({
        search: "?z=ABC",
        referrer: "https://www.google.com/search?q=mdrone+drone",
      }).target,
    ).toBe("app.html?z=ABC");
  });

  it("sends search-engine traffic without a payload to about.html", () => {
    expect(routerDecision({ referrer: "https://www.google.com/" }).target)
      .toBe("about.html");
  });

  it("sends direct traffic without a payload to app.html", () => {
    expect(routerDecision({ referrer: "" }).target).toBe("app.html");
  });

  it("recognises a range of search engine hosts", () => {
    for (const host of ["bing.com", "duckduckgo.com", "ecosia.org", "kagi.com", "yahoo.co.jp"]) {
      expect(routerDecision({ referrer: `https://${host}/` }).target).toBe("about.html");
    }
  });

  it("does not treat arbitrary referrers as search engines", () => {
    expect(routerDecision({ referrer: "https://news.ycombinator.com/" }).target)
      .toBe("app.html");
  });

  it("routes Googlebot to about.html via User-Agent (empty referrer)", () => {
    const ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    expect(routerDecision({ userAgent: ua }).target).toBe("about.html");
  });

  it("routes other indexing crawlers to about.html via User-Agent", () => {
    const uas = [
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
      "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
      "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
      "Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)",
    ];
    for (const ua of uas) {
      expect(routerDecision({ userAgent: ua }).target).toBe("about.html");
    }
  });

  it("routes social-unfurl bots to about.html via User-Agent", () => {
    const uas = [
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Twitterbot/1.0",
      "LinkedInBot/1.0",
      "WhatsApp/2.21.12",
      "TelegramBot (like TwitterBot)",
    ];
    for (const ua of uas) {
      expect(routerDecision({ userAgent: ua }).target).toBe("about.html");
    }
  });

  it("does not treat regular browser UAs as crawlers", () => {
    const uas = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
    ];
    for (const ua of uas) {
      expect(routerDecision({ userAgent: ua }).target).toBe("app.html");
    }
  });

  it("forces app.html for crawlers when a share payload is present", () => {
    const ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    expect(routerDecision({ search: "?z=ABC", userAgent: ua }).target)
      .toBe("app.html?z=ABC");
  });
});

describe("root router: shipped inline script", () => {
  it("preserves the share payload on direct visit", () => {
    expect(runInlineScript({ search: "?z=ABC123", hash: "", referrer: "" }))
      .toBe("app.html?z=ABC123");
  });

  it("preserves share payload + hash", () => {
    expect(runInlineScript({ search: "?b=DEF", hash: "#x", referrer: "" }))
      .toBe("app.html?b=DEF#x");
  });

  it("forces app.html for search-engine referrers when payload is present", () => {
    expect(
      runInlineScript({
        search: "?z=ABC",
        hash: "",
        referrer: "https://www.google.com/search?q=mdrone",
      }),
    ).toBe("app.html?z=ABC");
  });

  it("routes search-engine referrers without payload to about.html", () => {
    expect(runInlineScript({ search: "", hash: "", referrer: "https://www.bing.com/" }))
      .toBe("about.html");
  });

  it("routes direct visits without payload to app.html", () => {
    expect(runInlineScript({ search: "", hash: "", referrer: "" }))
      .toBe("app.html");
  });

  it("routes Googlebot User-Agent to about.html (empty referrer)", () => {
    expect(runInlineScript({
      search: "",
      hash: "",
      referrer: "",
      userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    })).toBe("about.html");
  });

  it("forces app.html for crawlers when a share payload is present", () => {
    expect(runInlineScript({
      search: "?z=ABC",
      hash: "",
      referrer: "",
      userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    })).toBe("app.html?z=ABC");
  });
});
