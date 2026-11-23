"""Face detection, MuseTalk crop box and lower-face compositing.

Detection uses MediaPipe FaceLandmarker (478 landmarks, torch-free) with the model file
Avatar Labs already hydrates for Face Mirror. The crop box follows the upstream MuseTalk 1.5
rule (TMElyralab/MuseTalk, MIT, `get_landmark_and_bbox` + inference `extra_margin`):

    half_face_y = nose_landmark_y + bbox_shift
    half_face_dist = chin_y - half_face_y
    box = (min_x, half_face_y - half_face_dist, max_x, chin_y + extra_margin)

The DWPose 68-point nose index 29 is approximated by MediaPipe index 5 (lower nose bridge).
Compositing replaces only the lower face through a feathered convex-hull mask built from
landmarks below the nose; the upper face is never modified.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .contract import RunError

FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400,
             377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
NOSE_BRIDGE_LOW = 5
CHIN = 152
CROP_SIZE = 256


@dataclass(frozen=True)
class Box:
    x1: int
    y1: int
    x2: int
    y2: int

    @property
    def w(self) -> int:
        return self.x2 - self.x1

    @property
    def h(self) -> int:
        return self.y2 - self.y1

    def as_list(self) -> list[int]:
        return [self.x1, self.y1, self.x2, self.y2]


class Landmarker:
    """Thin wrapper over MediaPipe FaceLandmarker in IMAGE mode (one face)."""

    def __init__(self, model_path: str | Path):
        model_path = Path(model_path)
        if not model_path.is_file():
            raise RunError("detect", f"FaceLandmarker model not found: {model_path}")
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        self._mp = mp
        opts = vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
        )
        self._lm = vision.FaceLandmarker.create_from_options(opts)

    def detect(self, frame_bgr: np.ndarray) -> np.ndarray | None:
        """Return (478, 2) pixel-space landmarks, or None if no face."""
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        res = self._lm.detect(image)
        if not res.face_landmarks:
            return None
        h, w = frame_bgr.shape[:2]
        pts = np.array([[p.x * w, p.y * h] for p in res.face_landmarks[0]], dtype=np.float32)
        return pts

    def close(self) -> None:
        self._lm.close()


def crop_box(lms: np.ndarray, frame_shape: tuple[int, ...], bbox_shift: int, extra_margin: int) -> Box:
    h, w = frame_shape[:2]
    oval = lms[FACE_OVAL]
    half_face_y = float(lms[NOSE_BRIDGE_LOW, 1]) + bbox_shift
    chin_y = float(max(oval[:, 1].max(), lms[CHIN, 1]))
    half_face_dist = chin_y - half_face_y
    if half_face_dist <= 1:
        raise RunError("crop", f"degenerate lower face (nose_y={half_face_y:.1f}, chin_y={chin_y:.1f})")
    x1 = max(0, int(round(oval[:, 0].min())))
    x2 = min(w, int(round(oval[:, 0].max())))
    y1 = max(0, int(round(half_face_y - half_face_dist)))
    y2 = min(h, int(round(chin_y + extra_margin)))
    if x2 - x1 < 16 or y2 - y1 < 16:
        raise RunError("crop", f"face box too small: {[x1, y1, x2, y2]}")
    return Box(x1, y1, x2, y2)


def smooth_boxes(boxes: list[Box], alpha: float) -> list[Box]:
    """Exponential moving average over box corners in frame order (alpha=1 disables)."""
    if not boxes:
        return []
    out: list[Box] = []
    acc = np.array(boxes[0].as_list(), dtype=np.float32)
    for b in boxes:
        acc = alpha * np.array(b.as_list(), dtype=np.float32) + (1 - alpha) * acc
        r = acc.round().astype(int)
        out.append(Box(int(r[0]), int(r[1]), int(r[2]), int(r[3])))
    return out


def crop_face(frame_bgr: np.ndarray, box: Box) -> np.ndarray:
    crop = frame_bgr[box.y1:box.y2, box.x1:box.x2]
    return cv2.resize(crop, (CROP_SIZE, CROP_SIZE), interpolation=cv2.INTER_LANCZOS4)


def lower_face_mask(lms: np.ndarray, box: Box, extra_margin: int) -> np.ndarray:
    """Feathered float32 alpha in box space: 1 over the lower face, 0 above the nose."""
    nose_y = lms[NOSE_BRIDGE_LOW, 1]
    oval = lms[FACE_OVAL]
    lower = oval[oval[:, 1] >= nose_y]
    # Let the jaw open below the resting chin line: extend the lowest points by extra_margin.
    extended = lower.copy()
    extended[:, 1] += np.where(lower[:, 1] > nose_y + 0.5 * (lower[:, 1].max() - nose_y), extra_margin, 0)
    pts = np.vstack([lower, extended, lms[[NOSE_BRIDGE_LOW]]]) - np.array([box.x1, box.y1], dtype=np.float32)
    hull = cv2.convexHull(pts.astype(np.int32))
    mask = np.zeros((box.h, box.w), dtype=np.uint8)
    cv2.fillConvexPoly(mask, hull, 255)
    k = max(3, int(round(0.04 * box.w)) | 1)
    mask = cv2.dilate(mask, np.ones((k, k), np.uint8))
    blur = max(3, int(round(0.10 * box.w)) | 1)
    mask = cv2.GaussianBlur(mask, (blur, blur), 0)
    # Never touch rows above the nose line, whatever the blur did.
    top = int(max(0, nose_y - box.y1))
    mask[:top] = 0
    return (mask.astype(np.float32) / 255.0)[..., None]


def paste_back(frame_bgr: np.ndarray, face_256_bgr: np.ndarray, box: Box, alpha: np.ndarray) -> np.ndarray:
    out = frame_bgr.copy()
    face = cv2.resize(face_256_bgr, (box.w, box.h), interpolation=cv2.INTER_LANCZOS4)
    region = out[box.y1:box.y2, box.x1:box.x2].astype(np.float32)
    blended = alpha * face.astype(np.float32) + (1.0 - alpha) * region
    out[box.y1:box.y2, box.x1:box.x2] = np.clip(blended, 0, 255).astype(np.uint8)
    return out
