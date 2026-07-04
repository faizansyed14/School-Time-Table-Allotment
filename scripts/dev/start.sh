#!/usr/bin/env bash
# Start the DEVELOPMENT stack (db + api + web) with smaller resource limits.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env.dev"
COMPOSE_FILE="docker-compose.dev.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.example and edit:" >&2
  echo "  cp .env.example $ENV_FILE" >&2
  exit 1
fi

echo "▶ Starting school TT allotment (development)…"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo ""
echo "✅ Development stack is up:"
echo "   Frontend : http://localhost:${FRONTEND_PORT:-3000}"
echo "   API      : http://localhost:${BACKEND_PORT:-4000}/api/health"
echo "   Postgres : localhost:5432"
echo ""
echo "Logs : docker compose -f $COMPOSE_FILE logs -f"
