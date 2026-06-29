#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "=== Snowts Install ==="
echo ""

# --- Check Python ---
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        version=$("$cmd" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
        major=$(echo "$version" | cut -d. -f1)
        minor=$(echo "$version" | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 11 ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    fail "Python 3.11+ is required but not found. Install it from https://python.org"
fi
info "Found $($PYTHON --version)"

# --- Check Node ---
if ! command -v node &>/dev/null; then
    fail "Node.js is required but not found. Install it from https://nodejs.org"
fi

NODE_MAJOR=$(node --version | grep -oE '[0-9]+' | head -1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    fail "Node.js 18+ is required (found $(node --version))"
fi
info "Found Node $(node --version)"

# --- Check npm ---
if ! command -v npm &>/dev/null; then
    fail "npm is required but not found. It should come with Node.js."
fi
info "Found npm $(npm --version)"

# --- Check Snow CLI ---
SNOW_CLI=""
if command -v snow &>/dev/null; then
    SNOW_CLI="$(command -v snow)"
elif [ -x "/Applications/SnowflakeCLI.app/Contents/MacOS/snow" ]; then
    SNOW_CLI="/Applications/SnowflakeCLI.app/Contents/MacOS/snow"
fi

if [ -n "$SNOW_CLI" ]; then
    info "Found Snow CLI at $SNOW_CLI"
else
    warn "Snow CLI not found. Document pipeline uploads will not work."
    warn "Install from https://developers.snowflake.com/snowflake-cli/"
fi

# --- Check Snowflake connection ---
TOML_PATH="$HOME/.snowflake/connections.toml"
if [ -f "$TOML_PATH" ]; then
    info "Found Snowflake connections at $TOML_PATH"
else
    warn "No ~/.snowflake/connections.toml found."
    warn "You'll need to configure a connection before using the app."
    warn "See: https://docs.snowflake.com/en/developer-guide/snowflake-cli/connecting/specify-credentials"
fi

echo ""
echo "--- Backend Setup ---"
echo ""

VENV_DIR="$ROOT_DIR/.venv"

if [ -d "$VENV_DIR" ]; then
    info "Virtual environment already exists at .venv"
else
    echo "Creating virtual environment..."
    $PYTHON -m venv "$VENV_DIR"
    info "Created virtual environment at .venv"
fi

echo "Installing Python dependencies..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$ROOT_DIR/app/backend/requirements.txt"
info "Python dependencies installed"

echo ""
echo "--- Frontend Setup ---"
echo ""

echo "Installing npm packages..."
cd "$ROOT_DIR/app/frontend"
npm install --silent
info "npm packages installed"

cd "$ROOT_DIR"

echo ""
echo "=== Install Complete ==="
echo ""
echo "Next steps:"
echo "  1. Ensure you have a connection in ~/.snowflake/connections.toml"
echo "  2. Run ./start.sh to launch the app"
echo "  3. Open http://localhost:5173 — the setup wizard will guide you through Snowflake configuration"
echo ""
