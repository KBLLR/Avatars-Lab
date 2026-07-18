import type {
  CompiledPerformanceEvent,
  CompiledSchedule,
  PerformanceProject,
  PerformanceTrackKind
} from "./types";

const ACTIONS: Partial<Record<PerformanceTrackKind, CompiledPerformanceEvent["action"]>> = {
  animation: "animation:start",
  expression: "expression:set",
  shader: "shader:set",
  camera: "camera:set",
  lighting: "lighting:set",
  environment: "environment:set",
  lipsync: "lipsync:start",
  stagefx: "stagefx:set"
};

export const compilePerformanceProject = (project: PerformanceProject): CompiledSchedule => {
  const started = performance.now();
  const warnings: string[] = [];
  const events: CompiledPerformanceEvent[] = [];
  const actorIds = new Set(project.actors.map((actor) => actor.id));

  for (const track of project.tracks) {
    if (track.muted || track.kind === "audio") continue;
    if (track.actorId && !actorIds.has(track.actorId)) {
      warnings.push(`${track.name}: actor ${track.actorId} is missing.`);
      continue;
    }
    const action = ACTIONS[track.kind];
    if (!action) continue;
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    let previousEnd = -1;
    for (const clip of sorted) {
      const startMs = Math.max(0, Math.min(project.durationMs, Math.round(clip.startMs)));
      const durationMs = Math.max(1, Math.round(clip.durationMs));
      const endMs = Math.min(project.durationMs, startMs + durationMs);
      if (startMs < previousEnd && track.kind !== "expression" && track.kind !== "lipsync") {
        warnings.push(`${track.name}: ${clip.label} overlaps the previous clip.`);
      }
      previousEnd = Math.max(previousEnd, endMs);
      events.push({
        id: `${clip.id}:start`,
        timeMs: startMs,
        endMs,
        action,
        actorId: track.actorId,
        clipId: clip.id,
        data: { ...clip.data }
      });
      if (track.kind === "animation") {
        events.push({
          id: `${clip.id}:stop`,
          timeMs: endMs,
          endMs,
          action: "animation:stop",
          actorId: track.actorId,
          clipId: clip.id,
          data: {}
        });
      } else if (track.kind === "expression") {
        events.push({
          id: `${clip.id}:reset`,
          timeMs: endMs,
          endMs,
          action: "expression:reset",
          actorId: track.actorId,
          clipId: clip.id,
          data: {}
        });
      } else if (track.kind === "lipsync") {
        events.push({
          id: `${clip.id}:stop`,
          timeMs: endMs,
          endMs,
          action: "lipsync:stop",
          actorId: track.actorId,
          clipId: clip.id,
          data: {}
        });
      }
    }
  }

  events.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
  return {
    projectId: project.id,
    durationMs: project.durationMs,
    events,
    warnings,
    compiledAt: new Date().toISOString(),
    compileMs: performance.now() - started
  };
};
