# Pull upstream elder-plinius/G0DM0D3 changes into our fork danny-dis/G0DM0D3,
# by hand.
#
# THIS IS THE MANUAL PATH. The automatic one is
# `.github/workflows/godmode-fork-sync.yml`, which runs nightly, additionally
# verifies patches/g0dm0d3/ still applies to the new commit, and opens a PR
# bumping DMRX_GODMODE_REF. That workflow lives in DMR-X rather than in the
# fork so changes to it appear in DMR-X's own review history and the fork stays
# a clean, DMR-X-commit-free mirror of upstream.
#
# Use this script when you want the fork current *now* — before the nightly
# run, or from a box where you would rather not wait on Actions. It only does
# the sync; it does not check the patches or touch DMRX_GODMODE_REF.
#
# server-manager.service.ts clones a PINNED COMMIT SHA (DMRX_GODMODE_REF), not
# the fork's moving branch tip, so running this script never silently changes
# what a running DMR-X installs — it only updates what NEW installs would pin
# to once someone deliberately bumps DMRX_GODMODE_REF to the synced commit.
#
# Usage: pwsh scripts/dev/sync-godmode-fork.ps1
#   (requires `gh auth status` to already be logged in; see README below)

$ErrorActionPreference = 'Stop'

$Fork = 'danny-dis/G0DM0D3'
$Upstream = 'elder-plinius/G0DM0D3'

Write-Host "Syncing $Fork from $Upstream ..."
gh repo sync $Fork --source $Upstream
if ($LASTEXITCODE -ne 0) {
  Write-Error "gh repo sync failed (exit $LASTEXITCODE)"
  exit $LASTEXITCODE
}

$Sha = gh api "repos/$Fork/commits/main" --jq '.sha'
Write-Host "Synced. Fork main is now at $Sha"
Write-Host ""
Write-Host "To pick this up, set DMRX_GODMODE_REF=$Sha (.env) and re-install"
Write-Host "the managed G0DM0D3 server (or delete .dmrx-data/servers/g0dm0d3"
Write-Host "and let it re-clone) — existing installs are pinned and do not"
Write-Host "move automatically."
