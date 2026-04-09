#!/usr/bin/env bash
# bump-version.sh — bump mdrone's version in both package.json and
# src/config.ts in lockstep. Usage:
#
#   misc/scripts/bump-version.sh patch    # 0.0.1 → 0.0.2
#   misc/scripts/bump-version.sh minor    # 0.0.1 → 0.1.0
#   misc/scripts/bump-version.sh major    # 0.0.1 → 1.0.0
#   misc/scripts/bump-version.sh 1.2.3    # explicit version
#
# Stops on error, refuses if there are uncommitted changes to either
# file, prints the old and new version, and leaves the files edited
# but unstaged so you can review the diff before committing.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
cd "$REPO_ROOT"

PKG_FILE="package.json"
CONFIG_FILE="src/config.ts"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 {patch|minor|major|X.Y.Z}" >&2
  exit 1
fi

# Read current version from package.json
current=$(node -p "require('./$PKG_FILE').version")
echo "current: $current"

bump="$1"
case "$bump" in
  patch|minor|major)
    IFS='.' read -r major minor patch <<< "$current"
    case "$bump" in
      patch) patch=$((patch + 1)) ;;
      minor) minor=$((minor + 1)); patch=0 ;;
      major) major=$((major + 1)); minor=0; patch=0 ;;
    esac
    next="$major.$minor.$patch"
    ;;
  *)
    if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      next="$bump"
    else
      echo "error: '$bump' is not a valid bump or X.Y.Z version" >&2
      exit 1
    fi
    ;;
esac

echo "next:    $next"

# Refuse if the target files have uncommitted changes already
if ! git diff --quiet -- "$PKG_FILE" "$CONFIG_FILE" 2>/dev/null; then
  echo "error: $PKG_FILE or $CONFIG_FILE has uncommitted changes — clean them first" >&2
  exit 1
fi

# Update package.json via node (preserves formatting)
node - "$next" <<'NODE'
const fs = require('fs');
const next = process.argv[2];
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = next;
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
NODE

# Update src/config.ts — replace the APP_VERSION line
tmp="${TMPDIR:-/tmp}/mdrone-bump.$$"
awk -v v="$next" '
  /export const APP_VERSION/ { print "export const APP_VERSION = \"" v "\";"; next }
  { print }
' "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"

echo "bumped $current → $next in:"
echo "  $PKG_FILE"
echo "  $CONFIG_FILE"
echo
echo "review the diff, then:"
echo "  git add $PKG_FILE $CONFIG_FILE"
echo "  git commit -m \"chore: bump version to $next\""
