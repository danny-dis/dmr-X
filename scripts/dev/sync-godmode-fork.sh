#!/usr/bin/env bash
# Bash counterpart of sync-godmode-fork.ps1 — see that file for the full
# rationale (gh repo sync vs. a GitHub Actions workflow living in the fork).
#
# Usage: bash scripts/dev/sync-godmode-fork.sh
set -euo pipefail

FORK="danny-dis/G0DM0D3"
UPSTREAM="elder-plinius/G0DM0D3"

echo "Syncing $FORK from $UPSTREAM ..."
gh repo sync "$FORK" --source "$UPSTREAM"

SHA="$(gh api "repos/$FORK/commits/main" --jq '.sha')"
echo "Synced. Fork main is now at $SHA"
echo
echo "To pick this up, set DMRX_GODMODE_REF=$SHA (.env) and re-install the"
echo "managed G0DM0D3 server (or delete .dmrx-data/servers/g0dm0d3 and let it"
echo "re-clone) — existing installs are pinned and do not move automatically."
