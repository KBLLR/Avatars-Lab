import type { TalkingHead } from "@met4citizen/talkinghead";
import type { TranscribeConfig, TranscribeResult } from "./types";

export const decodeAudio = async (
  audioFile: File,
  audioCtx: AudioContext
): Promise<AudioBuffer> => {
  const arrayBuffer = await audioFile.arrayBuffer();
  return audioCtx.decodeAudioData(arrayBuffer.slice(0));
};

export const transcribeAudio = async (
  audioFile: File,
  config: TranscribeConfig,
  updateStatus: (msg: string) => void
): Promise<TranscribeResult> => {
  if (!config.audioBaseUrl || !config.sttModel) {
    throw new Error("Missing audioBaseUrl or sttModel in config.");
  }

  updateStatus("Transcribing with MLX STT...");

  const form = new FormData();
  form.append("file", audioFile);
  form.append("model", config.sttModel);
  form.append("language", "en");
  form.append("word_timestamps", "true");

  const response = await fetch(`${config.audioBaseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`STT error (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const text = payload?.text || "";

  if (!text) {
    throw new Error("STT returned empty transcript.");
  }

  let wordTimings: TranscribeResult["wordTimings"] = null;

  if (
    Array.isArray(payload?.words) &&
    Array.isArray(payload?.wtimes) &&
    Array.isArray(payload?.wdurations) &&
    payload.words.length === payload.wtimes.length &&
    payload.words.length === payload.wdurations.length
  ) {
    wordTimings = {
      words: payload.words,
      wtimes: payload.wtimes,
      wdurations: payload.wdurations
    };
  }

  return { text, wordTimings };
};
