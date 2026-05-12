#!/bin/bash
cd "$(dirname "$0")/.." || exit 0

# Only pull if working tree is clean — if dirty, the sync watcher
# will commit first and next hook call will pull
if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
  git pull --rebase --quiet origin main 2>/dev/null || {
    git rebase --abort 2>/dev/null
    git pull --no-rebase --quiet origin main 2>/dev/null || true
  }
fi

exit 0
