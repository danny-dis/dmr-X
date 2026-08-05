#!/usr/bin/env bash
# Bash counterpart of sync-godmode-fork.ps1 — the MANUAL sync path. The
# automatic one is .github/workflows/godmode-fork-sync.yml (nightly; also
# verifies patches/g0dm0d3/ still applies and opens the ref-bump PR). See the
# .ps1 for the full rationale.
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
