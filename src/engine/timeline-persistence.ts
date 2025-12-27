/**
 * Timeline Persistence - Save/Load/Export timelines
 *
 * Handles serialization and storage of timeline data.
 */

import type { Timeline, TimelineBlock, LayerConfig, TimelineMarker } from "./types";
import { createDefaultLayers } from "./types";

// ============================================
// Storage Keys
// ============================================

const STORAGE_PREFIX = "avatarLabs.timeline";
const TIMELINE_LIST_KEY = `${STORAGE_PREFIX}.list`;
const CURRENT_KEY = `${STORAGE_PREFIX}.current`;

// ============================================
// Timeline Storage Format
// ============================================

export interface StoredTimeline {
  version: "1.0";
  timeline: Timeline;
  metadata: {
    createdAt: string;
    updatedAt: string;
    thumbnail?: string;
  };
}

export interface TimelineListItem {
  id: string;
  name: string;
  duration_ms: number;
  blockCount: number;
  updatedAt: string;
}

// ============================================
// Serialization
// ============================================

/**
 * Serialize a timeline to JSON string
 */
export function serializeTimeline(timeline: Timeline): string {
  const stored: StoredTimeline = {
    version: "1.0",
    timeline: {
      ...timeline,
      // Don't store audio buffer
      audioBuffer: undefined,
    },
    metadata: {
      createdAt: timeline.created_at,
      updatedAt: new Date().toISOString(),
    },
  };

  return JSON.stringify(stored, null, 2);
}

/**
 * Deserialize a timeline from JSON string
 */
export function deserializeTimeline(json: string): Timeline | null {
  try {
    const stored = JSON.parse(json) as StoredTimeline;

    if (stored.version !== "1.0" || !stored.timeline) {
      console.warn("Invalid timeline format");
      return null;
    }

    const timeline = stored.timeline;

    // Ensure layers exist
    if (!timeline.layers || timeline.layers.length === 0) {
      timeline.layers = createDefaultLayers();
    }

    // Ensure blocks is an array
    if (!Array.isArray(timeline.blocks)) {
      timeline.blocks = [];
    }

    // Ensure markers is an array
    if (!Array.isArray(timeline.markers)) {
      timeline.markers = [];
    }

    return timeline;
  } catch (err) {
    console.error("Failed to deserialize timeline:", err);
    return null;
  }
}

// ============================================
// Local Storage Operations
// ============================================

/**
 * Save timeline to localStorage
 */
export function saveTimeline(timeline: Timeline): void {
  const key = `${STORAGE_PREFIX}.${timeline.id}`;
  const json = serializeTimeline(timeline);
  localStorage.setItem(key, json);

  // Update timeline list
  updateTimelineList(timeline);

  // Set as current
  localStorage.setItem(CURRENT_KEY, timeline.id);

  console.log(`[Timeline] Saved: ${timeline.name} (${timeline.id})`);
}

/**
 * Load timeline from localStorage by ID
 */
export function loadTimeline(id: string): Timeline | null {
  const key = `${STORAGE_PREFIX}.${id}`;
  const json = localStorage.getItem(key);

  if (!json) {
    console.warn(`[Timeline] Not found: ${id}`);
    return null;
  }

  return deserializeTimeline(json);
}

/**
 * Load the most recently saved timeline
 */
export function loadCurrentTimeline(): Timeline | null {
  const currentId = localStorage.getItem(CURRENT_KEY);
  if (!currentId) return null;
  return loadTimeline(currentId);
}

/**
 * Delete a timeline from localStorage
 */
export function deleteTimeline(id: string): void {
  const key = `${STORAGE_PREFIX}.${id}`;
  localStorage.removeItem(key);

  // Update list
  const list = getTimelineList();
  const filtered = list.filter((t) => t.id !== id);
  localStorage.setItem(TIMELINE_LIST_KEY, JSON.stringify(filtered));

  console.log(`[Timeline] Deleted: ${id}`);
}

/**
 * Get list of all saved timelines
 */
export function getTimelineList(): TimelineListItem[] {
  const json = localStorage.getItem(TIMELINE_LIST_KEY);
  if (!json) return [];

  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Update the timeline list with current timeline info
 */
function updateTimelineList(timeline: Timeline): void {
  const list = getTimelineList();

  const existingIndex = list.findIndex((t) => t.id === timeline.id);
  const item: TimelineListItem = {
    id: timeline.id,
    name: timeline.name,
    duration_ms: timeline.duration_ms,
    blockCount: timeline.blocks.length,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    list[existingIndex] = item;
  } else {
    list.unshift(item);
  }

  // Keep only last 50 timelines
  const trimmed = list.slice(0, 50);
  localStorage.setItem(TIMELINE_LIST_KEY, JSON.stringify(trimmed));
}

// ============================================
// File Import/Export
// ============================================

/**
 * Export timeline as downloadable JSON file
 */
export function exportTimelineAsFile(timeline: Timeline): void {
  const json = serializeTimeline(timeline);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${timeline.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-timeline.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`[Timeline] Exported: ${timeline.name}`);
}

/**
 * Import timeline from file input
 */
export function importTimelineFromFile(file: File): Promise<Timeline | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const json = e.target?.result as string;
      const timeline = deserializeTimeline(json);
      if (timeline) {
        // Generate new ID to avoid conflicts
        timeline.id = `timeline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        timeline.name = `${timeline.name} (imported)`;
        resolve(timeline);
      } else {
        resolve(null);
      }
    };

    reader.onerror = () => {
      console.error("Failed to read timeline file");
      resolve(null);
    };

    reader.readAsText(file);
  });
}

// ============================================
// Auto-save
// ============================================

let autoSaveTimer: number | null = null;
let autoSaveTimeline: Timeline | null = null;

/**
 * Schedule an auto-save (debounced)
 */
export function scheduleAutoSave(timeline: Timeline, delay_ms = 2000): void {
  autoSaveTimeline = timeline;

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }

  autoSaveTimer = window.setTimeout(() => {
    if (autoSaveTimeline) {
      saveTimeline(autoSaveTimeline);
      autoSaveTimeline = null;
    }
    autoSaveTimer = null;
  }, delay_ms);
}

/**
 * Cancel pending auto-save
 */
export function cancelAutoSave(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  autoSaveTimeline = null;
}

// ============================================
// Timeline Validation
// ============================================

/**
 * Validate timeline structure
 */
export function validateTimeline(timeline: unknown): timeline is Timeline {
  if (!timeline || typeof timeline !== "object") return false;

  const t = timeline as Partial<Timeline>;

  if (typeof t.id !== "string") return false;
  if (typeof t.name !== "string") return false;
  if (typeof t.duration_ms !== "number") return false;
  if (!Array.isArray(t.layers)) return false;
  if (!Array.isArray(t.blocks)) return false;

  return true;
}

/**
 * Repair/normalize a timeline (fix common issues)
 */
export function repairTimeline(timeline: Timeline): Timeline {
  // Ensure all blocks have required fields
  timeline.blocks = timeline.blocks.filter((block) => {
    if (!block.id || !block.layerId || !block.layerType) return false;
    if (typeof block.start_ms !== "number") return false;
    if (typeof block.duration_ms !== "number") return false;
    return true;
  });

  // Ensure blocks don't exceed timeline duration
  for (const block of timeline.blocks) {
    const endTime = block.start_ms + block.duration_ms;
    if (endTime > timeline.duration_ms) {
      timeline.duration_ms = endTime;
    }
  }

  // Ensure layers exist
  if (!timeline.layers || timeline.layers.length === 0) {
    timeline.layers = createDefaultLayers();
  }

  // Ensure markers array exists
  if (!timeline.markers) {
    timeline.markers = [];
  }

  // Ensure timestamps
  if (!timeline.created_at) {
    timeline.created_at = new Date().toISOString();
  }
  timeline.updated_at = new Date().toISOString();

  return timeline;
}
