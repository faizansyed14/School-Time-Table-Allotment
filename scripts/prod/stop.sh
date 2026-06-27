#!/usr/bin/env bash
# Stop the PRODUCTION stack. Pass --wipe to also delete the database volume.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"

if [[ "${1:-}" == "--wipe" ]]; then
  echo "▶ Stopping production stack and REMOVING data volume…"
  docker compose --env-file .env.prod -f "$COMPOSE_FILE" down -v
else
  echo "▶ Stopping production stack…"
  docker compose --env-file .env.prod -f "$COMPOSE_FILE" down
fi

echo "✅ Production stack stopped."
