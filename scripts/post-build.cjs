#!/usr/bin/env node
/**
 * Post-build script: landing page setup + version stamp.
 * Run after vite build via the "postbuild" npm lifecycle hook.
 *
 * Search-engine visitors (Google, Bing, etc.) see about.html.
 * Everyone else (direct links, bookmarks, shared URLs) sees app.html.
 */
const fs = require("fs");
const path = require("path");
const { ROUTER_INLINE_SCRIPT } = require("./root-router.cjs");

const dist = path.join(__dirname, "..", "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

// 1. Rename Vite's index.html → app.html, write a new index.html router
fs.renameSync(path.join(dist, "index.html"), path.join(dist, "app.html"));
fs.writeFileSync(path.join(dist, "index.html"), `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>mdrone — browser drone instrument for long tones and slow-moving space</title><meta name="description" content="mdrone is a free open-source browser drone instrument. Layer voices, shape atmosphere with effects and weather, share scenes as links. No install. No account."><meta property="og:title" content="mdrone — browser drone instrument"><meta property="og:description" content="Hold a note. Shape the air. Save the atmosphere. A browser instrument for long tones, harmonic beds, and slow-moving space."><meta property="og:url" content="https://mdrone.mpump.live/"><meta property="og:type" content="website"><meta property="og:site_name" content="mdrone"><meta property="og:image" content="https://mdrone.mpump.live/mdrone_screenshot.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="mdrone — browser drone instrument"><meta name="twitter:description" content="Hold a note. Shape the air. Save the atmosphere. No install. No account."><meta name="twitter:image" content="https://mdrone.mpump.live/mdrone_screenshot.png"><link rel="canonical" href="https://mdrone.mpump.live/about.html"><script>${ROUTER_INLINE_SCRIPT}</script></head><body><noscript><a href="about.html">mdrone — browser drone instrument</a></noscript></body></html>`);
console.log("post-build: index.html → referrer-based router (about.html / app.html)");

// 2. Stamp version in landing page footer
const landingPath = path.join(dist, "about.html");
if (fs.existsSync(landingPath)) {
  let landing = fs.readFileSync(landingPath, "utf8");
  landing = landing.replace(/mdrone v[\d.]+/, `mdrone v${pkg.version}`);
  fs.writeFileSync(landingPath, landing);
  console.log("post-build: landing footer →", pkg.version);
}
