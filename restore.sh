#!/usr/bin/env bash
# Restore-point helper for the Data 360 Inspector (4 repos).
#
#   ./restore.sh --list            Show every restore-point tag across the repos.
#   ./restore.sh <tag>             Roll ALL repos back to that tagged restore point.
#
# Restore points are created by:  ./release.sh "msg" --tag <name>
# (or the one-time known-good tag already pushed).
#
# SAFETY: `./restore.sh <tag>` is destructive to your working state — it does
#   `git reset --hard <tag>` in each repo. It STOPS if a repo has uncommitted
#   changes (so you never lose in-progress work by accident). It does NOT push;
#   after you verify things look right, re-push with:  git push -f origin main
#   (per repo) or just make a new release. Nothing is force-pushed automatically.

set -uo pipefail

SRC="$HOME/datacloud-mapping-inspector"
PAGES="$HOME/datacloud-inspector"
EXT_PUB="$HOME/datacloud-inspector-extension"
EXT_DEV="$HOME/datacloud-inspector-extension-dev"
ALL_REPOS=("$SRC" "$PAGES" "$EXT_PUB" "$EXT_DEV")

MODE="${1:-}"
if [ -z "$MODE" ]; then
  echo "Usage:"
  echo "  ./restore.sh --list        # list restore points"
  echo "  ./restore.sh <tag>         # roll all repos back to <tag>"
  exit 1
fi

if [ "$MODE" = "--list" ]; then
  for dir in "${ALL_REPOS[@]}"; do
    [ -d "$dir/.git" ] || continue
    cd "$dir"
    echo "── $(basename "$dir") ──"
    git tag -l --sort=-creatordate --format='   %(refname:short)   %(creatordate:short)   %(subject)' | head -15
    echo
  done
  exit 0
fi

TAG="$MODE"
echo "About to roll ALL repos back to restore point: $TAG"
echo "(git reset --hard — local only; nothing is pushed automatically)"
echo

# 1) preflight: refuse if any repo has uncommitted work or is missing the tag
fail=0
for dir in "${ALL_REPOS[@]}"; do
  [ -d "$dir/.git" ] || { echo "  ! $(basename "$dir"): repo missing — will skip"; continue; }
  cd "$dir"
  if [ -n "$(git status --porcelain)" ]; then
    echo "  ✗ $(basename "$dir"): has uncommitted changes — commit/stash first (won't touch it)"; fail=1
  fi
  if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
    # try fetching the tag from origin
    git fetch -q origin "refs/tags/$TAG:refs/tags/$TAG" 2>/dev/null || true
    git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1 || { echo "  ✗ $(basename "$dir"): tag '$TAG' not found (local or origin)"; fail=1; }
  fi
done
if [ "$fail" -ne 0 ]; then
  echo; echo "Aborted — fix the above first. Nothing was changed."
  exit 1
fi

# 2) do the reset
echo
for dir in "${ALL_REPOS[@]}"; do
  [ -d "$dir/.git" ] || continue
  cd "$dir"
  git reset --hard "$TAG" >/dev/null
  echo "  ✓ $(basename "$dir"): reset to $TAG ($(git rev-parse --short HEAD))"
done

echo
echo "Done — all repos are now at '$TAG' locally."
echo "Verify (open the tool / run: cd $SRC && node build.js), then to publish the"
echo "rollback:  cd <repo> && git push -f origin main   (per repo, when you're sure)."
