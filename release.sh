#!/usr/bin/env bash
# One-command release for the Data 360 Inspector.
#
#   ./release.sh "what you changed"
#
# Does EVERYTHING so you never touch git per-repo:
#   1. node build.js            → rebuild + run the test gate (aborts if a test fails)
#                                  (build.js also syncs the two extension repos)
#   2. commit + push the SOURCE repo            (datacloud-mapping-inspector / dev)
#   3. copy install.html → the public bookmarklet page repo, commit + push
#   4. commit + push the PUBLIC extension repo
#   5. commit + push the PRIVATE (dev/internal) extension repo
#
# Skips any repo that has no changes. Safe to re-run. If a test fails, NOTHING is
# pushed. Requires: `gh auth login` done once (already done on this machine).

set -euo pipefail

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "Usage: ./release.sh \"short message describing what changed\""
  exit 1
fi

SRC="$HOME/datacloud-mapping-inspector"
PAGES="$HOME/datacloud-inspector"                       # public bookmarklet install page (index.html)
EXT_PUB="$HOME/datacloud-inspector-extension"           # public extension
EXT_DEV="$HOME/datacloud-inspector-extension-dev"       # private/internal extension

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

echo "──────────────────────────────────────────────"
echo "  ✅ Release complete."
echo "  Reminder: re-drag the bookmarklet from the install page; reload the"
echo "  unpacked extension in chrome://extensions to pick up the new build."
echo "──────────────────────────────────────────────"
