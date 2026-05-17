"""Generate equirectangular technical-grid backgrounds (PNG) in 5 colors.

Used as scene env-maps when the user wants a flat technical look. Output:
    core-x/ui/public/hdri/grid_<color>.png

Each PNG is 2048×1024 (2:1 equirectangular ratio), filled with a desaturated
base color and a 1-pixel grid overlay. Loaded by voice-scene.ts via
THREE.TextureLoader and treated as an EquirectangularReflectionMapping.

Why pure stdlib (zlib + struct)? Avoids a Pillow dependency on the bake
host and keeps the bakery self-contained.

2026-05-12 round-9 tweak (user feedback): thinner lines, desaturated palette,
denser cells. Reads as a scientific calibration grid rather than a kid's
graph paper.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

DST = Path(__file__).resolve().parents[4] / "core-x" / "ui" / "public" / "hdri"
W, H = 2048, 1024

# Round 9 calibration grid: small dense cells with 1-px minor lines and 1-px
# major lines every 8 cells. Center crosshair for that "instrument bezel"
# feel. Palette desaturated so the grid lines + the avatar's skin both read.
CELL = 32           # minor cell size in px (W/H gives a 64×32 grid)
MAJOR_EVERY = 8     # every 8 cells = a slightly darker line at 256 px spacing
CENTER_MARK_HALF = 32  # half-width of the centred crosshair in px


COLORS: dict[str, tuple[int, int, int]] = {
    # Desaturated, "technical" — closer to instrument-panel reads than Crayola.
    "red":    (172,  64,  68),
    "blue":   ( 64, 110, 172),
    "orange": (196, 122,  58),
    "yellow": (188, 168,  72),
    "green":  ( 72, 148,  92),
}


def _line_rgb(base: tuple[int, int, int], delta: int) -> tuple[int, int, int]:
    """Darken `base` by `delta` per channel, clamped at 0."""
    return (max(base[0] - delta, 0), max(base[1] - delta, 0), max(base[2] - delta, 0))


def _build_pixels(base: tuple[int, int, int]) -> bytes:
    """Return raw RGB pixel buffer (W * H * 3 bytes)."""
    minor = _line_rgb(base, 32)   # very subtle 1-px lines
    major = _line_rgb(base, 72)   # noticeable but not loud
    crosshair = _line_rgb(base, 110)  # center mark, slightly bolder

    # Pre-compute which columns + rows are grid lines.
    minor_cols: set[int] = set()
    major_cols: set[int] = set()
    for c in range(0, W // CELL + 1):
        x = c * CELL
        if 0 <= x < W:
            (major_cols if (c % MAJOR_EVERY == 0) else minor_cols).add(x)

    minor_rows: set[int] = set()
    major_rows: set[int] = set()
    for r in range(0, H // CELL + 1):
        y = r * CELL
        if 0 <= y < H:
            (major_rows if (r % MAJOR_EVERY == 0) else minor_rows).add(y)

    # Center cross marker: horizontal segment at H/2, vertical at W/2.
    cx, cy = W // 2, H // 2
    cross_cols = {cx}
    cross_rows = {cy}

    # Build the canvas one row at a time (memory-friendly for 2048×1024).
    base_row_bytes = bytes(base) * W
    minor_row_bytes = bytes(minor) * W
    major_row_bytes = bytes(major) * W

    pixel_data = bytearray()
    for y in range(H):
        if y in major_rows:
            row = bytearray(major_row_bytes)
        elif y in minor_rows:
            row = bytearray(minor_row_bytes)
        else:
            row = bytearray(base_row_bytes)
            # Punch vertical lines into this base row.
            for x in minor_cols:
                row[x * 3 : x * 3 + 3] = bytes(minor)
            for x in major_cols:
                row[x * 3 : x * 3 + 3] = bytes(major)

        # Center crosshair overlay.
        if y == cy:
            # horizontal arm of crosshair
            for x in range(max(0, cx - CENTER_MARK_HALF), min(W, cx + CENTER_MARK_HALF + 1)):
                row[x * 3 : x * 3 + 3] = bytes(crosshair)
        elif abs(y - cy) <= CENTER_MARK_HALF:
            # vertical arm
            row[cx * 3 : cx * 3 + 3] = bytes(crosshair)

        pixel_data.extend(bytes(row))

    return bytes(pixel_data)


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_png(path: Path, pixels: bytes, w: int, h: int) -> None:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit, RGB
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)
    iend = b""
    path.write_bytes(
        sig + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", iend)
    )


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for name, rgb in COLORS.items():
        out = DST / f"grid_{name}.png"
        pixels = _build_pixels(rgb)
        write_png(out, pixels, W, H)
        print(f"  ✓ {out.name}  {out.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
