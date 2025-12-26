/**
 * Gesture Library - CRUD operations and JSON persistence
 */

import type { GestureClip, GestureLibrary } from "./types";

const LIBRARY_URL = "/gestures/library.json";
const STORAGE_KEY = "avatarLabs.gestureLibrary";

// Generate a simple UUID
const generateId = (): string => {
  return `clip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

export class GestureLibraryManager {
  private library: GestureLibrary;
  private dirty = false;

  constructor() {
    this.library = {
      version: "1.0",
      updated_at: new Date().toISOString(),
      clips: []
    };
  }

  /**
   * Load library from JSON file or localStorage
   */
  async load(): Promise<void> {
    // Try localStorage first (local edits)
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        this.library = JSON.parse(stored);
        return;
      } catch {
        console.warn("Failed to parse stored gesture library");
      }
    }

    // Fall back to static JSON file
    try {
      const response = await fetch(LIBRARY_URL);
      if (response.ok) {
        this.library = await response.json();
      }
    } catch {
      console.warn("Failed to load gesture library from", LIBRARY_URL);
    }
  }

  /**
   * Save library to localStorage
   */
  save(): void {
    this.library.updated_at = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.library));
    this.dirty = false;
  }

  /**
   * Export library as JSON string
   */
  export(): string {
    return JSON.stringify(this.library, null, 2);
  }

  /**
   * Import library from JSON string
   */
  import(json: string): boolean {
    try {
      const parsed = JSON.parse(json);
      if (parsed.version && Array.isArray(parsed.clips)) {
        this.library = parsed;
        this.dirty = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get all clips
   */
  getAll(): GestureClip[] {
    return [...this.library.clips];
  }

  /**
   * Get clip by ID
   */
  get(id: string): GestureClip | undefined {
    return this.library.clips.find(c => c.id === id);
  }

  /**
   * Find clips by tag
   */
  findByTag(tag: string): GestureClip[] {
    return this.library.clips.filter(c => c.tags.includes(tag));
  }

  /**
   * Search clips by name
   */
  search(query: string): GestureClip[] {
    const q = query.toLowerCase();
    return this.library.clips.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Add a new clip
   */
  add(clip: Omit<GestureClip, "id" | "created_at">): GestureClip {
    const newClip: GestureClip = {
      ...clip,
      id: generateId(),
      created_at: new Date().toISOString()
    };
    this.library.clips.push(newClip);
    this.dirty = true;
    return newClip;
  }

  /**
   * Update an existing clip
   */
  update(id: string, updates: Partial<Omit<GestureClip, "id" | "created_at">>): GestureClip | undefined {
    const index = this.library.clips.findIndex(c => c.id === id);
    if (index === -1) return undefined;

    this.library.clips[index] = {
      ...this.library.clips[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    this.dirty = true;
    return this.library.clips[index];
  }

  /**
   * Delete a clip
   */
  delete(id: string): boolean {
    const index = this.library.clips.findIndex(c => c.id === id);
    if (index === -1) return false;

    this.library.clips.splice(index, 1);
    this.dirty = true;
    return true;
  }

  /**
   * Check if there are unsaved changes
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Clear all local changes and reload
   */
  async reset(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
    await this.load();
    this.dirty = false;
  }
}

// Singleton instance
let libraryInstance: GestureLibraryManager | null = null;

export const getGestureLibrary = (): GestureLibraryManager => {
  if (!libraryInstance) {
    libraryInstance = new GestureLibraryManager();
  }
  return libraryInstance;
};

export const initGestureLibrary = async (): Promise<GestureLibraryManager> => {
  const library = getGestureLibrary();
  await library.load();
  return library;
};
