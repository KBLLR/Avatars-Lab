/**
 * Dance Library Integration
 *
 * Connects the Dance Library with the Timeline Editor.
 * Allows dragging animations from library into timeline.
 */

import type { AnimationClip, PoseClip, Choreography } from "../dance/types";
import type { Timeline, TimelineBlock, DanceBlockData } from "./types";
import { createBlock } from "./types";

// ============================================
// Conversion Functions
// ============================================

/**
 * Convert an AnimationClip to a DanceBlockData
 */
export function animationClipToBlockData(clip: AnimationClip): DanceBlockData {
  return {
    clipId: clip.id,
    clipUrl: clip.url,
    loop: clip.loopable,
    mirror: false,
    speed: 1,
    blendWeight: 1,
  };
}

/**
 * Convert a PoseClip to a DanceBlockData
 */
export function poseClipToBlockData(pose: PoseClip): DanceBlockData {
  return {
    clipId: pose.id,
    clipUrl: pose.url,
    loop: false,
    mirror: false,
    speed: 1,
    blendWeight: 1,
  };
}

/**
 * Create a dance timeline block from an AnimationClip
 */
export function createDanceBlockFromClip(
  clip: AnimationClip,
  start_ms: number,
  duration_ms?: number
): TimelineBlock<DanceBlockData> {
  return createBlock(
    "dance",
    "dance",
    start_ms,
    duration_ms || clip.duration_ms,
    animationClipToBlockData(clip),
    clip.name
  );
}

/**
 * Create a dance timeline block from a PoseClip
 */
export function createPoseBlockFromClip(
  pose: PoseClip,
  start_ms: number,
  duration_ms?: number
): TimelineBlock<DanceBlockData> {
  return createBlock(
    "dance",
    "dance",
    start_ms,
    duration_ms || pose.duration_ms,
    poseClipToBlockData(pose),
    pose.name
  );
}

// ============================================
// Choreography to Timeline Conversion
// ============================================

/**
 * Convert a Choreography to timeline dance blocks
 */
export function choreographyToBlocks(
  choreography: Choreography,
  clips: Map<string, AnimationClip>
): TimelineBlock<DanceBlockData>[] {
  const blocks: TimelineBlock<DanceBlockData>[] = [];

  for (const step of choreography.steps) {
    const clip = clips.get(step.clip_id);
    if (!clip) {
      console.warn(`Clip not found: ${step.clip_id}`);
      continue;
    }

    const duration = step.duration_ms || clip.duration_ms;
    const block = createBlock(
      "dance",
      "dance",
      step.start_ms,
      duration,
      {
        clipId: clip.id,
        clipUrl: clip.url,
        loop: step.loop ?? clip.loopable,
        mirror: step.mirror ?? false,
        speed: step.speed ?? 1,
        blendWeight: 1,
      },
      clip.name
    );

    // Add transition easing
    if (step.transition === "crossfade" || step.transition === "blend") {
      block.fadeIn_ms = step.transition_ms || 200;
      block.fadeOut_ms = step.transition_ms || 200;
      block.easeIn = "easeInOut";
      block.easeOut = "easeInOut";
    }

    blocks.push(block);
  }

  return blocks;
}

// ============================================
// Timeline to Choreography Conversion
// ============================================

/**
 * Extract dance blocks from a timeline and create a Choreography
 */
export function timelineToChoreography(
  timeline: Timeline,
  name?: string
): Choreography {
  const danceBlocks = timeline.blocks.filter((b) => b.layerType === "dance");

  // Sort by start time
  danceBlocks.sort((a, b) => a.start_ms - b.start_ms);

  const steps = danceBlocks.map((block) => {
    const data = block.data as DanceBlockData;
    return {
      clip_id: data.clipId,
      start_ms: block.start_ms,
      duration_ms: block.duration_ms,
      loop: data.loop,
      mirror: data.mirror,
      speed: data.speed,
      transition: block.fadeIn_ms ? ("crossfade" as const) : ("cut" as const),
      transition_ms: block.fadeIn_ms,
    };
  });

  // Calculate total duration
  const duration_ms = danceBlocks.reduce((max, block) => {
    return Math.max(max, block.start_ms + block.duration_ms);
  }, 0);

  return {
    id: `choreo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || timeline.name,
    description: `Choreography from timeline: ${timeline.name}`,
    style: "freestyle",
    mood: "energetic",
    duration_ms,
    steps,
    created_at: new Date().toISOString(),
  };
}

// ============================================
// Drag & Drop Support
// ============================================

export interface DragDropData {
  type: "animation" | "pose" | "choreography";
  id: string;
  clip?: AnimationClip;
  pose?: PoseClip;
  choreography?: Choreography;
}

/**
 * Create drag data for an animation clip
 */
export function createAnimationDragData(clip: AnimationClip): string {
  const data: DragDropData = {
    type: "animation",
    id: clip.id,
    clip,
  };
  return JSON.stringify(data);
}

/**
 * Create drag data for a pose clip
 */
export function createPoseDragData(pose: PoseClip): string {
  const data: DragDropData = {
    type: "pose",
    id: pose.id,
    pose,
  };
  return JSON.stringify(data);
}

/**
 * Parse drag data and create timeline block
 */
export function parseDragData(
  jsonData: string,
  dropTime_ms: number
): TimelineBlock | null {
  try {
    const data = JSON.parse(jsonData) as DragDropData;

    switch (data.type) {
      case "animation":
        if (data.clip) {
          return createDanceBlockFromClip(data.clip, dropTime_ms);
        }
        break;

      case "pose":
        if (data.pose) {
          return createPoseBlockFromClip(data.pose, dropTime_ms);
        }
        break;

      case "choreography":
        // Choreography drops need special handling (multiple blocks)
        // For now, return null and handle separately
        return null;
    }
  } catch (err) {
    console.error("Failed to parse drag data:", err);
  }

  return null;
}

// ============================================
// Library Browser Integration
// ============================================

export interface LibraryItem {
  id: string;
  name: string;
  type: "animation" | "pose" | "choreography";
  duration_ms: number;
  tags: string[];
  thumbnail?: string;
  source: AnimationClip | PoseClip | Choreography;
}

/**
 * Convert library contents to a flat list for browsing
 */
export function flattenLibrary(
  animations: AnimationClip[],
  poses: PoseClip[],
  choreographies: Choreography[]
): LibraryItem[] {
  const items: LibraryItem[] = [];

  for (const clip of animations) {
    items.push({
      id: clip.id,
      name: clip.name,
      type: "animation",
      duration_ms: clip.duration_ms,
      tags: clip.tags,
      source: clip,
    });
  }

  for (const pose of poses) {
    items.push({
      id: pose.id,
      name: pose.name,
      type: "pose",
      duration_ms: pose.duration_ms,
      tags: pose.tags,
      source: pose,
    });
  }

  for (const choreo of choreographies) {
    items.push({
      id: choreo.id,
      name: choreo.name,
      type: "choreography",
      duration_ms: choreo.duration_ms,
      tags: [choreo.style, choreo.mood],
      source: choreo,
    });
  }

  return items;
}

/**
 * Filter library items by search query
 */
export function searchLibrary(items: LibraryItem[], query: string): LibraryItem[] {
  if (!query.trim()) return items;

  const lowerQuery = query.toLowerCase();

  return items.filter((item) => {
    if (item.name.toLowerCase().includes(lowerQuery)) return true;
    if (item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))) return true;
    return false;
  });
}

/**
 * Filter library items by type
 */
export function filterByType(
  items: LibraryItem[],
  type: "animation" | "pose" | "choreography" | "all"
): LibraryItem[] {
  if (type === "all") return items;
  return items.filter((item) => item.type === type);
}
