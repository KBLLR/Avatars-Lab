import { createId, type MusicAnalysis, type SongAnalysisSegment, type SpeakerProfile } from "./types";

interface RemoteTranscriptSegment {
  start?: number;
  end?: number;
  text?: string;
  speaker_id?: string;
}

interface RemoteDiarisationSegment {
  start?: number;
  end?: number;
  speaker_id?: string;
}

export interface SongAnalysisInput {
  file: File;
  gatewayBaseUrl: string;
  sttModel?: string;
  actorIds: string[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const responseError = async (response: Response, label: string): Promise<Error> => {
  const detail = (await response.text()).slice(0, 240);
  return new Error(`${label} failed (${response.status})${detail ? `: ${detail}` : ""}`);
};

const decodeSignal = async (file: File): Promise<AudioBuffer> => {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData((await file.arrayBuffer()).slice(0));
  } finally {
    await context.close();
  }
};

const percentile = (values: number[], amount: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * amount)))];
};

const analyzeSignal = (buffer: AudioBuffer): {
  durationMs: number;
  energyEnvelope: MusicAnalysis["energyEnvelope"];
  beatsMs: number[];
  tempoBpm?: number;
} => {
  const sampleRate = buffer.sampleRate;
  const frameMs = 80;
  const frameSize = Math.max(1, Math.round(sampleRate * frameMs / 1000));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const raw: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += frameSize) {
    let sum = 0;
    let count = 0;
    const end = Math.min(buffer.length, offset + frameSize);
    for (let sample = offset; sample < end; sample += 2) {
      let mixed = 0;
      for (const channel of channels) mixed += channel[sample] || 0;
      mixed /= channels.length;
      sum += mixed * mixed;
      count += 1;
    }
    raw.push(Math.sqrt(sum / Math.max(1, count)));
  }
  const floor = percentile(raw, 0.08);
  const ceiling = Math.max(floor + 0.0001, percentile(raw, 0.95));
  const normalized = raw.map((value, index) => {
    const previous = index > 0 ? raw[index - 1] : value;
    const next = index + 1 < raw.length ? raw[index + 1] : value;
    return clamp01((((previous + value * 2 + next) / 4) - floor) / (ceiling - floor));
  });
  const energyEnvelope = normalized.map((value, index) => ({ timeMs: index * frameMs, value }));
  const mean = normalized.reduce((sum, value) => sum + value, 0) / Math.max(1, normalized.length);
  const deviation = Math.sqrt(normalized.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, normalized.length));
  const beatsMs: number[] = [];
  for (let index = 2; index < normalized.length - 2; index += 1) {
    const value = normalized[index];
    const localPeak = value >= normalized[index - 1] && value > normalized[index + 1];
    const onset = value - normalized[index - 2];
    const timeMs = index * frameMs;
    if (localPeak && onset > Math.max(0.08, deviation * 0.36) && value > mean + deviation * 0.12 &&
      timeMs - (beatsMs.at(-1) || -1_000) >= 240) {
      beatsMs.push(timeMs);
    }
  }
  const intervals = beatsMs.slice(1).map((time, index) => time - beatsMs[index]).filter((value) => value > 0);
  let tempoBpm: number | undefined;
  if (intervals.length >= 2) {
    let estimate = 60_000 / percentile(intervals, 0.5);
    while (estimate < 70) estimate *= 2;
    while (estimate > 180) estimate /= 2;
    tempoBpm = Math.round(estimate * 10) / 10;
  }
  return {
    durationMs: Math.round(buffer.duration * 1000),
    energyEnvelope,
    beatsMs,
    tempoBpm,
  };
};

const energyBetween = (
  envelope: MusicAnalysis["energyEnvelope"],
  startMs: number,
  endMs: number,
): number => {
  const samples = envelope.filter((sample) => sample.timeMs >= startMs && sample.timeMs < endMs);
  return samples.reduce((sum, sample) => sum + sample.value, 0) / Math.max(1, samples.length);
};

const lexicalValence = (text: string, energy: number): number => {
  const positive = (text.match(/\b(love|joy|happy|free|alive|dance|light|home|together|smile|hope)\b/gi) || []).length;
  const negative = (text.match(/\b(lost|alone|fear|cry|dark|pain|broken|goodbye|hate|dead|cold)\b/gi) || []).length;
  return clamp01(0.5 + Math.min(0.3, positive * 0.06) - Math.min(0.3, negative * 0.06) + (energy - 0.5) * 0.08);
};

const bestSpeaker = (
  startMs: number,
  endMs: number,
  diarisation: RemoteDiarisationSegment[],
): string | undefined => {
  let winner: string | undefined;
  let bestOverlap = 0;
  for (const segment of diarisation) {
    const start = Number(segment.start || 0) * 1000;
    const end = Number(segment.end || 0) * 1000;
    const overlap = Math.max(0, Math.min(endMs, end) - Math.max(startMs, start));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      winner = segment.speaker_id || undefined;
    }
  }
  return winner;
};

const buildSegments = (
  transcript: RemoteTranscriptSegment[],
  diarisation: RemoteDiarisationSegment[],
  signal: ReturnType<typeof analyzeSignal>,
): SongAnalysisSegment[] => {
  if (!transcript.length) {
    const sectionCount = signal.durationMs < 20_000 ? 3 : 6;
    return Array.from({ length: sectionCount }, (_, index) => {
      const startMs = Math.round(signal.durationMs * index / sectionCount);
      const endMs = index === sectionCount - 1 ? signal.durationMs : Math.round(signal.durationMs * (index + 1) / sectionCount);
      const energy = energyBetween(signal.energyEnvelope, startMs, endMs);
      return {
        id: createId("song_segment"),
        startMs,
        endMs,
        text: "Instrumental or untranscribed passage",
        energy,
        arousal: clamp01(energy * 0.9 + 0.08),
        valence: 0.5,
      };
    });
  }
  return transcript.flatMap((segment) => {
    const startMs = Math.max(0, Math.round(Number(segment.start || 0) * 1000));
    const endMs = Math.min(signal.durationMs, Math.max(startMs + 1, Math.round(Number(segment.end || 0) * 1000)));
    if (startMs >= signal.durationMs) return [];
    const energy = energyBetween(signal.energyEnvelope, startMs, endMs);
    const text = String(segment.text || "").trim();
    return [{
      id: createId("song_segment"),
      startMs,
      endMs,
      text: text || "Vocal passage",
      speakerId: bestSpeaker(startMs, endMs, diarisation) || segment.speaker_id || undefined,
      energy,
      arousal: clamp01(energy * 0.9 + 0.08),
      valence: lexicalValence(text, energy),
    }];
  });
};

const buildSpeakers = (segments: SongAnalysisSegment[], actorIds: string[]): SpeakerProfile[] => {
  const durations = new Map<string, number>();
  for (const segment of segments) {
    if (!segment.speakerId || segment.speakerId === "UNKNOWN") continue;
    durations.set(segment.speakerId, (durations.get(segment.speakerId) || 0) + segment.endMs - segment.startMs);
  }
  return [...durations.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, durationMs], index) => ({
      id,
      durationMs,
      actorId: actorIds.length ? actorIds[index % actorIds.length] : undefined,
      confidence: durationMs >= 8_000 ? "medium" : "low",
    }));
};

const runRemoteAnalysis = async (
  input: SongAnalysisInput,
): Promise<{ transcript: RemoteTranscriptSegment[]; diarisation: RemoteDiarisationSegment[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const form = new FormData();
  form.append("file", input.file, input.file.name);
  form.append("model", input.sttModel || "whisper");
  let transcription: Record<string, unknown>;
  try {
    const response = await fetch(`${input.gatewayBaseUrl}/voice-snip/transcribe-file`, { method: "POST", body: form });
    if (!response.ok) throw await responseError(response, "Transcription");
    transcription = await response.json() as Record<string, unknown>;
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    return { transcript: [], diarisation: [], warnings };
  }
  const transcript = Array.isArray(transcription.segments)
    ? transcription.segments.filter((value): value is RemoteTranscriptSegment => Boolean(value) && typeof value === "object")
    : [];
  const audioPath = typeof transcription.audio_path === "string" ? transcription.audio_path : "";
  if (!audioPath) {
    warnings.push("Transcription returned no local audio path, so diarisation was skipped.");
    return { transcript, diarisation: [], warnings };
  }
  try {
    const response = await fetch(`${input.gatewayBaseUrl}/voice-snip/diarise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_path: audioPath, threshold: 0.5, min_duration: 0.5, min_gap: 0.5 }),
    });
    if (!response.ok) throw await responseError(response, "Diarisation");
    const payload = await response.json() as Record<string, unknown>;
    const diarisation = Array.isArray(payload.segments)
      ? payload.segments.filter((value): value is RemoteDiarisationSegment => Boolean(value) && typeof value === "object")
      : [];
    if (diarisation.length) {
      warnings.push("Singer assignment is best-effort: the local diarisation model is speech-trained and overlapping vocals require review.");
    }
    return { transcript, diarisation, warnings };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    return { transcript, diarisation: [], warnings };
  }
};

export const analyzeSong = async (input: SongAnalysisInput): Promise<MusicAnalysis> => {
  const [buffer, remote] = await Promise.all([decodeSignal(input.file), runRemoteAnalysis(input)]);
  const signal = analyzeSignal(buffer);
  const segments = buildSegments(remote.transcript, remote.diarisation, signal);
  return {
    schema: "avatar-labs.music-analysis.v1",
    analyzedAt: new Date().toISOString(),
    durationMs: signal.durationMs,
    tempoBpm: signal.tempoBpm,
    beatsMs: signal.beatsMs,
    energyEnvelope: signal.energyEnvelope,
    segments,
    speakers: buildSpeakers(segments, input.actorIds),
    source: {
      signal: "web-audio",
      transcription: remote.transcript.length ? input.sttModel || "whisper" : undefined,
      diarisation: remote.diarisation.length ? "pyannote-segmentation-3.0-mlx" : undefined,
    },
    warnings: remote.warnings,
  };
};

export const setSpeakerActor = (analysis: MusicAnalysis, speakerId: string, actorId: string): MusicAnalysis => ({
  ...analysis,
  speakers: analysis.speakers.map((speaker) => speaker.id === speakerId ? { ...speaker, actorId } : speaker),
});
