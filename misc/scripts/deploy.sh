#!/usr/bin/env bash
# deploy.sh — build and publish mdrone to GitHub Pages.
#
# Runs the npm `deploy` script which does:
#   1. tsc -b && vite build  (typecheck + build dist/)
#   2. gh-pages -d dist --dotfiles -b gh-pages
#
# Before deploying:
#   - refuses if working tree is dirty
#   - prints the current version
#   - asks for y/N confirmation
#   - tags the deploy (optional) with the current version
#
# Usage:
#   misc/scripts/deploy.sh            # interactive
#   misc/scripts/deploy.sh --yes      # skip confirmation
#   misc/scripts/deploy.sh --no-tag   # skip git tag
#
# The deployed site lives at https://mdrone.mpump.live (via the
# public/CNAME file that gets copied into dist/).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
cd "$REPO_ROOT"

skip_confirm=false
skip_tag=false
for arg in "$@"; do
  case "$arg" in
    -y|--yes) skip_confirm=true ;;
    --no-tag) skip_tag=true ;;
    -h|--help)
      sed -n '2,19p' "$0" | sed 's|^# \?||'
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# Refuse on dirty working tree — we don't want to ship uncommitted code
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree has uncommitted changes — commit or stash first" >&2
  exit 1
fi

version=$(node -p "require('./package.json').version")
branch=$(git rev-parse --abbrev-ref HEAD)
commit=$(git rev-parse --short HEAD)

echo "──────────────────────────────────────────────────"
echo " deploying mdrone v$version"
echo " branch: $branch"
echo " commit: $commit"
echo " target: https://mdrone.mpump.live  (gh-pages branch)"
echo "──────────────────────────────────────────────────"

if ! $skip_confirm; then
  read -r -p "proceed with deploy? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "aborted."
    exit 1
  fi
fi

# Ensure public/CNAME is there so GitHub Pages keeps the custom domain
if [[ ! -f public/CNAME ]]; then
  echo "warning: public/CNAME is missing — the custom domain will be lost after deploy." >&2
fi

npm run deploy

if ! $skip_tag; then
  tag="v$version"
  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "tag $tag already exists, skipping"
  else
    git tag -a "$tag" -m "Release $tag"
    echo "created tag $tag (not pushed — run: git push origin $tag)"
  fi
fi

echo
echo "✓ deployed v$version"
echo "  check: https://mdrone.mpump.live"
