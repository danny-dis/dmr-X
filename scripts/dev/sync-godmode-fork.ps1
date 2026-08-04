# Pull upstream elder-plinius/G0DM0D3 changes into our fork danny-dis/G0DM0D3.
#
# Why a `gh repo sync` script here instead of a GitHub Actions workflow living
# in the fork:
#   - The fork (danny-dis/G0DM0D3) is a separate repository from DMR-X. A
#     scheduled workflow would have to be authored and pushed there directly,
#     outside this repo's review/commit history — changes to it wouldn't show
#     up in a DMR-X PR diff, and DMR-X's "don't commit/push" workflow rules
#     don't cover a second repository at all.
#   - `gh repo sync` is one already-authenticated command (this box has `gh`
#     signed in as danny-dis with `repo`+`workflow` scope) — no Actions
#     minutes, no workflow YAML to maintain, no separate place to check for
#     failures.
#   - We control exactly when the sync happens (manually, or wired into
#     whatever scheduler already exists on this machine, e.g. Windows Task
#     Scheduler alongside DMR-X-Gateway.task.xml), rather than trusting GitHub
#     Actions' scheduled-workflow reliability (minimum interval, silent
#     disablement after 60 days of repo inactivity, etc).
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
