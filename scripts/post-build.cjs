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

// Canonical site URL — single source of truth for social meta + JSON-LD.
// No trailing slash; path segments appended as needed.
const CANONICAL_URL = "https://mdrone.org";

// 1. Rename Vite's index.html → app.html, write a new index.html router
fs.renameSync(path.join(dist, "index.html"), path.join(dist, "app.html"));
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "mdrone",
  "description": "Free open-source browser drone instrument for iPhone, iPad, Android, and desktop. Layer voices, shape atmosphere, save scenes as links.",
  "url": `${CANONICAL_URL}/`,
  "applicationCategory": "MusicApplication",
  "operatingSystem": "iOS, iPadOS, Android, Windows, macOS, Linux",
  "browserRequirements": "Requires JavaScript and Web Audio support",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "license": "https://www.gnu.org/licenses/agpl-3.0.html",
  "image": `${CANONICAL_URL}/mdrone_screenshot.png`,
  "author": { "@type": "Person", "name": "gdamdam", "url": "https://github.com/gdamdam" }
});
fs.writeFileSync(path.join(dist, "index.html"), `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>mdrone — Browser Drone Instrument (iPhone, iPad, Desktop)</title><meta name="description" content="Free open-source browser drone instrument for iPhone, iPad, Android, and desktop. Layer voices, shape atmosphere, save scenes as links. No install, no account."><meta property="og:title" content="mdrone — Browser Drone Instrument (iPhone, iPad, Desktop)"><meta property="og:description" content="Free browser drone instrument. Hold a note. Shape the air. Save the atmosphere. No install, no account."><meta property="og:url" content="${CANONICAL_URL}/"><meta property="og:type" content="website"><meta property="og:site_name" content="mdrone"><meta property="og:image" content="${CANONICAL_URL}/mdrone_screenshot.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="mdrone — Browser Drone Instrument (iPhone, iPad, Desktop)"><meta name="twitter:description" content="Free browser drone instrument. No install, no account."><meta name="twitter:image" content="${CANONICAL_URL}/mdrone_screenshot.png"><link rel="canonical" href="${CANONICAL_URL}/about.html"><script type="application/ld+json">${JSON_LD}</script><script>${ROUTER_INLINE_SCRIPT}</script></head><body><noscript><a href="about.html">mdrone — browser drone instrument</a></noscript></body></html>`);
console.log("post-build: index.html → referrer-based router (about.html / app.html)");

// 2. Stamp version in landing page footer
const landingPath = path.join(dist, "about.html");
if (fs.existsSync(landingPath)) {
  let landing = fs.readFileSync(landingPath, "utf8");
  landing = landing.replace(/mdrone v[\d.]+/, `mdrone v${pkg.version}`);
  fs.writeFileSync(landingPath, landing);
  console.log("post-build: landing footer →", pkg.version);
}

// 3. Stamp version into sw.js — the placeholder `__MDRONE_VERSION__`
// lives in public/sw.js and is substituted here so every deploy ships
// a byte-different worker, which is what triggers the browser's
// install/waiting flow and, in turn, the "update available" banner.
const swPath = path.join(dist, "sw.js");
if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, "utf8");
  sw = sw.replace(/__MDRONE_VERSION__/g, pkg.version);
  fs.writeFileSync(swPath, sw);
  console.log("post-build: sw.js stamped →", pkg.version);
}
