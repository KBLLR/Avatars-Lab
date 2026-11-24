"""On-disk cache of per-face preprocessing (landmarks + VAE latents).

MuseTalk's own realtime mode prepares an avatar once and reuses it for every utterance. This is the
offline equivalent: the first render of a face source stores its landmarks and UNet input latents;
later renders of the same source with the same crop settings, landmarker and VAE skip detection and
VAE encoding. Frames are prefix-stable (detection is per frame and box smoothing is a causal EMA),
so an entry covering K frames serves any request that needs <= K frames.

The cache lives outside the repo (default `<runs-root>/../cache/face-latents`) and holds derived
data only; deleting it is always safe.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

CACHE_VERSION = 1


def _file_fingerprint(path: Path) -> dict:
    st = path.stat()
    return {"name": path.name, "size": st.st_size, "mtime_ns": st.st_mtime_ns}


def cache_key(*, source_sha256: str, kind: str, crop: dict, landmarker: Path, vae_weights: Path,
              backend: str) -> str:
    """Everything that changes the cached arrays is part of the key."""
    payload = {
        "v": CACHE_VERSION,
        "source_sha256": source_sha256,
        "kind": kind,
        "crop": crop,
        "landmarker": _file_fingerprint(landmarker),
        "vae": _file_fingerprint(vae_weights),
        "backend": backend,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


@dataclass
class Entry:
    landmarks: np.ndarray   # (K, 478, 2) float32, after leading-gap fallback
    fallback: np.ndarray    # (K,) bool, True where the previous frame's landmarks were reused
    latents: np.ndarray     # (K, 8, 32, 32) float32, UNet input (masked ⊕ reference)

    @property
    def frames(self) -> int:
        return int(self.landmarks.shape[0])


def load(cache_dir: Path, key: str, need: int) -> Entry | None:
    """Return the first `need` frames of a cached entry, or None on miss/short/corrupt entry."""
    path = cache_dir / f"{key}.npz"
    if not path.is_file():
        return None
    try:
        with np.load(path, allow_pickle=False) as z:
            if int(z["version"]) != CACHE_VERSION or z["landmarks"].shape[0] < need:
                return None
            return Entry(z["landmarks"][:need].copy(), z["fallback"][:need].copy(), z["latents"][:need].copy())
    except (OSError, KeyError, ValueError):
        return None


def store(cache_dir: Path, key: str, entry: Entry) -> Path:
    """Atomically write an entry (never leaves a partial file under the final name)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    final = cache_dir / f"{key}.npz"
    tmp = cache_dir / f".{key}.{os.getpid()}.tmp.npz"
    try:
        np.savez(tmp, version=np.int64(CACHE_VERSION), landmarks=entry.landmarks.astype(np.float32),
                 fallback=entry.fallback.astype(bool), latents=entry.latents.astype(np.float32))
        os.replace(tmp, final)
    finally:
        tmp.unlink(missing_ok=True)
    return final
