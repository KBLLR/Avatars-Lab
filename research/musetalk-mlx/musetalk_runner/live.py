"""Private stdin worker for the Avatar Labs progressive chat harness."""
import argparse
import gc
import json
import math
import sys
import threading
import time
from tempfile import TemporaryDirectory
import urllib.request
from pathlib import Path

import cv2
import mlx.core as mx
import numpy as np
from scipy.signal import resample_poly
from musetalk_mlx.pipeline_mlx import MuseTalkPipeline, UNET_TIMESTEP, apply_pe, preprocess_img
from musetalk_mlx.whisper.log_mel import log_mel_spectrogram

from . import cache, face, media
from .cli import _detect, _encode_latents, _musetalk_mlx_commit, _ping_pong

BATCH = 8
LEFT_CONTEXT = 8
LOOKAHEAD = 4
MAX_AUDIO_SECONDS = 30


def clock():
    return time.perf_counter()


class StreamAudio:
    """Fetch mono Gateway PCM on a CPU thread. Readers wait for sample counts."""

    def __init__(self, gateway, text, voice, started):
        self.condition = threading.Condition()
        self.data = bytearray()
        self.rate = 0
        self.ended = False
        self.error = None
        self.first_s = None
        self.end_s = None
        self.started = started
        self.thread = threading.Thread(target=self._read, args=(gateway, text, voice), daemon=True)

    def _read(self, gateway, text, voice):
        payload = json.dumps({"input": text, "model": "qwen", "voice": voice,
                              "streaming_interval": 0.32}).encode()
        request = urllib.request.Request(
            f"{gateway.rstrip('/')}/v1/audio/speech/stream",
            data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=45) as reply:
                rate = int(reply.headers["X-Sample-Rate"])
                if rate <= 0 or rate % media.FPS:
                    raise ValueError("PCM rate must be divisible by the video clock")
                with self.condition:
                    self.rate = rate
                    self.condition.notify_all()
                while packet := reply.read1(8192):
                    with self.condition:
                        if len(self.data) + len(packet) > rate * MAX_AUDIO_SECONDS * 2:
                            raise ValueError("Speech exceeded the harness duration limit")
                        if self.first_s is None:
                            self.first_s = clock() - self.started
                        self.data.extend(packet)
                        self.condition.notify_all()
        except Exception as error:
            self.error = error
        finally:
            with self.condition:
                self.ended = True
                self.end_s = clock() - self.started
                self.condition.notify_all()

    def wait_rate(self):
        with self.condition:
            self.condition.wait_for(lambda: self.rate or self.ended)
            if self.error:
                raise self.error
            return self.rate

    def window(self, first, last):
        with self.condition:
            self.condition.wait_for(lambda: len(self.data) >= last * 2 or self.ended)
            if self.error:
                raise self.error
            samples = len(self.data) // 2
            return bytes(self.data[first * 2:min(last, samples) * 2]), samples, self.ended

    def mux_audio(self, pipe):
        """Feed ffmpeg only complete samples while inference drives its video pipe."""
        try:
            offset = 0
            while True:
                with self.condition:
                    self.condition.wait_for(lambda: len(self.data) >= offset + 2 or self.ended)
                    end = len(self.data) // 2 * 2
                    packet = bytes(self.data[offset:end])
                    ended = self.ended
                if packet:
                    # Raw FileIO can short-write to a pipe.
                    view = memoryview(packet)
                    while view:
                        view = view[pipe.write(view):]
                    offset = end
                if ended:
                    break
        except (BrokenPipeError, OSError):
            pass
        finally:
            pipe.close()


class ResidentRenderer:
    def __init__(self, args):
        started = clock()
        self.args = args
        self.turn = 0
        media.require_ffmpeg()
        self.pipe = MuseTalkPipeline.from_pretrained_mlx(args.weights)
        mx.eval(self.pipe.unet.parameters(), self.pipe.vae.parameters(), self.pipe.whisper_encoder.parameters())
        self.model_load_s = clock() - started
        self.timestep = mx.array([UNET_TIMESTEP])
        self.decode_pixels = mx.compile(self._decode_pixels)
        self.driver = None

    def prepare_driver(self, driver):
        if self.driver == driver:
            return 0.0
        started = clock()
        self.driver = None
        self.frames, self.boxes, self.masks, self.latents = [], [], [], None
        args = self.args
        with TemporaryDirectory() as temp:
            frames = media.load_frames(driver, "video", Path(temp), 250, max_side=1280, max_pixels=921600)
        key = cache.cache_key(
            source_sha256=media.sha256(driver), kind="video",
            crop={"bbox_shift": 0, "extra_margin": 10}, landmarker=args.landmarker,
            vae_weights=args.weights / "vae.safetensors",
            backend=f"musetalk-mlx@{_musetalk_mlx_commit()}:fp16:compiled-posterior-mean:live-{frames[0].shape[1]}x{frames[0].shape[0]}")
        entry = cache.load(args.cache_dir, key, len(frames))
        if entry is None:
            lms, flags = _detect(frames, str(args.landmarker))
        else:
            lms, flags = entry.landmarks, entry.fallback
        raw_boxes = [face.crop_box(lm, frame.shape, 0, 10) for lm, frame in zip(lms, frames)]
        boxes = face.smooth_boxes(raw_boxes, 0.5)
        masks = [face.lower_face_mask(lm, box, 10) for lm, box in zip(lms, boxes)]
        if entry is None:
            crops = [face.crop_face(frame, box) for frame, box in zip(frames, boxes)]
            encoded = _encode_latents(self.pipe, crops, preprocess_img)
            entry = cache.Entry(np.asarray(lms, dtype=np.float32), flags, encoded)
            cache.store(args.cache_dir, key, entry)
        self.latents = mx.array(entry.latents)
        mx.eval(self.latents)
        self.frames, self.boxes, self.masks = frames, boxes, masks
        self.driver = driver
        mx.clear_cache()
        return clock() - started

    def _decode_pixels(self, predicted):
        pixels = mx.clip(self.pipe.vae.decode(predicted / self.pipe.scaling_factor) / 2 + 0.5, 0, 1)
        pixels = pixels.transpose(0, 2, 3, 1).astype(mx.float32)
        return mx.round(pixels * 255).astype(mx.uint8)

    def generate(self, indices, prompts):
        dtype = self.pipe._dtype
        inputs = self.latents[mx.array(indices)].astype(dtype)
        context = apply_pe(prompts.astype(dtype))
        prediction = self.pipe.unet(inputs, self.timestep, context)
        return np.array(self.decode_pixels(prediction))[..., ::-1]

    def prompts(self, pcm, rate):
        raw = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        divisor = math.gcd(rate, 16000)
        samples = resample_poly(raw, 16000 // divisor, rate // divisor)
        # Whisper attention is bidirectional. Use a short overlapped window
        # and limited future context, not the offline full utterance features.
        mel_length = math.ceil(len(samples) / 160)
        mel = log_mel_spectrogram(mx.array(samples))[:, :, :mel_length]
        return self.pipe.encode_audio(mel, len(samples), fps=media.FPS)

    def render(self, job):
        started = clock()
        self.turn += 1
        audio = StreamAudio(self.args.gateway, job["text"], job["voice"], started)
        audio.thread.start()
        rate = audio.wait_rate()
        samples_per_frame = rate // media.FPS
        directory = Path(job["directory"])
        partial = directory / "output.partial.mp4"
        final = directory / "output.mp4"
        height, width = self.frames[0].shape[:2]
        writer = media.Mp4Writer(partial, width, height, None, fragmented=job["stream"], pcm_rate=rate)
        mux = threading.Thread(target=audio.mux_audio, args=(writer.audio_input,), daemon=True)
        mux.start()

        frames = 0
        inferred = 0
        first_frame = None
        last_frame = None
        neural_seconds = 0.0
        stride = 2 if job.get("interpolate") else 1
        previous = None

        def emit(pixels):
            nonlocal frames, first_frame, last_frame
            index = _ping_pong(frames, len(self.frames))
            writer.write(face.paste_back(self.frames[index], pixels, self.boxes[index], self.masks[index]))
            last_frame = clock() - started
            if first_frame is None:
                first_frame = last_frame
            frames += 1

        try:
            while True:
                first = inferred * stride
                batch = 4 if inferred == 0 and stride == 2 else BATCH
                start = max(0, first - LEFT_CONTEXT)
                end = first + (batch - 1) * stride + 1 + LOOKAHEAD
                pcm, available, ended = audio.window(start * samples_per_frame, end * samples_per_frame)
                available_frames = available // samples_per_frame
                stop = min(first + batch * stride, available_frames)
                steps = list(range(first, stop, stride))
                if steps:
                    prompts = self.prompts(pcm, rate)[first - start:stop - start:stride]
                    indices = [_ping_pong(step, len(self.frames)) for step in steps]
                    neural_start = clock()
                    generated = self.generate(indices, prompts)
                    neural_seconds += clock() - neural_start
                    for step, pixels in zip(steps, generated):
                        if frames < step:
                            # The generated crops share a normalized face coordinate
                            # system. Paste the in-between crop onto its own source frame.
                            emit(cv2.addWeighted(previous, 0.5, pixels, 0.5, 0))
                        emit(pixels)
                        previous = pixels
                        inferred += 1
                if ended and inferred * stride >= available_frames:
                    if frames < available_frames and previous is not None:
                        emit(previous)
                    break
            if not frames:
                raise ValueError("Gateway speech yielded no complete video frames")
            writer.close()
            mux.join(timeout=2)
            partial.rename(final)
        except BaseException:
            writer.abort()
            raise
        finally:
            gc.collect()
            mx.clear_cache()
        return {
            "status": "succeeded", "worker_turn": self.turn, "driver_id": job["driver_id"], "voice": job["voice"],
            "timings_s": {"model_load_at_worker_start": self.model_load_s, "driver_prepare": job["driver_prepare"],
                          "tts_first_pcm": audio.first_s, "tts_eof": audio.end_s,
                          "first_frame": first_frame, "last_frame": last_frame, "total": clock() - started},
            "throughput": {"frames": frames, "inferred_frames": inferred, "interpolated_frames": frames - inferred,
                           "neural_fps": inferred / neural_seconds,
                           "sustained_fps": (frames - 1) / (last_frame - first_frame) if frames > 1 else None},
            "mlx_active_bytes": mx.get_active_memory(), "mlx_peak_bytes": mx.get_peak_memory(),
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", required=True)
    for name in ("weights", "landmarker", "cache-dir"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    renderer = ResidentRenderer(parser.parse_args())
    print(json.dumps({"type": "ready"}), flush=True)
    for line in sys.stdin:
        try:
            job = json.loads(line)
            try:
                job["driver_prepare"] = renderer.prepare_driver(Path(job["driver"]))
            except Exception as error:
                print(f"[MuseTalk driver] {type(error).__name__}: {error}", file=sys.stderr, flush=True)
                print(json.dumps({"type": "driver-error"}), flush=True)
                continue
            result = renderer.render(job)
            (Path(job["directory"]) / "result.json").write_text(json.dumps(result, indent=2))
            print(json.dumps({"type": "done"}), flush=True)
        except Exception as error:
            print(f"[MuseTalk live] {type(error).__name__}: {error}", file=sys.stderr, flush=True)
            print(json.dumps({"type": "error"}), flush=True)
            # A terminated job can still have a live socket or mux thread.
            break


if __name__ == "__main__":
    main()
