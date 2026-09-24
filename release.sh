#!/usr/bin/env bash
# One-command release for the Data 360 Inspector.
#
#   ./release.sh "what you changed"
#   ./release.sh "what you changed" --tag my-restore-point
#
# Does EVERYTHING so you never touch git per-repo:
#   1. node build.js            → rebuild + run the test gate (aborts if a test fails)
#                                  (build.js also syncs the two extension repos)
#   2. commit + push the SOURCE repo            (datacloud-mapping-inspector / dev)
#   3. copy install.html → the public bookmarklet page repo, commit + push
#   4. commit + push the PUBLIC extension repo
#   5. commit + push the PRIVATE (dev/internal) extension repo
#   6. (optional) --tag NAME → stamp a "restore point" tag on ALL repos + push it,
#                  so you can always return to this exact known-good state later
#                  (recover with ./restore.sh NAME).
#
# Skips any repo that has no changes. Safe to re-run. If a test fails, NOTHING is
# pushed. Requires: `gh auth login` done once (already done on this machine).

set -euo pipefail

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "Usage: ./release.sh \"short message describing what changed\" [--tag restore-point-name]"
  exit 1
fi

# optional --tag NAME
TAG=""
if [ "${2:-}" = "--tag" ]; then
  TAG="${3:-}"
  if [ -z "$TAG" ]; then echo "ERROR: --tag needs a name, e.g. --tag before-big-change"; exit 1; fi
fi

SRC="$HOME/datacloud-mapping-inspector"
PAGES="$HOME/datacloud-inspector"                       # public bookmarklet install page (index.html)
EXT_PUB="$HOME/datacloud-inspector-extension"           # public extension
EXT_DEV="$HOME/datacloud-inspector-extension-dev"       # private/internal extension
ALL_REPOS=("$SRC" "$PAGES" "$EXT_PUB" "$EXT_DEV")

CO="Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"

echo "──────────────────────────────────────────────"
echo "  1/5  Building + running tests"
echo "──────────────────────────────────────────────"
cd "$SRC"
node build.js   # aborts on any test failure → nothing below runs

# helper: commit only if there are changes; always print what happened
commit_push () {
  local dir="$1" label="$2"
  if [ ! -d "$dir/.git" ]; then echo "  · $label: no git repo at $dir — skipped"; return; fi
  cd "$dir"
  if [ -z "$(git status --porcelain)" ]; then echo "  · $label: no changes"; return; fi
  git add -A
  git commit -q -m "$MSG

$CO"
  git push -q origin main
  echo "  ✓ $label: pushed ($(git rev-parse --short HEAD))"
}

echo "──────────────────────────────────────────────"
echo "  2/5  Source repo (dev)"
echo "──────────────────────────────────────────────"
commit_push "$SRC" "source (datacloud-mapping-inspector)"

echo "──────────────────────────────────────────────"
echo "  3/5  Public bookmarklet install page"
echo "──────────────────────────────────────────────"
if [ -d "$PAGES/.git" ]; then
  cp "$SRC/install.html" "$PAGES/index.html"
  commit_push "$PAGES" "public install page (datacloud-inspector)"
else
  echo "  · public install page: repo not found — skipped"
fi

echo "──────────────────────────────────────────────"
echo "  4/5  Public extension"
echo "──────────────────────────────────────────────"
commit_push "$EXT_PUB" "public extension (datacloud-inspector-extension)"

echo "──────────────────────────────────────────────"
echo "  5/5  Private/internal extension"
echo "──────────────────────────────────────────────"
commit_push "$EXT_DEV" "dev extension (datacloud-inspector-extension-dev)"

if [ -n "$TAG" ]; then
  echo "──────────────────────────────────────────────"
  echo "  6/6  Restore-point tag: $TAG"
  echo "──────────────────────────────────────────────"
  for dir in "${ALL_REPOS[@]}"; do
    [ -d "$dir/.git" ] || continue
    cd "$dir"
    git tag -d "$TAG" >/dev/null 2>&1 || true
    git tag -a "$TAG" -m "$MSG"
    git push -q -f origin "$TAG"
    echo "  ✓ $(basename "$dir"): tagged $TAG -> $(git rev-parse --short "$TAG")"
  done
fi

echo "──────────────────────────────────────────────"
echo "  ✅ Release complete.${TAG:+  (restore point: $TAG)}"
echo "  Reminder: re-drag the bookmarklet from the install page; reload the"
echo "  unpacked extension in chrome://extensions to pick up the new build."
echo "──────────────────────────────────────────────"
