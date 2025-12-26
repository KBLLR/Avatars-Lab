/**
 * Gestures Lab - Entry point for gesture authoring
 */

import { TalkingHead } from "@met4citizen/talkinghead";
import { loadAvatarList, resolveAvatarUrl } from "./avatar/avatar-loader";
import {
  GestureLibraryManager,
  initGestureLibrary
} from "./gestures/library";
import {
  BUILTIN_GESTURES,
  GESTURE_TAGS,
  type GestureClip
} from "./gestures/types";

// Elements
const els = {
  avatar: document.getElementById("avatar") as HTMLElement,
  avatarSelect: document.getElementById("avatarSelect") as HTMLSelectElement,
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
  // Morph sliders
  morphBrowInnerUp: document.getElementById("morphBrowInnerUp") as HTMLInputElement,
  morphBrowInnerUpVal: document.getElementById("morphBrowInnerUpVal") as HTMLElement,
  morphEyeSquint: document.getElementById("morphEyeSquint") as HTMLInputElement,
  morphEyeSquintVal: document.getElementById("morphEyeSquintVal") as HTMLElement,
  morphMouthSmile: document.getElementById("morphMouthSmile") as HTMLInputElement,
  morphMouthSmileVal: document.getElementById("morphMouthSmileVal") as HTMLElement,
  morphJawOpen: document.getElementById("morphJawOpen") as HTMLInputElement,
  morphJawOpenVal: document.getElementById("morphJawOpenVal") as HTMLElement
};

// State
let head: TalkingHead | null = null;
let library: GestureLibraryManager | null = null;
let avatarBaseUrl: string | null = null;
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
    cameraView: "upper",
    cameraDistance: 0.6,
    cameraX: 0,
    cameraY: 0,
    cameraRotateEnable: true,
    mixerGainSpeech: 3,
    lightAmbientIntensity: 0.2,
    lightDirectIntensity: 1,
    lightSpotIntensity: 20
  });
  return head;
};

const loadAvatar = async (name: string) => {
  if (!head) return;
  updateStatus(`Loading ${name}...`);
  await head.showAvatar({
    url: resolveAvatarUrl(name, avatarBaseUrl),
    body: "F",
    avatarMood: "neutral"
  });
  head.start();
  updateStatus(`Avatar loaded: ${name}`);
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

const bindMorphSliders = () => {
  const morphSliders = [
    { input: els.morphBrowInnerUp, val: els.morphBrowInnerUpVal, target: "browInnerUp" },
    { input: els.morphEyeSquint, val: els.morphEyeSquintVal, target: "eyeSquintLeft" },
    { input: els.morphMouthSmile, val: els.morphMouthSmileVal, target: "mouthSmileLeft" },
    { input: els.morphJawOpen, val: els.morphJawOpenVal, target: "jawOpen" }
  ];

  morphSliders.forEach(({ input, val, target }) => {
    input.addEventListener("input", () => {
      const value = parseFloat(input.value);
      val.textContent = value.toFixed(2);
      if (head) {
        head.setValue(target, value);
      }
    });
  });
};

const init = async () => {
  updateStatus("Initializing...");

  // Create head
  await createHead();

  // Load avatar list
  const { avatars, baseUrl } = await loadAvatarList(els.avatarSelect);
  avatarBaseUrl = baseUrl;

  // Load initial avatar
  if (avatars.length > 0) {
    await loadAvatar(avatars[0]);
  }

  // Avatar change
  els.avatarSelect.addEventListener("change", () => {
    loadAvatar(els.avatarSelect.value);
  });

  // Build UI
  buildGestureGrid();
  buildEmojiGrid();
  buildTagList();
  bindMorphSliders();

  // Load library
  library = await initGestureLibrary();
  renderLibraryList();

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
