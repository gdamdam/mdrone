// Write public/version.json from package.json version. Invoked via the
// `prebuild` npm lifecycle hook so every build publishes a fresh
// version.json alongside the bundle. The running client fetches this
// file periodically and shows an "update available" banner when it
// detects that the deployed version no longer matches its own.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
writeFileSync(
  new URL("../public/version.json", import.meta.url),
  JSON.stringify({ v: pkg.version }) + "\n",
);
console.log(`wrote public/version.json (v=${pkg.version})`);
