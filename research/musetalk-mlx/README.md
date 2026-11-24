# MuseTalk MLX offline runner (research case `musetalk-mlx-offline-lipsync`)

Status: **experimental research tool**. Not a service, no port, not registered in topology,
not wired into any Avatar Labs page. Outputs are review drafts and are never published to Warehouse.

One process renders one clip and exits:

```
face (video or still) + speech audio
  -> MediaPipe FaceLandmarker (Avatar Labs' local face_landmarker.task)
  -> upstream MuseTalk 1.5 crop box (nose/chin rule, bbox_shift, extra_margin) + EMA smoothing
  -> MuseTalk 1.5 MLX (xocialize/musetalk-mlx @ c6eb30e): Whisper-tiny -> UNet t=0 -> VAE decode
  -> feathered lower-face paste-back (upper face never modified)
  -> ffmpeg H.264/AAC mux
  -> <runs-root>/<run-id>/{request.json, result.json, output.mp4}
```

## Setup (Apple Silicon, Python 3.12, uv)

Everything heavy stays on the research volume; nothing is installed into shared Core-X environments.

```bash
export R=/Volumes/CoreX-Models/research/musetalk-mlx
export UV_CACHE_DIR=$R/cache/uv UV_PROJECT_ENVIRONMENT=$R/venvs/runner UV_PYTHON=3.12
uv sync --frozen
# weights (≈1.9 GB, MIT; trained on HDTF + private data — see RISKS doc before any commercial use)
HF_HOME=$R/cache/hf hf download mlx-community/MuseTalk-1.5-fp16 --local-dir $R/weights/MuseTalk-1.5-fp16
```

Requires `ffmpeg`/`ffprobe` on PATH. The FaceLandmarker model is read from Avatar Labs'
`AVATAR_LABS_MEDIAPIPE_MODEL_ROOT` (same default as `vite.config.mjs`) or `MUSETALK_LANDMARKER`.

## Use

```bash
# optional: local speech through the Core-X Gateway (MLX Audio, Qwen TTS)
uv run musetalk-runner tts --voice kbllr --text "Hello from Core-X." --out $R/inputs/kbllr/hello.wav

uv run musetalk-runner run --run-id B1-kbllr-fp16 \
  --face ../../../../core-x/ui/public/avatars/heads/kbllr/council-portrait.webp \
  --audio $R/inputs/kbllr/hello.wav --audio-origin gateway-tts --voice-id kbllr \
  --weights $R/weights/MuseTalk-1.5-fp16 --variant fp16 \
  --head-id kbllr --authorized-by operator
```

A still image is rendered as a single frame: only the mouth region moves; the head stays frozen.
For head motion, pass a short driving video of the same identity (mouth closed).

`result.json` follows `avatar-labs.lipsync-result.v1`. Every number is measured; unmeasured fields are
`null`. Failures set `status: "failed"`, `error.stage` (`probe|detect|crop|audio|model_load|inference|paste|mux`)
and leave no `output.mp4`. Existing run directories are never overwritten.

## Tests

```bash
uv run --group dev pytest -q        # weight-free: contract, geometry, compositing, failure paths
```

## Rollback

Delete `research/musetalk-mlx/` from this house and `/Volumes/CoreX-Models/research/musetalk-mlx/`
(weights, venv, caches, runs). Nothing else references either.
