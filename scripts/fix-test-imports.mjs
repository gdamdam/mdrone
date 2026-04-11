import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".test-dist");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const source = await fs.readFile(fullPath, "utf8");
    const withImports = source.replace(
      /((?:import|export)\s[^"'\n]*?from\s+|import\()\s*["'](\.{1,2}\/[^"']+?)["']/g,
      (match, prefix, specifier) => {
        if (specifier.endsWith(".js") || specifier.endsWith(".css") || specifier.includes("?")) {
          return `${prefix}"${specifier}"`;
        }
        return `${prefix}"${specifier}.js"`;
      },
    );
    // Replace the vite-injected `__APP_VERSION__` global (defined via
    // `define` in vite.config.ts) with a literal. tsc doesn't know
    // about vite defines, so without this the test build throws
    // `ReferenceError: __APP_VERSION__ is not defined` at runtime.
    const next = withImports.replace(/__APP_VERSION__/g, '"0.0.0-test"');
    if (next !== source) {
      await fs.writeFile(fullPath, next);
    }
  }
}

await walk(ROOT);
