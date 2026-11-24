"""musetalk-runner CLI.

  musetalk-runner tts  --text "..." --voice kbllr --out speech.wav [--gateway http://127.0.0.1:8090]
  musetalk-runner run  --run-id ID --face PATH --audio PATH --weights DIR --variant fp16 \
                       --authorized-by OPERATOR [--face-kind auto|video|still] [--runs-root DIR]

`run` is a one-shot process: it loads the model, renders one clip, writes
<runs-root>/<run-id>/{request.json,result.json,output.mp4}, releases MLX memory and exits.
On failure it writes result.json with status "failed" and the failing stage, and no output.mp4.
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import platform
import resource
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from .contract import CropParams, LipSyncRequest, RunError, empty_result
from . import media

DEFAULT_RUNS_ROOT = os.environ.get("MUSETALK_RUNS_ROOT", "/Volumes/CoreX-Models/research/musetalk-mlx/runs")
# Same model file Avatar Labs serves at /facial-assets/mediapipe (vite.config.mjs MEDIAPIPE_MODEL_ROOT).
# parents[5] = workspace root when running from <root>/houses/avatar-labs-v0.2.0/research/musetalk-mlx.
_MEDIAPIPE_ROOT = os.environ.get(
    "AVATAR_LABS_MEDIAPIPE_MODEL_ROOT",
    str(Path(__file__).resolve().parents[5] / "warehouse/var/cache/objects/avatar-labs/intake-2026-05-05/public/mediapipe"),
)
DEFAULT_LANDMARKER = os.environ.get("MUSETALK_LANDMARKER", str(Path(_MEDIAPIPE_ROOT) / "face_landmarker.task"))
MAX_FRAMES = 750  # 30 s at 25 fps; bounds RAM for cached frames


def _ping_pong(step: int, n: int) -> int:
    if n <= 1:
        return 0
    period = 2 * n - 2
    pos = step % period
    return pos if pos < n else period - pos


def _musetalk_mlx_commit() -> str | None:
    try:
        from importlib.metadata import distribution

        raw = distribution("musetalk-mlx").read_text("direct_url.json")
        return json.loads(raw).get("vcs_info", {}).get("commit_id") if raw else None
    except Exception:
        return None


def _environment(weights: Path) -> dict:
    import mlx.core as mx

    chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
    return {
        "chip": chip,
        "macos": platform.mac_ver()[0],
        "python": platform.python_version(),
        "mlx": mx.__version__,
        "musetalk_mlx_commit": _musetalk_mlx_commit(),
        "weights_dir": str(weights),
        "weights_sha256": {p.name: media.sha256(p) for p in sorted(weights.glob("*.safetensors"))},
    }


def cmd_tts(a: argparse.Namespace) -> int:
    body = json.dumps({"input": a.text, "voice": a.voice, "model": a.model}).encode()
    req = urllib.request.Request(f"{a.gateway.rstrip('/')}/v1/audio/speech", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = resp.read()
    except urllib.error.URLError as exc:
        print(f"TTS request failed: {exc}", file=sys.stderr)
        return 1
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    meta = {"gateway": a.gateway, "voice": a.voice, "model": a.model, "text": a.text,
            "wall_clock_s": round(time.perf_counter() - t0, 3), "bytes": len(data),
            "sha256": media.sha256(out), "probe": media.probe(out, stage="audio")}
    out.with_suffix(".tts.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))
    return 0


def _render(req: LipSyncRequest, a: argparse.Namespace, run_dir: Path, result: dict) -> None:
    t_start = time.perf_counter()
    weights = Path(a.weights)
    work = run_dir / "work"
    work.mkdir()
    media.require_ffmpeg()

    # --- inputs ---------------------------------------------------------------
    wav = work / "audio_16k.wav"
    audio_dur = media.normalize_audio(Path(req.audio["path"]), wav)
    t_pre = time.perf_counter()
    frames = media.load_frames(Path(req.face_source["path"]), req.face_source["kind"], work, MAX_FRAMES)

    from . import face

    lmk = face.Landmarker(a.landmarker)
    try:
        lms, raw_boxes, fallback = [], [], 0
        last = None
        for fr in frames:
            pts = lmk.detect(fr)
            if pts is None:
                if last is None:
                    continue
                pts, fallback = last, fallback + 1
            last = pts
            lms.append(pts)
            raw_boxes.append(face.crop_box(pts, fr.shape, req.crop.bbox_shift, req.crop.extra_margin))
    finally:
        lmk.close()
    detected = len(lms) - fallback
    result["detection"] = {"frames": len(frames), "faces_detected": detected, "fallback_frames": fallback}
    if len(lms) != len(frames):
        raise RunError("detect", f"no face in {len(frames) - len(lms)} leading frame(s) of {len(frames)}")
    boxes = face.smooth_boxes(raw_boxes, req.crop.ema_alpha)
    masks = [face.lower_face_mask(l, b, req.crop.extra_margin) for l, b in zip(lms, boxes)]
    crops = [face.crop_face(fr, b) for fr, b in zip(frames, boxes)]
    result["crop_boxes_sample"] = [b.as_list() for b in boxes[:3]]

    # --- model ----------------------------------------------------------------
    import mlx.core as mx
    from musetalk_mlx.pipeline_mlx import MuseTalkPipeline

    t0 = time.perf_counter()
    try:
        pipe = MuseTalkPipeline.from_pretrained_mlx(weights)
        mx.eval(pipe.unet.parameters(), pipe.vae.parameters(), pipe.whisper_encoder.parameters())
    except Exception as exc:  # noqa: BLE001 - attribute any load failure to model_load
        raise RunError("model_load", f"{type(exc).__name__}: {exc}") from exc
    result["timings_s"]["model_init"] = round(time.perf_counter() - t0, 3)

    try:
        chunks = pipe.encode_audio_from_wav(str(wav), fps=media.FPS)
        mx.eval(chunks)
    except Exception as exc:  # noqa: BLE001
        raise RunError("audio", f"feature extraction failed: {type(exc).__name__}: {exc}") from exc
    n_out = int(chunks.shape[0])
    if n_out == 0:
        raise RunError("audio", "audio produced zero frames")
    latents = mx.concatenate([pipe.get_latents_for_unet(c) for c in crops], axis=0)
    mx.eval(latents)
    result["timings_s"]["preprocess"] = round(time.perf_counter() - t_pre - result["timings_s"]["model_init"], 3)

    # --- generate + composite + mux -------------------------------------------
    h, w = frames[0].shape[:2]
    partial = run_dir / "output.partial.mp4"
    writer = media.Mp4Writer(partial, w, h, wav)
    batch = int(req.render["batch_size"])
    neural_t, first = 0.0, None
    order = [_ping_pong(s, len(frames)) for s in range(n_out)]
    try:
        for i in range(0, n_out, batch):
            idx = order[i:i + batch]
            s = time.perf_counter()
            try:
                faces = pipe.run_batched(latents[mx.array(idx)], chunks[i:i + batch], batch_size=batch)
            except Exception as exc:  # noqa: BLE001
                raise RunError("inference", f"{type(exc).__name__}: {exc}") from exc
            neural_t += time.perf_counter() - s
            for j, f_bgr in zip(idx, faces):
                try:
                    out = face.paste_back(frames[j], f_bgr, boxes[j], masks[j])
                except Exception as exc:  # noqa: BLE001
                    raise RunError("paste", f"{type(exc).__name__}: {exc}") from exc
                writer.write(out)
                if first is None:
                    first = time.perf_counter() - t_start
        writer.close()
    except BaseException:
        writer.abort()
        partial.unlink(missing_ok=True)
        raise
    final = run_dir / "output.mp4"
    partial.rename(final)
    total = time.perf_counter() - t_start

    result["timings_s"].update({"first_frame": round(first, 3), "neural_total": round(neural_t, 3),
                                "total": round(total, 3)})
    result["throughput"] = {"neural_faces_per_s": round(n_out / neural_t, 2),
                            "end_to_end_fps": round(n_out / total, 2)}
    result["memory"]["mlx_peak_mb"] = round(mx.get_peak_memory() / 2**20, 1)

    info = media.probe(final, stage="mux")
    streams = {s["codec_type"]: s for s in info["streams"]}
    vdur, adur = float(streams["video"]["duration"]), float(streams["audio"]["duration"])
    result["sync"] = {"video_duration_s": vdur, "audio_duration_s": adur, "delta_ms": round((vdur - adur) * 1000, 1),
                      "input_audio_duration_s": round(audio_dur, 3)}
    result["output"] = {"video_path": str(final), "duration_s": float(info["format"]["duration"]),
                        "frames": n_out, "width": int(streams["video"]["width"]),
                        "height": int(streams["video"]["height"]), "sha256": media.sha256(final)}
    result["status"] = "succeeded"

    # --- release ------------------------------------------------------------
    del pipe, latents, chunks, faces
    gc.collect()
    mx.clear_cache()
    result["memory"]["mlx_active_after_release_mb"] = round(mx.get_active_memory() / 2**20, 1)


def cmd_run(a: argparse.Namespace) -> int:
    runs_root = Path(a.runs_root)
    run_dir = runs_root / a.run_id
    if run_dir.exists():
        print(f"run directory already exists: {run_dir}", file=sys.stderr)
        return 2
    run_dir.mkdir(parents=True)
    face_path, audio_path = Path(a.face).resolve(), Path(a.audio).resolve()
    kind = a.face_kind
    if kind == "auto":
        kind = "still" if face_path.suffix.lower() in media.IMAGE_EXTS else "video"
    req = LipSyncRequest(
        request_id=a.request_id or a.run_id,
        variant=a.variant,
        face_source={"path": str(face_path), "kind": kind, "authorized_by": a.authorized_by,
                     "sha256": media.sha256(face_path) if face_path.is_file() else None},
        audio={"path": str(audio_path), "origin": a.audio_origin, "voice_id": a.voice_id, "text": a.text,
               "sha256": media.sha256(audio_path) if audio_path.is_file() else None},
        identity={k: v for k, v in {"orchestrator_id": a.orchestrator_id, "head_id": a.head_id}.items() if v},
        crop=CropParams(a.bbox_shift, a.extra_margin, a.ema_alpha),
        render={"fps": 25, "batch_size": a.batch},
    )
    (run_dir / "request.json").write_text(json.dumps(req.to_dict(), indent=2))
    result = empty_result(req.request_id, a.run_id)
    code = 0
    try:
        req.validate()
        _render(req, a, run_dir, result)
    except RunError as exc:
        result["status"] = "failed"
        result["error"] = {"stage": exc.stage, "message": exc.message}
        code = 1
    finally:
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        result["memory"]["peak_rss_mb"] = round(rss / 2**20, 1)  # macOS reports bytes
        try:
            result["environment"] = _environment(Path(a.weights))
        except Exception as exc:  # noqa: BLE001 - environment capture must not mask the run outcome
            result["environment"] = {"error": f"{type(exc).__name__}: {exc}"}
        (run_dir / "output.partial.mp4").unlink(missing_ok=True)
        if not a.keep_work:
            shutil.rmtree(run_dir / "work", ignore_errors=True)
        (run_dir / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return code


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="musetalk-runner", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("tts", help="synthesize speech through the Core-X Gateway (local MLX Audio)")
    t.add_argument("--text", required=True)
    t.add_argument("--voice", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--model", default="qwen")
    t.add_argument("--gateway", default=os.environ.get("COREX_GATEWAY_URL", "http://127.0.0.1:8090"))
    t.set_defaults(func=cmd_tts)

    r = sub.add_parser("run", help="render one lip-synced clip")
    r.add_argument("--run-id", required=True)
    r.add_argument("--request-id")
    r.add_argument("--face", required=True)
    r.add_argument("--face-kind", choices=["auto", "video", "still"], default="auto")
    r.add_argument("--audio", required=True)
    r.add_argument("--audio-origin", choices=["gateway-tts", "file"], default="file")
    r.add_argument("--voice-id")
    r.add_argument("--text")
    r.add_argument("--weights", required=True)
    r.add_argument("--variant", choices=["fp16", "q8", "q4"], required=True)
    r.add_argument("--authorized-by", required=True)
    r.add_argument("--orchestrator-id")
    r.add_argument("--head-id")
    r.add_argument("--bbox-shift", type=int, default=0)
    r.add_argument("--extra-margin", type=int, default=10)
    r.add_argument("--ema-alpha", type=float, default=0.5)
    r.add_argument("--batch", type=int, default=8)
    r.add_argument("--landmarker", default=DEFAULT_LANDMARKER)
    r.add_argument("--runs-root", default=DEFAULT_RUNS_ROOT)
    r.add_argument("--keep-work", action="store_true")
    r.set_defaults(func=cmd_run)
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
