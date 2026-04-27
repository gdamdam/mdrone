#!/usr/bin/env node
/**
 * release — bump version + regenerate CHANGELOG.md from git history.
 *
 *   node scripts/release.mjs              # bump patch (default)
 *   node scripts/release.mjs patch        # explicit patch bump
 *   node scripts/release.mjs minor
 *   node scripts/release.mjs major
 *   node scripts/release.mjs 1.19.0       # set exact version
 *
 * After running, review the staged changes, then:
 *
 *   git commit -m "X.Y.Z — release: <summary>"
 *   git tag vX.Y.Z
 *   git push origin <branch> --tags
 *
 * The tag push triggers .github/workflows/deploy.yml which publishes
 * dist/ to the gh-pages branch (only if CI is green).
 *
 * Commit-format convention: every release commit starts with the new
 * version, e.g. "1.18.21 — fix: refresh stale fx tests". Intermediate
 * commits without a leading version land under the next release in the
 * changelog. The parser handles both forms.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = join(ROOT, "package.json");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Not a valid semver: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function bump(version, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const v = parseSemver(version);
  if (kind === "major") return `${v.major + 1}.0.0`;
  if (kind === "minor") return `${v.major}.${v.minor + 1}.0`;
  if (kind === "patch") return `${v.major}.${v.minor}.${v.patch + 1}`;
  throw new Error(`Unknown bump kind: ${kind}`);
}

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

function lastReleaseTag() {
  try {
    return git("describe --tags --abbrev=0 --match=v*");
  } catch {
    return null;
  }
}

function commitsSince(ref) {
  const range = ref ? `${ref}..HEAD` : "HEAD";
  const log = git(`log ${range} --pretty=format:%H%x09%s`);
  if (!log) return [];
  return log.split("\n").map((line) => {
    const [sha, ...rest] = line.split("\t");
    return { sha: sha.slice(0, 7), subject: rest.join("\t") };
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function renderChangelogSection(version, commits) {
  if (commits.length === 0) {
    return `## ${version} — ${todayIso()}\n\n_No user-visible changes._\n`;
  }
  const lines = commits.map((c) => {
    // Strip a leading "X.Y.Z — " from versioned commits so the bullet
    // reads cleanly under the section header.
    const subject = c.subject.replace(/^\d+\.\d+\.\d+\s*[—-]\s*/, "");
    return `- ${subject} (${c.sha})`;
  });
  return `## ${version} — ${todayIso()}\n\n${lines.join("\n")}\n`;
}

function prependChangelog(section) {
  const HEADER = "# Changelog\n\nAll notable changes to mdrone. Generated from git history by `scripts/release.mjs`.\n\n";
  if (!existsSync(CHANGELOG_PATH)) {
    writeFileSync(CHANGELOG_PATH, HEADER + section);
    return;
  }
  const existing = readFileSync(CHANGELOG_PATH, "utf8");
  // Strip the existing header (we re-add it) so the new section lands
  // right under it without duplicating the title block.
  const body = existing.startsWith("# Changelog")
    ? existing.replace(/^# Changelog[\s\S]*?\n## /, "## ")
    : existing;
  writeFileSync(CHANGELOG_PATH, HEADER + section + "\n" + body);
}

function main() {
  const arg = process.argv[2] || "patch";
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  const next = bump(pkg.version, arg);

  const since = lastReleaseTag();
  const commits = commitsSince(since);
  const section = renderChangelogSection(next, commits);

  pkg.version = next;
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
  prependChangelog(section);

  try {
    execSync(`git add ${PKG_PATH} ${CHANGELOG_PATH}`, { cwd: ROOT });
  } catch {
    // ignore — script still printed the diff
  }

  process.stdout.write(
    `\n[release] bumped ${pkg.name ?? "package"} → ${next}\n` +
    `[release] commits since ${since ?? "repo root"}: ${commits.length}\n` +
    `[release] CHANGELOG.md and package.json staged.\n\n` +
    `Next steps:\n` +
    `  git commit -m "${next} — release: <summary>"\n` +
    `  git tag v${next}\n` +
    `  git push origin <branch> --tags\n`,
  );
}

main();
