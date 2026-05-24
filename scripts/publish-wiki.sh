#!/usr/bin/env bash
# publish-wiki.sh — push docs/wiki-drafts pages to the GitHub Wiki
#
# Usage: ./scripts/publish-wiki.sh [--dry-run]
#
# Requires: git, gh (GitHub CLI), repo write access
# The script clones the wiki repo into a temp dir, copies wave pages, commits,
# and pushes. Run from the repo root.
#
# Note: On Unix/Linux/macOS, make this script executable first:
#   chmod +x scripts/publish-wiki.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIKI_DRAFTS="$REPO_ROOT/docs/wiki-drafts"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "DRY RUN — no changes will be pushed"
fi

# Detect remote
REMOTE_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")
if [[ -z "$REMOTE_URL" ]]; then
  echo "ERROR: Could not determine git remote URL" >&2
  exit 1
fi

WIKI_URL="${REMOTE_URL%.git}.wiki.git"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Cloning wiki from $WIKI_URL ..."
if ! git clone "$WIKI_URL" "$TMPDIR/wiki" 2>/dev/null; then
  echo "ERROR: Could not clone wiki. Make sure the GitHub Wiki is enabled." >&2
  exit 1
fi

echo "Copying wiki-draft pages ..."
for file in "$WIKI_DRAFTS"/*.md; do
  [[ -f "$file" ]] || continue
  basename_file=$(basename "$file")
  # Skip the README — it's internal docs metadata, not a wiki page
  [[ "$basename_file" == "README.md" ]] && continue
  # Strip leading NN- numeric prefix from filename
  wiki_name=$(echo "$basename_file" | sed 's/^[0-9]*-//')
  cp "$file" "$TMPDIR/wiki/$wiki_name"
  echo "  + $basename_file -> $wiki_name"
done

if $DRY_RUN; then
  echo "DRY RUN complete — files staged in $TMPDIR/wiki (not pushed)"
  exit 0
fi

cd "$TMPDIR/wiki"
git add -A
if git diff --cached --quiet; then
  echo "No changes to push."
  exit 0
fi

git commit -m "docs: sync wiki from docs/wiki-drafts [automated]"
git push
echo "Wiki updated successfully."
