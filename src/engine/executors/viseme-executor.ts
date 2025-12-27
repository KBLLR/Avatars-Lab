/**
 * Multi-Layer Performance Engine - Viseme Executor
 *
 * Handles lip sync from audio.
 * Supports:
 * - Audio playback with word timings
 * - Viseme mapping for mouth shapes
 * - Word highlight events for lyrics display
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type {
  Timeline,
  TimelineBlock,
  VisemeBlockData,
  WordTiming,
  LayerType,
  EngineState,
} from "../types";
import { getBlockData } from "../types";
import { BaseExecutor } from "./base-executor";

export class VisemeExecutor extends BaseExecutor {
  readonly layerType: LayerType = "viseme";

  // Audio state
  private audioContext: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;
  private audioBuffers: Map<string, AudioBuffer> = new Map();

  // Playback tracking
  private currentBlockId: string | null = null;
  private playbackStartTime = 0;
  private currentWordIndex = -1;

  // Word event callback
  private onWordChange?: (word: string, index: number) => void;

  constructor(head: TalkingHead) {
    super(head);
  }

  // ─────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────

  /**
   * Set callback for word highlight events (for lyrics display)
   */
  setWordChangeCallback(callback: (word: string, index: number) => void): void {
    this.onWordChange = callback;
  }

  // ─────────────────────────────────────────────────────────
  // Resource Loading
  // ─────────────────────────────────────────────────────────

  async loadResources(timeline: Timeline): Promise<void> {
    // Collect all audio URLs from viseme blocks
    const visemeBlocks = timeline.blocks.filter((b) => b.layerType === "viseme");
    const urls = new Set<string>();

    for (const block of visemeBlocks) {
      const data = getBlockData(block, "viseme");
      if (data?.audioUrl) {
        urls.add(data.audioUrl);
      }
    }

    // Pre-load audio buffers
    if (urls.size > 0) {
      this.audioContext = new AudioContext();

      for (const url of urls) {
        try {
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
          this.audioBuffers.set(url, audioBuffer);
        } catch (err) {
          this.warn(`Failed to load audio: ${url}`, err);
        }
      }

      this.log(`Loaded ${this.audioBuffers.size} audio buffers`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Main Update
  // ─────────────────────────────────────────────────────────

  update(
    time_ms: number,
    _delta_ms: number,
    activeBlocks: TimelineBlock[]
  ): void {
    if (this.isPaused || activeBlocks.length === 0) {
      return;
    }

    // Get first active viseme block
    const block = activeBlocks[0];
    const data = getBlockData(block, "viseme");
    if (!data) return;

    // Check if this is a new block (need to start audio)
    if (block.id !== this.currentBlockId) {
      this.startBlock(block, data);
      this.currentBlockId = block.id;
    }

    // Track word timings for lyrics display
    if (data.wordTimings) {
      this.updateWordTracking(block, data.wordTimings, time_ms);
    }

    this.currentBlocks = activeBlocks;
  }

  // ─────────────────────────────────────────────────────────
  // Block Processing
  // ─────────────────────────────────────────────────────────

  private startBlock(block: TimelineBlock, data: VisemeBlockData): void {
    this.playbackStartTime = performance.now();
    this.currentWordIndex = -1;

    // If we have audio and TalkingHead can handle it, use speakAudio
    if (data.audioUrl && data.wordTimings && data.visemeMapping) {
      this.startAudioPlayback(data);
    } else if (data.source === "tts" && data.text) {
      // TTS source - let TalkingHead handle it
      this.startTTSPlayback(data);
    }
  }

  private startAudioPlayback(data: VisemeBlockData): void {
    if (!data.audioUrl || !data.wordTimings || !data.visemeMapping) {
      return;
    }

    const audioBuffer = this.audioBuffers.get(data.audioUrl);
    if (!audioBuffer) {
      this.warn(`Audio buffer not found: ${data.audioUrl}`);
      return;
    }

    try {
      // Build audio config for TalkingHead.speakAudio()
      const audioConfig = {
        audio: audioBuffer,
        words: data.wordTimings.words,
        wtimes: data.wordTimings.wtimes,
        wdurations: data.wordTimings.wdurations,
        visemes: data.visemeMapping.visemes,
        vtimes: data.visemeMapping.vtimes,
        vdurations: data.visemeMapping.vdurations,
      };

      this.head.speakAudio(audioConfig);
      this.log("Started audio playback with lip sync");
    } catch (err) {
      this.warn("Failed to start audio playback:", err);
    }
  }

  private startTTSPlayback(data: VisemeBlockData): void {
    if (!data.text) return;

    try {
      // TalkingHead can speak text directly
      this.head.speak(data.text);
      this.log(`Started TTS: "${data.text.slice(0, 50)}..."`);
    } catch (err) {
      this.warn("Failed to start TTS:", err);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Word Tracking
  // ─────────────────────────────────────────────────────────

  private updateWordTracking(
    block: TimelineBlock,
    wordTimings: WordTiming,
    time_ms: number
  ): void {
    const relativeTime = time_ms - block.start_ms;

    // Find current word based on time
    let newWordIndex = -1;
    for (let i = 0; i < wordTimings.wtimes.length; i++) {
      const wordStart = wordTimings.wtimes[i];
      const wordEnd = wordStart + (wordTimings.wdurations[i] || 100);

      if (relativeTime >= wordStart && relativeTime < wordEnd) {
        newWordIndex = i;
        break;
      }
    }

    // Emit word change event if word changed
    if (newWordIndex !== this.currentWordIndex && newWordIndex >= 0) {
      this.currentWordIndex = newWordIndex;
      const word = wordTimings.words[newWordIndex];

      if (this.onWordChange) {
        this.onWordChange(word, newWordIndex);
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Cross-Layer Actions
  // ─────────────────────────────────────────────────────────

  executeAction(action: string, args?: Record<string, unknown>): void {
    switch (action) {
      case "speak":
        if (args?.text) {
          this.head.speak(args.text as string);
        }
        break;

      case "speak_emoji":
        if (args?.emoji) {
          this.head.speakEmoji(args.emoji as string);
        }
        break;

      case "speak_break":
        if (args?.duration_ms) {
          this.head.speakBreak(args.duration_ms as number);
        }
        break;

      case "stop_speaking":
        try {
          this.head.stop();
          this.head.start();
        } catch {
          // Ignore
        }
        break;

      default:
        this.warn(`Unknown action: ${action}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  onEngineStateChange(newState: EngineState, _prevState: EngineState): void {
    if (newState === "paused") {
      // Could pause audio here if needed
    }
  }

  stop(): void {
    super.stop();

    // Stop any playing audio
    if (this.audioSource) {
      try {
        this.audioSource.stop();
      } catch {
        // Ignore
      }
      this.audioSource = null;
    }

    this.currentBlockId = null;
    this.currentWordIndex = -1;
  }

  seek(_time_ms: number): void {
    // On seek, reset block tracking so audio restarts
    this.currentBlockId = null;
    this.currentWordIndex = -1;
  }

  dispose(): void {
    this.stop();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioBuffers.clear();
    this.onWordChange = undefined;

    super.dispose();
  }
}
