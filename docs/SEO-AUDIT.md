# mdrone — SEO Audit & Findability Plan

_Date: 2026-05-31 · Domain: https://mdrone.org · Indexed by Google ~April 2026_

This covers (1) how findable mdrone is today, (2) what's working, (3) what's
hurting it, and (4) a prioritized plan.

---

## Status — what shipped (v1.26.1, 2026-05-31)

**Done in code** (this release):
- **Removed the cloaking router** (`scripts/root-router.cjs`): the root stub now
  forwards *every* visitor — humans and crawlers alike — to `app.html`, with no
  referrer/User-Agent sniffing. Share payloads still preserved. _(C2)_
- **Fixed root canonical** → `https://mdrone.org/` (was `/about.html`). _(C3)_
- **Sitemap** now lists `/` **and** `/about.html` with a build-stamped `<lastmod>`
  (`scripts/post-build.cjs` substitutes `__BUILD_DATE__`). _(H1)_
- **`about.html` on-page**: keyword-led `<title>`/`og:title`/`twitter:title`, the
  `<h1>` is now "A microtonal drone instrument" (poetic mantra kept visually as a
  `<p>`), and a `FAQPage` JSON-LD block was added from the existing Q&A. _(H2, P2.4)_
- Router unit test updated; full suite (347) + lint + typecheck green.

**Done outside the repo:**
- **C1 / P0.1 — `mdrone.mpump.live` now 301-redirects to `mdrone.org`** (Cloudflare,
  2026-05-31). The duplicate that was outranking the canonical domain is resolved;
  its authority will consolidate onto `mdrone.org` as Google re-crawls.

**Still MANUAL — cannot be done from the repo (do these next, highest impact):**
- **P0.2 — Google Search Console + Bing Webmaster**: verify `mdrone.org`, submit
  the sitemap, "Request indexing" for `/` and `/about.html`, read the coverage /
  "why not indexed" report.
- **P4 — backlinks/launch** (Show HN, r/microtonal, awesome-webaudio, GitHub repo
  topics) and **P3** (split explainers into standalone pages) remain open.

---

## TL;DR — the headline problems

1. **A duplicate deployment is outranking the canonical domain.** Google has
   indexed and surfaces `https://mdrone.mpump.live/` — **not** `mdrone.org`. Every
   descriptive query that finds "mdrone" returns the `mpump.live` copy. The real
   domain is essentially invisible.
2. **`mdrone.org` is effectively not in the index.** `site:mdrone.org` returns
   zero pages from the domain. Even searching the literal string `mdrone.org`
   surfaces only the unrelated aerial-drone company `mdrone.com`.
3. **The homepage serves no crawlable content.** `https://mdrone.org/` is an empty
   0.1 KB shell that JS-redirects based on referrer/user-agent: search engines and
   detected crawlers get sent to `about.html`, everyone else to `app.html`.
4. **Brand-name collision.** "mdrone" is dominated by UAV/aerial-drone businesses
   (mdrone.com, mdrones.net, MDRONE on Crunchbase/X). The music instrument loses
   the branded search outright.

Fixing #1 and #2 is worth more than every on-page tweak combined.

---

## How findability was tested

Live Google queries run during this audit:

| Query | Top result for mdrone | mdrone.org present? |
|---|---|---|
| `mdrone microtonal drone instrument browser` | `mdrone.mpump.live` | No |
| `browser drone instrument online free` | `mdrone.mpump.live` | No |
| `microtonal drone instrument web app` | _(not in top 8)_ | No |
| `mdrone drone instrument hold a note shape the air` | `mdrone.mpump.live` | No |
| `site:mdrone.org` | _(nothing from the domain)_ | No |
| `mdrone.org` | mdrone.com (UAV co.) | No |

**Conclusion:** the only indexed, ranking instance of the app is the `mpump.live`
subdomain. `mdrone.org` is not competing — it is barely (if at all) in the index a
month after first crawl.

---

## What's working (keep it)

- **Strong on-page metadata.** Title, meta description, canonical, Open Graph
  (incl. `og:image:width/height`), Twitter `summary_large_image`, and
  `SoftwareApplication` JSON-LD (with `offers`, `applicationCategory`,
  `operatingSystem`) are present and consistent across `index.html`, `app.html`,
  and `about.html`.
- **`about.html` is a real, well-structured content page.** ~2,000 words, clean
  `h1 → h2 → h3` hierarchy, semantic sections ("What is a drone?", "Why
  microtonal?", "How do melodies appear?").
- **Good keyword density in `about.html`** (body text): `drone` ×23, `microtonal`
  ×9, `drone instrument` ×6, `browser` ×6, `tuning` ×4, `tanpura` ×2,
  `just intonation` ×2. The topical signal is genuinely there.
- **Hygiene basics exist:** `robots.txt`, `sitemap.xml`, PWA `manifest`, mobile
  meta, Bing site-auth file, GoatCounter analytics loaded off the critical path.
- **AI-crawler policy** is deliberate (GPTBot/ClaudeBot/CCBot/etc. disallowed,
  normal search bots allowed) — fine, and not the cause of the ranking problem.

---

## What's hurting rankings

### Critical

- **C1 — Duplicate site at `mdrone.mpump.live`.** A full copy of the app is live on
  a subdomain of the author's higher-history `mpump.live` domain. Google chose it
  as the canonical instance. This splits/steals all authority and makes `.org`
  redundant in Google's eyes. _Root cause of invisibility._
- **C2 — Homepage has zero indexable content + cloaking-shaped routing.**
  `mdrone.org/` is an empty shell that does `location.replace()` to different
  targets **based on whether the visitor looks like a search engine** (referrer
  matches google/bing/etc. or UA matches Googlebot → `about.html`; otherwise
  `app.html`). Serving crawlers different content than users is the textbook
  definition of **cloaking** and is against Google's guidelines — even with benign
  intent it risks suppression. JS redirects are also a weaker signal than a 301
  and cost crawl/render budget.
- **C3 — Canonical/URL confusion.** Root shell's `rel=canonical` →
  `/about.html`, but its `og:url` → `/`. `app.html` canonicals to `/`.
  `about.html` canonicals to itself. The "home" URL therefore points away from
  itself, and no single URL is presented as _the_ page.

### High

- **H1 — Sitemap lists only `about.html`.** One URL, no homepage, no `lastmod`, no
  `app.html`. Thin signal to crawlers about site scope.
- **H2 — Primary keyword absent from title & H1 of the ranking page.**
  - `about.html` `<title>`: _"mdrone — An instrument where melodies emerge without
    being played"_ (poetic; no head keyword).
  - `about.html` `<h1>`: _"Melodies emerge without being played."_
  - "microtonal drone instrument" lives only in the subtitle and meta description.
    The strongest on-page ranking slots are spent on poetry, not the query.
- **H3 — No inbound links.** Only outbound links (to GitHub). New domain, no
  authority, no referring domains → little reason for Google to rank or even
  prioritize crawling `.org` over the established `mpump.live`.

### Medium

- **M1 — Head keywords are saturated/polluted.** "drone instrument" is shared with
  FPV/aerial drone sims; "online drone tool / tanpura / shruti box" is owned by
  high-authority incumbents (myNoise.net, violinspiration.com, chromatone.center,
  onlinemusictools.com, Terpstra Keyboard). Hard to crack head-on with a new
  domain.
- **M2 — Content locked inside one page.** The "What is a drone?" / "Why
  microtonal?" explainers are great informational content but buried in
  `about.html`; they could each rank as standalone pages.

---

## Competitive landscape (for the target keywords)

| Keyword cluster | Who owns it now | Difficulty | Verdict for mdrone |
|---|---|---|---|
| `drone instrument` | Wikipedia, aerial-drone sites, VST libraries | High + polluted | De-prioritize head term |
| `microtonal drone instrument` | thin field — Terpstra, scattered | **Medium / winnable** | **Primary target** |
| `browser/online drone instrument` | myNoise, violinspiration, onlinemusictools | High | Long-tail only |
| `tanpura / shruti box online` | myNoise, chromatone | Very high | Don't fight head-on |
| `microtonal drone synth web / just intonation drone browser` | open | **Low** | **Quick wins** |
| `ambient drone web app / hold a note` | open-ish | Low | Secondary |

The realistic strategy: **own "microtonal drone instrument" and a cluster of
specific long-tails**, not the generic head terms.

---

## The plan (prioritized, no code yet)

### Phase 0 — Stop the bleeding (do first, highest ROI)

- [ ] **P0.1 Resolve the duplicate (C1).** Pick one:
  - **(a) Take down `mdrone.mpump.live`** entirely (cleanest), _or_
  - **(b) 301-redirect** `mdrone.mpump.live/*` → `mdrone.org/*` at the
    Cloudflare/host level, _or_
  - **(c)** at minimum, ensure every `mpump.live` page carries
    `rel=canonical → mdrone.org` **and** add it to `robots.txt`/GSC so signals
    consolidate. (a) or (b) strongly preferred — canonical alone is a hint Google
    can ignore, which is exactly what's happening.
- [ ] **P0.2 Set up Google Search Console + Bing Webmaster Tools for `mdrone.org`.**
  Submit the sitemap, use the URL Inspection tool on `/` and `/about.html`, hit
  "Request indexing", and read the Coverage / "Why not indexed" report — that will
  say definitively whether Google deduped `.org` against `mpump.live`.

### Phase 1 — Make the homepage indexable (fixes C2, C3)

Decide the architecture (these are options with tradeoffs — pick before coding):

- **Option A — Prerender/SSG the homepage** (recommended): build a static,
  content-rich `index.html` (essentially today's `about.html` content) served to
  **everyone**, with the interactive app one click away (`app.html` or a "Launch"
  button / progressive enhancement). One URL, real content, no cloaking.
  _Tradeoff:_ small build change; best long-term SEO.
- **Option B — Drop the UA/referrer router**, keep a thin homepage but make it the
  canonical content page (merge `about.html` into `/`). _Tradeoff:_ less elegant
  app/landing split, but removes cloaking risk immediately.
- **Option C — Leave routing, but never branch on crawler detection.** Serve the
  same content to all and let users click through. _Tradeoff:_ minimal change,
  removes the cloaking risk but keeps an empty-ish root.

Whichever is chosen:
- [ ] **P1.1** Eliminate referrer/user-agent-based content switching (cloaking).
- [ ] **P1.2** One canonical home URL; make `rel=canonical`, `og:url`, and the
  sitemap all agree on it.
- [ ] **P1.3** Ensure real text content is in the served HTML without requiring JS.

### Phase 2 — On-page optimization

- [ ] **P2.1** Rework `about.html` (or the new home) `<title>` to lead with the
  keyword, e.g. _"Microtonal Drone Instrument — Play in Your Browser | mdrone"_.
  Keep the poetic line as a subtitle/tagline, not the title.
- [ ] **P2.2** Make the `<h1>` contain "microtonal drone instrument"; demote
  "Melodies emerge without being played" to an `<h2>`/lede.
- [ ] **P2.3** Fix the sitemap (H1): add the homepage + `app.html`, add `lastmod`,
  wire it into the build (`post-build.cjs`) so it stays current.
- [ ] **P2.4** Add `FAQPage`/`HowTo` JSON-LD around the existing "What is a drone?"
  / "Why microtonal?" sections for rich-result eligibility.

### Phase 3 — Content & long-tail capture (M2)

- [ ] **P3.1** Split the explainers into standalone, internally-linked pages:
  "What is a drone instrument?", "Microtonal tuning systems explained",
  "Just intonation vs equal temperament", "How phantom melodies emerge from a
  drone". Each targets an informational query the head terms can't.
- [ ] **P3.2** Add a short, indexable page per preset/tuning system if feasible
  (the app already has 26 tuning systems and named presets — natural long-tail).

### Phase 4 — Off-page / authority (H3)

- [ ] **P4.1** Launch posts: **Show HN**, Lobsters, Product Hunt.
- [ ] **P4.2** Communities: r/ambientmusic, r/microtonal, r/WeAreTheMusicMakers,
  r/synthesizers, lines/llllllll.co, Web Audio / Tone.js circles.
- [ ] **P4.3** Get listed: "awesome-webaudio", web-audio demo roundups,
  free-music-tools directories, GitHub `topics` (microtonal, web-audio, drone,
  ambient) — the repo README is strong; point these at `mdrone.org`, not GitHub
  alone.
- [ ] **P4.4** Cross-link from the sibling apps (mpump/mloop) footers to
  `mdrone.org` for relevant internal authority (note: footer cross-links were
  previously removed per CHANGELOG — reconsider for SEO).

### Phase 5 — Measure

- [ ] Track in GSC: impressions/clicks for "microtonal drone instrument" + the
  long-tail cluster; index coverage of `.org`; confirm `mpump.live` drops out.
- [ ] Re-run `site:mdrone.org` weekly until pages appear.

---

## Suggested keyword targets (final)

**Primary:** `microtonal drone instrument`, `microtonal drone instrument browser`
**Secondary:** `browser drone instrument`, `online drone instrument free`,
`drone synth web app`, `ambient drone instrument`
**Long-tail / quick wins:** `microtonal drone synth in browser`,
`just intonation drone web`, `26 tuning systems drone`, `hold a note drone web app`,
`phantom melodies drone instrument`, `tanpura-style microtonal drone online`
**Avoid as primary:** bare `drone instrument` (aerial-drone pollution),
`tanpura online` (myNoise/chromatone own it).

---

## Sources (live queries, May 2026)

- [mdrone — Browser Drone Instrument (the indexed `mpump.live` copy)](https://mdrone.mpump.live/)
- [site:mdrone.org → no domain results; surfaces mdrone.com (UAV co.)](https://mdrone.com/en/)
- [Tediris MDrones (brand collision)](https://www.mdrones.net/)
- Competitors for target terms: [myNoise Tanpura](https://mynoise.net/NoiseMachines/tanpuraDroneGenerator.php),
  [Violinspiration Drone Tone](https://violinspiration.com/drone-tone/),
  [Chromatone Drone](https://chromatone.center/practice/pitch/drone/),
  [Online Music Tools Drone](https://www.onlinemusictools.com/drone/),
  [Terpstra Keyboard](http://terpstrakeyboard.com/play-it-now/)
