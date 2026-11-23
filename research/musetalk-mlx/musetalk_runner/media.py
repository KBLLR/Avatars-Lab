"""ffmpeg/ffprobe helpers. ffmpeg is an external binary, never bundled."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

from .contract import RunError

FPS = 25
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


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


def load_frames(src: Path, kind: str, work: Path, max_frames: int) -> list[np.ndarray]:
    """Return BGR frames at 25 fps. A still image becomes a single frame."""
    if not src.is_file() or src.stat().st_size == 0:
        raise RunError("probe", f"face source missing or empty: {src}")
    if kind == "still":
        img = cv2.imread(str(src), cv2.IMREAD_COLOR)
        if img is None:
            raise RunError("probe", f"could not decode still image {src.name}")
        return [img]
    info = probe(src)
    if not any(s.get("codec_type") == "video" for s in info.get("streams", [])):
        raise RunError("probe", f"no video stream in {src.name}")
    norm = work / "face_25fps.mp4"
    proc = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-an", "-r", str(FPS),
                           "-frames:v", str(max_frames), "-c:v", "libx264", "-crf", "12", str(norm)],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RunError("probe", f"video normalization failed: {proc.stderr.strip()[:300]}")
    cap = cv2.VideoCapture(str(norm))
    frames: list[np.ndarray] = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    if not frames:
        raise RunError("probe", f"no decodable frames in {src.name}")
    return frames


class Mp4Writer:
    """Streams BGR frames into ffmpeg (H.264 yuv420p) and muxes the wav (AAC)."""

    def __init__(self, out: Path, width: int, height: int, wav: Path):
        self.out = out
        self.proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y",
             "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(FPS), "-i", "-",
             "-i", str(wav),
             "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out)],
            stdin=subprocess.PIPE, stderr=subprocess.PIPE)

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
