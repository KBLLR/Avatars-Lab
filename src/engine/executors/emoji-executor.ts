/**
 * Multi-Layer Performance Engine - Emoji Executor
 *
 * Handles emoji expression blocks.
 * Triggers emoji expressions once per block start.
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type { Timeline, TimelineBlock, EmojiBlockData, LayerType } from "../types";
import { getBlockData } from "../types";
import { BaseExecutor } from "./base-executor";

export class EmojiExecutor extends BaseExecutor {
  readonly layerType: LayerType = "emoji";

  private triggeredBlocks: Set<string> = new Set();

  constructor(head: TalkingHead) {
    super(head);
  }

  update(
    time_ms: number,
    _delta_ms: number,
    activeBlocks: TimelineBlock[]
  ): void {
    if (this.isPaused || activeBlocks.length === 0) {
      return;
    }

    for (const block of activeBlocks) {
      if (this.triggeredBlocks.has(block.id)) continue;
      const data = getBlockData(block, "emoji") as EmojiBlockData | null;
      if (!data?.emoji) continue;

      const progress = this.getBlockProgress(block, time_ms);
      if (progress < 0.1) {
        this.head.speakEmoji(data.emoji);
        this.triggeredBlocks.add(block.id);
      }
    }

    this.currentBlocks = activeBlocks;
  }

  executeAction(action: string, args?: Record<string, unknown>): void {
    switch (action) {
      case "speak_emoji":
      case "make_facial_expression":
        if (args?.emoji) {
          this.head.speakEmoji(args.emoji as string);
        }
        break;
      default:
        this.warn(`Unknown action: ${action}`);
    }
  }

  async loadResources(_timeline: Timeline): Promise<void> {}

  stop(): void {
    super.stop();
    this.triggeredBlocks.clear();
  }

  dispose(): void {
    this.stop();
    super.dispose();
  }
}
