import { createOrchestrator, type DirectorOrchestrator, type PipelineResult } from "../pipeline/orchestrator";
import type { DirectorStage, DirectorStyle, InputSection, PlanAction, PlanSection } from "../directors/types";
import {
  createId,
  trackColor,
  type ActorRuntimeCapabilities,
  type AnimationBody,
  type DirectorBriefing,
  type MusicAnalysis,
  type PerformanceCatalog,
  type PerformanceClip,
  type PerformanceProject,
  type PerformanceTrack,
  type PerformanceTrackKind,
  type ShaderPresetId,
} from "./types";

export const SHOW_DIRECTOR_STAGES: DirectorStage[] = ["performance", "stage", "camera", "postfx"];

export interface ShowDirectorInput {
  project: PerformanceProject;
  catalog: PerformanceCatalog;
  capabilities: Map<string, ActorRuntimeCapabilities>;
  brief: string;
  baseUrl: string;
  model: string;
  style: DirectorStyle;
  enabledDirectors?: DirectorStage[];
  musicAnalysis?: MusicAnalysis;
}

export interface ShowDirectorCallbacks {
  onProgress?: (stage: DirectorStage, status: string, message: string) => void;
  onThoughts?: (stage: DirectorStage, thoughts: string) => void;
}

export interface DirectedShowResult {
  project: PerformanceProject;
  pipeline: PipelineResult;
  warnings: string[];
  briefings: DirectorBriefing[];
}

const sectionLabels = ["Opening", "Development", "Peak", "Finale"];
const directorOwnedKinds = new Set<PerformanceTrackKind>([
  "animation",
  "expression",
  "shader",
  "camera",
  "lighting",
  "environment",
  "lipsync",
  "stagefx",
]);

const createTrack = (
  kind: PerformanceTrackKind,
  name: string,
  actorId?: string,
  clips: PerformanceClip[] = [],
): PerformanceTrack => ({
  id: createId(`track_${kind}`),
  name,
  kind,
  actorId,
  muted: false,
  locked: false,
  color: trackColor(kind),
  clips,
});

const createClip = (
  label: string,
  startMs: number,
  durationMs: number,
  data: Record<string, unknown>,
): PerformanceClip => ({ id: createId("clip"), label, startMs, durationMs, data });

const buildSections = (
  brief: string,
  durationMs: number,
  analysis?: MusicAnalysis,
  project?: PerformanceProject,
): InputSection[] => {
  if (analysis?.segments.length) {
    const count = Math.max(4, Math.min(8, Math.ceil(durationMs / 30_000), analysis.segments.length));
    return Array.from({ length: count }, (_, index) => {
      const startMs = Math.round((durationMs * index) / count);
      const endMs = index === count - 1 ? durationMs : Math.round((durationMs * (index + 1)) / count);
      const segments = analysis.segments.filter((segment) => segment.endMs > startMs && segment.startMs < endMs);
      const lyrics = segments.map((segment) => segment.text).filter(Boolean).join(" ").slice(0, 620);
      const speakers = [...new Set(segments.map((segment) => segment.speakerId).filter(Boolean))];
      const singerTargets = speakers.flatMap((speakerId) => {
        const actorId = analysis.speakers.find((speaker) => speaker.id === speakerId)?.actorId;
        const actor = project?.actors.find((candidate) => candidate.id === actorId);
        return actorId ? [`${speakerId} -> ${actor?.label || actorId} (${actorId})`] : [];
      });
      const energy = segments.reduce((sum, segment) => sum + segment.energy, 0) / Math.max(1, segments.length);
      const arousal = segments.reduce((sum, segment) => sum + segment.arousal, 0) / Math.max(1, segments.length);
      const valence = segments.reduce((sum, segment) => sum + segment.valence, 0) / Math.max(1, segments.length);
      const beats = analysis.beatsMs.filter((beat) => beat >= startMs && beat < endMs).length;
      return {
        start_ms: startMs,
        end_ms: endMs,
        text: [
          `${sectionLabels[index] || `Movement ${index + 1}`}.`,
          `Lyrics: ${lyrics || "Instrumental passage"}.`,
          `Music evidence: energy ${energy.toFixed(2)}, arousal ${arousal.toFixed(2)}, valence ${valence.toFixed(2)}, ${beats} detected onsets${analysis.tempoBpm ? `, estimated ${analysis.tempoBpm} BPM` : ""}.`,
          speakers.length ? `Diarised singers: ${speakers.join(", ")}.` : "No distinct singer identity detected.",
          singerTargets.length ? `Singer targets: ${singerTargets.join(", ")}.` : "",
          `Operator brief: ${brief}`,
        ].filter(Boolean).join(" "),
      };
    });
  }
  const count = durationMs < 16_000 ? 3 : 4;
  return Array.from({ length: count }, (_, index) => {
    const startMs = Math.round((durationMs * index) / count);
    const endMs = index === count - 1 ? durationMs : Math.round((durationMs * (index + 1)) / count);
    return {
      start_ms: startMs,
      end_ms: endMs,
      text: `${sectionLabels[index] || `Section ${index + 1}`}. Show brief: ${brief}`,
    };
  });
};

const analysisForSection = (analysis: MusicAnalysis | undefined, section: PlanSection) => {
  const segments = analysis?.segments.filter((segment) => segment.endMs > section.start_ms && segment.startMs < section.end_ms) || [];
  const energy = segments.reduce((sum, segment) => sum + segment.energy, 0) / Math.max(1, segments.length);
  const arousal = segments.reduce((sum, segment) => sum + segment.arousal, 0) / Math.max(1, segments.length);
  const speaker = segments.reduce<Record<string, number>>((counts, segment) => {
    if (segment.speakerId) counts[segment.speakerId] = (counts[segment.speakerId] || 0) + segment.endMs - segment.startMs;
    return counts;
  }, {});
  const speakerId = Object.entries(speaker).sort((a, b) => b[1] - a[1])[0]?.[0];
  return { energy, arousal, speakerId };
};

const actorBody = (project: PerformanceProject, actorId: string): AnimationBody =>
  project.actors.find((actor) => actor.id === actorId)?.asset.body || "any";

const isAnimationCompatible = (
  animation: PerformanceCatalog["animations"][number],
  project: PerformanceProject,
  actorId: string,
): boolean => {
  const body = actorBody(project, actorId);
  return animation.body === "any" || body === "any" || animation.body === body;
};

const actionArgs = (action: PlanAction): Record<string, unknown> => action.args || {};

const explicitAnimationFor = (
  section: PlanSection,
  actorId: string,
  project: PerformanceProject,
  catalog: PerformanceCatalog,
  warnings: string[],
): { animation: PerformanceCatalog["animations"][number]; args: Record<string, unknown> } | null => {
  const actions = section.actions || [];
  for (const action of actions.filter((candidate) => candidate.action === "play_animation")) {
    const args = actionArgs(action);
    const requestedActor = String(args.actor_id || args.actorId || "");
    if (requestedActor && requestedActor !== actorId) continue;
    const requestedId = String(args.animation_id || args.animationId || "");
    const animation = catalog.animations.find((candidate) => candidate.id === requestedId);
    if (!animation) {
      warnings.push(`${section.label}: rejected unavailable animation ${requestedId || "(missing id)"}.`);
      continue;
    }
    if (!isAnimationCompatible(animation, project, actorId)) {
      warnings.push(`${section.label}: rejected ${animation.label} for an incompatible body rig.`);
      continue;
    }
    return { animation, args };
  }
  return null;
};

const chooseVerifiedAnimation = (
  section: PlanSection,
  actorId: string,
  project: PerformanceProject,
  catalog: PerformanceCatalog,
  brief: string,
  sectionIndex: number,
): PerformanceCatalog["animations"][number] => {
  const compatible = catalog.animations.filter((animation) =>
    isAnimationCompatible(animation, project, actorId),
  );
  if (!compatible.length) throw new Error(`No verified animations are compatible with actor ${actorId}.`);
  const energetic = /dance|music|concert|energy|celebr|party|rhythm|song|perform/i.test(
    `${brief} ${section.label} ${section.notes || ""}`,
  );
  const categoryOrder = energetic
    ? ["dance", "gesture", "locomotion", "idle", "action"]
    : section.mood === "angry" || section.mood === "fear"
      ? ["action", "gesture", "locomotion", "dance", "idle"]
      : ["gesture", "idle", "dance", "locomotion", "action"];
  const category = categoryOrder[sectionIndex % Math.min(3, categoryOrder.length)];
  const matches = compatible.filter((animation) => animation.category === category);
  const pool = matches.length ? matches : compatible;
  return pool[sectionIndex % pool.length];
};

const cameraPreset = (section: PlanSection, actorCount: number): "wide" | "two-shot" | "portrait" | "orbit" => {
  if (section.camera === "full") return actorCount > 1 ? "two-shot" : "wide";
  if (section.camera === "head" || section.camera === "upper") return "portrait";
  if (section.camera === "mid") return actorCount > 1 ? "two-shot" : "portrait";
  return "wide";
};

const cameraCue = (
  section: PlanSection,
  actorCount: number,
  analysis: MusicAnalysis | undefined,
  action?: PlanAction,
  shotIndex = 0,
): Record<string, unknown> => {
  const evidence = analysisForSection(analysis, section);
  const speakerActorId = analysis?.speakers.find((speaker) => speaker.id === evidence.speakerId)?.actorId;
  const view = action?.action === "set_view" ? String(action.args?.view || "") : "";
  const preset = view === "full"
    ? actorCount > 1 ? "two-shot" : "wide"
    : view === "head" || view === "upper" || action?.action === "camera_punch"
      ? "portrait"
      : action?.action === "camera_orbit" ? "orbit"
        : action?.action === "camera_sweep" ? "profile"
          : cameraPreset(section, actorCount);
  return {
    preset,
    movement: action?.action === "set_view"
      ? "cut"
      : action?.action.replace("camera_", "") || (evidence.arousal > 0.72 ? "orbit" : "dolly"),
    amount: Number(action?.args?.angle ?? action?.args?.distance ?? action?.args?.endAngle ?? (evidence.arousal > 0.72 ? 28 : -0.45)),
    transitionMs: Math.max(360, Math.min(2_800, Number(action?.args?.duration_ms) || (1_800 - evidence.arousal * 1_100))),
    targetActorId: speakerActorId,
    handheld: action?.action === "camera_shake" ? Number(action.args?.intensity) || 0.2 : evidence.arousal > 0.86 ? 0.08 : 0,
    lensMm: section.camera === "head" ? 85 : section.camera === "upper" ? 65 : section.camera === "mid" ? 50 : 35,
    energy: evidence.energy,
    storyPurpose: section.notes || section.label,
    shotIndex,
  };
};

const cameraClipsForSection = (
  section: PlanSection,
  actorCount: number,
  analysis: MusicAnalysis | undefined,
): PerformanceClip[] => {
  const cameraActions = (section.actions || []).filter((action) =>
    action.action.startsWith("camera_") || action.action === "set_view",
  ).slice(0, 3);
  const actions: Array<PlanAction | undefined> = cameraActions.length ? cameraActions : [undefined];
  const requestedStarts = actions.map((action) => Math.max(section.start_ms, Math.min(section.end_ms - 1, action?.time_ms ?? section.start_ms)));
  const distinctStarts = new Set(requestedStarts).size === requestedStarts.length;
  const starts = distinctStarts
    ? requestedStarts
    : actions.map((_, index) => Math.round(section.start_ms + (section.end_ms - section.start_ms) * index / actions.length));
  return actions.map((action, index) => {
    const startMs = starts[index];
    const endMs = starts[index + 1] ?? section.end_ms;
    return createClip(
      actions.length > 1 ? `${section.label} / Shot ${index + 1}` : section.label,
      startMs,
      Math.max(1, endMs - startMs),
      cameraCue(section, actorCount, analysis, action, index),
    );
  });
};

const lightingPreset = (section: PlanSection): "studio" | "concert" | "noir" | "sunset" => ({
  neon: "concert",
  noir: "noir",
  sunset: "sunset",
  frost: "studio",
  crimson: "concert",
} as const)[section.light || "frost"];

const stageEffectCue = (section: PlanSection, analysis?: MusicAnalysis): Record<string, unknown> => {
  const evidence = analysisForSection(analysis, section);
  const energetic = evidence.arousal > 0.68;
  return {
    shader: section.effects === "vignette" ? "monochrome" : section.effects === "bloom" ? "aurora" : energetic ? "pulse" : "clean",
    particles: section.mood === "sad" ? "rain" : section.mood === "fear" ? "embers" : energetic ? "sparks" : "dust",
    physics: evidence.arousal > 0.82 ? "confetti" : "none",
    intensity: Math.max(0.18, Math.min(1, evidence.energy || 0.35)),
    pulseOnBeat: Boolean(analysis?.beatsMs.length),
    palette: section.light || "frost",
  };
};

const expressionValues = (section: PlanSection): Record<string, number> => {
  if (section.mood === "happy" || section.mood === "love") {
    return { mouthSmileLeft: 0.7, mouthSmileRight: 0.7, cheekSquintLeft: 0.2, cheekSquintRight: 0.2 };
  }
  if (section.mood === "angry") return { browDownLeft: 0.65, browDownRight: 0.65, mouthPressLeft: 0.25 };
  if (section.mood === "sad") return { mouthFrownLeft: 0.55, mouthFrownRight: 0.55, browInnerUp: 0.4 };
  if (section.mood === "fear") return { eyeWideLeft: 0.55, eyeWideRight: 0.55, jawOpen: 0.18 };
  return { mouthSmileLeft: 0.08, mouthSmileRight: 0.08 };
};

const requireDirectorResults = (result: PipelineResult, enabled: DirectorStage[]): void => {
  if (result.usedFallback || !result.performanceResult?.plan) {
    const detail = result.performanceResult?.error?.message;
    throw new Error(
      `Performance Director did not return a valid show${detail ? `: ${detail}` : ""}. The current project was not changed.`,
    );
  }
  const results = {
    stage: result.stageResult,
    camera: result.cameraResult,
    postfx: result.postFxResult,
  };
  for (const stage of enabled.filter((candidate) => candidate !== "performance")) {
    if (!results[stage as keyof typeof results]?.plan) {
      throw new Error(`${stage === "postfx" ? "PostFX" : stage[0].toUpperCase() + stage.slice(1)} Director did not return a valid plan. The current project was not changed.`);
    }
  }
};

const buildDirectedProject = (
  input: ShowDirectorInput,
  result: PipelineResult,
  warnings: string[],
  briefings: DirectorBriefing[],
): PerformanceProject => {
  const { project, catalog, brief, model, style, capabilities } = input;
  const next = structuredClone(project);
  const sections = result.plan.sections;
  next.title = result.plan.title?.trim() || project.title;
  next.tracks = next.tracks.filter((track) => !directorOwnedKinds.has(track.kind));

  next.tracks.push(createTrack("environment", "Stage / Environment", undefined, sections.map((section) =>
    createClip(project.environment.label, section.start_ms, section.end_ms - section.start_ms, { environmentId: project.environment.id }),
  )));
  next.tracks.push(createTrack("camera", "Camera Director", undefined, sections.flatMap((section) =>
    cameraClipsForSection(section, project.actors.length, input.musicAnalysis),
  )));
  next.tracks.push(createTrack("lighting", "Stage Director / Lighting", undefined, sections.map((section) =>
    createClip(section.label, section.start_ms, section.end_ms - section.start_ms, {
      preset: lightingPreset(section),
      energy: analysisForSection(input.musicAnalysis, section).energy,
      transitionMs: 900,
      pulseOnBeat: Boolean(input.musicAnalysis?.beatsMs.length),
    }),
  )));
  next.tracks.push(createTrack("stagefx", "Stage / Atmosphere + Physics", undefined, sections.map((section) =>
    createClip(section.label, section.start_ms, section.end_ms - section.start_ms, stageEffectCue(section, input.musicAnalysis)),
  )));

  for (const actor of next.actors) {
    actor.shader = "realismus";
    next.tracks.push(createTrack("shader", `${actor.label} / Material`, actor.id, [
      createClip("Realismus", 0, project.durationMs, { preset: "realismus" satisfies ShaderPresetId }),
    ]));
    next.tracks.push(createTrack("expression", `${actor.label} / Performance`, actor.id, sections.map((section) =>
      createClip(section.mood || "neutral", section.start_ms, section.end_ms - section.start_ms, expressionValues(section)),
    )));

    if (!capabilities.get(actor.id)?.animationCompatible) continue;
    const motionClips = sections.map((section, sectionIndex) => {
      const explicit = explicitAnimationFor(section, actor.id, project, catalog, warnings);
      const animation = explicit?.animation || chooseVerifiedAnimation(
        section,
        actor.id,
        project,
        catalog,
        brief,
        sectionIndex,
      );
      const sectionDuration = section.end_ms - section.start_ms;
      const requestedDuration = Number(explicit?.args.duration_ms);
      const durationMs = Number.isFinite(requestedDuration) && requestedDuration > 0
        ? Math.min(sectionDuration, requestedDuration)
        : animation.loop
          ? sectionDuration
          : Math.min(sectionDuration, animation.durationMs);
      return createClip(animation.label, section.start_ms, durationMs, {
        animationId: animation.id,
        url: animation.url,
        loop: explicit?.args.loop === false ? false : animation.loop,
        speed: typeof explicit?.args.speed === "number" ? explicit.args.speed : 1,
        source: animation.source,
        rig: animation.rig,
      });
    });
    next.tracks.push(createTrack("animation", `${actor.label} / Choreography`, actor.id, motionClips));
  }

  for (const speaker of input.musicAnalysis?.speakers || []) {
    if (!speaker.actorId || !next.actors.some((actor) => actor.id === speaker.actorId)) continue;
    const clips = input.musicAnalysis!.segments
      .filter((segment) => segment.speakerId === speaker.id)
      .map((segment) => createClip(
        `${speaker.id} / vocal`,
        segment.startMs,
        segment.endMs - segment.startMs,
        { speakerId: speaker.id, confidence: speaker.confidence },
      ));
    if (clips.length) next.tracks.push(createTrack("lipsync", `${next.actors.find((actor) => actor.id === speaker.actorId)!.label} / ${speaker.id} Lipsync`, speaker.actorId, clips));
  }

  const enabled = input.enabledDirectors || SHOW_DIRECTOR_STAGES;
  next.direction = {
    createdBy: "performance-director",
    model,
    style,
    brief,
    generatedAt: new Date().toISOString(),
    source: "llm",
    specialists: enabled,
    notes: {
      performance: result.performanceResult?.thoughts,
      stage: result.stageResult?.thoughts,
      camera: result.cameraResult?.thoughts,
      postfx: result.postFxResult?.thoughts,
    },
    briefings,
  };
  next.updatedAt = new Date().toISOString();
  return next;
};

export class PerformanceShowDirector {
  private orchestrator: DirectorOrchestrator | null = null;

  cancel(): void {
    this.orchestrator?.cancel();
  }

  async create(input: ShowDirectorInput, callbacks: ShowDirectorCallbacks = {}): Promise<DirectedShowResult> {
    const brief = input.brief.trim();
    if (!brief) throw new Error("Write a show brief before asking the Performance Director.");
    if (!input.model) throw new Error("No Core-X director model is available.");
    const enabledDirectors = input.enabledDirectors?.length
      ? [...new Set(["performance" as const, ...input.enabledDirectors])]
      : SHOW_DIRECTOR_STAGES;
    const sections = buildSections(brief, input.project.durationMs, input.musicAnalysis, input.project);
    const briefings: DirectorBriefing[] = [];
    this.orchestrator = createOrchestrator({
      baseUrl: input.baseUrl,
      model: input.model,
      style: input.style,
      seed: `${input.project.id}:${Date.now()}`,
      timeoutMs: 120_000,
      retries: 1,
      streaming: false,
      enableChunking: false,
      parallelStageCamera: false,
    });
    try {
      const pipeline = await this.orchestrator.run({
        sections,
        durationMs: input.project.durationMs,
        defaultLightPreset: "frost",
        defaultCameraView: input.project.actors.length > 1 ? "full" : "upper",
        enabledDirectors,
        performanceContext: {
          brief,
          cast: input.project.actors.map((actor) => ({
            id: actor.id,
            label: actor.label,
            kind: actor.asset.kind,
            body: actor.asset.body,
            animationCompatible: input.capabilities.get(actor.id)?.animationCompatible === true,
            performanceMode: input.capabilities.get(actor.id)?.performanceMode ||
              (actor.asset.kind === "head" ? "portrait-head" : "full-body"),
          })),
          animations: input.catalog.animations.map((animation) => ({
            id: animation.id,
            label: animation.label,
            category: animation.category,
            rig: animation.rig,
            body: animation.body,
            loop: animation.loop,
          })),
        },
      }, {
        onProgress: (event) => callbacks.onProgress?.(event.stage, event.status, event.message || ""),
        onThoughts: (stage, summary) => {
          const existing = briefings.find((briefing) => briefing.stage === stage);
          if (existing) existing.summary = summary;
          else briefings.push({ stage, summary, status: "complete", generatedAt: new Date().toISOString() });
          callbacks.onThoughts?.(stage, summary);
        },
      });
      requireDirectorResults(pipeline, enabledDirectors);
      const warnings: string[] = [];
      const project = buildDirectedProject(input, pipeline, warnings, briefings);
      return { project, pipeline, warnings, briefings };
    } finally {
      this.orchestrator = null;
    }
  }
}
