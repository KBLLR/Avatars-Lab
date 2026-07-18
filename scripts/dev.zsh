#!/usr/bin/env zsh
set -euo pipefail

HOUSE_DIR=$(cd "$(dirname "$0")/.." && pwd)
REPO_ROOT=$(cd "$HOUSE_DIR/../.." && pwd)
COREX_GATEWAY_URL="${COREX_GATEWAY_URL:-http://127.0.0.1:8090}"
AVATAR_LABS_VITE_PORT="${AVATAR_LABS_VITE_PORT:-${AVATAR_LABS_DEV_PORT:-5185}}"

export VITE_COREX_GATEWAY_URL="${VITE_COREX_GATEWAY_URL:-$COREX_GATEWAY_URL}"
export AVATAR_LABS_VITE_PORT

node "$HOUSE_DIR/scripts/hydrate-avatar-assets.mjs"

gateway_status=$(curl --config /dev/null --connect-timeout 1 --max-time 2 -s -o /dev/null -w "%{http_code}" "$COREX_GATEWAY_URL/health" || true)
if [[ "$gateway_status" != "200" ]]; then
  echo "Core-X Gateway is offline at $COREX_GATEWAY_URL (HTTP ${gateway_status:-unreachable})."
  echo "Start or repair it from $REPO_ROOT with: ./corex wall"
  echo "Avatar Labs will still open, but MLX-backed cases will report the lane offline."
else
  echo "Core-X Gateway online: $COREX_GATEWAY_URL"
fi

cd "$HOUSE_DIR"
exec npm run dev:ui -- --host 127.0.0.1 --strictPort --port "$AVATAR_LABS_VITE_PORT"
