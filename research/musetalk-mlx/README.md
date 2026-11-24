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

### Face preprocessing cache

The first render of a face source stores its landmarks and VAE latents in
`<runs-root>/../cache/face-latents/<key>.npz`. Later renders of the same file with the same crop settings,
landmarker and VAE skip detection and VAE encoding, which is the slowest part of preprocessing. This is the
offline equivalent of MuseTalk's one-time avatar preparation. On M3 Max a 10 s, 704×1216 clip goes from
~48 s to ~22 s warm. Cached and uncached renders are byte-identical.

The key covers the source SHA-256, face kind, crop settings, landmarker file, VAE weights file and backend,
so a changed input is a miss, never a stale hit. Use `--cache-dir DIR` to move the cache and `--no-cache`
to bypass it. Deleting the cache is always safe. `result.json` reports `preprocess_cache.status`
(`hit`, `miss` or `disabled`).

Only source frames the audio can reach are detected and encoded: the ping-pong cycle visits
`min(source_frames, output_frames)` frames.

`result.json` follows `avatar-labs.lipsync-result.v1`. Every number is measured; unmeasured fields are
`null`. Failures set `status: "failed"`, `error.stage` (`probe|detect|crop|audio|model_load|inference|paste|mux`)
and leave no `output.mp4`. Existing run directories are never overwritten.

## Tests

```bash
uv run --group dev pytest -q        # weight-free: contract, geometry, compositing, failure paths
```

## Rollback

Delete `research/musetalk-mlx/` from this house and `/Volumes/CoreX-Models/research/musetalk-mlx/`
(weights, venv, caches including `cache/face-latents`, runs). Nothing else references either.
