#!/usr/bin/env bash
set -euo pipefail

# One-click starter for Mail Manager (macOS/zsh, works in bash too)

# cd to project root (directory of this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load nvm if available, prefer Node 20
export NVM_DIR="$HOME/.nvm"
if [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
  . "/opt/homebrew/opt/nvm/nvm.sh"
elif [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

if command -v nvm >/dev/null 2>&1; then
  nvm install 20 >/dev/null
  nvm use 20
fi

echo "Node version: $(node -v 2>/dev/null || echo 'node not found')"

# Default port
export PORT="${PORT:-3000}"

# Free the port if occupied
if lsof -iTCP:"$PORT" -sTCP:LISTEN -nP >/dev/null 2>&1; then
  echo "Port $PORT is in use, trying to stop previous server..."
  pkill -f "server/index.js" 2>/dev/null || true
  # wait briefly and force kill any listener on the port
  sleep 0.5
  if lsof -iTCP:"$PORT" -sTCP:LISTEN -nP >/dev/null 2>&1; then
    PID_TO_KILL=$(lsof -t -iTCP:"$PORT" -sTCP:LISTEN -nP | head -n1 || true)
    if [ -n "${PID_TO_KILL:-}" ]; then
      kill -9 "$PID_TO_KILL" 2>/dev/null || true
    fi
  fi
fi

# Install dependencies if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

# Start the server
echo "Starting Mail Manager on http://localhost:$PORT ..."
exec node server/index.js


