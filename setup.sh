#!/bin/bash
# =============================================================
# Project Interrupt — Portable Setup Script
# Run this after plugging the SSD into a new machine.
# Usage: bash "/Volumes/Extreme Pro/project Interrupt/setup.sh"
# =============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$HOME/roof_venv"

echo "========================================="
echo "  Project Interrupt — Machine Setup"
echo "========================================="
echo ""
echo "Project directory: $PROJECT_DIR"
echo ""

# --- Check for Node.js ---
if command -v node &> /dev/null; then
    echo "[OK] Node.js $(node --version)"
else
    echo "[MISSING] Node.js not found."
    echo "  Install: https://nodejs.org/ or 'brew install node'"
    MISSING=1
fi

# --- Check for npm ---
if command -v npm &> /dev/null; then
    echo "[OK] npm $(npm --version)"
else
    echo "[MISSING] npm not found (comes with Node.js)"
    MISSING=1
fi

# --- Check for Python 3.12 ---
PY312=""
if command -v python3.12 &> /dev/null; then
    PY312="python3.12"
elif [ -x "/opt/homebrew/opt/python@3.12/bin/python3.12" ]; then
    PY312="/opt/homebrew/opt/python@3.12/bin/python3.12"
elif [ -x "/usr/local/opt/python@3.12/bin/python3.12" ]; then
    PY312="/usr/local/opt/python@3.12/bin/python3.12"
fi

if [ -n "$PY312" ]; then
    echo "[OK] Python 3.12 found: $PY312"
else
    echo "[MISSING] Python 3.12 not found."
    echo "  Install: brew install python@3.12"
    MISSING=1
fi

# --- Check for Claude Code ---
if command -v claude &> /dev/null; then
    echo "[OK] Claude Code found"
else
    echo "[MISSING] Claude Code not found."
    echo "  Install: npm install -g @anthropic-ai/claude-code"
    MISSING=1
fi

if [ "${MISSING:-0}" = "1" ]; then
    echo ""
    echo "Install the missing dependencies above, then re-run this script."
    exit 1
fi

echo ""

# --- Install Node.js dependencies ---
echo "Installing Node.js dependencies..."
cd "$PROJECT_DIR"
npm install
echo "[OK] node_modules ready"
echo ""

# --- Create Python venv on local drive ---
if [ -d "$VENV_DIR" ] && "$VENV_DIR/bin/python3" -c "import open3d" &> /dev/null; then
    echo "[OK] Python venv already exists at $VENV_DIR with Open3D"
else
    echo "Creating Python 3.12 venv at $VENV_DIR ..."
    rm -rf "$VENV_DIR"
    "$PY312" -m venv "$VENV_DIR"
    "$VENV_DIR/bin/python3.12" -m ensurepip
    echo "Installing Python dependencies (this may take a few minutes)..."
    "$VENV_DIR/bin/python3.12" -m pip install -r "$PROJECT_DIR/roof_geometry/requirements.txt"
    echo "[OK] Python venv ready"
fi

echo ""

# --- Check .env file ---
if [ -f "$PROJECT_DIR/.env" ]; then
    echo "[OK] .env file found"
else
    echo "[WARNING] No .env file found. You may need to create one with:"
    echo "  GOOGLE_API_KEY=your_key_here"
fi

echo ""
echo "========================================="
echo "  Setup complete!"
echo "========================================="
echo ""
echo "To start the services:"
echo ""
echo "  1. Node server (port 3001):"
echo "     cd \"$PROJECT_DIR\" && node server.js"
echo ""
echo "  2. Python roof service (port 8000):"
echo "     cd \"$PROJECT_DIR/roof_geometry\" && ~/roof_venv/bin/python3.12 -m uvicorn app:app --host 0.0.0.0 --port 8000"
echo ""
echo "  3. Claude Code:"
echo "     cd \"$PROJECT_DIR\" && claude"
echo ""
