# Distribution

DMR-X is distributed as standalone executables (via `bun build --compile`) and
as OCI container images pushed to GHCR. Releases are produced entirely by the
GitHub Actions workflow in `.github/workflows/release.yml`.

## Building Binaries Locally

```bash
bun run build                       # Build all packages + UI
cd apps/gateway
bun run build:exe                   # Windows (dmrx.exe)
bun run build:exe:linux             # Linux
bun run build:exe:macos             # macOS
```

## What a Release Actually Produces

The `release.yml` workflow runs on every `v*` tag (or via
`workflow_dispatch`). There is no build matrix — all compilation happens in one
`ubuntu-latest` job, producing binaries for each target with
`bun build --compile`:

| Platform | Artifact |
|----------|----------|
| Linux x64 | `dmrx-linux-x64.tar.gz` |
| Linux arm64 | `dmrx-linux-arm64.tar.gz` |
| macOS x64 | `dmrx-darwin-x64.tar.gz` |
| macOS arm64 | `dmrx-darwin-arm64.tar.gz` |
| Windows x64 | `dmrx-windows-x64.zip` |

Each archive contains the compiled binary plus the built UI assets in
`public/` only:

```
dmrx-linux-x64/
├── dmrx-linux-x64      # Binary (dmrx.exe inside the Windows zip)
└── public/             # UI assets
```

There are no install scripts packaged inside the archives; unzip/untar and run
the binary. The data directory defaults to `~/.dmr-x/` (configurable via
`DMRX_DATA_DIR`).

## Containers

The `container` job builds and pushes to GitHub Container Registry:

- **Node runtime image** — multi-arch (`linux/amd64`, `linux/arm64`), built from
  the `production-node` Dockerfile target:
  - `ghcr.io/danny-dis/dmr-x:<version>`
  - `ghcr.io/danny-dis/dmr-x:<version>-node`
  - `ghcr.io/danny-dis/dmr-x:latest`
- **Binary image** — single-arch (`linux/amd64`), `production-binary` target:
  - `ghcr.io/danny-dis/dmr-x:<version>-binary`

Images are signed with **cosign keyless signing** (using the workflow's OIDC
token) and a **CycloneDX SBOM** is generated and uploaded as a workflow artifact.

## GitHub Release

The `release` job (after `binaries` and `container` succeed):

1. Downloads the binary artifacts, checksums, and SBOM.
2. Reads the version's section from `docs/CHANGELOG.md` for release notes
   (falls back to a generic note if the section is missing).
3. Creates a GitHub Release and attaches the platform archives, `checksums.txt`,
   and `sbom.cdx.json`.

## Triggering a Release

```bash
git tag v0.5.0
git push origin v0.5.0
```

The workflow creates a GitHub Release with binaries for all platforms and
pushes the container images to GHCR.

## Binary Size

Pre-built binaries are approximately 38–39 MB each (Bun runtime + all packages
+ UI assets).

## Data Directory

The binary stores data at `~/.dmr-x/` (configurable via `DMRX_DATA_DIR`):

```
~/.dmr-x/
├── data.db           # SQLite database (data.db.enc when encrypted)
└── logs/             # Application logs (if configured)
```

## Updating

To update DMR-X:
1. Download the new release
2. Replace the binary
3. Restart

The SQLite database and configuration are preserved in `~/.dmr-x/`.
