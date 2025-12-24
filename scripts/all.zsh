#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

zsh scripts/smoke.zsh
zsh scripts/e2e.zsh
