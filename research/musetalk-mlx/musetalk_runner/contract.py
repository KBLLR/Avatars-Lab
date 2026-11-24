"""LipSyncRequest / LipSyncResult contract (mirrors AVATAR_LABS_MUSETALK_ARCHITECTURE.md §3).

Every numeric field in a result is measured by the runner. Fields that could not be
measured are None — never estimated.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

REQUEST_SCHEMA = "avatar-labs.lipsync-request.v1"
RESULT_SCHEMA = "avatar-labs.lipsync-result.v1"

ErrorStage = Literal["probe", "detect", "crop", "audio", "model_load", "inference", "paste", "mux"]
ERROR_STAGES: tuple[str, ...] = ("probe", "detect", "crop", "audio", "model_load", "inference", "paste", "mux")
VARIANTS = ("fp16", "q8", "q4")


class RunError(Exception):
    """A failure attributed to one pipeline stage."""

    def __init__(self, stage: str, message: str):
        if stage not in ERROR_STAGES:
            raise ValueError(f"unknown error stage {stage!r}")
        super().__init__(f"[{stage}] {message}")
        self.stage = stage
        self.message = message


@dataclass
class CropParams:
    bbox_shift: int = 0
    extra_margin: int = 10
    ema_alpha: float = 0.5


@dataclass
class LipSyncRequest:
    request_id: str
    variant: str
    face_source: dict[str, Any]  # {path, kind: video|still, sha256, authorized_by}
    audio: dict[str, Any]  # {path, sha256, origin: gateway-tts|file, voice_id?, text?}
    identity: dict[str, Any] = field(default_factory=dict)
    crop: CropParams = field(default_factory=CropParams)
    render: dict[str, Any] = field(default_factory=lambda: {"fps": 25, "batch_size": 8})
    provider: str = "musetalk-mlx"
    schema: str = REQUEST_SCHEMA

    def validate(self) -> None:
        if self.variant not in VARIANTS:
            raise RunError("probe", f"variant must be one of {VARIANTS}, got {self.variant!r}")
        if self.face_source.get("kind") not in ("video", "still"):
            raise RunError("probe", "face_source.kind must be 'video' or 'still'")
        if not self.face_source.get("authorized_by"):
            raise RunError("probe", "face_source.authorized_by is required")
        if self.audio.get("origin") not in ("gateway-tts", "file"):
            raise RunError("probe", "audio.origin must be 'gateway-tts' or 'file'")
        if int(self.render.get("fps", 25)) != 25:
            raise RunError("probe", "MuseTalk 1.5 is trained at 25 fps; render.fps must be 25")
        if int(self.render.get("batch_size", 8)) < 1:
            raise RunError("probe", "render.batch_size must be >= 1")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def empty_result(request_id: str, run_id: str) -> dict[str, Any]:
    """Result skeleton with every measurable field set to None."""
    return {
        "schema": RESULT_SCHEMA,
        "request_id": request_id,
        "run_id": run_id,
        "status": "failed",
        "error": None,
        "output": None,
        "timings_s": {"model_init": None, "preprocess": None, "first_frame": None,
                      "neural_total": None, "total": None},
        "throughput": {"neural_faces_per_s": None, "end_to_end_fps": None},
        "memory": {"peak_rss_mb": None, "mlx_peak_mb": None, "mlx_active_after_release_mb": None},
        "sync": {"video_duration_s": None, "audio_duration_s": None, "delta_ms": None},
        "detection": {"frames": None, "faces_detected": None, "fallback_frames": None},
        "environment": {},
        "review": {"status": "draft"},
    }
