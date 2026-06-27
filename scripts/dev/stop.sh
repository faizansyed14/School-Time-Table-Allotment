#!/usr/bin/env bash
# Stop the DEVELOPMENT stack. Pass --wipe to also delete the database volume.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.dev.yml"

if [[ "${1:-}" == "--wipe" ]]; then
  echo "▶ Stopping development stack and REMOVING data volume…"
  docker compose --env-file .env.dev -f "$COMPOSE_FILE" down -v
else
  echo "▶ Stopping development stack…"
  docker compose --env-file .env.dev -f "$COMPOSE_FILE" down
fi

echo "✅ Development stack stopped."
