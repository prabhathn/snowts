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

VENV_DIR="$ROOT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
    fail "Virtual environment not found. Run ./install.sh first."
fi

if [ ! -d "$ROOT_DIR/app/frontend/node_modules" ]; then
    fail "Frontend dependencies not found. Run ./install.sh first."
fi

# --- Determine connection ---
CONNECTION="${SNOWFLAKE_CONNECTION_NAME:-}"

if [ -z "$CONNECTION" ]; then
    TOML_PATH="$HOME/.snowflake/connections.toml"
    if [ -f "$TOML_PATH" ]; then
        FIRST_CONN=$(grep '^\[' "$TOML_PATH" | head -1 | tr -d '[]' | xargs)
        if [ -n "$FIRST_CONN" ]; then
            CONNECTION="$FIRST_CONN"
            warn "No SNOWFLAKE_CONNECTION_NAME set, using first connection: $CONNECTION"
        fi
    fi
fi

if [ -z "$CONNECTION" ]; then
    fail "No Snowflake connection found. Set SNOWFLAKE_CONNECTION_NAME or add one to ~/.snowflake/connections.toml"
fi

info "Using Snowflake connection: $CONNECTION"

cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
    wait $FRONTEND_PID 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT INT TERM

echo ""
echo "=== Starting Snowts ==="
echo ""

echo "Starting backend on http://localhost:8000 ..."
SNOWFLAKE_CONNECTION_NAME="$CONNECTION" "$VENV_DIR/bin/python" -m uvicorn \
    app.backend.main:app \
    --reload \
    --host 0.0.0.0 \
    --port 8000 \
    --app-dir "$ROOT_DIR" &
BACKEND_PID=$!

sleep 2

echo "Starting frontend on http://localhost:5173 ..."
cd "$ROOT_DIR/app/frontend"
npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

cd "$ROOT_DIR"

echo ""
info "Backend:  http://localhost:8000"
info "Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."
echo ""

wait
