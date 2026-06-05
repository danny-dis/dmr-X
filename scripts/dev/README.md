# scripts/dev

Local-only developer utilities. These scripts are **not** part of the
production build and are excluded from the root `tsconfig.json`.

They are ad-hoc SQLite inspectors that hardcode a personal data path
(`C:/Users/pc/.dmr-x/data.db`) and are intended for poking at the
local DMR-X database while debugging.

## Scripts

| Script | What it does |
|---|---|
| `check-schema.ts` | Lists all tables and their columns in the local SQLite database |
| `list-keys.ts` | Lists active API keys joined with their tenant names |
| `list-providers.ts` | Lists all providers with their base URL and active state |
| `list-providers-v2.ts` | Lists all providers with adapter type and health state |

## Usage

```bash
# From repo root
bun scripts/dev/check-schema.ts
bun scripts/dev/list-keys.ts
bun scripts/dev/list-providers.ts
bun scripts/dev/list-providers-v2.ts
```

## Path configuration

By default these scripts read from
`C:/Users/pc/.dmr-x/data.db` (Windows) or `~/.dmr-x/data.db`. To
point at a different database, edit the `Database` constructor at
the top of each file or set `DMRX_DATA_DIR` and adjust the path
accordingly.

## Why not under `scripts/` (top-level)?

The top-level `scripts/` directory ships release/install scripts
that are part of the production build pipeline. Keeping
`scripts/dev/` separate makes the intent explicit: anything under
`scripts/dev/` is for local debugging only and is excluded from
`tsc -b`.
