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
const CATALOG_URL = "/performance-assets/catalog.json";
const STORAGE_KEY = "avatarLabs.danceLibrary.v2";

interface CatalogAnimationEntry {
  id: string;
  label: string;
  url: string;
  durationMs: number;
  loop: boolean;
  category: "idle" | "dance" | "locomotion" | "gesture" | "action";
  source: string;
  origin?: string;
  rig: string;
  body: string;
  tags: string[];
}

const inferDanceStylesAndMoods = (label: string, category: string, origin?: string): string[] => {
  const lower = label.toLowerCase();
  const extra: string[] = [];
  if (category === "dance") {
    if (lower.includes("salsa")) extra.push("salsa", "sensual", "smooth");
    else if (lower.includes("northern soul") || lower.includes("spin") || lower.includes("floor")) {
      extra.push("house", "breaking", "energetic", "dramatic");
    } else if (lower.includes("shuffl")) {
      extra.push("shuffling", "house", "energetic", "playful");
    } else if (lower.includes("hip hop") || lower.includes("street") || origin === "m2mr") {
      extra.push("hip-hop", "freestyle", "energetic", "smooth");
    } else if (lower.includes("maraschino") || lower.includes("wave")) {
      extra.push("popping", "wave", "playful", "quirky");
    } else {
      extra.push("freestyle", "hip-hop", "house", "contemporary", "energetic", "playful", "chill");
    }
  } else if (category === "gesture") {
    extra.push("freestyle", "playful", "chill");
  } else if (category === "idle") {
    extra.push("chill", "smooth");
  }
  return extra;
};

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
    // Load static JSON template first (for choreographies and poses)
    try {
      const response = await fetch(LIBRARY_URL);
      if (response.ok) {
        this.library = await response.json();
      }
    } catch {
      console.warn("Failed to load dance library from", LIBRARY_URL);
    }

    // Hydrate real FBX clips from the live performance-assets catalog
    try {
      const catalogRes = await fetch(CATALOG_URL, { cache: "no-store" });
      if (catalogRes.ok) {
        const payload = await catalogRes.json();
        const entries: CatalogAnimationEntry[] = Array.isArray(payload?.animations)
          ? payload.animations
          : [];
        if (entries.length > 0) {
          const now = new Date().toISOString();
          const mapClip = (entry: CatalogAnimationEntry, typeOverride?: AnimationClip["type"]): AnimationClip => {
            const styleMoodTags = inferDanceStylesAndMoods(entry.label, entry.category, entry.origin);
            const mergedTags = Array.from(new Set([...(entry.tags || []), ...styleMoodTags]));
            return {
              id: entry.id,
              name: entry.origin === "m2mr" ? `${entry.label} [M2MR]` : entry.label,
              description: `${entry.source} (${entry.rig} rig, ${entry.body} body)`,
              url: entry.url,
              source: entry.origin === "m2mr" ? "custom" : "mixamo",
              type: typeOverride || (entry.category === "locomotion" ? "transition" : entry.category === "action" ? "gesture" : entry.category),
              duration_ms: entry.durationMs || 5000,
              bpm: entry.category === "dance" ? 120 : undefined,
              loopable: Boolean(entry.loop),
              tags: mergedTags,
              mood: mergedTags.includes("energetic") ? "happy" : "neutral",
              intensity: entry.category === "dance" ? "high" : entry.category === "idle" ? "low" : "medium",
              created_at: now,
            };
          };

          const danceEntries = entries.filter((e) => e.category === "dance" || e.origin === "m2mr");
          const idleEntries = entries.filter((e) => e.category === "idle");
          const gestureEntries = entries.filter((e) => e.category === "gesture" || e.category === "action");
          const locomotionEntries = entries.filter((e) => e.category === "locomotion");

          this.library.animations = [
            ...danceEntries.map((e) => mapClip(e, "dance")),
            ...gestureEntries.slice(0, 10).map((e) => mapClip(e, "gesture")),
          ];
          this.library.idle = idleEntries.map((e) => mapClip(e, "idle"));
          this.library.expressions = gestureEntries.map((e) => mapClip(e, "gesture"));
          this.library.locomotion = locomotionEntries.map((e) => mapClip(e, "transition"));

          // Ensure poses point to valid live FBX clips
          const defaultIdleUrl = this.library.idle[0]?.url || entries[0]?.url || "";
          const defaultDanceUrl = this.library.animations[0]?.url || defaultIdleUrl;
          this.library.poses = (this.library.poses || []).map((pose, idx) => ({
            ...pose,
            url: pose.url.startsWith("/animations/")
              ? (this.library.expressions?.[idx % Math.max(1, this.library.expressions.length)]?.url || defaultDanceUrl)
              : pose.url,
          }));

          // Remap template choreographies to valid live clip IDs
          const validDanceIds = this.library.animations.map((a) => a.id);
          if (validDanceIds.length > 0) {
            this.library.choreographies = (this.library.choreographies || []).map((choreo) => ({
              ...choreo,
              steps: (choreo.steps || []).map((step, idx) => ({
                ...step,
                clip_id: this.library.animations.some((a) => a.id === step.clip_id)
                  ? step.clip_id
                  : validDanceIds[idx % validDanceIds.length],
              })),
            }));
          }
        }
      }
    } catch {
      console.warn("Failed to hydrate dance library from", CATALOG_URL);
    }

    // Merge user-saved custom choreographies/clips from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed: DanceLibrary = JSON.parse(stored);
        if (Array.isArray(parsed.choreographies) && parsed.choreographies.length > 0) {
          this.library.choreographies = parsed.choreographies;
        }
      } catch {
        console.warn("Failed to parse stored dance library");
      }
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

  // ─────────────────────────────────────────────────────────────
  // Idle Animations
  // ─────────────────────────────────────────────────────────────

  getIdleAnimations(): AnimationClip[] {
    return [...(this.library.idle || [])];
  }

  getDefaultIdle(): AnimationClip | undefined {
    return this.library.idle?.[0];
  }

  // ─────────────────────────────────────────────────────────────
  // Expression Animations
  // ─────────────────────────────────────────────────────────────

  getExpressions(): AnimationClip[] {
    return [...(this.library.expressions || [])];
  }

  // ─────────────────────────────────────────────────────────────
  // Locomotion Animations
  // ─────────────────────────────────────────────────────────────

  getLocomotion(): AnimationClip[] {
    return [...(this.library.locomotion || [])];
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
