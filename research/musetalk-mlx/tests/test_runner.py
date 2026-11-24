"""Weight-free tests: contract validation, geometry, compositing and failure reporting."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

from musetalk_runner import cli, face
from musetalk_runner.contract import CropParams, LipSyncRequest, RunError


def _req(**over):
    base = dict(request_id="r", variant="fp16",
                face_source={"path": "x.png", "kind": "still", "authorized_by": "operator"},
                audio={"path": "a.wav", "origin": "file"})
    base.update(over)
    return LipSyncRequest(**base)


def test_valid_request_passes():
    _req().validate()


@pytest.mark.parametrize("over,stage", [
    ({"variant": "int2"}, "probe"),
    ({"face_source": {"path": "x", "kind": "gif", "authorized_by": "o"}}, "probe"),
    ({"face_source": {"path": "x", "kind": "still"}}, "probe"),
    ({"audio": {"path": "a", "origin": "cloud"}}, "probe"),
    ({"render": {"fps": 30, "batch_size": 8}}, "probe"),
])
def test_invalid_request_reports_stage(over, stage):
    with pytest.raises(RunError) as e:
        _req(**over).validate()
    assert e.value.stage == stage


def test_unknown_stage_rejected():
    with pytest.raises(ValueError):
        RunError("vibes", "x")


def test_ping_pong_cycles_and_handles_single_frame():
    assert [cli._ping_pong(s, 1) for s in range(4)] == [0, 0, 0, 0]
    assert [cli._ping_pong(s, 3) for s in range(6)] == [0, 1, 2, 1, 0, 1]


def _fake_landmarks(cx=200.0, cy=200.0, r=80.0):
    """478 points on a circle; nose at the centre, chin at the bottom."""
    pts = np.zeros((478, 2), dtype=np.float32)
    ang = np.linspace(0, 2 * np.pi, len(face.FACE_OVAL), endpoint=False)
    for k, idx in enumerate(face.FACE_OVAL):
        pts[idx] = [cx + r * np.sin(ang[k]), cy - r * np.cos(ang[k])]
    pts[face.NOSE_BRIDGE_LOW] = [cx, cy]
    pts[face.CHIN] = [cx, cy + r]
    return pts


def test_crop_box_follows_upstream_rule():
    lms = _fake_landmarks()
    b = face.crop_box(lms, (400, 400, 3), bbox_shift=0, extra_margin=10)
    # half_face_dist = chin(280) - nose(200) = 80 -> y1 = 120, y2 = 280 + 10
    assert (b.y1, b.y2) == (120, 290)
    assert b.x1 == pytest.approx(120, abs=1) and b.x2 == pytest.approx(280, abs=1)


def test_crop_box_clips_and_rejects_degenerate():
    lms = _fake_landmarks(cx=10, cy=10, r=5)
    with pytest.raises(RunError) as e:
        face.crop_box(lms, (400, 400, 3), 0, 0)
    assert e.value.stage == "crop"


def test_smooth_boxes_alpha_one_is_identity():
    boxes = [face.Box(0, 0, 10, 10), face.Box(10, 10, 30, 30)]
    assert face.smooth_boxes(boxes, 1.0) == boxes
    assert face.smooth_boxes(boxes, 0.5)[1] == face.Box(5, 5, 20, 20)


def test_mask_and_paste_never_touch_upper_face():
    lms = _fake_landmarks()
    frame = np.full((400, 400, 3), 100, dtype=np.uint8)
    b = face.crop_box(lms, frame.shape, 0, 10)
    alpha = face.lower_face_mask(lms, b, 10)
    assert alpha.shape == (b.h, b.w, 1)
    nose_row = int(lms[face.NOSE_BRIDGE_LOW, 1]) - b.y1
    assert float(alpha[:nose_row].max()) == 0.0
    assert float(alpha.max()) > 0.9
    gen = np.full((256, 256, 3), 250, dtype=np.uint8)
    out = face.paste_back(frame, gen, b, alpha)
    assert np.array_equal(out[: b.y1 + nose_row], frame[: b.y1 + nose_row])  # upper face untouched
    assert out[b.y1:b.y2, b.x1:b.x2].max() > 200  # lower face replaced


def test_empty_audio_fails_at_audio_stage_without_output(tmp_path: Path):
    img = tmp_path / "face.png"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=64x64", "-frames:v", "1",
                    str(img)], check=True)
    wav = tmp_path / "empty.wav"
    wav.write_bytes(b"")
    code = cli.main(["run", "--run-id", "t1", "--face", str(img), "--audio", str(wav),
                     "--weights", str(tmp_path / "noweights"), "--variant", "fp16",
                     "--authorized-by", "test", "--runs-root", str(tmp_path / "runs")])
    assert code == 1
    run = tmp_path / "runs" / "t1"
    res = json.loads((run / "result.json").read_text())
    assert res["status"] == "failed" and res["error"]["stage"] == "audio"
    assert res["timings_s"]["total"] is None  # nothing invented
    assert not (run / "output.mp4").exists() and not (run / "output.partial.mp4").exists()


def test_existing_run_dir_is_never_overwritten(tmp_path: Path):
    (tmp_path / "runs" / "dup").mkdir(parents=True)
    code = cli.main(["run", "--run-id", "dup", "--face", "x.png", "--audio", "a.wav", "--weights", "w",
                     "--variant", "fp16", "--authorized-by", "t", "--runs-root", str(tmp_path / "runs")])
    assert code == 2


def test_video_round_trip_adds_no_colour_bias(tmp_path: Path):
    """load_frames -> Mp4Writer -> load_frames must not shift colour (it used to darken up to 3/255).

    Flat plates (the council background and a skin tone) isolate conversion rounding; saturated
    test patterns would add content-dependent 4:2:0 chroma loss instead.
    """
    from musetalk_runner import media
    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error",
                    "-f", "lavfi", "-i", "color=c=0x101415:s=64x96:r=25:d=1",
                    "-f", "lavfi", "-i", "color=c=0xb07a5c:s=64x96:r=25:d=1",
                    "-filter_complex", "hstack", "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p",
                    str(src)], check=True)
    wav = tmp_path / "a.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1",
                    str(wav)], check=True)
    frames = media.load_frames(src, "video", tmp_path, 750)
    assert len(frames) == 25 and frames[0].shape == (96, 128, 3)
    out = tmp_path / "out.mp4"
    w = media.Mp4Writer(out, 128, 96, wav)
    for f in frames:
        w.write(f)
    w.close()
    back = media.load_frames(out, "video", tmp_path, 750)
    assert len(back) == len(frames)
    bias = (np.stack(back).astype(np.float32) - np.stack(frames).astype(np.float32)).mean(axis=(0, 1, 2))
    assert np.all(np.abs(bias) < 0.25), bias  # was [-2, -1, -3] on the dark plate before the fix


def test_crop_params_defaults_match_upstream():
    c = CropParams()
    assert (c.bbox_shift, c.extra_margin) == (0, 10)
