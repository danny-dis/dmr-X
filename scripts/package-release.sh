#!/usr/bin/env bash
set -euo pipefail

# DMR-X Release Packaging Script
# Creates distributable zip/tarball from built artifacts

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/apps/gateway/dist"
RELEASE_DIR="$PROJECT_ROOT/release"

echo "DMR-X Release Packager"
echo "======================"

# Check that public/ exists
if [ ! -d "$DIST_DIR/public" ]; then
    echo "ERROR: No public/ directory found in $DIST_DIR"
    echo "Run 'cd apps/gateway && bun run build:exe' first"
    exit 1
fi

# Clean release dir
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# Detect available binaries
HAS_WINDOWS=false
HAS_LINUX=false
HAS_MACOS=false

if [ -f "$DIST_DIR/dmrx.exe" ]; then HAS_WINDOWS=true; fi
if [ -f "$DIST_DIR/dmrx-linux" ]; then HAS_LINUX=true; fi
if [ -f "$DIST_DIR/dmrx-darwin" ]; then HAS_MACOS=true; fi

if [ "$HAS_WINDOWS" = false ] && [ "$HAS_LINUX" = false ] && [ "$HAS_MACOS" = false ]; then
    echo "ERROR: No binaries found in $DIST_DIR"
    echo "Run 'cd apps/gateway && bun run build:exe:all' first"
    exit 1
fi

package_platform() {
    local platform="$1"
    local binary_name="$2"   # final name in archive (dmrx.exe or dmrx)
    local src_binary="$3"    # source name in dist/ (dmrx.exe, dmrx-linux, dmrx-darwin)
    local archive_format="$4"

    local binary_src="$DIST_DIR/$src_binary"

    if [ ! -f "$binary_src" ]; then
        echo "  Skipping $platform - $src_binary not found"
        return
    fi

    echo "Packaging $platform..."
    local plat_dir="$RELEASE_DIR/dmrx-${platform}-x64"
    mkdir -p "$plat_dir"

    # Copy binary with final name
    cp "$binary_src" "$plat_dir/$binary_name"
    if [ "$platform" != "windows" ]; then
        chmod +x "$plat_dir/$binary_name"
    fi

    # Copy UI assets
    cp -r "$DIST_DIR/public" "$plat_dir/"

    # Copy install script
    if [ "$platform" = "windows" ]; then
        cp "$SCRIPT_DIR/install.bat" "$plat_dir/"
    else
        cp "$SCRIPT_DIR/install.sh" "$plat_dir/"
        chmod +x "$plat_dir/install.sh"
    fi

    # Create README
    local run_cmd="./dmrx"
    local data_dir="~/.dmr-x"
    if [ "$platform" = "windows" ]; then
        run_cmd="dmrx.exe"
        data_dir="%USERPROFILE%\\.dmr-x"
    fi

    cat > "$plat_dir/README.txt" << EOF
DMR-X - AI Model Router Proxy
==============================

Quick Start:
  1. Run: $run_cmd
  2. Open http://localhost:3000 in your browser
  3. Add your API keys on the Provider Keys page

Data is stored in: $data_dir
EOF

    # Create archive
    cd "$RELEASE_DIR"
    if [ "$archive_format" = "zip" ]; then
        if command -v zip &>/dev/null; then
            zip -r "dmrx-${platform}-x64.zip" "dmrx-${platform}-x64/"
        elif command -v 7z &>/dev/null; then
            7z a "dmrx-${platform}-x64.zip" "dmrx-${platform}-x64/"
        else
            echo "  WARNING: No zip tool found, skipping archive"
            return
        fi
        echo "  -> $RELEASE_DIR/dmrx-${platform}-x64.zip"
    else
        tar -czf "dmrx-${platform}-x64.tar.gz" "dmrx-${platform}-x64/"
        echo "  -> $RELEASE_DIR/dmrx-${platform}-x64.tar.gz"
    fi
    cd "$PROJECT_ROOT"
}

if [ "$HAS_WINDOWS" = true ]; then package_platform "windows" "dmrx.exe" "dmrx.exe" "zip"; fi
if [ "$HAS_LINUX" = true ]; then package_platform "linux" "dmrx" "dmrx-linux" "tar.gz"; fi
if [ "$HAS_MACOS" = true ]; then package_platform "darwin" "dmrx" "dmrx-darwin" "tar.gz"; fi

echo ""
echo "Done! Release packages in: $RELEASE_DIR/"
ls -lh "$RELEASE_DIR/"*.{zip,tar.gz} 2>/dev/null || true
