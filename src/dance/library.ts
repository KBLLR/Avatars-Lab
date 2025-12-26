/**
 * Dance Library - CRUD operations for animations, poses, and choreographies
 */

import type {
  AnimationClip,
  PoseClip,
  Choreography,
  DanceLibrary,
  DanceStyle,
  DanceMood
} from "./types";

const LIBRARY_URL = "/dance/library.json";
const STORAGE_KEY = "avatarLabs.danceLibrary";

const generateId = (): string => {
  return `dance_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

export class DanceLibraryManager {
  private library: DanceLibrary;
  private dirty = false;

  constructor() {
    this.library = {
      version: "1.0",
      updated_at: new Date().toISOString(),
      animations: [],
      poses: [],
      choreographies: []
    };
  }

  async load(): Promise<void> {
    // Try localStorage first
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        this.library = JSON.parse(stored);
        return;
      } catch {
        console.warn("Failed to parse stored dance library");
      }
    }

    // Fall back to static JSON
    try {
      const response = await fetch(LIBRARY_URL);
      if (response.ok) {
        this.library = await response.json();
      }
    } catch {
      console.warn("Failed to load dance library from", LIBRARY_URL);
    }
  }

  save(): void {
    this.library.updated_at = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.library));
    this.dirty = false;
  }

  export(): string {
    return JSON.stringify(this.library, null, 2);
  }

  import(json: string): boolean {
    try {
      const parsed = JSON.parse(json);
      if (parsed.version && Array.isArray(parsed.animations)) {
        this.library = parsed;
        this.dirty = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Animations
  // ─────────────────────────────────────────────────────────────

  getAllAnimations(): AnimationClip[] {
    return [...this.library.animations];
  }

  getAnimation(id: string): AnimationClip | undefined {
    return this.library.animations.find(a => a.id === id);
  }

  findAnimationsByStyle(style: DanceStyle): AnimationClip[] {
    return this.library.animations.filter(a => a.tags.includes(style));
  }

  findAnimationsByMood(mood: DanceMood): AnimationClip[] {
    // DanceMood is stored in tags, not in the avatar mood field
    return this.library.animations.filter(a => a.tags.includes(mood));
  }

  findAnimationsByTag(tag: string): AnimationClip[] {
    return this.library.animations.filter(a => a.tags.includes(tag));
  }

  searchAnimations(query: string): AnimationClip[] {
    const q = query.toLowerCase();
    return this.library.animations.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      a.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  addAnimation(clip: Omit<AnimationClip, "id" | "created_at">): AnimationClip {
    const newClip: AnimationClip = {
      ...clip,
      id: generateId(),
      created_at: new Date().toISOString()
    };
    this.library.animations.push(newClip);
    this.dirty = true;
    return newClip;
  }

  updateAnimation(id: string, updates: Partial<Omit<AnimationClip, "id" | "created_at">>): AnimationClip | undefined {
    const index = this.library.animations.findIndex(a => a.id === id);
    if (index === -1) return undefined;
    this.library.animations[index] = { ...this.library.animations[index], ...updates };
    this.dirty = true;
    return this.library.animations[index];
  }

  deleteAnimation(id: string): boolean {
    const index = this.library.animations.findIndex(a => a.id === id);
    if (index === -1) return false;
    this.library.animations.splice(index, 1);
    this.dirty = true;
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // Poses
  // ─────────────────────────────────────────────────────────────

  getAllPoses(): PoseClip[] {
    return [...this.library.poses];
  }

  getPose(id: string): PoseClip | undefined {
    return this.library.poses.find(p => p.id === id);
  }

  addPose(clip: Omit<PoseClip, "id" | "created_at">): PoseClip {
    const newClip: PoseClip = {
      ...clip,
      id: generateId(),
      created_at: new Date().toISOString()
    };
    this.library.poses.push(newClip);
    this.dirty = true;
    return newClip;
  }

  deletePose(id: string): boolean {
    const index = this.library.poses.findIndex(p => p.id === id);
    if (index === -1) return false;
    this.library.poses.splice(index, 1);
    this.dirty = true;
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // Choreographies
  // ─────────────────────────────────────────────────────────────

  getAllChoreographies(): Choreography[] {
    return [...this.library.choreographies];
  }

  getChoreography(id: string): Choreography | undefined {
    return this.library.choreographies.find(c => c.id === id);
  }

  findChoreographiesByStyle(style: DanceStyle): Choreography[] {
    return this.library.choreographies.filter(c => c.style === style);
  }

  addChoreography(choreo: Omit<Choreography, "id" | "created_at">): Choreography {
    const newChoreo: Choreography = {
      ...choreo,
      id: generateId(),
      created_at: new Date().toISOString()
    };
    this.library.choreographies.push(newChoreo);
    this.dirty = true;
    return newChoreo;
  }

  updateChoreography(id: string, updates: Partial<Omit<Choreography, "id" | "created_at">>): Choreography | undefined {
    const index = this.library.choreographies.findIndex(c => c.id === id);
    if (index === -1) return undefined;
    this.library.choreographies[index] = { ...this.library.choreographies[index], ...updates };
    this.dirty = true;
    return this.library.choreographies[index];
  }

  deleteChoreography(id: string): boolean {
    const index = this.library.choreographies.findIndex(c => c.id === id);
    if (index === -1) return false;
    this.library.choreographies.splice(index, 1);
    this.dirty = true;
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // Utils
  // ─────────────────────────────────────────────────────────────

  isDirty(): boolean {
    return this.dirty;
  }

  async reset(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
    await this.load();
    this.dirty = false;
  }

  getStats(): { animations: number; poses: number; choreographies: number } {
    return {
      animations: this.library.animations.length,
      poses: this.library.poses.length,
      choreographies: this.library.choreographies.length
    };
  }
}

// Singleton
let instance: DanceLibraryManager | null = null;

export const getDanceLibrary = (): DanceLibraryManager => {
  if (!instance) {
    instance = new DanceLibraryManager();
  }
  return instance;
};

export const initDanceLibrary = async (): Promise<DanceLibraryManager> => {
  const library = getDanceLibrary();
  await library.load();
  return library;
};
