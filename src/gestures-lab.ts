/**
 * Gestures Lab - Entry point for gesture authoring
 */

import { TalkingHead } from "@met4citizen/talkinghead";
import {
  loadAvatarList,
  resolveAvatarUrl,
  findAvatarEntry,
  getAvatarLabel,
  type AvatarManifestEntry
} from "./avatar/avatar-loader";
import {
  GestureLibraryManager,
  initGestureLibrary
} from "./gestures/library";
import {
  BUILTIN_GESTURES,
  GESTURE_TAGS,
  type GestureClip
} from "./gestures/types";
import {
  initDanceLibrary,
  type DanceLibraryManager
} from "./dance/library";
import type { AnimationClip } from "./dance/types";

// Elements
const els = {
  avatar: document.getElementById("avatar") as HTMLElement,
  avatarSelect: document.getElementById("avatarSelect") as HTMLSelectElement,
  heroDesc: document.getElementById("heroDesc") as HTMLElement,
  clipName: document.getElementById("clipName") as HTMLInputElement,
  clipDescription: document.getElementById("clipDescription") as HTMLTextAreaElement,
  clipDuration: document.getElementById("clipDuration") as HTMLInputElement,
  gestureGrid: document.getElementById("gestureGrid") as HTMLElement,
  emojiGrid: document.getElementById("emojiGrid") as HTMLElement,
  moodSelect: document.getElementById("moodSelect") as HTMLSelectElement,
  tagList: document.getElementById("tagList") as HTMLElement,
  previewBtn: document.getElementById("previewBtn") as HTMLButtonElement,
  saveBtn: document.getElementById("saveBtn") as HTMLButtonElement,
  libraryList: document.getElementById("libraryList") as HTMLElement,
  exportBtn: document.getElementById("exportBtn") as HTMLButtonElement,
  importBtn: document.getElementById("importBtn") as HTMLButtonElement,
  importFile: document.getElementById("importFile") as HTMLInputElement,
  status: document.getElementById("status") as HTMLElement,
  morphGrid: document.getElementById("morphGrid") as HTMLElement,
  resetMorphsBtn: document.getElementById("resetMorphsBtn") as HTMLButtonElement,
  animationGrid: document.getElementById("animationGrid") as HTMLElement,
  stopAnimBtn: document.getElementById("stopAnimBtn") as HTMLButtonElement
};

// Full ARKit blendshape list (52 shapes)
const ARKIT_BLENDSHAPES = [
  // Eyes (14)
  "eyeBlinkLeft", "eyeBlinkRight",
  "eyeLookDownLeft", "eyeLookDownRight",
  "eyeLookInLeft", "eyeLookInRight",
  "eyeLookOutLeft", "eyeLookOutRight",
  "eyeLookUpLeft", "eyeLookUpRight",
  "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight",
  // Jaw (4)
  "jawForward", "jawLeft", "jawRight", "jawOpen",
  // Mouth (22)
  "mouthClose", "mouthFunnel", "mouthPucker",
  "mouthLeft", "mouthRight",
  "mouthSmileLeft", "mouthSmileRight",
  "mouthFrownLeft", "mouthFrownRight",
  "mouthDimpleLeft", "mouthDimpleRight",
  "mouthStretchLeft", "mouthStretchRight",
  "mouthRollLower", "mouthRollUpper",
  "mouthShrugLower", "mouthShrugUpper",
  "mouthPressLeft", "mouthPressRight",
  "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  // Brows (5)
  "browDownLeft", "browDownRight",
  "browInnerUp",
  "browOuterUpLeft", "browOuterUpRight",
  // Cheeks & Nose (5)
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "noseSneerLeft", "noseSneerRight",
  // Tongue (1)
  "tongueOut"
] as const;

// Track morph slider values
const morphValues: Record<string, number> = {};

// State
let head: TalkingHead | null = null;
let library: GestureLibraryManager | null = null;
let danceLibrary: DanceLibraryManager | null = null;
let avatarBaseUrl: string | null = null;
let avatarManifest: AvatarManifestEntry[] = [];
let selectedGesture: string | null = null;
let selectedEmoji: string | null = null;
let selectedTags: Set<string> = new Set();
let selectedClipId: string | null = null;

// Common emojis for expressions
const EMOJIS = [
  "😊", "😄", "😃", "🙂", "😐", "😕", "😢", "😭",
  "😠", "😡", "🤔", "😳", "😮", "😯", "🤨", "😏",
  "😴", "🥱", "😎", "🤩", "😍", "🥰", "😇", "🤗",
  "👋", "👍", "👎", "👏", "🙏", "💪", "🤷", "🤦"
];

const updateStatus = (msg: string) => {
  els.status.textContent = msg;
};

const createHead = async () => {
  head = new TalkingHead(els.avatar, {
    ttsEndpoint: "N/A",
    // No lipsync needed for gesture preview - disable to prevent init loop
    lipsyncLang: "",
    // Close-up head view for expression authoring
    cameraView: "head",
    cameraDistance: 0.25,
    cameraX: 0,
    cameraY: 0.08,  // Slightly higher for better framing
    cameraRotateEnable: true,
    cameraPanEnable: true,  // Enable panning for adjustments
    mixerGainSpeech: 3,
    // Special lighting for facial expressions - softer, more flattering
    lightAmbientIntensity: 0.5,
    lightDirectIntensity: 0.6,
    lightSpotIntensity: 12
  });
  return head;
};

// Mesh patterns to HIDE (body/outfit parts) - case insensitive
const BODY_MESH_PATTERNS = [
  "body", "outfit", "bottom", "top", "footwear", "shoes",
  "wolf3d_body", "wolf3d_outfit", "avatarbody"
];

// Check if mesh should be visible (head-related)
const isHeadMesh = (name: string): boolean => {
  const lower = name.toLowerCase();

  // Hide body/outfit meshes
  for (const pattern of BODY_MESH_PATTERNS) {
    if (lower.includes(pattern)) return false;
  }

  // Show head-related meshes
  if (lower.includes("head")) return true;
  if (lower.includes("eye")) return true;
  if (lower.includes("cornea")) return true;
  if (lower.includes("teeth")) return true;
  if (lower.includes("tongue")) return true;
  if (lower.includes("hair")) return true;
  if (lower.includes("eyelash")) return true;
  if (lower.includes("glasses")) return true;
  if (lower.includes("hat")) return true;
  if (lower.includes("earring")) return true;
  if (lower.includes("necklace")) return true;
  if (lower.includes("wolf3d_head")) return true;
  if (lower.includes("wolf3d_teeth")) return true;
  if (lower.includes("wolf3d_hair")) return true;
  if (lower.includes("wolf3d_glasses")) return true;
  if (lower.includes("wolf3d_avatar")) return true;  // Full avatar mesh

  // Unknown mesh patterns (Mesh_1, Mesh_2, etc) - hide by default
  if (lower.startsWith("mesh_")) return false;

  // Default: hide unknown meshes
  return false;
};

const loadAvatar = async (name: string) => {
  if (!head) return;
  const avatarEntry = findAvatarEntry(avatarManifest, name);
  const avatarLabel = avatarEntry ? getAvatarLabel(avatarEntry) : name;
  updateStatus(`Loading ${avatarLabel}...`);
  await head.showAvatar({
    url: resolveAvatarUrl(avatarEntry?.file || name, avatarBaseUrl),
    body: avatarEntry?.body || "F",
    avatarMood: avatarEntry?.default_mood || "neutral"
  });

  // Hide body meshes, show only head for expression authoring
  const headInternal = head as unknown as {
    scene?: { traverse: (cb: (obj: unknown) => void) => void };
    animMoods: Record<string, unknown>;
    setMood: (mood: string) => void;
  };

  if (headInternal.scene && typeof headInternal.scene.traverse === "function") {
    const meshNames: string[] = [];
    headInternal.scene.traverse((obj: unknown) => {
      const mesh = obj as { isMesh?: boolean; isSkinnedMesh?: boolean; name?: string; visible?: boolean };
      if ((mesh.isMesh || mesh.isSkinnedMesh) && mesh.name) {
        meshNames.push(mesh.name);
      }
    });
    console.log("[GesturesLab] Available meshes:", meshNames);

    // Now hide body meshes based on actual names found
    headInternal.scene.traverse((obj: unknown) => {
      const mesh = obj as { isMesh?: boolean; isSkinnedMesh?: boolean; name?: string; visible?: boolean };
      if ((mesh.isMesh || mesh.isSkinnedMesh) && mesh.name) {
        mesh.visible = isHeadMesh(mesh.name);
      }
    });
  }

  // Start render loop (required to see avatar)
  head.start();

  // Create a completely static mood - no breathing, blinking, or any animations
  headInternal.animMoods["static"] = {
    baseline: {},
    speech: { deltaRate: 0, deltaPitch: 0, deltaVolume: 0 },
    anims: []  // No animations at all
  };
  headInternal.setMood("static");

  // Set persistent eye contact - look at camera
  head.makeEyeContact(Infinity);

  updateStatus(`Avatar loaded: ${avatarLabel}`);
};

const buildGestureGrid = () => {
  els.gestureGrid.innerHTML = "";
  BUILTIN_GESTURES.forEach((gesture) => {
    const btn = document.createElement("button");
    btn.className = "gesture-btn";
    btn.textContent = gesture;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".gesture-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedGesture = gesture;
    });
    els.gestureGrid.appendChild(btn);
  });
};

const buildEmojiGrid = () => {
  els.emojiGrid.innerHTML = "";
  EMOJIS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.className = "emoji-btn";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".emoji-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedEmoji = emoji;
    });
    els.emojiGrid.appendChild(btn);
  });
};

const buildTagList = () => {
  els.tagList.innerHTML = "";
  GESTURE_TAGS.forEach((tag) => {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = tag;
    el.addEventListener("click", () => {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
        el.classList.remove("active");
      } else {
        selectedTags.add(tag);
        el.classList.add("active");
      }
    });
    els.tagList.appendChild(el);
  });
};

const renderLibraryList = () => {
  if (!library) return;
  const clips = library.getAll();
  els.libraryList.innerHTML = "";

  if (clips.length === 0) {
    els.libraryList.innerHTML = '<div style="color: var(--muted); font-size: 12px;">No clips yet. Create one above.</div>';
    return;
  }

  clips.forEach((clip) => {
    const item = document.createElement("div");
    item.className = "library-item" + (clip.id === selectedClipId ? " active" : "");
    item.innerHTML = `
      <div class="library-item-name">${clip.name}</div>
      <div class="library-item-tags">${clip.tags.join(", ") || "No tags"}</div>
    `;
    item.addEventListener("click", () => {
      selectedClipId = clip.id;
      loadClipToEditor(clip);
      renderLibraryList();
    });
    els.libraryList.appendChild(item);
  });
};

const loadClipToEditor = (clip: GestureClip) => {
  els.clipName.value = clip.name;
  els.clipDescription.value = clip.description || "";
  els.clipDuration.value = String(clip.duration_ms);
  els.moodSelect.value = clip.mood || "";

  // Gesture
  selectedGesture = clip.gesture?.name || null;
  document.querySelectorAll(".gesture-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.textContent === selectedGesture);
  });

  // Emoji
  selectedEmoji = clip.emoji || null;
  document.querySelectorAll(".emoji-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.textContent === selectedEmoji);
  });

  // Tags
  selectedTags = new Set(clip.tags);
  document.querySelectorAll(".tag").forEach((tag) => {
    tag.classList.toggle("active", selectedTags.has(tag.textContent || ""));
  });

  updateStatus(`Loaded: ${clip.name}`);
};

const getCurrentClipData = (): Omit<GestureClip, "id" | "created_at"> => {
  const duration = parseInt(els.clipDuration.value, 10) || 2000;
  const mood = els.moodSelect.value || undefined;

  return {
    name: els.clipName.value || "Untitled Clip",
    description: els.clipDescription.value || undefined,
    duration_ms: duration,
    tags: Array.from(selectedTags),
    gesture: selectedGesture ? {
      name: selectedGesture,
      duration: duration / 1000
    } : undefined,
    emoji: selectedEmoji || undefined,
    mood: mood as GestureClip["mood"]
  };
};

const previewClip = async () => {
  if (!head) return;
  const clip = getCurrentClipData();

  updateStatus("Previewing...");

  if (clip.mood) {
    head.setMood(clip.mood);
  }

  if (clip.emoji) {
    head.speakEmoji(clip.emoji);
  }

  if (clip.gesture) {
    head.playGesture(clip.gesture.name, clip.gesture.duration || 2.5);
  }

  setTimeout(() => {
    updateStatus("Preview complete");
    // Reset eye contact after gesture
    if (head) {
      head.makeEyeContact(Infinity);
    }
  }, clip.duration_ms);
};

const saveClip = () => {
  if (!library) return;
  const data = getCurrentClipData();

  if (!data.name || data.name === "Untitled Clip") {
    updateStatus("Please enter a clip name");
    return;
  }

  if (selectedClipId) {
    // Update existing
    library.update(selectedClipId, data);
    updateStatus(`Updated: ${data.name}`);
  } else {
    // Create new
    const clip = library.add(data);
    selectedClipId = clip.id;
    updateStatus(`Saved: ${data.name}`);
  }

  library.save();
  renderLibraryList();
};

const exportLibrary = () => {
  if (!library) return;
  const json = library.export();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gesture-library.json";
  a.click();
  URL.revokeObjectURL(url);
  updateStatus("Library exported");
};

const importLibrary = async (file: File) => {
  if (!library) return;
  const text = await file.text();
  if (library.import(text)) {
    library.save();
    renderLibraryList();
    updateStatus("Library imported");
  } else {
    updateStatus("Invalid library file");
  }
};

const buildAnimationGrid = () => {
  if (!danceLibrary) return;
  els.animationGrid.innerHTML = "";

  // Get all animation types
  const allAnims: AnimationClip[] = [
    ...danceLibrary.getAllAnimations(),
    ...danceLibrary.getExpressions(),
    ...danceLibrary.getIdleAnimations(),
    ...danceLibrary.getLocomotion()
  ];

  if (allAnims.length === 0) {
    els.animationGrid.innerHTML = '<div style="color: var(--muted); font-size: 12px;">No animations in library.</div>';
    return;
  }

  allAnims.forEach((anim) => {
    const btn = document.createElement("button");
    btn.className = "gesture-btn";
    btn.style.fontSize = "10px";
    btn.style.padding = "8px 4px";
    btn.textContent = anim.name;
    btn.title = anim.description || anim.url;

    btn.addEventListener("click", () => {
      if (!head) return;
      updateStatus(`Playing: ${anim.name}`);

      // Need to start animation loop for playback
      head.start();

      head.playAnimation(
        anim.url,
        null,  // onprogress
        anim.duration_ms / 1000,
        0,     // ndx
        0.01   // scale
      );

      // Return to static after animation
      setTimeout(() => {
        if (head) {
          const headAny = head as unknown as { setMood: (mood: string) => void };
          headAny.setMood("static");
          head.makeEyeContact(Infinity);
        }
        updateStatus("Ready");
      }, anim.duration_ms);
    });

    els.animationGrid.appendChild(btn);
  });

  // Stop animation button
  els.stopAnimBtn.addEventListener("click", () => {
    if (head) {
      head.stopAnimation();
      const headAny = head as unknown as { setMood: (mood: string) => void };
      headAny.setMood("static");
      head.makeEyeContact(Infinity);
      updateStatus("Animation stopped");
    }
  });
};

const buildMorphGrid = () => {
  els.morphGrid.innerHTML = "";

  ARKIT_BLENDSHAPES.forEach((shape) => {
    morphValues[shape] = 0;

    const row = document.createElement("div");
    row.className = "slider-row";

    const label = document.createElement("label");
    label.textContent = shape;
    label.style.fontSize = "10px";
    label.style.flex = "0 0 120px";

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = "0";
    input.id = `morph_${shape}`;

    const val = document.createElement("span");
    val.className = "val";
    val.textContent = "0";

    input.addEventListener("input", () => {
      const value = parseFloat(input.value);
      morphValues[shape] = value;
      val.textContent = value.toFixed(2);
      if (head) {
        head.setValue(shape, value);
      }
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(val);
    els.morphGrid.appendChild(row);
  });

  // Reset button
  els.resetMorphsBtn.addEventListener("click", () => {
    ARKIT_BLENDSHAPES.forEach((shape) => {
      morphValues[shape] = 0;
      const input = document.getElementById(`morph_${shape}`) as HTMLInputElement;
      if (input) {
        input.value = "0";
        const val = input.nextElementSibling as HTMLElement;
        if (val) val.textContent = "0";
      }
      if (head) {
        head.setValue(shape, 0);
      }
    });
    updateStatus("Morphs reset");
  });
};

const init = async () => {
  updateStatus("Initializing...");

  // Create head
  await createHead();

  // Load avatar list
  const { avatars, baseUrl } = await loadAvatarList(els.avatarSelect);
  avatarManifest = avatars;
  avatarBaseUrl = baseUrl;

  // Load initial avatar
  if (avatars.length > 0) {
    await loadAvatar(avatars[0].file);
  }

  // Avatar change
  els.avatarSelect.addEventListener("change", () => {
    loadAvatar(els.avatarSelect.value);
  });

  // Build UI
  buildGestureGrid();
  buildEmojiGrid();
  buildTagList();
  buildMorphGrid();

  // Load libraries
  library = await initGestureLibrary();
  danceLibrary = await initDanceLibrary();
  renderLibraryList();
  buildAnimationGrid();

  // Buttons
  els.previewBtn.addEventListener("click", previewClip);
  els.saveBtn.addEventListener("click", saveClip);
  els.exportBtn.addEventListener("click", exportLibrary);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", () => {
    const file = els.importFile.files?.[0];
    if (file) importLibrary(file);
  });

  updateStatus("Ready");
};

init().catch((err) => {
  console.error("Init error:", err);
  updateStatus("Error: " + err.message);
});
