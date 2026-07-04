#!/usr/bin/env bash
# Start the PRODUCTION stack (db + api + web) with full resource limits.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env.prod"
COMPOSE_FILE="docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.example and edit:" >&2
  echo "  cp .env.example $ENV_FILE" >&2
  exit 1
fi

if grep -q "CHANGE_ME" "$ENV_FILE"; then
  echo "⚠️  $ENV_FILE still contains CHANGE_ME placeholders — update secrets before going live." >&2
fi

echo "▶ Starting school TT allotment (production)…"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo ""
echo "✅ Production stack is up:"
echo "   Frontend : http://localhost:${FRONTEND_PORT:-80}"
echo "   API      : http://localhost:${BACKEND_PORT:-4000}/api/health"
echo ""
echo "Logs : docker compose -f $COMPOSE_FILE logs -f"
