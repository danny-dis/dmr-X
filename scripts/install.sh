#!/usr/bin/env bash
set -euo pipefail

# DMR-X Installer for Linux/macOS
# Downloads the latest release and sets up DMR-X

REPO="dmr-x/dmr-x"
INSTALL_DIR="${HOME}/.dmr-x/bin"
DATA_DIR="${HOME}/.dmr-x"

echo ""
echo "  =========================================="
echo "   DMR-X - AI Model Router Proxy"
echo "  =========================================="
echo ""

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux*)  PLATFORM="linux" ;;
    Darwin*) PLATFORM="darwin" ;;
    *)       echo "  [ERROR] Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
    x86_64|amd64)  ARCH_NAME="x64" ;;
    aarch64|arm64) ARCH_NAME="arm64" ;;
    *)             echo "  [ERROR] Unsupported architecture: $ARCH"; exit 1 ;;
esac

echo "  Platform: ${PLATFORM}-${ARCH_NAME}"

# Check for required tools
for cmd in curl tar; do
    if command -v "$cmd" &>/dev/null; then
        echo "  [OK] $cmd found"
    else
        echo "  [ERROR] $cmd is required but not installed."
        exit 1
    fi
done

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$DATA_DIR"

# Download latest release
echo ""
echo "  Downloading latest release..."

DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/dmrx-${PLATFORM}-${ARCH_NAME}.tar.gz"
TEMP_FILE="$(mktemp)"

if ! curl -sL "$DOWNLOAD_URL" -o "$TEMP_FILE"; then
    echo "  [ERROR] Download failed. Check your internet connection."
    rm -f "$TEMP_FILE"
    exit 1
fi

# Extract
echo "  Extracting..."
tar -xzf "$TEMP_FILE" -C "$INSTALL_DIR" --strip-components=1 >/dev/null 2>&1
rm -f "$TEMP_FILE"

# Make executable
chmod +x "$INSTALL_DIR/dmrx" 2>/dev/null || true

# Verify installation
if [ -f "$INSTALL_DIR/dmrx" ]; then
    echo ""
    echo "  [OK] DMR-X installed to $INSTALL_DIR/dmrx"
else
    echo "  [ERROR] Installation failed - dmrx binary not found"
    exit 1
fi

# Add to PATH if not already there
SHELL_RC=""
case "$(basename "$SHELL")" in
    bash) SHELL_RC="$HOME/.bashrc" ;;
    zsh)  SHELL_RC="$HOME/.zshrc" ;;
    *)    SHELL_RC="$HOME/.profile" ;;
esac

if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
    echo ""
    echo "  Adding to PATH..."
    echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$SHELL_RC"
    export PATH="$PATH:$INSTALL_DIR"
    echo "  [OK] Added to $SHELL_RC"
    echo "  [NOTE] Run 'source $SHELL_RC' or restart your terminal"
fi

# Create a start script
cat > "$INSTALL_DIR/start-dmrx" << 'STARTEOF'
#!/usr/bin/env bash
echo "Starting DMR-X..."
echo "Open http://localhost:3000 in your browser"
echo "Press Ctrl+C to stop"
echo ""
exec "${HOME}/.dmr-x/bin/dmrx"
STARTEOF
chmod +x "$INSTALL_DIR/start-dmrx"

echo ""
echo "  =========================================="
echo "   Installation complete!"
echo "  =========================================="
echo ""
echo "  To start DMR-X:"
echo "    1. Open a new terminal"
echo "    2. Run: dmrx"
echo "    3. Open http://localhost:3000"
echo ""
echo "  To add API keys:"
echo "    - Go to Provider Keys page in the UI"
echo "    - Add your OpenAI, Anthropic, etc. keys"
echo ""
echo "  Data directory: $DATA_DIR"
echo ""
