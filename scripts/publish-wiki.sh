#!/usr/bin/env bash
# publish-wiki.sh - push docs/wiki-drafts pages to the GitHub Wiki
#
# Usage: ./scripts/publish-wiki.sh [--dry-run|--validate-only]
#
# Requires: git, gh (GitHub CLI), repo write access
# The script validates draft naming, optionally clones the wiki repo into a
# temp dir, copies pages, commits, and pushes. Run from the repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIKI_DRAFTS="$REPO_ROOT/docs/wiki-drafts"
DRY_RUN=false
VALIDATE_ONLY=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "DRY RUN - no changes will be pushed"
elif [[ "${1:-}" == "--validate-only" ]]; then
  VALIDATE_ONLY=true
  echo "VALIDATE ONLY - checking wiki-draft publishability without cloning or pushing"
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Copying wiki-draft pages ..."
declare -A seen_wiki_names
for file in "$WIKI_DRAFTS"/*.md; do
  [[ -f "$file" ]] || continue
  basename_file=$(basename "$file")
  [[ "$basename_file" == "README.md" ]] && continue
  wiki_name=$(echo "$basename_file" | sed 's/^[0-9]*-//')
  if [[ -n "${seen_wiki_names[$wiki_name]+_}" ]]; then
    echo "ERROR: wiki name collision - both '${seen_wiki_names[$wiki_name]}' and '$basename_file' would produce '$wiki_name'" >&2
    exit 1
  fi
  seen_wiki_names[$wiki_name]="$basename_file"
  echo "  + $basename_file -> $wiki_name"
done

if $VALIDATE_ONLY; then
  echo "Validation complete - wiki-draft names are publishable"
  exit 0
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

REMOTE_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")
if [[ -z "$REMOTE_URL" ]]; then
  echo "ERROR: Could not determine git remote URL" >&2
  exit 1
fi

WIKI_URL="${REMOTE_URL%.git}.wiki.git"

echo "Cloning wiki from $WIKI_URL ..."
if ! git clone "$WIKI_URL" "$TMPDIR/wiki" 2>/dev/null; then
  echo "ERROR: Could not clone wiki. Make sure the GitHub Wiki is enabled." >&2
  exit 1
fi

for file in "$WIKI_DRAFTS"/*.md; do
  [[ -f "$file" ]] || continue
  basename_file=$(basename "$file")
  [[ "$basename_file" == "README.md" ]] && continue
  wiki_name=$(echo "$basename_file" | sed 's/^[0-9]*-//')
  cp "$file" "$TMPDIR/wiki/$wiki_name"
done

if $DRY_RUN; then
  echo "DRY RUN complete - files staged in $TMPDIR/wiki (not pushed)"
  exit 0
fi

cd "$TMPDIR/wiki"
git add -A
if git diff --cached --quiet; then
  echo "No changes to push."
  exit 0
fi

GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Riviamigo Docs Bot}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-noreply@riviamigo.local}"
GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

git commit -m "docs: sync wiki from docs/wiki-drafts [automated]"
git push
echo "Wiki updated successfully."
