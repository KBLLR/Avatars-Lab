"""ffmpeg/ffprobe helpers. ffmpeg is an external binary, never bundled."""

from __future__ import annotations

import hashlib
import json
import shutil
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np

from .contract import RunError

FPS = 25
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
# swscale's default YUV<->RGB rounding darkens ~1-3/255 per conversion; accurate_rnd makes the
# decode -> encode round trip unbiased. It must be an OUTPUT option (after -i): placed before an
# input it is silently ignored.
SWS_FLAGS = "bicubic+accurate_rnd+full_chroma_int"


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise RunError("probe", f"{tool} not found on PATH")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe(path: Path, stage: str = "probe") -> dict:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,duration:format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True)
    if proc.returncode != 0:
        raise RunError(stage, f"ffprobe failed for {path.name}: {proc.stderr.strip()[:300]}")
    return json.loads(proc.stdout)


def normalize_audio(src: Path, dst: Path) -> float:
    """Convert to 16 kHz mono PCM wav; return duration in seconds."""
    if not src.is_file() or src.stat().st_size == 0:
        raise RunError("audio", f"audio file missing or empty: {src}")
    info = probe(src, stage="audio")
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        raise RunError("audio", f"no audio stream in {src.name}")
    proc = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
                           "-c:a", "pcm_s16le", str(dst)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RunError("audio", f"audio normalization failed: {proc.stderr.strip()[:300]}")
    dur = float(probe(dst, stage="audio")["format"]["duration"])
    if dur <= 0.04:
        raise RunError("audio", f"audio too short ({dur:.3f}s); need at least one 25 fps frame")
    return dur


def _display_size(stream: dict) -> tuple[int, int]:
    """Frame size after ffmpeg's default autorotation."""
    w, h = int(stream["width"]), int(stream["height"])
    rotation = 0
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(float(sd["rotation"]))
    rotation = int(float((stream.get("tags") or {}).get("rotate", rotation)))
    return (h, w) if abs(rotation) % 180 == 90 else (w, h)


def load_frames(src: Path, kind: str, work: Path, max_frames: int, *,
                max_side: int | None = None, max_pixels: int | None = None) -> list[np.ndarray]:
    """Return BGR frames at 25 fps. A still image becomes a single frame.

    Video is decoded straight to bgr24 by ffmpeg with the same `SWS_FLAGS` that `Mp4Writer` encodes with,
    so a decode -> encode round trip adds no colour bias. (OpenCV's decoder converted YUV ~1.8/255 darker,
    and the earlier lossy 25 fps re-encode added a second decode.) `work` is unused for video.
    """
    if not src.is_file() or src.stat().st_size == 0:
        raise RunError("probe", f"face source missing or empty: {src}")
    if kind == "still":
        img = cv2.imread(str(src), cv2.IMREAD_COLOR)
        if img is None:
            raise RunError("probe", f"could not decode still image {src.name}")
        return [img]
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:stream_side_data=rotation:stream_tags=rotate", "-of", "json", str(src)],
        capture_output=True, text=True)
    streams = json.loads(proc.stdout or "{}").get("streams", []) if proc.returncode == 0 else None
    if streams is None:
        raise RunError("probe", f"ffprobe failed for {src.name}: {proc.stderr.strip()[:300]}")
    if not streams:
        raise RunError("probe", f"no video stream in {src.name}")
    width, height = _display_size(streams[0])
    filters = []
    scale = min(1, (max_side or max(width, height)) / max(width, height),
                ((max_pixels or width * height) / (width * height)) ** 0.5)
    if scale < 1:
        width, height = (max(2, int(value * scale) // 2 * 2) for value in (width, height))
        filters = ["-vf", f"scale={width}:{height}"]
    proc = subprocess.run(["ffmpeg", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(src),
                           "-sws_flags", SWS_FLAGS, *filters, "-an", "-r", str(FPS),
                           "-frames:v", str(max_frames), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                          capture_output=True)
    if proc.returncode != 0:
        raise RunError("probe", f"video decode failed: {proc.stderr.decode(errors='replace').strip()[:300]}")
    frame_bytes = width * height * 3
    if not proc.stdout or len(proc.stdout) % frame_bytes:
        raise RunError("probe", f"no decodable frames in {src.name} (got {len(proc.stdout)} bytes, "
                                f"expected a multiple of {frame_bytes})")
    arr = np.frombuffer(proc.stdout, dtype=np.uint8).reshape(-1, height, width, 3)
    return [f.copy() for f in arr]


class Mp4Writer:
    """Streams BGR frames into ffmpeg (H.264 yuv420p) and muxes the wav (AAC)."""

    def __init__(self, out: Path, width: int, height: int, wav: Path | None, *, fragmented: bool = False, pcm_rate: int | None = None):
        self.out = out
        video = ["-preset", "medium"]
        format_flags = ["-movflags", "+faststart"]
        if fragmented:
            video = ["-preset", "ultrafast", "-tune", "zerolatency", "-profile:v", "baseline",
                     "-level:v", "3.1", "-g", "6", "-sc_threshold", "0"]
            format_flags = ["-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                            "-frag_duration", "240000", "-flush_packets", "1"]
        self.audio_input = None
        audio_read = audio_write = None
        if pcm_rate:
            audio_read, audio_write = os.pipe()
            audio = ["-thread_queue_size", "32", "-f", "s16le", "-ar", str(pcm_rate),
                     "-ac", "1", "-probesize", "32", "-analyzeduration", "0", "-i", f"pipe:{audio_read}"]
        else:
            audio = ["-i", str(wav)]
        try:
            self.proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y",
             "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(FPS), "-i", "-",
             *audio,
             "-sws_flags", SWS_FLAGS,
             "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
             "-c:v", "libx264", *video, "-crf", "18", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-shortest", *format_flags, str(out)],
                stdin=subprocess.PIPE, stderr=subprocess.PIPE,
                pass_fds=(audio_read,) if audio_read is not None else ())
        except BaseException:
            if audio_write is not None:
                os.close(audio_write)
            raise
        finally:
            if audio_read is not None:
                os.close(audio_read)
        if audio_write is not None:
            self.audio_input = os.fdopen(audio_write, "wb", buffering=0)

    def write(self, frame_bgr: np.ndarray) -> None:
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.write(np.ascontiguousarray(frame_bgr).tobytes())
        except BrokenPipeError as exc:
            raise RunError("mux", f"ffmpeg closed its input: {self._stderr()}") from exc

    def _stderr(self) -> str:
        return (self.proc.stderr.read().decode(errors="replace") if self.proc.stderr else "")[:300]

    def close(self) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        rc = self.proc.wait()
        if rc != 0:
            raise RunError("mux", f"ffmpeg exited {rc}: {self._stderr()}")

    def abort(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
