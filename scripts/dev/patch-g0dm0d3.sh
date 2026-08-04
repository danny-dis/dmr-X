#!/usr/bin/env bash
# Re-apply DMR-X specific patches to the vendored G0DM0D3 proxy.
#
# THIS SCRIPT IS NOW A THIN WRAPPER. The actual patch logic lives in
# services/server-manager/src/patch-godmode.ts (pure TS, no perl/bash) and is
# called automatically by ServerManagerService.install()/start() on every
# gateway boot — bash is no longer required to make godmode work.
#
# This script previously reimplemented the same 3 edits directly with perl,
# using its own copy of the patch logic. That copy drifted from the real
# patch set (patches/g0dm0d3/*.patch + relay.ts, added later) and its chat.ts
# edit referenced an undefined `relayMode` variable — a ReferenceError that
# would have broken every relayed chat request, on the one code path (bash)
# that was actually wired up. It is kept only as a manual convenience for
# anyone still invoking it directly (e.g. from run-alwayson.sh); Windows
# entry points never had an equivalent and never needed one, since the fix
# now lives inside the gateway itself.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"

if [ ! -x "$BUN" ] && ! command -v bun >/dev/null 2>&1; then
  echo "[patch-g0dm0d3] bun not found — skipping (gateway will self-patch on boot anyway)." >&2
  exit 0
fi

"$BUN" "$ROOT/scripts/dev/patch-godmode-cli.ts" "$ROOT/.dmrx-data/servers/g0dm0d3"
