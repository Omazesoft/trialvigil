#!/usr/bin/env bash
# TrialVigil — run locally WITHOUT docker.
# Requires: node 24+ and npm. No docker, no cloud account, no spend.
#
# Usage:
#   bash infra/scripts/run-local.sh
#   # or from the repo root: ./infra/scripts/run-local.sh
#
# What it does:
#   1. Loads infra/.env if present (otherwise uses defaults).
#   2. Runs `npm install` at the repo root (installs workspaces).
#   3. Starts the harness service (port 3001) and the console (port 3000)
#      concurrently in the foreground. Ctrl-C stops both.
#
# Ollama is optional: if OLLAMA_HOST is reachable it is used for local
# inference; otherwise the harness falls back to the deterministic extractor
# and the demo still works.
set -euo pipefail

# Resolve repo root (parent of infra/) regardless of where we are invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Load infra/.env if present (simple KEY=VALUE lines, no export needed).
if [[ -f "infra/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "infra/.env"
  set +a
fi

CONSOLE_PORT="${CONSOLE_PORT:-3000}"
HARNESS_PORT="${HARNESS_PORT:-3001}"
DATA_DIR="${DATA_DIR:-./data}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1:8b}"

echo "TrialVigil (local, no docker)"
echo "  repo root:   $REPO_ROOT"
echo "  console:     http://localhost:$CONSOLE_PORT"
echo "  harness:     http://localhost:$HARNESS_PORT"
echo "  data dir:    $DATA_DIR"
echo "  ollama host: $OLLAMA_HOST (optional — demo works without it)"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed. Install Node.js 24+ and retry." >&2
  exit 1
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  echo "ERROR: Node.js 24+ is required (found $(node --version))." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

echo "Installing dependencies (npm install at repo root)..."
npm install

# Start both apps concurrently; trap Ctrl-C / exit and kill both children.
PIDS=()
cleanup() {
  echo ""
  echo "Stopping TrialVigil..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting harness service on :$HARNESS_PORT ..."
(
  # Prefer the harness app's own start script when it exists; otherwise
  # build at the repo root and run the compiled entrypoint (the root
  # package.json's `dev` script does the same thing).
  if [[ -f "apps/harness-service/package.json" ]] && node -e "const p=require('./apps/harness-service/package.json'); process.exit(p.scripts && (p.scripts.start || p.scripts.dev) ? 0 : 1)"; then
    cd apps/harness-service
    PORT="$HARNESS_PORT" DATA_DIR="$REPO_ROOT/$DATA_DIR" \
      OLLAMA_HOST="$OLLAMA_HOST" OLLAMA_MODEL="$OLLAMA_MODEL" \
      npm start
  else
    npm run build
    PORT="$HARNESS_PORT" DATA_DIR="$REPO_ROOT/$DATA_DIR" \
      OLLAMA_HOST="$OLLAMA_HOST" OLLAMA_MODEL="$OLLAMA_MODEL" \
      node apps/harness-service/dist/index.js
  fi
) &
PIDS+=($!)

echo "Starting console on :$CONSOLE_PORT ..."
(
  PORT="$CONSOLE_PORT" HARNESS_URL="http://localhost:$HARNESS_PORT" \
    DATA_DIR="$REPO_ROOT/$DATA_DIR" \
    npm run dev --workspace=@trialvigil/console -- \
      --port "$CONSOLE_PORT" --host 127.0.0.1
) &
PIDS+=($!)

echo ""
echo "Running. Console: http://localhost:$CONSOLE_PORT  |  Harness: http://localhost:$HARNESS_PORT"
echo "Press Ctrl-C to stop both."
wait
