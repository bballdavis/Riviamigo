#!/usr/bin/env bash
# publish-wiki.sh - sync docs/guides pages to the GitHub Wiki repository
#
# Usage: ./scripts/publish-wiki.sh [--dry-run|--validate-only]
#
# The repository docs remain canonical. This script renders the selected
# user-facing guides into the separate <repo>.wiki.git repository, where
# GitHub serves them as Wiki pages.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUIDES_DIR="$REPO_ROOT/docs/guides"
DRY_RUN=false
VALIDATE_ONLY=false

case "${1:-}" in
  "") ;;
  --dry-run)
    DRY_RUN=true
    echo "DRY RUN - no changes will be pushed"
    ;;
  --validate-only)
    VALIDATE_ONLY=true
    echo "VALIDATE ONLY - checking guide publishability without cloning or pushing"
    ;;
  *)
    echo "ERROR: unknown option: $1" >&2
    echo "Usage: $0 [--dry-run|--validate-only]" >&2
    exit 1
    ;;
esac

if [[ ! -d "$GUIDES_DIR" || ! -f "$GUIDES_DIR/README.md" ]]; then
  echo "ERROR: expected wiki source directory and docs/guides/README.md" >&2
  exit 1
fi

REMOTE_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")
if [[ -z "$REMOTE_URL" ]]; then
  echo "ERROR: Could not determine git remote URL" >&2
  exit 1
fi

case "$REMOTE_URL" in
  https://github.com/*|http://github.com/*)
    REPO_PATH="${REMOTE_URL#*github.com/}"
    ;;
  git@github.com:*)
    REPO_PATH="${REMOTE_URL#git@github.com:}"
    ;;
  ssh://git@github.com/*)
    REPO_PATH="${REMOTE_URL#ssh://git@github.com/}"
    ;;
  *)
    echo "ERROR: origin must point to github.com to publish the Wiki" >&2
    exit 1
    ;;
esac
REPO_PATH="${REPO_PATH%.git}"
WIKI_URL="${RIVIAMIGO_WIKI_GIT_URL:-https://github.com/${REPO_PATH}.wiki.git}"
WIKI_PAGE_BASE_URL="https://github.com/${REPO_PATH}/wiki"

DEFAULT_BRANCH=$(git -C "$REPO_ROOT" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
DEFAULT_BRANCH="${DEFAULT_BRANCH#origin/}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
REPO_DOC_BASE_URL="https://github.com/${REPO_PATH}/blob/${DEFAULT_BRANCH}"

declare -A seen_wiki_names
guide_files=()
while IFS= read -r -d '' file; do
  guide_files+=("$file")
  basename_file=$(basename "$file")
  if [[ "$basename_file" == "README.md" ]]; then
    wiki_name="Home.md"
  else
    wiki_name="$basename_file"
  fi

  if [[ "$wiki_name" == *[\\/:\*\?\"\<\>\|]* ]]; then
    echo "ERROR: invalid Wiki filename: $wiki_name" >&2
    exit 1
  fi
  if [[ -n "${seen_wiki_names[$wiki_name]+_}" ]]; then
    echo "ERROR: Wiki name collision - both '${seen_wiki_names[$wiki_name]}' and '$basename_file' would produce '$wiki_name'" >&2
    exit 1
  fi
  seen_wiki_names[$wiki_name]="$basename_file"
  echo "  + $basename_file -> $wiki_name"
done < <(find "$GUIDES_DIR" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

if [[ "${#guide_files[@]}" -lt 2 ]]; then
  echo "ERROR: expected README.md plus at least one Wiki guide in docs/guides" >&2
  exit 1
fi

if $VALIDATE_ONLY; then
  echo "Validation complete - guide names are publishable"
  exit 0
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
WIKI_DIR="$TMPDIR/wiki"

echo "Cloning Wiki from $WIKI_URL ..."
if ! git clone "$WIKI_URL" "$WIKI_DIR" 2>/dev/null; then
  echo "ERROR: Could not clone Wiki. Make sure the GitHub Wiki is enabled and Git credentials are available." >&2
  exit 1
fi

# The Wiki is a generated mirror. Remove its previous contents while keeping
# the clone metadata, so pages removed from docs/guides do not remain live.
find "$WIKI_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf -- {} +

render_page() {
  local source_file="$1"
  local target_file="$2"
  local source_name="$(basename "$source_file")"

  node - "$source_file" "$target_file" "$source_name" "$WIKI_PAGE_BASE_URL" "$REPO_DOC_BASE_URL" "$GUIDES_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [sourceFile, targetFile, sourceName, wikiBase, repoDocBase, guidesDir] = process.argv.slice(2);
const source = fs.readFileSync(sourceFile, "utf8");
const guideNames = new Set(
  fs.readdirSync(guidesDir).filter((name) => name.endsWith(".md")),
);

function rewriteTarget(rawTarget) {
  const [targetWithQuery, ...anchorParts] = rawTarget.split("#");
  const anchor = anchorParts.length ? `#${anchorParts.join("#")}` : "";

  if (/^(?:[a-z]+:|\/\/|mailto:)/i.test(targetWithQuery) || targetWithQuery.startsWith("#")) {
    return rawTarget;
  }

  const sourcePath = path.resolve(guidesDir, sourceName);
  const resolved = path.resolve(path.dirname(sourcePath), targetWithQuery);
  const relativeToGuides = path.relative(guidesDir, resolved).replaceAll(path.sep, "/");

  if (!relativeToGuides.startsWith("../") && guideNames.has(relativeToGuides)) {
    const pageName = relativeToGuides === "README.md" ? "Home" : relativeToGuides.replace(/\.md$/, "");
    return `${wikiBase}/${pageName}${anchor}`;
  }

  if (targetWithQuery.startsWith(".") || targetWithQuery.startsWith("..")) {
    const repoPath = path.posix.normalize(
      path.posix.join("docs/guides", targetWithQuery.replaceAll("\\", "/")),
    );
    return `${repoDocBase}/${repoPath.replace(/^\.\//, "")}${anchor}`;
  }

  return rawTarget;
}

const rendered = source.replace(/(\]\()([^\)]+)(\))/g, (_match, prefix, target, suffix) => {
  return `${prefix}${rewriteTarget(target)}${suffix}`;
});
fs.writeFileSync(targetFile, rendered);
NODE
}

echo "Rendering Wiki pages ..."
for source_file in "${guide_files[@]}"; do
  basename_file=$(basename "$source_file")
  if [[ "$basename_file" == "README.md" ]]; then
    render_page "$source_file" "$WIKI_DIR/Home.md"
  else
    render_page "$source_file" "$WIKI_DIR/$basename_file"
  fi
done

{
  echo "# Riviamigo"
  echo
  echo "- [Home]($WIKI_PAGE_BASE_URL/Home)"
  for source_file in "${guide_files[@]}"; do
    basename_file=$(basename "$source_file")
    [[ "$basename_file" == "README.md" ]] && continue
    page_name="${basename_file%.md}"
    title=$(sed -n 's/^# //p' "$source_file" | head -n 1)
    title="${title:-$page_name}"
    echo "- [$title]($WIKI_PAGE_BASE_URL/$page_name)"
  done
} > "$WIKI_DIR/_Sidebar.md"

if $DRY_RUN; then
  echo "DRY RUN complete - rendered Wiki files are in $WIKI_DIR (not pushed)"
  find "$WIKI_DIR" -maxdepth 1 -type f -printf '  %f\n' | sort
  exit 0
fi

cd "$WIKI_DIR"
git add -A
if git diff --cached --quiet; then
  echo "No Wiki changes to push."
  exit 0
fi

GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Riviamigo Docs Bot}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-noreply@riviamigo.local}"
GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

git commit -m "docs: sync Wiki from docs/guides [automated]"
git push
echo "Wiki updated successfully."
