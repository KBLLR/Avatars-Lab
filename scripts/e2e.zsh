#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is set. Unset it to avoid outbound OpenAI calls."
  exit 2
fi

export AVATAR_LABS_DEV_PORT="${AVATAR_LABS_DEV_PORT:-5177}"
export AVATAR_LABS_BASE_URL="${AVATAR_LABS_BASE_URL:-http://127.0.0.1:${AVATAR_LABS_DEV_PORT}}"

eval "$(node packages/tests/print-config.mjs --export-env)"
node packages/tests/print-config.mjs

npx playwright test packages/tests/playwright/talkinghead.e2e.spec.mjs --config playwright.config.mjs
