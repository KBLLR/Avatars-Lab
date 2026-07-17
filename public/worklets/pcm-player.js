/**
 * pcm-player.js — minimal streaming PCM ring-buffer player.
 *
 * Gemma Avatar reference case (2026-07-17). Mirrors the role of the
 * audio-playback worklet in hf.co/spaces/victor/gemma-avatar: the page posts
 * Float32 chunks (already at context sample rate — resampling happens on the
 * main thread) and this processor plays them gaplessly, reporting queue depth
 * so the UI can show buffering state. `clear` implements barge-in/stop: the
 * queue drops instantly and the mouth settles on its own.
 */

class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.queued = 0; // total queued samples
    this.blocks = 0;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "chunk" && data.samples) {
        this.queue.push(data.samples);
        this.queued += data.samples.length;
      } else if (data.type === "clear") {
        this.queue = [];
        this.offset = 0;
        this.queued = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length > 0) {
      const head = this.queue[0];
      const n = Math.min(out.length - i, head.length - this.offset);
      out.set(head.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      this.queued -= n;
      if (this.offset >= head.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    for (; i < out.length; i += 1) out[i] = 0;

    // ~10 Hz queue telemetry for the page UI.
    this.blocks += 1;
    if (this.blocks % 32 === 0) {
      this.port.postMessage({ type: "state", queuedSamples: this.queued });
    }
    return true;
  }
}

registerProcessor("pcm-player", PcmPlayerProcessor);
