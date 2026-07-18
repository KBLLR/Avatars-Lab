import { COREX_GATEWAY_URL } from "./corex-client";

export interface SpeechStreamOptions {
  input: string;
  voice: string;
  destinationSampleRate: number;
  signal?: AbortSignal;
  baseUrl?: string;
  model?: string;
  intervalSeconds?: number;
  onFirstChunk?: (elapsedMs: number) => void;
  onChunk: (samples: Float32Array) => void;
}

export interface SpeechStreamResult {
  firstChunkMs: number;
  totalMs: number;
  sourceSampleRate: number;
  sourceSamples: number;
}

class Pcm16Decoder {
  private leftover: number | null = null;

  push(bytes: Uint8Array): Float32Array {
    let input = bytes;
    if (this.leftover !== null) {
      input = new Uint8Array(bytes.length + 1);
      input[0] = this.leftover;
      input.set(bytes, 1);
    }
    const evenLength = input.length & ~1;
    this.leftover = evenLength < input.length ? input[evenLength] : null;
    const view = new DataView(input.buffer, input.byteOffset, evenLength);
    const output = new Float32Array(evenLength / 2);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = view.getInt16(index * 2, true) / 32768;
    }
    return output;
  }
}

class LinearPcmResampler {
  private sourcePosition = 0;
  private readonly ratio: number;

  constructor(sourceRate: number, destinationRate: number) {
    this.ratio = sourceRate / destinationRate;
  }

  push(source: Float32Array): Float32Array {
    if (!source.length || this.ratio === 1) return source;
    const output: number[] = [];
    let position = this.sourcePosition;
    while (position < source.length) {
      const index = Math.floor(position);
      const fraction = position - index;
      const first = source[index];
      const second = source[Math.min(index + 1, source.length - 1)];
      output.push(first + (second - first) * fraction);
      position += this.ratio;
    }
    this.sourcePosition = position - source.length;
    return Float32Array.from(output);
  }
}

export async function streamSpeech(
  options: SpeechStreamOptions,
): Promise<SpeechStreamResult> {
  const startedAt = performance.now();
  const baseUrl = (options.baseUrl || COREX_GATEWAY_URL).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/v1/audio/speech/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: options.input,
      voice: options.voice,
      model: options.model || "qwen",
      streaming_interval: options.intervalSeconds || 0.6,
    }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`speech stream failed (HTTP ${response.status})`);
  }

  const sourceSampleRate = Number(response.headers.get("X-Sample-Rate") || 24000);
  const decoder = new Pcm16Decoder();
  const resampler = new LinearPcmResampler(
    sourceSampleRate,
    options.destinationSampleRate,
  );
  const reader = response.body.getReader();
  let firstChunkMs = 0;
  let sourceSamples = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    if (!firstChunkMs) {
      firstChunkMs = performance.now() - startedAt;
      options.onFirstChunk?.(firstChunkMs);
    }
    const decoded = decoder.push(value);
    sourceSamples += decoded.length;
    options.onChunk(resampler.push(decoded));
  }

  return {
    firstChunkMs,
    totalMs: performance.now() - startedAt,
    sourceSampleRate,
    sourceSamples,
  };
}
