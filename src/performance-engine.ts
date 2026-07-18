import {
  AudioLines,
  AudioWaveform,
  Clapperboard,
  CloudUpload,
  Download,
  FilePlus2,
  FolderOpen,
  PanelRight,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  ZoomIn,
  createIcons,
} from "lucide";
import "./styles/performance-engine.css";
import { loadPerformanceCatalog, probeAsset } from "./performance-engine/catalog";
import { PerformanceController, type PlaybackState } from "./performance-engine/controller";
import { PerformanceShowDirector, SHOW_DIRECTOR_STAGES } from "./performance-engine/director";
import { PerformanceWarehouseStore } from "./performance-engine/persistence";
import {
  createDefaultProject,
  exportProjectJson,
  loadProjectLocally,
  parsePerformanceProject,
  saveProjectLocally,
} from "./performance-engine/project";
import { PerformanceRoom } from "./performance-engine/room";
import { DirectorPlanningRehearsal } from "./performance-engine/planning-rehearsal";
import { analyzeSong, setSpeakerActor } from "./performance-engine/music-analysis";
import { PerformanceTimelineView } from "./performance-engine/timeline-view";
import {
  createId,
  trackColor,
  type ActorRuntimeCapabilities,
  type PerformanceActor,
  type PerformanceCatalog,
  type PerformanceClip,
  type PerformanceEngineResult,
  type PerformanceProject,
  type PerformanceTrack,
  type PerformanceTrackKind,
} from "./performance-engine/types";
import { getMlxConfig } from "./mlx-config";
import { filterModels, loadModelRegistry, populateModelSelect } from "./runtime/model-registry";
import type { DirectorStage, DirectorStyle } from "./directors/types";
import { directorModelFallback } from "./stage/constants";

createIcons({
  icons: {
    AudioLines,
    AudioWaveform,
    Clapperboard,
    CloudUpload,
    Download,
    FilePlus2,
    FolderOpen,
    PanelRight,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Save,
    Square,
    Sparkles,
    Trash2,
    Upload,
    UserPlus,
    ZoomIn,
  },
  attrs: { "stroke-width": 1.5 },
});

const element = <T extends HTMLElement>(id: string): T => {
  const match = document.getElementById(id);
  if (!match) throw new Error(`Performance Engine is missing #${id}.`);
  return match as T;
};

const result: PerformanceEngineResult = {
  ready: false,
  renderer: "pending",
  scheduler: "pending",
  projectId: null,
  actorsReady: 0,
  frameCount: 0,
  averageFps: 0,
  errors: [],
};

declare global {
  interface Window {
    __performanceEngineResult?: PerformanceEngineResult;
  }
}
window.__performanceEngineResult = result;

const viewport = element<HTMLElement>("performanceViewport");
const loading = element<HTMLElement>("stageLoading");
const loadingDetail = element<HTMLElement>("loadingDetail");
const notice = element<HTMLOutputElement>("engineNotice");
const projectTitle = element<HTMLInputElement>("projectTitle");
const projectState = element<HTMLElement>("projectState");
const projectDuration = element<HTMLInputElement>("projectDuration");
const projectFps = element<HTMLSelectElement>("projectFps");
const actorList = element<HTMLElement>("actorList");
const actorAsset = element<HTMLSelectElement>("actorAsset");
const actorShader = element<HTMLSelectElement>("actorShader");
const actorX = element<HTMLInputElement>("actorX");
const actorZ = element<HTMLInputElement>("actorZ");
const actorScale = element<HTMLInputElement>("actorScale");
const actorCapability = element<HTMLOutputElement>("actorCapability");
const animationSearch = element<HTMLInputElement>("animationSearch");
const animationCategory = element<HTMLSelectElement>("animationCategory");
const animationRig = element<HTMLSelectElement>("animationRig");
const animationCompatibleOnly = element<HTMLInputElement>("animationCompatibleOnly");
const animationSelect = element<HTMLSelectElement>("animationSelect");
const animationCatalogStatus = element<HTMLOutputElement>("animationCatalogStatus");
const motionStart = element<HTMLInputElement>("motionStart");
const motionDuration = element<HTMLInputElement>("motionDuration");
const addMotionButton = element<HTMLButtonElement>("addMotionButton");
const environmentSelect = element<HTMLSelectElement>("environmentSelect");
const cameraSelect = element<HTMLSelectElement>("cameraSelect");
const lightingSelect = element<HTMLSelectElement>("lightingSelect");
const clipInspector = element<HTMLDetailsElement>("clipInspector");
const selectedClipName = element<HTMLOutputElement>("selectedClipName");
const clipStart = element<HTMLInputElement>("clipStart");
const clipDuration = element<HTMLInputElement>("clipDuration");
const timelineSummary = element<HTMLElement>("timelineSummary");
const timelineWarnings = element<HTMLElement>("timelineWarnings");
const transportScrub = element<HTMLInputElement>("transportScrub");
const timecode = element<HTMLOutputElement>("timecode");
const durationLabel = element<HTMLElement>("durationLabel");
const warehouseBadge = element<HTMLElement>("warehouseBadge");
const warehouseProjects = element<HTMLSelectElement>("warehouseProjects");
const engineErrors = element<HTMLOListElement>("engineErrors");
const directorBrief = element<HTMLTextAreaElement>("directorBrief");
const directorModel = element<HTMLSelectElement>("directorModel");
const directorStyle = element<HTMLSelectElement>("directorStyle");
const directorState = element<HTMLElement>("directorState");
const directorStatus = element<HTMLOutputElement>("directorStatus");
const directorProvenance = element<HTMLOutputElement>("directorProvenance");
const createShowButton = element<HTMLButtonElement>("createShowButton");
const directorVoiceModel = element<HTMLSelectElement>("directorVoiceModel");
const directorVoiceEnabled = element<HTMLInputElement>("directorVoiceEnabled");
const directorPlanningOverlay = element<HTMLElement>("directorPlanningOverlay");
const planningVoiceState = element<HTMLOutputElement>("planningVoiceState");
const analyzeScoreButton = element<HTMLButtonElement>("analyzeScoreButton");
const scoreAnalysisStatus = element<HTMLOutputElement>("scoreAnalysisStatus");
const speakerAssignments = element<HTMLElement>("speakerAssignments");
const stageShaderSelect = element<HTMLSelectElement>("stageShaderSelect");
const stageParticlesSelect = element<HTMLSelectElement>("stageParticlesSelect");
const stagePhysicsSelect = element<HTMLSelectElement>("stagePhysicsSelect");
const stageFxIntensity = element<HTMLInputElement>("stageFxIntensity");

let catalog: PerformanceCatalog;
let project: PerformanceProject;
let room: PerformanceRoom;
let controller: PerformanceController;
let timeline: PerformanceTimelineView;
let selectedActorId = "";
let selectedTrackId = "";
let selectedClipId = "";
let audioElement: HTMLAudioElement | null = null;
let audioFile: File | null = null;
let attachedAudioFile: File | null = null;
let noticeTimer = 0;
let compileTimer = 0;
let metricsTimer = 0;
const actorCapabilities = new Map<string, ActorRuntimeCapabilities>();
const mlxConfig = getMlxConfig();
const warehouse = new PerformanceWarehouseStore(mlxConfig.warehouseBaseUrl);
const showDirector = new PerformanceShowDirector();
let directorRunning = false;
let analysisPromise: Promise<void> | null = null;
let analysisGeneration = 0;
let planningRehearsal: DirectorPlanningRehearsal | null = null;

const formatTime = (timeMs: number, fps = project?.fps || 30): string => {
  const bounded = Math.max(0, timeMs);
  const minutes = Math.floor(bounded / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1000);
  const frames = Math.floor((bounded % 1000) / (1000 / fps));
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
};

const showNotice = (message: string, persistent = false): void => {
  notice.textContent = message;
  notice.hidden = false;
  window.clearTimeout(noticeTimer);
  if (!persistent) noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 4200);
};

const reportError = (message: string): void => {
  const normalized = message.replace(/^Error:\s*/, "");
  result.errors.push(normalized);
  if (result.errors.length > 12) result.errors.shift();
  engineErrors.replaceChildren(...result.errors.slice(-5).map((error) => {
    const item = document.createElement("li");
    item.textContent = error;
    return item;
  }));
  showNotice(normalized);
};

const markDirty = (): void => {
  project.updatedAt = new Date().toISOString();
  projectState.textContent = "Unsaved";
  projectState.dataset.state = "dirty";
};

const markSaved = (label = "Saved locally"): void => {
  projectState.textContent = label;
  projectState.dataset.state = "saved";
};

const selectedActor = (): PerformanceActor | undefined =>
  project.actors.find((actor) => actor.id === selectedActorId);

const selectedClip = (): { track: PerformanceTrack; clip: PerformanceClip } | null => {
  const track = project.tracks.find((candidate) => candidate.id === selectedTrackId);
  const clip = track?.clips.find((candidate) => candidate.id === selectedClipId);
  return track && clip ? { track, clip } : null;
};

const createTrack = (kind: PerformanceTrackKind, name: string, actorId?: string): PerformanceTrack => ({
  id: createId(`track_${kind}`),
  name,
  kind,
  actorId,
  muted: false,
  locked: false,
  color: trackColor(kind),
  clips: [],
});

const scheduleCompile = (delay = 80): void => {
  window.clearTimeout(compileTimer);
  compileTimer = window.setTimeout(() => {
    void controller.setProject(project).catch((error) => reportError(String(error)));
  }, delay);
};

const refreshTimeline = (): void => {
  timeline.render(project);
  timeline.setTime(controller.timeMs);
  timeline.selectClip(selectedClipId || null);
  timelineSummary.textContent = `${project.tracks.length} tracks / ${project.tracks.reduce((sum, track) => sum + track.clips.length, 0)} clips`;
  transportScrub.max = String(project.durationMs);
  durationLabel.textContent = formatTime(project.durationMs);
};

const animationCompatibleWithSelectedActor = (
  animation: PerformanceCatalog["animations"][number],
): boolean => {
  const actor = selectedActor();
  if (!actor || actorCapabilities.get(actor.id)?.animationCompatible !== true) return false;
  return animation.body === "any" || !actor.asset.body || animation.body === actor.asset.body;
};

const refreshAnimationControls = (): void => {
  if (!catalog) return;
  const query = animationSearch.value.trim().toLowerCase();
  const category = animationCategory.value;
  const rig = animationRig.value;
  const previous = animationSelect.value;
  const filtered = catalog.animations.filter((animation) => {
    if (category !== "all" && animation.category !== category) return false;
    if (rig !== "all" && animation.rig !== rig) return false;
    if (animationCompatibleOnly.checked && !animationCompatibleWithSelectedActor(animation)) return false;
    if (!query) return true;
    return [animation.label, animation.category, animation.rig, animation.source, ...animation.tags]
      .some((value) => value.toLowerCase().includes(query));
  });
  animationSelect.replaceChildren(...filtered.map((animation) => {
    const option = document.createElement("option");
    option.value = animation.id;
    const body = animation.body === "any" ? "unisex" : animation.body === "F" ? "feminine" : "masculine";
    const source = animation.source === "ready-player-me" ? "RPM" : "curated";
    option.textContent = `${animation.label} / ${source} / ${body}`;
    return option;
  }));
  if (filtered.some((animation) => animation.id === previous)) animationSelect.value = previous;
  animationCatalogStatus.textContent = `${filtered.length} of ${catalog.animationSummary.total} verified clips / ${catalog.animationSummary.curated} curated + ${catalog.animationSummary.rpm} RPM`;
  const actor = selectedActor();
  addMotionButton.disabled = !actor || actorCapabilities.get(actor.id)?.animationCompatible !== true || filtered.length === 0;
};

const refreshDirectorProvenance = (): void => {
  const direction = project.direction;
  directorProvenance.hidden = !direction;
  if (!direction) {
    directorProvenance.textContent = "";
    return;
  }
  directorProvenance.textContent = [
    `Created by Performance Director / ${direction.model}`,
    `Council: ${direction.specialists.join(" -> ")}`,
    `Generated: ${new Date(direction.generatedAt).toLocaleString()}`,
    ...(direction.briefings || []).map((briefing) => `${briefing.stage}: ${briefing.summary}`),
  ].join("\n");
};

const setPlanningCard = (
  stage: DirectorStage,
  state: "pending" | "running" | "complete" | "failed",
  message: string,
): void => {
  const card = directorPlanningOverlay.querySelector<HTMLElement>(`[data-director-card="${stage}"]`);
  if (!card) return;
  card.dataset.state = state;
  const copy = card.querySelector("p");
  if (copy) copy.textContent = message;
};

const resetPlanningOverlay = (): void => {
  const waiting: Record<DirectorStage, string> = {
    performance: "Waiting for showrunner",
    stage: "Waiting for performance plan",
    camera: "Waiting for blocking",
    postfx: "Waiting for visual language",
  };
  for (const stage of SHOW_DIRECTOR_STAGES) setPlanningCard(stage, "pending", waiting[stage]);
};

const syncLipSyncTracksFromAnalysis = (): void => {
  const analysis = project.audio?.analysis;
  project.tracks = project.tracks.filter((track) => track.kind !== "lipsync");
  if (!analysis) return;
  for (const speaker of analysis.speakers) {
    const actor = project.actors.find((candidate) => candidate.id === speaker.actorId);
    if (!actor) continue;
    const track = createTrack("lipsync", `${actor.label} / ${speaker.id} Lipsync`, actor.id);
    track.clips = analysis.segments.filter((segment) => segment.speakerId === speaker.id).map((segment) => ({
      id: createId("clip"),
      label: `${speaker.id} / vocal`,
      startMs: segment.startMs,
      durationMs: segment.endMs - segment.startMs,
      data: { speakerId: speaker.id, confidence: speaker.confidence },
    }));
    if (track.clips.length) project.tracks.push(track);
  }
};

const refreshSpeakerAssignments = (): void => {
  const analysis = project.audio?.analysis;
  speakerAssignments.hidden = !analysis?.speakers.length;
  speakerAssignments.replaceChildren();
  if (!analysis?.speakers.length) return;
  const title = document.createElement("strong");
  title.textContent = "Diarised singer to actor mapping";
  speakerAssignments.append(title);
  for (const speaker of analysis.speakers) {
    const row = document.createElement("label");
    row.className = "speaker-assignment-row";
    const label = document.createElement("span");
    label.textContent = `${speaker.id} / ${(speaker.durationMs / 1000).toFixed(1)}s`;
    label.title = `${speaker.id}, ${speaker.confidence} confidence`;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Actor for ${speaker.id}`);
    select.append(...project.actors.map((actor) => {
      const option = document.createElement("option");
      option.value = actor.id;
      option.textContent = actor.label;
      return option;
    }));
    if (speaker.actorId && project.actors.some((actor) => actor.id === speaker.actorId)) select.value = speaker.actorId;
    select.addEventListener("change", () => {
      if (!project.audio?.analysis) return;
      project.audio.analysis = setSpeakerActor(project.audio.analysis, speaker.id, select.value);
      syncLipSyncTracksFromAnalysis();
      markDirty();
      refreshTimeline();
      scheduleCompile(0);
    });
    row.append(label, select);
    speakerAssignments.append(row);
  }
};

const refreshScoreAnalysis = (): void => {
  const analysis = project.audio?.analysis;
  result.analysisReady = Boolean(analysis);
  result.speakers = analysis?.speakers.length || 0;
  if (!project.audio) {
    scoreAnalysisStatus.textContent = "Attach a score for semantic and singer analysis";
    analyzeScoreButton.disabled = true;
  } else if (!analysis) {
    scoreAnalysisStatus.textContent = "Score attached / analysis pending";
    analyzeScoreButton.disabled = !attachedAudioFile;
  } else {
    scoreAnalysisStatus.textContent = [
      analysis.tempoBpm ? `${analysis.tempoBpm} BPM` : "tempo unconfirmed",
      `${analysis.segments.length} semantic segments`,
      `${analysis.speakers.length} singer${analysis.speakers.length === 1 ? "" : "s"}`,
      analysis.source.diarisation ? "MLX diarised" : "signal analysis only",
    ].join(" / ");
    analyzeScoreButton.disabled = !attachedAudioFile;
  }
  refreshSpeakerAssignments();
};

const refreshActorInspector = (): void => {
  const actor = selectedActor();
  actorList.replaceChildren(...project.actors.map((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "option";
    button.dataset.actorId = candidate.id;
    button.classList.toggle("is-selected", candidate.id === selectedActorId);
    button.setAttribute("aria-selected", String(candidate.id === selectedActorId));
    const name = document.createElement("strong");
    name.textContent = candidate.label;
    const kind = document.createElement("small");
    kind.textContent = candidate.asset.kind;
    button.append(name, kind);
    button.addEventListener("click", () => {
      selectedActorId = candidate.id;
      refreshActorInspector();
    });
    return button;
  }));
  if (!actor) {
    actorCapability.textContent = "No actor selected";
    addMotionButton.disabled = true;
    refreshAnimationControls();
    return;
  }
  actorAsset.value = actor.asset.id;
  actorShader.value = actor.shader;
  actorX.value = String(actor.position.x);
  actorZ.value = String(actor.position.z);
  actorScale.value = String(actor.scale);
  const capabilities = actorCapabilities.get(actor.id);
  if (capabilities) {
    actorCapability.textContent = capabilities.animationCompatible
      ? `${capabilities.skeletons} rig / ${capabilities.morphTargets} morph targets / animation ready`
      : `${capabilities.morphTargets} morph targets / rig-less head / motion clips disabled`;
    addMotionButton.disabled = !capabilities.animationCompatible;
  } else {
    actorCapability.textContent = "Asset capability pending";
    addMotionButton.disabled = true;
  }
  refreshAnimationControls();
};

const refreshClipInspector = (): void => {
  const selection = selectedClip();
  clipInspector.hidden = !selection;
  if (!selection) return;
  clipInspector.open = true;
  selectedClipName.textContent = `${selection.track.name} / ${selection.clip.label}`;
  clipStart.value = String(selection.clip.startMs / 1000);
  clipDuration.value = String(selection.clip.durationMs / 1000);
};

const refreshProjectControls = (): void => {
  projectTitle.value = project.title;
  projectDuration.value = String(project.durationMs / 1000);
  projectFps.value = String(project.fps);
  environmentSelect.value = project.environment.id;
  element<HTMLElement>("audioButtonLabel").textContent = project.audio?.name || "Attach score";
  refreshActorInspector();
  refreshTimeline();
  refreshClipInspector();
  refreshDirectorProvenance();
  refreshScoreAnalysis();
};

const loadActor = async (actor: PerformanceActor): Promise<void> => {
  loadingDetail.textContent = `Loading ${actor.label}`;
  try {
    const capabilities = await room.loadActor(actor);
    actorCapabilities.set(actor.id, capabilities);
  } catch (error) {
    actorCapabilities.delete(actor.id);
    reportError(`${actor.label}: ${String(error)}`);
  }
};

const attachAudio = async (file: File, publishSource = true): Promise<void> => {
  if (audioElement?.src.startsWith("blob:")) URL.revokeObjectURL(audioElement.src);
  audioElement?.pause();
  audioFile = publishSource ? file : null;
  attachedAudioFile = file;
  audioElement = new Audio(URL.createObjectURL(file));
  audioElement.preload = "auto";
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    audioElement!.addEventListener("loadedmetadata", done, { once: true });
    audioElement!.addEventListener("error", done, { once: true });
  });
  const durationMs = Number.isFinite(audioElement.duration) ? Math.round(audioElement.duration * 1000) : undefined;
  project.audio = {
    name: file.name,
    objectUrl: audioElement.src,
    warehouseId: project.audio?.warehouseId,
    durationMs,
    analysis: publishSource ? undefined : project.audio?.analysis,
  };
  if (durationMs && Math.abs(durationMs - project.durationMs) > 500) {
    project.durationMs = durationMs;
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        clip.startMs = Math.min(clip.startMs, Math.max(0, durationMs - 1));
        clip.durationMs = Math.min(clip.durationMs, durationMs - clip.startMs);
      }
    }
  }
  controller.setAudio(audioElement);
  markDirty();
  refreshProjectControls();
  scheduleCompile(0);
};

const analyzeAttachedScore = async (): Promise<void> => {
  if (analysisPromise) return analysisPromise;
  if (!attachedAudioFile || !project.audio) {
    showNotice("Attach a local score before running music analysis.");
    return;
  }
  const generation = ++analysisGeneration;
  const file = attachedAudioFile;
  analyzeScoreButton.disabled = true;
  analyzeScoreButton.dataset.running = "true";
  scoreAnalysisStatus.textContent = "Reading signal, transcribing lyrics, then diarising singers on local MLX";
  const actorIds = project.actors
    .filter((actor) => (actorCapabilities.get(actor.id)?.morphTargets || 0) > 0)
    .map((actor) => actor.id);
  const candidates = actorIds.length ? actorIds : project.actors.map((actor) => actor.id);
  analysisPromise = analyzeSong({
    file,
    gatewayBaseUrl: mlxConfig.audioBaseUrl,
    sttModel: mlxConfig.sttModel,
    actorIds: candidates,
  }).then((analysis) => {
    if (generation !== analysisGeneration || attachedAudioFile !== file || !project.audio) return;
    project.audio.analysis = analysis;
    syncLipSyncTracksFromAnalysis();
    markDirty();
    refreshProjectControls();
    scheduleCompile(0);
    if (analysis.warnings.length) showNotice(analysis.warnings.join(" "));
  }).catch((error) => {
    if (generation !== analysisGeneration) return;
    const message = error instanceof Error ? error.message : String(error);
    scoreAnalysisStatus.textContent = message;
    reportError(message);
  }).finally(() => {
    if (generation === analysisGeneration) {
      analysisPromise = null;
      analyzeScoreButton.dataset.running = "false";
      analyzeScoreButton.disabled = !attachedAudioFile;
    }
  });
  return analysisPromise;
};

const applyProject = async (nextProject: PerformanceProject, sourceLabel: string): Promise<void> => {
  controller.pause();
  const previousActorIds = project.actors.map((actor) => actor.id);
  project = nextProject;
  selectedActorId = project.actors[0]?.id || "";
  selectedTrackId = "";
  selectedClipId = "";
  actorCapabilities.clear();
  for (const actorId of previousActorIds) room.removeActor(actorId);
  await room.setEnvironment(project.environment).catch((error) => reportError(String(error)));
  await Promise.all(project.actors.map(loadActor));
  await controller.setProject(project);
  if (project.audio?.warehouseId) {
    try {
      const file = await warehouse.loadAudio(project.audio.warehouseId, project.audio.name);
      await attachAudio(file, false);
    } catch (error) {
      reportError(`Project loaded without score: ${String(error)}`);
    }
  } else {
    if (audioElement?.src.startsWith("blob:")) URL.revokeObjectURL(audioElement.src);
    audioElement?.pause();
    audioElement = null;
    controller.setAudio(null);
    audioFile = null;
    attachedAudioFile = null;
  }
  result.projectId = project.id;
  result.actorsReady = actorCapabilities.size;
  refreshProjectControls();
  markSaved(sourceLabel);
};

const populateCatalogControls = (): void => {
  actorAsset.replaceChildren();
  for (const kind of ["head", "body"] as const) {
    const group = document.createElement("optgroup");
    group.label = kind === "head" ? "Core-X Heads" : "Rigged Bodies";
    for (const asset of catalog.actors.filter((candidate) => candidate.kind === kind)) {
      const option = document.createElement("option");
      option.value = asset.id;
      option.textContent = asset.label;
      group.append(option);
    }
    actorAsset.append(group);
  }
  refreshAnimationControls();
  environmentSelect.replaceChildren(...catalog.environments.map((environment) => {
    const option = document.createElement("option");
    option.value = environment.id;
    option.textContent = environment.label;
    return option;
  }));
};

const setGlobalClip = (kind: "camera" | "lighting" | "environment" | "stagefx", label: string, data: Record<string, unknown>): void => {
  let track = project.tracks.find((candidate) => candidate.kind === kind);
  if (!track) {
    track = createTrack(kind, kind.charAt(0).toUpperCase() + kind.slice(1));
    project.tracks.push(track);
  }
  track.clips = [{ id: track.clips[0]?.id || createId("clip"), label, startMs: 0, durationMs: project.durationMs, data }];
};

const setActorShaderClip = (actor: PerformanceActor): void => {
  let track = project.tracks.find((candidate) => candidate.kind === "shader" && candidate.actorId === actor.id);
  if (!track) {
    track = createTrack("shader", `${actor.label} / Look`, actor.id);
    project.tracks.push(track);
  }
  const label = actor.shader.charAt(0).toUpperCase() + actor.shader.slice(1);
  track.clips = [{ id: track.clips[0]?.id || createId("clip"), label, startMs: 0, durationMs: project.durationMs, data: { preset: actor.shader } }];
};

const refreshWarehouseList = async (): Promise<void> => {
  const healthy = await warehouse.health();
  warehouseBadge.dataset.state = healthy ? "online" : "offline";
  warehouseBadge.textContent = healthy ? "Warehouse / online" : "Warehouse / offline";
  if (!healthy) return;
  try {
    const items = await warehouse.list();
    warehouseProjects.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = items.length ? `${items.length} project${items.length === 1 ? "" : "s"}` : "No published projects";
    warehouseProjects.append(placeholder, ...items.map((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.title;
      return option;
    }));
  } catch (error) {
    reportError(String(error));
  }
};

const loadDirectorModels = async (): Promise<void> => {
  const registry = await loadModelRegistry(mlxConfig.llmBaseUrl);
  const chatModels = filterModels(registry, "chat");
  const routed = chatModels.filter((model) => model.id.startsWith("text/"));
  const generative = chatModels.filter((model) =>
    /gpt|qwen|gemma|llama|mistral|deepseek/i.test(model.id) && !/embed|bert/i.test(model.id),
  );
  const discovered = routed.length ? routed : generative;
  const requested = mlxConfig.directorModel || mlxConfig.llmModel ||
    discovered.find((model) => model.isDefault && model.loaded)?.id ||
    discovered.find((model) => model.loaded)?.id ||
    discovered[0]?.id ||
    directorModelFallback;
  const models = discovered.some((model) => model.id === requested)
    ? discovered
    : [{ id: requested, capabilities: ["chat"], description: "Core-X Gateway director" }, ...discovered];
  populateModelSelect(directorModel, models, requested);
  const voiceModels = filterModels(registry, "audio-generate");
  const requestedVoice = mlxConfig.ttsModel ||
    voiceModels.find((model) => model.isDefault && model.loaded)?.id ||
    voiceModels.find((model) => model.loaded)?.id ||
    voiceModels[0]?.id;
  populateModelSelect(directorVoiceModel, voiceModels, requestedVoice);
  directorStatus.textContent = directorModel.value
    ? `Performance Director ready / ${directorModel.value}${directorVoiceModel.value ? ` / voice ${directorVoiceModel.value}` : " / silent briefings"}`
    : "Core-X Gateway has no director model";
};

const setDirectorRunning = (running: boolean): void => {
  directorRunning = running;
  createShowButton.dataset.running = String(running);
  createShowButton.textContent = running ? "Cancel direction" : "Create show";
  directorBrief.disabled = running;
  directorModel.disabled = running;
  directorStyle.disabled = running;
};

const selectedDirectorStages = (): DirectorStage[] => {
  const stages: DirectorStage[] = ["performance"];
  if (element<HTMLInputElement>("directorStageEnabled").checked) stages.push("stage");
  if (element<HTMLInputElement>("directorCameraEnabled").checked) stages.push("camera");
  if (element<HTMLInputElement>("directorPostFxEnabled").checked) stages.push("postfx");
  return stages;
};

const createDirectedShow = async (): Promise<void> => {
  if (directorRunning) {
    showDirector.cancel();
    directorStatus.textContent = "Cancelling director council";
    return;
  }
  setDirectorRunning(true);
  directorState.dataset.state = "running";
  directorState.textContent = "Working";
  directorStatus.textContent = "Performance Director is shaping the show";
  result.planningState = "running";
  resetPlanningOverlay();
  directorPlanningOverlay.hidden = false;
  await planningRehearsal?.dispose();
  planningRehearsal = new DirectorPlanningRehearsal(room, {
    baseUrl: mlxConfig.audioBaseUrl,
    model: directorVoiceModel.value || undefined,
    voice: mlxConfig.ttsVoice,
    enabled: directorVoiceEnabled.checked,
  }, {
    onVoiceState: (message) => { planningVoiceState.textContent = message; },
  });
  try {
    await planningRehearsal.start(project, catalog, actorCapabilities);
    if (project.audio && attachedAudioFile && !project.audio.analysis) {
      setPlanningCard("performance", "running", "Listening to score and identifying singers");
      await analyzeAttachedScore();
    }
    const directed = await showDirector.create({
      project,
      catalog,
      capabilities: actorCapabilities,
      brief: directorBrief.value,
      baseUrl: mlxConfig.llmBaseUrl,
      model: directorModel.value,
      style: directorStyle.value as DirectorStyle,
      enabledDirectors: selectedDirectorStages(),
      musicAnalysis: project.audio?.analysis,
    }, {
      onProgress: (stage, status, message) => {
        const name = stage === "postfx" ? "PostFX" : stage[0].toUpperCase() + stage.slice(1);
        directorState.textContent = name;
        directorStatus.textContent = message || `${name} Director / ${status}`;
        planningRehearsal?.focus(stage);
        const state = status === "complete" ? "complete" : status === "failed" ? "failed" : "running";
        setPlanningCard(stage, state, message || `${name} Director / ${status}`);
      },
      onThoughts: (stage, thoughts) => {
        const name = stage === "postfx" ? "PostFX" : stage[0].toUpperCase() + stage.slice(1);
        directorStatus.textContent = `${name}: ${thoughts}`;
        setPlanningCard(stage, "complete", thoughts);
        planningRehearsal?.briefing(stage, thoughts);
      },
    });
    planningVoiceState.textContent = "Finishing director briefings";
    await planningRehearsal.finish(project);
    await applyProject(directed.project, "Directed");
    markDirty();
    directorState.dataset.state = "complete";
    directorState.textContent = "Complete";
    result.planningState = "complete";
    directorStatus.textContent = directed.warnings.length
      ? `Show created with ${directed.warnings.length} catalog warning${directed.warnings.length === 1 ? "" : "s"}`
      : `Show created by ${directed.project.direction?.specialists.length || SHOW_DIRECTOR_STAGES.length} directors`;
    if (directed.warnings.length) showNotice(directed.warnings.join(" "));
    refreshDirectorProvenance();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = message.toLowerCase().includes("cancel");
    directorState.dataset.state = cancelled ? "idle" : "failed";
    directorState.textContent = cancelled ? "Ready" : "Failed";
    result.planningState = cancelled ? "idle" : "failed";
    directorStatus.textContent = message;
    showNotice(message);
    planningRehearsal?.stop(project);
    await controller.seek(controller.timeMs);
  } finally {
    directorPlanningOverlay.hidden = true;
    setDirectorRunning(false);
  }
};

const bindEvents = (): void => {
  element<HTMLButtonElement>("playButton").addEventListener("click", () => void controller.play());
  element<HTMLButtonElement>("pauseButton").addEventListener("click", () => controller.pause());
  element<HTMLButtonElement>("stopButton").addEventListener("click", () => void controller.stop());
  transportScrub.addEventListener("input", () => void controller.seek(Number(transportScrub.value)));
  element<HTMLInputElement>("timelineZoom").addEventListener("input", (event) => {
    timeline.setScale(Number((event.currentTarget as HTMLInputElement).value));
    timeline.setTime(controller.timeMs);
  });
  element<HTMLButtonElement>("inspectorToggle").addEventListener("click", () => {
    element<HTMLElement>("performanceInspector").classList.toggle("is-open");
  });
  createShowButton.addEventListener("click", () => void createDirectedShow());
  analyzeScoreButton.addEventListener("click", () => void analyzeAttachedScore());
  for (const control of [animationSearch, animationCategory, animationRig, animationCompatibleOnly]) {
    control.addEventListener("input", refreshAnimationControls);
    control.addEventListener("change", refreshAnimationControls);
  }

  projectTitle.addEventListener("input", () => {
    project.title = projectTitle.value.trim() || "Untitled Performance";
    markDirty();
  });
  projectDuration.addEventListener("change", () => {
    project.durationMs = Math.max(1_000, Math.min(14_400_000, Math.round(Number(projectDuration.value) * 1000)));
    for (const track of project.tracks) for (const clip of track.clips) {
      clip.startMs = Math.min(clip.startMs, project.durationMs - 1);
      clip.durationMs = Math.max(1, Math.min(clip.durationMs, project.durationMs - clip.startMs));
    }
    markDirty();
    refreshTimeline();
    scheduleCompile(0);
  });
  projectFps.addEventListener("change", () => {
    project.fps = Number(projectFps.value) as PerformanceProject["fps"];
    markDirty();
    refreshTimeline();
  });

  element<HTMLButtonElement>("newProjectButton").addEventListener("click", () => {
    if (!window.confirm("Start a new performance project? Unsaved changes will remain only in this browser session.")) return;
    void applyProject(createDefaultProject(catalog), "New project");
  });
  element<HTMLButtonElement>("saveLocalButton").addEventListener("click", () => {
    saveProjectLocally(project);
    markSaved();
  });
  element<HTMLButtonElement>("exportProjectButton").addEventListener("click", () => {
    const url = URL.createObjectURL(exportProjectJson(project));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "performance"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });
  element<HTMLButtonElement>("importProjectButton").addEventListener("click", () => element<HTMLInputElement>("importProjectInput").click());
  element<HTMLInputElement>("importProjectInput").addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    void file.text().then((text) => parsePerformanceProject(JSON.parse(text), catalog))
      .then((nextProject) => applyProject(nextProject, "Imported"))
      .catch((error) => reportError(`Import failed: ${String(error)}`));
  });
  element<HTMLButtonElement>("audioButton").addEventListener("click", () => element<HTMLInputElement>("audioInput").click());
  element<HTMLInputElement>("audioInput").addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void attachAudio(file)
      .then(() => analyzeAttachedScore())
      .catch((error) => reportError(String(error)));
  });

  element<HTMLButtonElement>("addActorButton").addEventListener("click", () => {
    if (project.actors.length >= 4) {
      showNotice("A performance room supports up to four simultaneous actors.");
      return;
    }
    const usedAssets = new Set(project.actors.map((actor) => actor.asset.id));
    const asset = catalog.actors.find((candidate) => !usedAssets.has(candidate.id)) || catalog.actors[0];
    const actor: PerformanceActor = {
      id: createId("actor"),
      label: asset.label.replace(/ \/ (Head|Body)$/, ""),
      asset,
      shader: "original",
      position: { x: (project.actors.length - 1.5) * 1.25, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
      visible: true,
    };
    project.actors.push(actor);
    selectedActorId = actor.id;
    setActorShaderClip(actor);
    markDirty();
    void loadActor(actor).then(() => {
      refreshActorInspector();
      refreshTimeline();
      scheduleCompile(0);
    });
  });
  element<HTMLButtonElement>("removeActorButton").addEventListener("click", () => {
    if (project.actors.length <= 1) {
      showNotice("A project must keep at least one actor.");
      return;
    }
    const actor = selectedActor();
    if (!actor) return;
    room.removeActor(actor.id);
    actorCapabilities.delete(actor.id);
    project.actors = project.actors.filter((candidate) => candidate.id !== actor.id);
    project.tracks = project.tracks.filter((track) => track.actorId !== actor.id);
    selectedActorId = project.actors[0].id;
    if (project.audio?.analysis) {
      project.audio.analysis = {
        ...project.audio.analysis,
        speakers: project.audio.analysis.speakers.map((speaker) =>
          speaker.actorId === actor.id ? { ...speaker, actorId: selectedActorId } : speaker),
      };
      syncLipSyncTracksFromAnalysis();
    }
    markDirty();
    refreshProjectControls();
    scheduleCompile(0);
  });
  actorAsset.addEventListener("change", () => {
    const actor = selectedActor();
    const asset = catalog.actors.find((candidate) => candidate.id === actorAsset.value);
    if (!actor || !asset) return;
    actor.asset = asset;
    actor.label = asset.label.replace(/ \/ (Head|Body)$/, "");
    if (asset.kind === "head") project.tracks = project.tracks.filter((track) => !(track.actorId === actor.id && track.kind === "animation"));
    markDirty();
    void loadActor(actor).then(() => {
      refreshActorInspector();
      refreshTimeline();
      scheduleCompile(0);
    });
  });
  actorShader.addEventListener("change", () => {
    const actor = selectedActor();
    if (!actor) return;
    actor.shader = actorShader.value as PerformanceActor["shader"];
    room.setActorShader(actor.id, actor.shader);
    setActorShaderClip(actor);
    markDirty();
    refreshTimeline();
    scheduleCompile(0);
  });
  for (const input of [actorX, actorZ, actorScale]) input.addEventListener("change", () => {
    const actor = selectedActor();
    if (!actor) return;
    actor.position.x = Number(actorX.value) || 0;
    actor.position.z = Number(actorZ.value) || 0;
    actor.scale = Math.max(0.1, Number(actorScale.value) || 1);
    room.updateActor(actor);
    markDirty();
  });

  addMotionButton.addEventListener("click", () => {
    const actor = selectedActor();
    const animation = catalog.animations.find((candidate) => candidate.id === animationSelect.value);
    if (!actor || !animation) return;
    if (!actorCapabilities.get(actor.id)?.animationCompatible) {
      showNotice(`${actor.label} is a rig-less head. Select a rigged body for FBX motion.`);
      return;
    }
    let track = project.tracks.find((candidate) => candidate.kind === "animation" && candidate.actorId === actor.id);
    if (!track) {
      track = createTrack("animation", `${actor.label} / Motion`, actor.id);
      project.tracks.push(track);
    }
    const startMs = Math.max(0, Math.min(project.durationMs - 100, Math.round(Number(motionStart.value) * 1000)));
    const durationMs = Math.max(100, Math.min(project.durationMs - startMs, Math.round(Number(motionDuration.value) * 1000)));
    const clip: PerformanceClip = {
      id: createId("clip"),
      label: animation.label,
      startMs,
      durationMs,
      data: { animationId: animation.id, url: animation.url, loop: animation.loop, speed: 1 },
    };
    track.clips.push(clip);
    selectedTrackId = track.id;
    selectedClipId = clip.id;
    markDirty();
    refreshTimeline();
    refreshClipInspector();
    scheduleCompile(0);
  });

  environmentSelect.addEventListener("change", () => {
    const environment = catalog.environments.find((candidate) => candidate.id === environmentSelect.value);
    if (!environment) return;
    project.environment = environment;
    setGlobalClip("environment", environment.label, { environmentId: environment.id });
    markDirty();
    refreshTimeline();
    void room.setEnvironment(environment).catch((error) => reportError(String(error)));
    scheduleCompile(0);
  });
  cameraSelect.addEventListener("change", () => {
    const preset = cameraSelect.value as Parameters<PerformanceRoom["setCameraPreset"]>[0];
    room.setCameraPreset(preset);
    setGlobalClip("camera", cameraSelect.selectedOptions[0].textContent || "Camera", { preset });
    markDirty();
    refreshTimeline();
    scheduleCompile(0);
  });
  lightingSelect.addEventListener("change", () => {
    const preset = lightingSelect.value as Parameters<PerformanceRoom["setLightingPreset"]>[0];
    room.setLightingPreset(preset);
    setGlobalClip("lighting", lightingSelect.selectedOptions[0].textContent || "Lighting", { preset });
    markDirty();
    refreshTimeline();
    scheduleCompile(0);
  });
  element<HTMLButtonElement>("applyStageFxButton").addEventListener("click", () => {
    const cue = {
      shader: stageShaderSelect.value as "clean" | "aurora" | "pulse" | "monochrome",
      particles: stageParticlesSelect.value as "none" | "dust" | "sparks" | "rain" | "embers",
      physics: stagePhysicsSelect.value === "confetti" ? "confetti" as const : "none" as const,
      intensity: Number(stageFxIntensity.value),
      palette: lightingSelect.value,
      pulseOnBeat: Boolean(project.audio?.analysis?.beatsMs.length),
    };
    void room.setStageEffects(cue).catch((error) => reportError(String(error)));
    setGlobalClip("stagefx", "Stage atmosphere", cue);
    markDirty();
    refreshTimeline();
    scheduleCompile(0);
  });

  const applyClipInputs = (): void => {
    const selection = selectedClip();
    if (!selection) return;
    selection.clip.startMs = Math.max(0, Math.min(project.durationMs - 1, Math.round(Number(clipStart.value) * 1000)));
    selection.clip.durationMs = Math.max(1, Math.min(project.durationMs - selection.clip.startMs, Math.round(Number(clipDuration.value) * 1000)));
    markDirty();
    refreshTimeline();
    scheduleCompile(0);
  };
  clipStart.addEventListener("change", applyClipInputs);
  clipDuration.addEventListener("change", applyClipInputs);
  element<HTMLButtonElement>("deleteClipButton").addEventListener("click", () => {
    const selection = selectedClip();
    if (!selection) return;
    selection.track.clips = selection.track.clips.filter((clip) => clip.id !== selection.clip.id);
    selectedTrackId = "";
    selectedClipId = "";
    markDirty();
    refreshTimeline();
    refreshClipInspector();
    scheduleCompile(0);
  });

  element<HTMLButtonElement>("publishWarehouseButton").addEventListener("click", () => {
    projectState.textContent = "Publishing";
    void warehouse.save(project, audioFile).then((id) => {
      audioFile = null;
      markSaved("Published");
      showNotice(`Published ${id}`);
      return refreshWarehouseList();
    }).catch((error) => {
      markDirty();
      reportError(String(error));
    });
  });
  element<HTMLButtonElement>("refreshWarehouseButton").addEventListener("click", () => void refreshWarehouseList());
  element<HTMLButtonElement>("loadWarehouseButton").addEventListener("click", () => {
    if (!warehouseProjects.value) return;
    void warehouse.load(warehouseProjects.value, catalog)
      .then((nextProject) => applyProject(nextProject, "Warehouse"))
      .catch((error) => reportError(String(error)));
  });
};

const initialize = async (): Promise<void> => {
  try {
    loadingDetail.textContent = "Reading canonical asset catalogs";
    catalog = await loadPerformanceCatalog();
    void loadDirectorModels();
    let restored: PerformanceProject | null = null;
    try {
      restored = loadProjectLocally(catalog);
    } catch (error) {
      reportError(`Local project was ignored: ${String(error)}`);
    }
    project = restored || createDefaultProject(catalog);
    selectedActorId = project.actors[0]?.id || "";
    populateCatalogControls();

    loadingDetail.textContent = "Probing room and animation assets";
    const probes = [
      ...project.actors.map((actor) => ({ label: actor.asset.label, url: actor.asset.url })),
      ...(project.environment.hdriUrl ? [{ label: project.environment.label, url: project.environment.hdriUrl }] : []),
      ...catalog.animations.slice(0, 2).map((animation) => ({ label: animation.label, url: animation.url })),
    ];
    const probeResults = await Promise.all(probes.map(async (asset) => ({ ...asset, ok: await probeAsset(asset.url) })));
    for (const asset of probeResults.filter((candidate) => !candidate.ok)) reportError(`${asset.label} asset is unavailable at ${asset.url}.`);

    loadingDetail.textContent = "Starting WebGPU room";
    room = await PerformanceRoom.create(viewport);
    result.renderer = room.rendererLabel;
    element<HTMLElement>("rendererBadge").textContent = `Renderer / ${room.rendererLabel}`;
    element<HTMLElement>("diagnosticRenderer").textContent = room.rendererLabel;
    await room.setEnvironment(project.environment).catch((error) => reportError(String(error)));
    await Promise.all(project.actors.map(loadActor));

    timeline = new PerformanceTimelineView(element<HTMLElement>("performanceTimeline"), {
      onSeek: (timeMs) => void controller.seek(timeMs),
      onSelectClip: (trackId, clipId) => {
        selectedTrackId = trackId;
        selectedClipId = clipId;
        timeline.selectClip(clipId);
        refreshClipInspector();
      },
      onClipChange: (trackId, clipId, startMs, durationMs) => {
        const track = project.tracks.find((candidate) => candidate.id === trackId);
        const clip = track?.clips.find((candidate) => candidate.id === clipId);
        if (!clip) return;
        clip.startMs = startMs;
        clip.durationMs = durationMs;
        markDirty();
        refreshTimeline();
        refreshClipInspector();
        scheduleCompile(0);
      },
    });
    controller = new PerformanceController(room, catalog, project, {
      onTime: (timeMs) => {
        timeline.setTime(timeMs);
        timecode.textContent = formatTime(timeMs);
        transportScrub.value = String(Math.round(timeMs));
        motionStart.value = String((timeMs / 1000).toFixed(1));
      },
      onSchedule: (schedule) => {
        timelineWarnings.textContent = schedule.warnings.length ? `${schedule.warnings.length} warning${schedule.warnings.length === 1 ? "" : "s"}` : "";
      },
      onState: (state: PlaybackState) => {
        element<HTMLButtonElement>("playButton").dataset.active = String(state === "playing");
      },
      onError: reportError,
    });
    result.scheduler = controller.scheduler.mode;
    element<HTMLElement>("schedulerBadge").textContent = `Schedule / ${controller.scheduler.mode}`;
    element<HTMLElement>("diagnosticScheduler").textContent = controller.scheduler.mode;
    await controller.compile();
    await controller.seek(0);
    bindEvents();
    refreshProjectControls();
    result.projectId = project.id;
    result.actorsReady = actorCapabilities.size;
    if (restored) markSaved("Restored");

    metricsTimer = window.setInterval(() => {
      const stats = room.getStats();
      const schedulerMode = controller.scheduler.mode;
      result.frameCount = stats.frameCount;
      result.averageFps = stats.averageFps;
      result.actorsReady = stats.actors;
      result.scheduler = schedulerMode;
      element<HTMLElement>("schedulerBadge").textContent = `Schedule / ${schedulerMode}`;
      element<HTMLElement>("diagnosticScheduler").textContent = schedulerMode;
      element<HTMLElement>("diagnosticFps").textContent = `${stats.averageFps.toFixed(0)} fps`;
      element<HTMLElement>("diagnosticActors").textContent = String(stats.actors);
      element<HTMLElement>("diagnosticDrawCalls").textContent = stats.drawCalls.toLocaleString();
      element<HTMLElement>("diagnosticTriangles").textContent = Math.round(stats.triangles).toLocaleString();
    }, 500);
    void refreshWarehouseList();
    result.ready = actorCapabilities.size > 0;
    loading.classList.add("is-hidden");
  } catch (error) {
    reportError(String(error));
    loadingDetail.textContent = "Performance Engine failed to initialize";
  }
};

window.addEventListener("beforeunload", () => {
  analysisGeneration += 1;
  window.clearInterval(metricsTimer);
  window.clearTimeout(compileTimer);
  controller?.dispose();
  void planningRehearsal?.dispose();
  room?.dispose();
  audioElement?.pause();
  if (audioElement?.src.startsWith("blob:")) URL.revokeObjectURL(audioElement.src);
});

void initialize();
