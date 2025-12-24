#!/usr/bin/env zsh
set -euo pipefail

HOUSE_DIR=$(cd "$(dirname "$0")/.." && pwd)
REPO_ROOT=$(cd "$HOUSE_DIR/../.." && pwd)
LOG_DIR="$REPO_ROOT/anthology/logs/avatar-labs"

mkdir -p "$LOG_DIR"

if [[ ! -f "$REPO_ROOT/.env.ecosystem" ]]; then
  echo "Generating .env.ecosystem from services.manifest.json"
  python3 "$REPO_ROOT/scripts/infra/generate_env.py"
fi

# Load service host/port from ecosystem env if present
set -a
source "$REPO_ROOT/.env.ecosystem"
set +a

find_running_pid() {
  local pattern="$1"
  pgrep -f "$pattern" | head -n 1 || true
}

find_listening_pid() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $2; exit}' || true
  fi
}

detect_running_port() {
  local pattern="$1"
  local pid
  pid=$(find_running_pid "$pattern")
  if [[ -z "$pid" ]]; then
    return 0
  fi
  local cmd
  cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
  if [[ -z "$cmd" ]]; then
    return 0
  fi
  if [[ "$cmd" =~ --port[=[:space:]]([0-9]+) ]]; then
    echo "${match[1]}"
  fi
}

LLM_HOST="${MLX_LLM_HOST:-127.0.0.1}"
AUDIO_HOST="${MLX_AUDIO_HOST:-127.0.0.1}"
LLM_PORT="${MLX_LLM_PORT:-8080}"
AUDIO_PORT="${MLX_AUDIO_PORT:-7001}"

detected_llm_pid=$(find_listening_pid "$LLM_PORT")
if [[ -z "$detected_llm_pid" ]]; then
  detected_llm_pid=$(find_running_pid "python -m app.main")
fi
detected_llm_port=$(detect_running_port "python -m app.main")
if [[ -n "$detected_llm_port" && "$detected_llm_port" != "${MLX_LLM_PORT:-}" ]]; then
  echo "Detected running MLX LLM on port ${detected_llm_port}. Using it."
  export MLX_LLM_PORT="$detected_llm_port"
  export MLX_LLM_BASE_URL="http://${LLM_HOST}:${MLX_LLM_PORT}"
  LLM_PORT="$MLX_LLM_PORT"
fi

detected_audio_pid=$(find_listening_pid "$AUDIO_PORT")
if [[ -z "$detected_audio_pid" ]]; then
  detected_audio_pid=$(find_running_pid "uvicorn app.main:app")
fi
detected_audio_port=$(detect_running_port "uvicorn app.main:app")
if [[ -n "$detected_audio_port" && "$detected_audio_port" != "${MLX_AUDIO_PORT:-}" ]]; then
  echo "Detected running MLX Audio on port ${detected_audio_port}. Using it."
  export MLX_AUDIO_PORT="$detected_audio_port"
  export MLX_AUDIO_BASE_URL="http://${AUDIO_HOST}:${MLX_AUDIO_PORT}"
  AUDIO_PORT="$MLX_AUDIO_PORT"
fi

node "$HOUSE_DIR/packages/tests/write-env-local.mjs"
node "$HOUSE_DIR/packages/tests/write-model-snapshot.mjs"

if [[ -f "$HOUSE_DIR/.env.local" ]]; then
  set -a
  source "$HOUSE_DIR/.env.local"
  set +a
fi

LLM_URL="http://${LLM_HOST}:${LLM_PORT}/health"
AUDIO_URL="http://${AUDIO_HOST}:${AUDIO_PORT}/health"

export PYTHONPATH="${REPO_ROOT}:${PYTHONPATH:-}"
export CAMPUS_FRONTEND_URL="${CAMPUS_FRONTEND_URL:-http://127.0.0.1:5177}"
export HF_HOME="${HF_HOME:-$REPO_ROOT/model-zoo/hf_cache}"
export HF_HUB_CACHE="${HF_HUB_CACHE:-$REPO_ROOT/model-zoo/hf_cache/hub}"
export HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-$REPO_ROOT/model-zoo/hf_cache/hub}"
FORCE_RESTART="${AVATAR_LABS_FORCE_RESTART:-0}"
DISABLE_TTS="${AVATAR_LABS_DISABLE_TTS:-0}"

echo "Bootstrapping services..."
echo "LLM health: $LLM_URL"
echo "Audio health: $AUDIO_URL"

started_pids=()

wait_for_health() {
  local url="$1"
  local name="$2"
  local timeout="${3:-120}"
  local elapsed=0
  local tick=0
  while true; do
    local code
    code=$(curl --config /dev/null --connect-timeout 1 --max-time 2 -s -o /dev/null -w "%{http_code}" "$url" || true)
    if [[ "$code" == "200" || "$code" == "503" ]]; then
      echo "${name} healthy: $url"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    tick=$((tick + 2))
    if (( tick >= 10 )); then
      echo "Waiting for ${name} to become healthy... (${elapsed}s)"
      tick=0
    fi
    if (( elapsed >= timeout )); then
      echo "Warning: ${name} did not become healthy within ${timeout}s"
      return 1
    fi
  done
}

start_service() {
  local name="$1"
  local cmd="$2"
  local url="$3"
  local logfile="$4"
  local port="$5"

  local code
  code=$(curl --config /dev/null --connect-timeout 1 --max-time 2 -s -o /dev/null -w "%{http_code}" "$url" || true)
  if [[ "$code" == "200" || "$code" == "503" ]]; then
    echo "${name} already running."
    return 0
  fi

  local listen_pid
  listen_pid=$(find_listening_pid "$port")
  if [[ -n "$listen_pid" ]]; then
    echo "${name} port ${port} is already in use (pid ${listen_pid})."
    echo "Health check failed (code ${code}). Check logs: $LOG_DIR/$logfile"
    if [[ "$FORCE_RESTART" == "1" ]]; then
      echo "Force restart enabled. Stopping pid ${listen_pid}..."
      kill "$listen_pid" 2>/dev/null || true
    else
      return 0
    fi
  fi

  echo "Starting ${name}..."
  echo "Logs: $LOG_DIR/$logfile"
  eval "$cmd" >> "$LOG_DIR/$logfile" 2>&1 &
  started_pids+=("$!")
  wait_for_health "$url" "$name" 180 || true
}

LLM_MODEL_ID="${VITE_MLX_DEFAULT_LLM_MODEL:-}"
LLM_CMD="cd \"$REPO_ROOT/mlx-services/llm\" && env PYTHONPATH=\"$PYTHONPATH\" uv run python -m app.main --host \"$LLM_HOST\" --port \"$LLM_PORT\""
if [[ -n "$LLM_MODEL_ID" ]]; then
  LLM_CMD+=" --model-id \"$LLM_MODEL_ID\""
else
  echo "Warning: VITE_MLX_DEFAULT_LLM_MODEL missing. LLM will not start."
  LLM_CMD=""
fi

AUDIO_ENV="PYTHONPATH=\"$PYTHONPATH\""
if [[ "$DISABLE_TTS" == "1" ]]; then
  AUDIO_ENV="$AUDIO_ENV MLX_AUDIO_DISABLE_TTS=1"
fi
AUDIO_CMD="cd \"$REPO_ROOT/mlx-services/audio\" && env $AUDIO_ENV uv run python -m uvicorn app.main:app --host \"$AUDIO_HOST\" --port \"$AUDIO_PORT\""

if [[ -n "$LLM_CMD" ]]; then
  if [[ -n "$detected_llm_pid" ]]; then
    echo "MLX LLM already running (pid ${detected_llm_pid})."
    code=$(curl --config /dev/null --connect-timeout 1 --max-time 2 -s -o /dev/null -w "%{http_code}" "$LLM_URL" || true)
    if [[ "$code" == "200" || "$code" == "503" ]]; then
      echo "MLX LLM healthy: $LLM_URL"
    else
      echo "MLX LLM health check failed (code ${code}). Check logs: $LOG_DIR/llm.log"
      if [[ "$FORCE_RESTART" == "1" ]]; then
        echo "Force restart enabled. Stopping pid ${detected_llm_pid}..."
        kill "$detected_llm_pid" 2>/dev/null || true
        start_service "MLX LLM" "$LLM_CMD" "$LLM_URL" "llm.log" "$LLM_PORT"
      fi
    fi
  else
    start_service "MLX LLM" "$LLM_CMD" "$LLM_URL" "llm.log" "$LLM_PORT"
  fi
fi

if [[ -n "$detected_audio_pid" ]]; then
  echo "MLX Audio already running (pid ${detected_audio_pid})."
  code=$(curl --config /dev/null --connect-timeout 1 --max-time 2 -s -o /dev/null -w "%{http_code}" "$AUDIO_URL" || true)
  if [[ "$code" == "200" || "$code" == "503" ]]; then
    echo "MLX Audio healthy: $AUDIO_URL"
  else
    echo "MLX Audio health check failed (code ${code}). Check logs: $LOG_DIR/audio.log"
  fi
else
  start_service "MLX Audio" "$AUDIO_CMD" "$AUDIO_URL" "audio.log" "$AUDIO_PORT"
fi

cleanup() {
  if (( ${#started_pids[@]} > 0 )); then
    echo "Stopping services started by dev script..."
    for pid in "${started_pids[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
  fi
}
trap cleanup EXIT

cd "$HOUSE_DIR"
exec npm run dev:ui
