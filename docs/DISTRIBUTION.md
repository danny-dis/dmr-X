# Distribution

DMR-X compiles to standalone executables for Windows, Linux, and macOS using `bun build --compile`. Each release archive contains the binary, UI assets, and an install script.

## Building Binaries

### Single Platform

```bash
bun run build                       # Build all packages + UI
cd apps/gateway
bun run build:exe                   # Windows (dmrx.exe)
bun run build:exe:linux             # Linux (dmrx-linux)
bun run build:exe:macos             # macOS (dmrx-darwin)
```

### All Platforms (CI)

The GitHub Actions workflow (`.github/workflows/release.yml`) builds all three platforms in parallel.

## Release Packaging

The `scripts/package-release.sh` script creates distributable archives from built binaries:

```bash
# After building binaries
./scripts/package-release.sh
```

This creates in `release/`:
- `dmrx-windows-x64.zip`
- `dmrx-linux-x64.tar.gz`
- `dmrx-darwin-x64.tar.gz`

Each archive contains:
```
dmrx-{platform}-x64/
├── dmrx              # Binary (or dmrx.exe on Windows)
├── public/           # UI assets
├── install.sh        # Install script (Linux/macOS)
├── install.bat       # Install script (Windows)
└── README.txt        # Quick start guide
```

## Install Scripts

### Linux / macOS (`install.sh`)

The install script:
1. Detects OS (Linux/Darwin) and architecture (x64/arm64)
2. Downloads the latest release archive from GitHub
3. Extracts to `~/.dmr-x/bin/`
4. Adds `~/.dmr-x/bin` to PATH (bash/zsh/profile)
5. Creates a `start-dmrx` convenience script

```bash
# One-liner install
curl -sL https://github.com/dmr-x/dmr-x/releases/latest/download/dmrx-linux-x64.tar.gz | tar xz
cd dmrx-linux-x64 && ./install.sh
```

### Windows (`install.bat`)

The install script:
1. Downloads the latest release zip from GitHub via curl
2. Extracts to `%USERPROFILE%\.dmr-x\bin\`
3. Adds to PATH via `setx`
4. Creates a `start-dmrx.bat` convenience script

```cmd
:: Download and extract
curl -sL https://github.com/dmr-x/dmr-x/releases/latest/download/dmrx-windows-x64.zip -o dmrx.zip
powershell -Command "Expand-Archive -Path dmrx.zip -DestinationPath $env:USERPROFILE\.dmr-x\bin -Force"
:: Run installer
%USERPROFILE%\.dmr-x\bin\install.bat
```

## CI/CD Release Workflow

`.github/workflows/release.yml` triggers on `v*` tags:

1. **Build job** (matrix: windows, linux, macos)
   - Checkout code
   - Install Bun
   - `bun install --frozen-lockfile`
   - `bun run build` (all packages)
   - `bun run --cwd apps/ui build` (UI)
   - `bun run build:exe` (platform-specific binary)
   - Package into archive with UI assets, install script, README
   - Upload as GitHub Actions artifact

2. **Release job** (runs after all builds pass)
   - Downloads all platform artifacts
   - Creates GitHub Release with auto-generated release notes
   - Attaches `.zip` and `.tar.gz` archives

### Triggering a Release

```bash
git tag v0.5.0
git push origin v0.5.0
```

The workflow creates a GitHub Release with binaries for all three platforms.

## Binary Size

Pre-built binaries are approximately 38-39MB each (includes Bun runtime + all packages + UI assets).

## Data Directory

The binary stores data at `~/.dmr-x/` (configurable via `DMRX_DATA_DIR`):

```
~/.dmr-x/
├── data.db           # SQLite database
└── logs/             # Application logs (if configured)
```

## Updating

To update DMR-X:
1. Download the new release
2. Replace the binary
3. Restart

The SQLite database and configuration are preserved in `~/.dmr-x/`.
