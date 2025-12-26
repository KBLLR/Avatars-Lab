/**
 * Dance Studio - Entry point for animation/choreography authoring
 *
 * Uses TalkingHead's playAnimation, playPose, and animQueue for
 * Mixamo-compatible FBX animations.
 */

import { TalkingHead } from "@met4citizen/talkinghead";
import { loadAvatarList, resolveAvatarUrl } from "./avatar/avatar-loader";
import {
  initDanceLibrary,
  type DanceLibraryManager
} from "./dance/library";
import { getDanceDirector, type DanceDirector } from "./dance/director";
import {
  DANCE_STYLES,
  DANCE_MOODS,
  type AnimationClip,
  type PoseClip,
  type Choreography,
  type ChoreographyStep,
  type DanceStyle,
  type DanceMood
} from "./dance/types";

// Elements
const els = {
  avatar: document.getElementById("avatar") as HTMLElement,
  avatarSelect: document.getElementById("avatarSelect") as HTMLSelectElement,
  // Style & Mood
  styleGrid: document.getElementById("styleGrid") as HTMLElement,
  moodGrid: document.getElementById("moodGrid") as HTMLElement,
  bpmSlider: document.getElementById("bpmSlider") as HTMLInputElement,
  bpmVal: document.getElementById("bpmVal") as HTMLElement,
  intensitySelect: document.getElementById("intensitySelect") as HTMLSelectElement,
  generateBtn: document.getElementById("generateBtn") as HTMLButtonElement,
  // Animation library
  animationList: document.getElementById("animationList") as HTMLElement,
  addAnimationBtn: document.getElementById("addAnimationBtn") as HTMLButtonElement,
  importFbxBtn: document.getElementById("importFbxBtn") as HTMLButtonElement,
  fbxFile: document.getElementById("fbxFile") as HTMLInputElement,
  // Poses
  poseList: document.getElementById("poseList") as HTMLElement,
  addPoseBtn: document.getElementById("addPoseBtn") as HTMLButtonElement,
  // Choreography
  choreoName: document.getElementById("choreoName") as HTMLInputElement,
  stepsList: document.getElementById("stepsList") as HTMLElement,
  clearStepsBtn: document.getElementById("clearStepsBtn") as HTMLButtonElement,
  saveChoreoBtn: document.getElementById("saveChoreoBtn") as HTMLButtonElement,
  choreographyList: document.getElementById("choreographyList") as HTMLElement,
  exportChoreoBtn: document.getElementById("exportChoreoBtn") as HTMLButtonElement,
  importChoreoBtn: document.getElementById("importChoreoBtn") as HTMLButtonElement,
  importFile: document.getElementById("importFile") as HTMLInputElement,
  // Timeline
  timelineTrack: document.getElementById("timelineTrack") as HTMLElement,
  playhead: document.getElementById("playhead") as HTMLElement,
  playBtn: document.getElementById("playBtn") as HTMLButtonElement,
  stopBtn: document.getElementById("stopBtn") as HTMLButtonElement,
  timeDisplay: document.getElementById("timeDisplay") as HTMLElement,
  // Playback
  speedSlider: document.getElementById("speedSlider") as HTMLInputElement,
  speedVal: document.getElementById("speedVal") as HTMLElement,
  loopToggle: document.getElementById("loopToggle") as HTMLInputElement,
  playSelectedBtn: document.getElementById("playSelectedBtn") as HTMLButtonElement,
  queueBtn: document.getElementById("queueBtn") as HTMLButtonElement,
  // Tabs
  tabs: document.querySelectorAll(".tab") as NodeListOf<HTMLButtonElement>,
  tabContents: document.querySelectorAll(".tab-content") as NodeListOf<HTMLElement>,
  // Status
  status: document.getElementById("status") as HTMLElement
};

// State
let head: TalkingHead | null = null;
let library: DanceLibraryManager | null = null;
let director: DanceDirector | null = null;
let avatarBaseUrl: string | null = null;

let selectedStyle: DanceStyle = "freestyle";
let selectedMood: DanceMood = "energetic";
let selectedAnimationId: string | null = null;
let selectedPoseId: string | null = null;
let selectedChoreographyId: string | null = null;

let currentChoreography: Choreography | null = null;
let isPlaying = false;
let playbackStart = 0;
let animationFrameId: number | null = null;

const updateStatus = (msg: string) => {
  els.status.textContent = msg;
};

const formatTime = (ms: number): string => {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

// ─────────────────────────────────────────────────────────────
// Head Management
// ─────────────────────────────────────────────────────────────

const createHead = async () => {
  head = new TalkingHead(els.avatar, {
    ttsEndpoint: "N/A",
    // No lipsync needed for dance studio - disable to prevent init loop
    lipsyncLang: "",
    cameraView: "full",
    cameraDistance: 1.2,
    cameraX: 0,
    cameraY: -0.1,
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

// ─────────────────────────────────────────────────────────────
// UI Builders
// ─────────────────────────────────────────────────────────────

const buildStyleGrid = () => {
  els.styleGrid.innerHTML = "";
  DANCE_STYLES.forEach((style) => {
    const btn = document.createElement("button");
    btn.className = "style-btn" + (style === selectedStyle ? " active" : "");
    btn.textContent = style;
    btn.addEventListener("click", () => {
      selectedStyle = style;
      document.querySelectorAll(".style-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      director?.setConfig({ style });
    });
    els.styleGrid.appendChild(btn);
  });
};

const buildMoodGrid = () => {
  els.moodGrid.innerHTML = "";
  DANCE_MOODS.forEach((mood) => {
    const btn = document.createElement("button");
    btn.className = "mood-btn" + (mood === selectedMood ? " active" : "");
    btn.textContent = mood;
    btn.addEventListener("click", () => {
      selectedMood = mood;
      document.querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      director?.setConfig({ mood });
    });
    els.moodGrid.appendChild(btn);
  });
};

const renderAnimationList = () => {
  if (!library) return;
  const animations = library.getAllAnimations();
  els.animationList.innerHTML = "";

  if (animations.length === 0) {
    els.animationList.innerHTML = '<div class="empty-state">No animations. Add some FBX files.</div>';
    return;
  }

  animations.forEach((anim) => {
    const item = document.createElement("div");
    item.className = "library-item" + (anim.id === selectedAnimationId ? " active" : "");
    item.innerHTML = `
      <div class="library-item-info">
        <div class="library-item-name">${anim.name}</div>
        <div class="library-item-meta">${anim.type} | ${anim.duration_ms}ms | ${anim.tags.join(", ") || "no tags"}</div>
      </div>
      <div class="library-item-actions">
        <button class="play-anim-btn">Play</button>
        <button class="add-step-btn">+</button>
      </div>
    `;

    item.querySelector(".play-anim-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      playAnimation(anim);
    });

    item.querySelector(".add-step-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      addStepToChoreography(anim.id, anim.duration_ms);
    });

    item.addEventListener("click", () => {
      selectedAnimationId = anim.id;
      renderAnimationList();
    });

    els.animationList.appendChild(item);
  });
};

const renderPoseList = () => {
  if (!library) return;
  const poses = library.getAllPoses();
  els.poseList.innerHTML = "";

  if (poses.length === 0) {
    els.poseList.innerHTML = '<div class="empty-state">No poses yet.</div>';
    return;
  }

  poses.forEach((pose) => {
    const item = document.createElement("div");
    item.className = "library-item" + (pose.id === selectedPoseId ? " active" : "");
    item.innerHTML = `
      <div class="library-item-info">
        <div class="library-item-name">${pose.name}</div>
        <div class="library-item-meta">${pose.duration_ms}ms | ${pose.tags.join(", ") || "no tags"}</div>
      </div>
      <div class="library-item-actions">
        <button class="play-pose-btn">Play</button>
      </div>
    `;

    item.querySelector(".play-pose-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      playPose(pose);
    });

    item.addEventListener("click", () => {
      selectedPoseId = pose.id;
      renderPoseList();
    });

    els.poseList.appendChild(item);
  });
};

const renderChoreographyList = () => {
  if (!library) return;
  const choreographies = library.getAllChoreographies();
  els.choreographyList.innerHTML = "";

  if (choreographies.length === 0) {
    els.choreographyList.innerHTML = '<div class="empty-state">No saved choreographies.</div>';
    return;
  }

  choreographies.forEach((choreo) => {
    const item = document.createElement("div");
    item.className = "library-item" + (choreo.id === selectedChoreographyId ? " active" : "");
    item.innerHTML = `
      <div class="library-item-info">
        <div class="library-item-name">${choreo.name}</div>
        <div class="library-item-meta">${choreo.style} | ${choreo.steps.length} steps | ${formatTime(choreo.duration_ms)}</div>
      </div>
      <div class="library-item-actions">
        <button class="load-choreo-btn">Load</button>
        <button class="play-choreo-btn">Play</button>
      </div>
    `;

    item.querySelector(".load-choreo-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      loadChoreography(choreo);
    });

    item.querySelector(".play-choreo-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      loadChoreography(choreo);
      playChoreography();
    });

    item.addEventListener("click", () => {
      selectedChoreographyId = choreo.id;
      renderChoreographyList();
    });

    els.choreographyList.appendChild(item);
  });
};

const renderStepsList = () => {
  els.stepsList.innerHTML = "";

  if (!currentChoreography || currentChoreography.steps.length === 0) {
    els.stepsList.innerHTML = '<div class="empty-state">No steps. Add animations from the library.</div>';
    return;
  }

  currentChoreography.steps.forEach((step, index) => {
    const anim = library?.getAnimation(step.clip_id);
    const item = document.createElement("div");
    item.className = "step-item";
    item.innerHTML = `
      <span class="step-num">${index + 1}</span>
      <span class="step-name">${anim?.name || step.clip_id}</span>
      <span class="step-duration">${step.duration_ms}ms</span>
    `;
    els.stepsList.appendChild(item);
  });
};

const renderTimeline = () => {
  els.timelineTrack.innerHTML = '<div id="playhead" style="left: 0%"></div>';

  if (!currentChoreography || currentChoreography.duration_ms === 0) return;

  const totalDuration = currentChoreography.duration_ms;

  currentChoreography.steps.forEach((step) => {
    const anim = library?.getAnimation(step.clip_id);
    const clip = document.createElement("div");
    clip.className = "timeline-clip";
    const left = (step.start_ms / totalDuration) * 100;
    const width = ((step.duration_ms || 1000) / totalDuration) * 100;
    clip.style.left = `${left}%`;
    clip.style.width = `${width}%`;
    clip.textContent = anim?.name || "clip";
    els.timelineTrack.appendChild(clip);
  });

  // Re-add playhead
  const playhead = document.createElement("div");
  playhead.id = "playhead";
  playhead.style.left = "0%";
  els.timelineTrack.appendChild(playhead);
};

// ─────────────────────────────────────────────────────────────
// Playback
// ─────────────────────────────────────────────────────────────

const playAnimation = async (anim: AnimationClip) => {
  if (!head) return;
  updateStatus(`Playing: ${anim.name}`);

  const speed = parseFloat(els.speedSlider.value);

  // Use TalkingHead's playAnimation method
  head.playAnimation(
    anim.url,
    null, // progressCallback
    anim.duration_ms / 1000,
    null  // onComplete
  );
};

const playPose = async (pose: PoseClip) => {
  if (!head) return;
  updateStatus(`Posing: ${pose.name}`);

  head.playPose(
    pose.url,
    null,
    pose.duration_ms / 1000
  );
};

const playChoreography = () => {
  if (!head || !currentChoreography) {
    updateStatus("No choreography loaded");
    return;
  }

  if (isPlaying) {
    stopPlayback();
  }

  isPlaying = true;
  playbackStart = performance.now();
  updateStatus(`Playing: ${currentChoreography.name}`);

  // Queue all animations
  const animItems = director?.choreographyToAnimQueue(currentChoreography) || [];

  // Use animQueue approach: reset and enqueue
  // For now, play sequentially via timeouts (TalkingHead's animQueue can be used more directly)
  let cumulativeTime = 0;
  currentChoreography.steps.forEach((step) => {
    const anim = library?.getAnimation(step.clip_id);
    if (!anim) return;

    setTimeout(() => {
      if (!isPlaying) return;
      head?.playAnimation(
        anim.url,
        null,
        (step.duration_ms || anim.duration_ms) / 1000 * (step.speed || 1)
      );
    }, cumulativeTime);

    cumulativeTime += step.duration_ms || anim.duration_ms;
  });

  // Start playhead animation
  animatePlayhead();

  // Auto-stop at end
  setTimeout(() => {
    if (isPlaying && !els.loopToggle.checked) {
      stopPlayback();
      updateStatus("Playback complete");
    } else if (isPlaying && els.loopToggle.checked) {
      // Loop
      playChoreography();
    }
  }, currentChoreography.duration_ms);
};

const animatePlayhead = () => {
  if (!isPlaying || !currentChoreography) return;

  const elapsed = performance.now() - playbackStart;
  const progress = Math.min(elapsed / currentChoreography.duration_ms, 1);

  const playhead = document.getElementById("playhead");
  if (playhead) {
    playhead.style.left = `${progress * 100}%`;
  }

  els.timeDisplay.textContent = `${formatTime(elapsed)} / ${formatTime(currentChoreography.duration_ms)}`;

  if (progress < 1) {
    animationFrameId = requestAnimationFrame(animatePlayhead);
  }
};

const stopPlayback = () => {
  isPlaying = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  head?.stop();
  updateStatus("Stopped");
};

// ─────────────────────────────────────────────────────────────
// Choreography Management
// ─────────────────────────────────────────────────────────────

const createNewChoreography = () => {
  currentChoreography = {
    id: `choreo_${Date.now()}`,
    name: els.choreoName.value || "New Choreography",
    style: selectedStyle,
    mood: selectedMood,
    duration_ms: 0,
    steps: [],
    created_at: new Date().toISOString()
  };
  renderStepsList();
  renderTimeline();
};

const loadChoreography = (choreo: Choreography) => {
  currentChoreography = { ...choreo, steps: [...choreo.steps] };
  selectedChoreographyId = choreo.id;
  els.choreoName.value = choreo.name;
  renderStepsList();
  renderTimeline();
  renderChoreographyList();
  updateStatus(`Loaded: ${choreo.name}`);
};

const addStepToChoreography = (clipId: string, durationMs: number) => {
  if (!currentChoreography) {
    createNewChoreography();
  }

  const startMs = currentChoreography!.duration_ms;

  const step: ChoreographyStep = {
    clip_id: clipId,
    start_ms: startMs,
    duration_ms: durationMs,
    transition: "crossfade",
    transition_ms: 300
  };

  currentChoreography!.steps.push(step);
  currentChoreography!.duration_ms = startMs + durationMs;

  renderStepsList();
  renderTimeline();
  updateStatus(`Added step: ${clipId}`);
};

const clearChoreography = () => {
  if (!currentChoreography) return;
  currentChoreography.steps = [];
  currentChoreography.duration_ms = 0;
  renderStepsList();
  renderTimeline();
  updateStatus("Choreography cleared");
};

const saveChoreography = () => {
  if (!library || !currentChoreography) {
    updateStatus("Nothing to save");
    return;
  }

  currentChoreography.name = els.choreoName.value || "Untitled";
  currentChoreography.style = selectedStyle;
  currentChoreography.mood = selectedMood;

  if (selectedChoreographyId) {
    // Update existing
    library.updateChoreography(selectedChoreographyId, currentChoreography);
  } else {
    // Add new
    const saved = library.addChoreography(currentChoreography);
    selectedChoreographyId = saved.id;
    currentChoreography.id = saved.id;
  }

  library.save();
  renderChoreographyList();
  updateStatus(`Saved: ${currentChoreography.name}`);
};

const generateChoreography = () => {
  if (!director) return;

  const bpm = parseInt(els.bpmSlider.value, 10);
  const intensity = els.intensitySelect.value as "low" | "medium" | "high";

  director.setConfig({
    style: selectedStyle,
    mood: selectedMood,
    bpm,
    intensity
  });

  // Generate a 30-second choreography
  const result = director.generateChoreography(30000, `${selectedStyle} ${selectedMood}`);

  if (result.choreography.steps.length === 0) {
    updateStatus("No matching animations found. Add some to the library.");
    return;
  }

  currentChoreography = result.choreography;
  selectedChoreographyId = null;
  els.choreoName.value = currentChoreography.name;

  renderStepsList();
  renderTimeline();
  updateStatus(`Generated: ${result.choreography.name} (${result.clips.length} clips)`);
};

// ─────────────────────────────────────────────────────────────
// Import/Export
// ─────────────────────────────────────────────────────────────

const addDemoAnimation = () => {
  if (!library) return;

  // Add a demo animation entry (user would normally import FBX files)
  const clip = library.addAnimation({
    name: "Demo Dance",
    description: "Sample animation clip",
    url: "/animations/demo-dance.fbx",
    source: "mixamo",
    type: "dance",
    duration_ms: 5000,
    bpm: 120,
    loopable: true,
    tags: [selectedStyle, selectedMood]
  });

  library.save();
  renderAnimationList();
  updateStatus(`Added demo animation: ${clip.name}`);
};

const exportLibraryJson = () => {
  if (!library) return;
  const json = library.export();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dance-library.json";
  a.click();
  URL.revokeObjectURL(url);
  updateStatus("Library exported");
};

const importLibraryJson = async (file: File) => {
  if (!library) return;
  const text = await file.text();
  if (library.import(text)) {
    library.save();
    renderAnimationList();
    renderPoseList();
    renderChoreographyList();
    updateStatus("Library imported");
  } else {
    updateStatus("Invalid library file");
  }
};

// ─────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────

const bindTabs = () => {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = tab.dataset.tab + "Tab";

      els.tabs.forEach((t) => t.classList.remove("active"));
      els.tabContents.forEach((tc) => tc.classList.remove("active"));

      tab.classList.add("active");
      document.getElementById(targetId)?.classList.add("active");
    });
  });
};

const bindControls = () => {
  // BPM slider
  els.bpmSlider.addEventListener("input", () => {
    els.bpmVal.textContent = els.bpmSlider.value;
    director?.setConfig({ bpm: parseInt(els.bpmSlider.value, 10) });
  });

  // Speed slider
  els.speedSlider.addEventListener("input", () => {
    els.speedVal.textContent = parseFloat(els.speedSlider.value).toFixed(1) + "x";
  });

  // Generate button
  els.generateBtn.addEventListener("click", generateChoreography);

  // Add animation (demo)
  els.addAnimationBtn.addEventListener("click", addDemoAnimation);

  // Import FBX (placeholder - would need server-side processing)
  els.importFbxBtn.addEventListener("click", () => {
    updateStatus("FBX import requires server processing. Use Add Animation for demo.");
  });

  // Choreography controls
  els.clearStepsBtn.addEventListener("click", clearChoreography);
  els.saveChoreoBtn.addEventListener("click", saveChoreography);

  // Playback controls
  els.playBtn.addEventListener("click", playChoreography);
  els.stopBtn.addEventListener("click", stopPlayback);
  els.playSelectedBtn.addEventListener("click", () => {
    if (selectedAnimationId) {
      const anim = library?.getAnimation(selectedAnimationId);
      if (anim) playAnimation(anim);
    } else if (selectedPoseId) {
      const pose = library?.getPose(selectedPoseId);
      if (pose) playPose(pose);
    }
  });

  els.queueBtn.addEventListener("click", () => {
    if (selectedAnimationId) {
      const anim = library?.getAnimation(selectedAnimationId);
      if (anim) addStepToChoreography(anim.id, anim.duration_ms);
    }
  });

  // Export/Import
  els.exportChoreoBtn.addEventListener("click", exportLibraryJson);
  els.importChoreoBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", () => {
    const file = els.importFile.files?.[0];
    if (file) importLibraryJson(file);
  });

  // Avatar select
  els.avatarSelect.addEventListener("change", () => {
    loadAvatar(els.avatarSelect.value);
  });
};

const init = async () => {
  updateStatus("Initializing Dance Studio...");

  // Create head
  await createHead();

  // Load avatar list
  const { avatars, baseUrl } = await loadAvatarList(els.avatarSelect);
  avatarBaseUrl = baseUrl;

  // Load initial avatar
  if (avatars.length > 0) {
    await loadAvatar(avatars[0]);
  }

  // Initialize library and director
  library = await initDanceLibrary();
  director = getDanceDirector({
    style: selectedStyle,
    mood: selectedMood,
    bpm: 120,
    intensity: "medium"
  });

  // Build UI
  buildStyleGrid();
  buildMoodGrid();
  bindTabs();
  bindControls();

  // Render lists
  renderAnimationList();
  renderPoseList();
  renderChoreographyList();

  // Create initial empty choreography
  createNewChoreography();

  updateStatus("Dance Studio ready");
};

init().catch((err) => {
  console.error("Dance Studio init error:", err);
  updateStatus("Error: " + err.message);
});
