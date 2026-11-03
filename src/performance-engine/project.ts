import {
  PERFORMANCE_PROJECT_SCHEMA,
  TRACK_KINDS,
  createId,
  trackColor,
  type PerformanceCatalog,
  type PerformanceClip,
  type MusicAnalysis,
  type PerformanceProject,
  type PerformanceTrack,
  type PerformanceTrackKind,
} from "./types";

const LOCAL_PROJECT_KEY = "avatarLabs.performanceEngine.project.v1";
const ALLOWED_FPS = new Set([24, 25, 30, 50, 60]);
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
const MAX_TRACKS = 128;
const MAX_CLIPS = 2048;

const now = (): string => new Date().toISOString();

const makeTrack = (
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

const makeClip = (
  label: string,
  startMs: number,
  durationMs: number,
  data: Record<string, unknown>,
): PerformanceClip => ({ id: createId("clip"), label, startMs, durationMs, data });

export const createDefaultProject = (
  catalog: PerformanceCatalog,
  random: () => number = Math.random,
): PerformanceProject => {
  const bodies = catalog.actors.filter((asset) => asset.kind === "body");
  if (!bodies.length) throw new Error("Performance Engine found no full-body avatar assets.");
  const randomValue = Math.max(0, Math.min(0.999999, Number(random()) || 0));
  const body = bodies[Math.floor(randomValue * bodies.length)];

  const actors = [body].map((asset) => ({
    id: createId("actor"),
    label: asset.label.replace(/ \/ (Head|Body)$/, ""),
    asset,
    shader: "realismus" as const,
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    scale: 1,
    visible: true,
  }));
  const bodyActor = actors[0];
  const animation = catalog.animations.find((candidate) => candidate.id.includes("standing-neutral")) ||
    catalog.animations.find((candidate) => candidate.category === "idle") ||
    catalog.animations[0];
  const environment = catalog.environments[0];
  const durationMs = 30_000;
  const createdAt = now();
  const tracks: PerformanceTrack[] = [
    makeTrack("audio", "Score"),
    makeTrack("environment", "Environment", undefined, [
      makeClip(environment.label, 0, durationMs, { environmentId: environment.id }),
    ]),
    makeTrack("camera", "Camera", undefined, [
      makeClip("Solo Wide", 0, durationMs, {
        preset: "wide",
        targetActorId: bodyActor.id,
        lensMm: 50,
        autoCastFraming: true,
      }),
    ]),
    makeTrack("lighting", "Lighting", undefined, [
      makeClip("Studio", 0, durationMs, { preset: "studio" }),
    ]),
  ];
  if (animation) {
    tracks.push(makeTrack("animation", `${bodyActor.label} / Motion`, bodyActor.id, [
        makeClip(animation.label, 0, durationMs, {
          animationId: animation.id,
          url: animation.url,
          loop: animation.loop,
          speed: 1,
        }),
      ]));
  }
  tracks.push(makeTrack("shader", `${bodyActor.label} / Look`, bodyActor.id, [
    makeClip("Realismus", 0, durationMs, { preset: "realismus" }),
  ]));

  return {
    schema: PERFORMANCE_PROJECT_SCHEMA,
    id: createId("performance"),
    title: "Untitled Performance",
    durationMs,
    fps: 30,
    actors,
    environment,
    tracks,
    createdAt,
    updatedAt: createdAt,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
};

const parseMusicAnalysis = (value: unknown, durationMs: number): MusicAnalysis | undefined => {
  if (!isRecord(value) || value.schema !== "avatar-labs.music-analysis.v1" ||
    !Array.isArray(value.energyEnvelope) || !Array.isArray(value.segments) ||
    !Array.isArray(value.speakers) || !Array.isArray(value.beatsMs) || !Array.isArray(value.warnings)) {
    return undefined;
  }
  const energyEnvelope = value.energyEnvelope.flatMap((sample) => {
    if (!isRecord(sample) || typeof sample.timeMs !== "number" || typeof sample.value !== "number") return [];
    return [{ timeMs: Math.max(0, Math.min(durationMs, sample.timeMs)), value: Math.max(0, Math.min(1, sample.value)) }];
  });
  const segments = value.segments.flatMap((segment) => {
    if (!isRecord(segment) || typeof segment.startMs !== "number" || typeof segment.endMs !== "number") return [];
    const startMs = Math.max(0, Math.min(durationMs - 1, Math.round(segment.startMs)));
    const endMs = Math.max(startMs + 1, Math.min(durationMs, Math.round(segment.endMs)));
    return [{
      id: typeof segment.id === "string" ? segment.id : createId("song_segment"),
      startMs,
      endMs,
      text: typeof segment.text === "string" ? segment.text : "Vocal passage",
      speakerId: typeof segment.speakerId === "string" ? segment.speakerId : undefined,
      energy: Math.max(0, Math.min(1, Number(segment.energy) || 0)),
      arousal: Math.max(0, Math.min(1, Number(segment.arousal) || 0)),
      valence: Math.max(0, Math.min(1, Number(segment.valence) || 0.5)),
    }];
  });
  const speakers = value.speakers.flatMap((speaker) => {
    if (!isRecord(speaker) || typeof speaker.id !== "string") return [];
    const confidence = ["low", "medium", "high"].includes(String(speaker.confidence))
      ? speaker.confidence as "low" | "medium" | "high"
      : "low";
    return [{
      id: speaker.id,
      durationMs: Math.max(0, Number(speaker.durationMs) || 0),
      actorId: typeof speaker.actorId === "string" ? speaker.actorId : undefined,
      confidence,
    }];
  });
  const source = isRecord(value.source) ? value.source : {};
  return {
    schema: "avatar-labs.music-analysis.v1",
    analyzedAt: typeof value.analyzedAt === "string" ? value.analyzedAt : now(),
    durationMs,
    tempoBpm: typeof value.tempoBpm === "number" && Number.isFinite(value.tempoBpm) ? value.tempoBpm : undefined,
    beatsMs: value.beatsMs.filter((beat): beat is number => typeof beat === "number" && Number.isFinite(beat))
      .map((beat) => Math.max(0, Math.min(durationMs, beat))),
    energyEnvelope,
    segments,
    speakers,
    source: {
      signal: "web-audio",
      transcription: typeof source.transcription === "string" ? source.transcription : undefined,
      diarisation: typeof source.diarisation === "string" ? source.diarisation : undefined,
      speakerReview: source.speakerReview === "manual" || source.speakerReview === "mlx+manual"
        ? source.speakerReview
        : undefined,
    },
    warnings: value.warnings.filter((warning): warning is string => typeof warning === "string"),
  };
};

export const parsePerformanceProject = (
  payload: unknown,
  catalog: PerformanceCatalog,
): PerformanceProject => {
  if (!isRecord(payload) || payload.schema !== PERFORMANCE_PROJECT_SCHEMA) {
    throw new Error(`Expected ${PERFORMANCE_PROJECT_SCHEMA}.`);
  }
  const durationMs = Math.round(finiteNumber(payload.durationMs, "durationMs"));
  if (durationMs < 1_000 || durationMs > MAX_DURATION_MS) {
    throw new Error("Performance duration must be between 1 second and 4 hours.");
  }
  const fps = finiteNumber(payload.fps, "fps");
  if (!ALLOWED_FPS.has(fps)) throw new Error("Unsupported project frame rate.");
  if (!Array.isArray(payload.actors) || payload.actors.length < 1 || payload.actors.length > 4) {
    throw new Error("A performance project must contain 1 to 4 actors.");
  }
  const catalogAssets = new Map(catalog.actors.map((asset) => [asset.id, asset]));
  const actorIds = new Set<string>();
  const actors = payload.actors.map((raw, index) => {
    if (!isRecord(raw) || !isRecord(raw.asset) || typeof raw.asset.id !== "string") {
      throw new Error(`Actor ${index + 1} is invalid.`);
    }
    const asset = catalogAssets.get(raw.asset.id);
    if (!asset) throw new Error(`Actor asset ${raw.asset.id} is not available in this installation.`);
    const id = typeof raw.id === "string" && raw.id ? raw.id : createId("actor");
    if (actorIds.has(id)) throw new Error(`Actor ID ${id} is duplicated.`);
    actorIds.add(id);
    const position = isRecord(raw.position) ? raw.position : {};
    const shader = ["realismus", "original", "hologram", "toon", "chrome", "xray"].includes(String(raw.shader))
      ? raw.shader as PerformanceProject["actors"][number]["shader"]
      : "realismus";
    return {
      id,
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : asset.label,
      asset,
      shader,
      position: {
        x: Math.max(-8, Math.min(8, Number(position.x) || 0)),
        y: Math.max(-2, Math.min(6, Number(position.y) || 0)),
        z: Math.max(-8, Math.min(8, Number(position.z) || 0)),
      },
      rotationY: Math.max(-Math.PI * 2, Math.min(Math.PI * 2, Number(raw.rotationY) || 0)),
      scale: Math.max(0.1, Math.min(5, Number(raw.scale) || 1)),
      visible: raw.visible !== false,
    };
  });

  if (!Array.isArray(payload.tracks) || payload.tracks.length > MAX_TRACKS) {
    throw new Error(`A project can contain at most ${MAX_TRACKS} tracks.`);
  }
  let clipCount = 0;
  const tracks = payload.tracks.map((raw, trackIndex) => {
    if (!isRecord(raw) || !TRACK_KINDS.includes(raw.kind as PerformanceTrackKind)) {
      throw new Error(`Track ${trackIndex + 1} has an invalid kind.`);
    }
    if (raw.actorId && (typeof raw.actorId !== "string" || !actorIds.has(raw.actorId))) {
      throw new Error(`Track ${trackIndex + 1} references a missing actor.`);
    }
    if (!Array.isArray(raw.clips)) throw new Error(`Track ${trackIndex + 1} has invalid clips.`);
    clipCount += raw.clips.length;
    if (clipCount > MAX_CLIPS) throw new Error(`A project can contain at most ${MAX_CLIPS} clips.`);
    const kind = raw.kind as PerformanceTrackKind;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId(`track_${kind}`),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : kind,
      kind,
      actorId: typeof raw.actorId === "string" ? raw.actorId : undefined,
      muted: raw.muted === true,
      locked: raw.locked === true,
      color: typeof raw.color === "string" ? raw.color : trackColor(kind),
      clips: raw.clips.map((clipRaw, clipIndex) => {
        if (!isRecord(clipRaw) || !isRecord(clipRaw.data)) {
          throw new Error(`Track ${trackIndex + 1}, clip ${clipIndex + 1} is invalid.`);
        }
        const startMs = Math.max(0, Math.min(durationMs - 1, Math.round(finiteNumber(clipRaw.startMs, "clip.startMs"))));
        const duration = Math.max(1, Math.min(durationMs - startMs, Math.round(finiteNumber(clipRaw.durationMs, "clip.durationMs"))));
        return {
          id: typeof clipRaw.id === "string" && clipRaw.id ? clipRaw.id : createId("clip"),
          label: typeof clipRaw.label === "string" && clipRaw.label.trim() ? clipRaw.label.trim() : "Clip",
          startMs,
          durationMs: duration,
          data: { ...clipRaw.data },
          color: typeof clipRaw.color === "string" ? clipRaw.color : undefined,
        };
      }),
    };
  });

  const environmentId = isRecord(payload.environment) && typeof payload.environment.id === "string"
    ? payload.environment.id
    : "";
  const environment = catalog.environments.find((item) => item.id === environmentId) || catalog.environments[0];
  if (!environment) throw new Error("No compatible performance environment is available.");
  let direction: PerformanceProject["direction"];
  if (payload.direction !== undefined) {
    if (!isRecord(payload.direction) ||
      payload.direction.createdBy !== "performance-director" ||
      payload.direction.source !== "llm" ||
      typeof payload.direction.model !== "string" ||
      typeof payload.direction.style !== "string" ||
      typeof payload.direction.brief !== "string" ||
      typeof payload.direction.generatedAt !== "string" ||
      !Array.isArray(payload.direction.specialists)) {
      throw new Error("Performance direction provenance is invalid.");
    }
    const allowedSpecialists = new Set(["performance", "stage", "camera", "postfx"]);
    const specialists = payload.direction.specialists.filter(
      (value): value is "performance" | "stage" | "camera" | "postfx" =>
        typeof value === "string" && allowedSpecialists.has(value),
    );
    if (specialists.length !== payload.direction.specialists.length || !specialists.includes("performance")) {
      throw new Error("Performance direction specialists are invalid.");
    }
    const rawNotes = isRecord(payload.direction.notes) ? payload.direction.notes : {};
    const directionGeneratedAt = payload.direction.generatedAt;
    direction = {
      createdBy: "performance-director",
      model: payload.direction.model,
      style: payload.direction.style,
      brief: payload.direction.brief,
      generatedAt: payload.direction.generatedAt,
      source: "llm",
      specialists,
      notes: Object.fromEntries(
        Object.entries(rawNotes).filter(([key, value]) => allowedSpecialists.has(key) && typeof value === "string"),
      ),
      briefings: Array.isArray(payload.direction.briefings)
        ? payload.direction.briefings.flatMap((briefing) => {
          if (!isRecord(briefing) || typeof briefing.stage !== "string" ||
            !allowedSpecialists.has(briefing.stage) || typeof briefing.summary !== "string") return [];
          return [{
            stage: briefing.stage as "performance" | "stage" | "camera" | "postfx",
            summary: briefing.summary,
            status: briefing.status === "failed" ? "failed" as const : "complete" as const,
            generatedAt: typeof briefing.generatedAt === "string" ? briefing.generatedAt : directionGeneratedAt,
          }];
        })
        : undefined,
    };
  }
  const timestamp = now();
  return {
    schema: PERFORMANCE_PROJECT_SCHEMA,
    id: typeof payload.id === "string" && payload.id ? payload.id : createId("performance"),
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Untitled Performance",
    durationMs,
    fps: fps as PerformanceProject["fps"],
    actors,
    environment,
    tracks,
    audio: isRecord(payload.audio) && typeof payload.audio.name === "string" ? {
      name: payload.audio.name,
      warehouseId: typeof payload.audio.warehouseId === "string" ? payload.audio.warehouseId : undefined,
      durationMs: typeof payload.audio.durationMs === "number" ? payload.audio.durationMs : undefined,
      analysis: parseMusicAnalysis(payload.audio.analysis, durationMs),
    } : undefined,
    direction,
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : timestamp,
    updatedAt: timestamp,
  };
};

export const saveProjectLocally = (project: PerformanceProject): void => {
  const serializable = {
    ...project,
    audio: project.audio ? { ...project.audio, objectUrl: undefined } : undefined,
    updatedAt: now(),
  };
  localStorage.setItem(LOCAL_PROJECT_KEY, JSON.stringify(serializable));
};

export const loadProjectLocally = (catalog: PerformanceCatalog): PerformanceProject | null => {
  const raw = localStorage.getItem(LOCAL_PROJECT_KEY);
  if (!raw) return null;
  return parsePerformanceProject(JSON.parse(raw), catalog);
};

export const exportProjectJson = (project: PerformanceProject): Blob => new Blob([
  JSON.stringify({
    ...project,
    audio: project.audio ? { ...project.audio, objectUrl: undefined } : undefined,
    updatedAt: now(),
  }, null, 2),
], { type: "application/json" });
