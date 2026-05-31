/**
 * Production root-redirect tests.
 *
 * The deployed site ships a minimal index.html whose inline script
 * forwards every visitor to app.html, and must preserve the URL's
 * search+hash so share-URLs like /?z=ABC keep their payload. Regression
 * coverage for the prior bug where that redirect dropped location.search
 * entirely on shared scene links.
 *
 * The router intentionally does NOT branch on referrer or User-Agent —
 * varying content for crawlers vs humans is cloaking. These tests assert
 * that bots and humans alike are forwarded to app.html unchanged.
 */
import { describe, it, expect } from "vitest";
import vm from "node:vm";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { routerDecision, ROUTER_INLINE_SCRIPT } = require("../../scripts/root-router.cjs") as {
  routerDecision: (i: { search?: string; hash?: string; referrer?: string; userAgent?: string }) => { target: string };
  ROUTER_INLINE_SCRIPT: string;
};

function runInlineScript(input: { search: string; hash: string; referrer?: string; userAgent?: string }): string {
  let replaced: string | null = null;
  const sandbox = {
    location: {
      search: input.search,
      hash: input.hash,
      replace: (u: string) => { replaced = u; },
    },
    document: { referrer: input.referrer ?? "" },
    navigator: { userAgent: input.userAgent ?? "" },
  };
  vm.createContext(sandbox);
  vm.runInContext(ROUTER_INLINE_SCRIPT, sandbox);
  if (replaced === null) throw new Error("inline router did not call location.replace");
  return replaced;
}

describe("root router: pure decision", () => {
  it("sends direct traffic to app.html", () => {
    expect(routerDecision({}).target).toBe("app.html");
  });

  it("sends a z= share payload to app.html with query intact", () => {
    expect(routerDecision({ search: "?z=ABC123" }).target).toBe("app.html?z=ABC123");
  });

  it("sends a plain-b64 share payload to app.html with query intact", () => {
    expect(routerDecision({ search: "?b=DEF" }).target).toBe("app.html?b=DEF");
  });

  it("preserves an extra cs=style parameter alongside the share payload", () => {
    expect(routerDecision({ search: "?z=ABC&cs=tarot" }).target)
      .toBe("app.html?z=ABC&cs=tarot");
  });

  it("preserves a trailing hash fragment", () => {
    expect(routerDecision({ search: "?z=ABC", hash: "#play" }).target)
      .toBe("app.html?z=ABC#play");
  });

  it("ignores the referrer — search-engine traffic still goes to app.html (no cloaking)", () => {
    expect(routerDecision({ referrer: "https://www.google.com/search?q=mdrone" }).target)
      .toBe("app.html");
  });

  it("ignores the User-Agent — crawlers still go to app.html (no cloaking)", () => {
    const ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    expect(routerDecision({ userAgent: ua }).target).toBe("app.html");
  });
});

describe("root router: shipped inline script", () => {
  it("forwards a direct visit to app.html", () => {
    expect(runInlineScript({ search: "", hash: "" })).toBe("app.html");
  });

  it("preserves the share payload on direct visit", () => {
    expect(runInlineScript({ search: "?z=ABC123", hash: "" })).toBe("app.html?z=ABC123");
  });

  it("preserves share payload + hash", () => {
    expect(runInlineScript({ search: "?b=DEF", hash: "#x" })).toBe("app.html?b=DEF#x");
  });

  it("forwards search-engine referrers to app.html (no cloaking)", () => {
    expect(runInlineScript({ search: "", hash: "", referrer: "https://www.bing.com/" }))
      .toBe("app.html");
  });

  it("forwards Googlebot to app.html (no cloaking)", () => {
    expect(runInlineScript({
      search: "",
      hash: "",
      userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    })).toBe("app.html");
  });
});
