import type { PerformanceRoom } from "./room";
import { PerformanceScheduler } from "./scheduler";
import type {
  CameraPresetId,
  CompiledPerformanceEvent,
  CompiledSchedule,
  LightingPresetId,
  PerformanceCatalog,
  PerformanceProject,
  ShaderPresetId,
} from "./types";

export type PlaybackState = "stopped" | "playing" | "paused";

export interface PerformanceControllerCallbacks {
  onTime?: (timeMs: number, state: PlaybackState) => void;
  onSchedule?: (schedule: CompiledSchedule) => void;
  onError?: (message: string) => void;
  onState?: (state: PlaybackState) => void;
}

const CAMERA_PRESETS = new Set<CameraPresetId>(["wide", "two-shot", "portrait", "orbit", "profile", "low-angle", "overhead", "dutch"]);
const LIGHTING_PRESETS = new Set<LightingPresetId>(["studio", "concert", "noir", "sunset", "chiaroscuro", "silhouette"]);
const SHADER_PRESETS = new Set<ShaderPresetId>(["original", "hologram", "toon", "chrome", "xray"]);

export class PerformanceController {
  readonly scheduler = new PerformanceScheduler();
  private schedule: CompiledSchedule | null = null;
  private state: PlaybackState = "stopped";
  private currentTimeMs = 0;
  private eventCursor = 0;
  private syncGeneration = 0;
  private audio: HTMLAudioElement | null = null;
  private compileGeneration = 0;
  private activeLipSyncActors = new Set<string>();

  constructor(
    private room: PerformanceRoom,
    private catalog: PerformanceCatalog,
    private project: PerformanceProject,
    private callbacks: PerformanceControllerCallbacks = {},
  ) {
    this.room.setFrameHandler((deltaMs) => this.tick(deltaMs));
  }

  get playbackState(): PlaybackState {
    return this.state;
  }

  get timeMs(): number {
    return this.currentTimeMs;
  }

  get compiledSchedule(): CompiledSchedule | null {
    return this.schedule;
  }

  setAudio(audio: HTMLAudioElement | null): void {
    this.audio?.pause();
    this.audio = audio;
    if (this.audio) this.audio.currentTime = this.currentTimeMs / 1000;
  }

  async setProject(project: PerformanceProject): Promise<CompiledSchedule> {
    this.pause();
    this.project = project;
    this.currentTimeMs = Math.min(this.currentTimeMs, project.durationMs);
    const generation = ++this.compileGeneration;
    const schedule = await this.scheduler.compile(project);
    if (generation !== this.compileGeneration) return schedule;
    this.schedule = schedule;
    this.callbacks.onSchedule?.(schedule);
    await this.syncAt(this.currentTimeMs);
    return schedule;
  }

  async compile(): Promise<CompiledSchedule> {
    const generation = ++this.compileGeneration;
    const schedule = await this.scheduler.compile(this.project);
    if (generation !== this.compileGeneration) return schedule;
    this.schedule = schedule;
    this.callbacks.onSchedule?.(schedule);
    this.eventCursor = this.firstEventAfter(this.currentTimeMs);
    return schedule;
  }

  async play(): Promise<void> {
    if (!this.schedule) await this.compile();
    if (this.currentTimeMs >= this.project.durationMs) await this.seek(0);
    this.state = "playing";
    this.callbacks.onState?.(this.state);
    if (this.audio?.src) {
      this.audio.currentTime = this.currentTimeMs / 1000;
      try {
        await this.audio.play();
      } catch (error) {
        this.reportError(`Audio playback was blocked: ${String(error)}`);
      }
    }
  }

  pause(): void {
    if (this.state === "stopped") return;
    this.state = "paused";
    this.audio?.pause();
    this.resetLipSync();
    this.callbacks.onState?.(this.state);
    this.callbacks.onTime?.(this.currentTimeMs, this.state);
  }

  async stop(): Promise<void> {
    this.state = "stopped";
    this.audio?.pause();
    await this.seek(0);
    this.callbacks.onState?.(this.state);
  }

  async seek(timeMs: number): Promise<void> {
    this.currentTimeMs = Math.max(0, Math.min(this.project.durationMs, timeMs));
    if (this.audio?.src) this.audio.currentTime = this.currentTimeMs / 1000;
    await this.syncAt(this.currentTimeMs);
    this.callbacks.onTime?.(this.currentTimeMs, this.state);
  }

  private tick(deltaMs: number): void {
    if (this.state !== "playing") return;
    const previous = this.currentTimeMs;
    const audioTime = this.audio?.src && !this.audio.paused ? this.audio.currentTime * 1000 : null;
    this.currentTimeMs = Math.min(
      this.project.durationMs,
      audioTime !== null && Number.isFinite(audioTime) ? audioTime : previous + deltaMs,
    );
    this.dispatchRange(previous, this.currentTimeMs);
    this.applyMusicDrivenPerformance();
    this.callbacks.onTime?.(this.currentTimeMs, this.state);
    if (this.currentTimeMs >= this.project.durationMs) {
      this.state = "stopped";
      this.audio?.pause();
      this.callbacks.onState?.(this.state);
    }
  }

  private dispatchRange(previousMs: number, nextMs: number): void {
    if (!this.schedule || nextMs < previousMs) return;
    while (this.eventCursor < this.schedule.events.length) {
      const event = this.schedule.events[this.eventCursor];
      if (event.timeMs > nextMs) break;
      this.eventCursor += 1;
      if (event.timeMs > previousMs) void this.execute(event, 0, this.syncGeneration);
    }
  }

  private async syncAt(timeMs: number): Promise<void> {
    const generation = ++this.syncGeneration;
    for (const actor of this.project.actors) {
      this.room.stopAnimation(actor.id);
      this.room.setActorShader(actor.id, actor.shader);
      this.room.resetExpression(actor.id);
      this.room.resetLipSync(actor.id);
    }
    this.activeLipSyncActors.clear();
    this.room.resetStageEffects();
    this.room.setCameraPreset("two-shot");
    this.room.setLightingPreset("studio");
    try {
      await this.room.setEnvironment(this.project.environment);
    } catch (error) {
      this.reportError(String(error));
    }
    if (generation !== this.syncGeneration || !this.schedule) return;

    const latest = new Map<string, CompiledPerformanceEvent>();
    const activeAnimations = new Map<string, CompiledPerformanceEvent>();
    const activeExpressions = new Map<string, CompiledPerformanceEvent>();
    const activeLipSync = new Map<string, CompiledPerformanceEvent>();
    for (const event of this.schedule.events) {
      if (event.timeMs > timeMs) break;
      if (event.action === "animation:start" && event.actorId) {
        if (event.endMs > timeMs) activeAnimations.set(event.actorId, event);
        else activeAnimations.delete(event.actorId);
        continue;
      }
      if (event.action === "animation:stop" && event.actorId) {
        activeAnimations.delete(event.actorId);
        continue;
      }
      if (event.action === "expression:set" && event.actorId) {
        if (event.endMs > timeMs) activeExpressions.set(event.actorId, event);
        else activeExpressions.delete(event.actorId);
        continue;
      }
      if (event.action === "expression:reset" && event.actorId) {
        activeExpressions.delete(event.actorId);
        continue;
      }
      if (event.action === "lipsync:start" && event.actorId) {
        if (event.endMs > timeMs) activeLipSync.set(event.actorId, event);
        else activeLipSync.delete(event.actorId);
        continue;
      }
      if (event.action === "lipsync:stop" && event.actorId) {
        activeLipSync.delete(event.actorId);
        continue;
      }
      const key = event.actorId ? `${event.action}:${event.actorId}` : event.action;
      latest.set(key, event);
    }
    for (const event of latest.values()) await this.execute(event, 0, generation);
    for (const event of activeAnimations.values()) {
      await this.execute(event, timeMs - event.timeMs, generation);
    }
    for (const event of activeExpressions.values()) await this.execute(event, 0, generation);
    for (const event of activeLipSync.values()) await this.execute(event, timeMs - event.timeMs, generation);
    this.applyMusicDrivenPerformance();
    this.eventCursor = this.firstEventAfter(timeMs);
  }

  private firstEventAfter(timeMs: number): number {
    if (!this.schedule) return 0;
    let low = 0;
    let high = this.schedule.events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.schedule.events[middle].timeMs <= timeMs) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private async execute(event: CompiledPerformanceEvent, offsetMs: number, generation: number): Promise<void> {
    try {
      if (generation !== this.syncGeneration) return;
      if (event.action === "animation:start" && event.actorId) {
        const url = typeof event.data.url === "string" ? event.data.url : "";
        if (!url) throw new Error("Animation clip has no source URL.");
        await this.room.playAnimation(event.actorId, url, {
          loop: event.data.loop === true,
          speed: typeof event.data.speed === "number" ? event.data.speed : 1,
          offsetMs,
        });
        if (generation !== this.syncGeneration) this.room.stopAnimation(event.actorId);
      } else if (event.action === "animation:stop" && event.actorId) {
        this.room.stopAnimation(event.actorId);
      } else if (event.action === "shader:set" && event.actorId) {
        const preset = String(event.data.preset) as ShaderPresetId;
        if (SHADER_PRESETS.has(preset)) this.room.setActorShader(event.actorId, preset);
      } else if (event.action === "expression:set" && event.actorId) {
        const values = Object.fromEntries(
          Object.entries(event.data).filter(([, value]) => typeof value === "number"),
        ) as Record<string, number>;
        this.room.setExpression(event.actorId, values);
      } else if (event.action === "expression:reset" && event.actorId) {
        this.room.resetExpression(event.actorId);
      } else if (event.action === "camera:set") {
        const preset = String(event.data.preset) as CameraPresetId;
        if (CAMERA_PRESETS.has(preset)) {
          this.room.setCameraCue({
            preset,
            movement: typeof event.data.movement === "string" ? event.data.movement : undefined,
            amount: typeof event.data.amount === "number" ? event.data.amount : undefined,
            transitionMs: typeof event.data.transitionMs === "number" ? event.data.transitionMs : undefined,
            targetActorId: typeof event.data.targetActorId === "string" ? event.data.targetActorId : undefined,
            handheld: typeof event.data.handheld === "number" ? event.data.handheld : undefined,
            lensMm: typeof event.data.lensMm === "number" ? event.data.lensMm : undefined,
            energy: typeof event.data.energy === "number" ? event.data.energy : undefined,
          }, offsetMs);
        }
      } else if (event.action === "lighting:set") {
        const preset = String(event.data.preset) as LightingPresetId;
        if (LIGHTING_PRESETS.has(preset)) this.room.setLightingCue({
          preset,
          pulseOnBeat: event.data.pulseOnBeat === true,
          energy: typeof event.data.energy === "number" ? event.data.energy : undefined,
        });
      } else if (event.action === "environment:set") {
        const environment = this.catalog.environments.find((item) => item.id === event.data.environmentId);
        if (environment) await this.room.setEnvironment(environment);
      } else if (event.action === "lipsync:start" && event.actorId) {
        this.activeLipSyncActors.add(event.actorId);
      } else if (event.action === "lipsync:stop" && event.actorId) {
        this.activeLipSyncActors.delete(event.actorId);
        this.room.resetLipSync(event.actorId);
      } else if (event.action === "stagefx:set") {
        await this.room.setStageEffects({
          shader: typeof event.data.shader === "string" ? event.data.shader as "clean" | "aurora" | "pulse" | "monochrome" : "clean",
          particles: typeof event.data.particles === "string" ? event.data.particles as "none" | "dust" | "sparks" | "rain" | "embers" : "none",
          physics: event.data.physics === "confetti" ? "confetti" : "none",
          intensity: typeof event.data.intensity === "number" ? event.data.intensity : 0,
          palette: typeof event.data.palette === "string" ? event.data.palette : "frost",
          pulseOnBeat: event.data.pulseOnBeat === true,
        });
      } else if (event.action === "stagefx:reset") {
        this.room.resetStageEffects();
      }
    } catch (error) {
      this.reportError(`${event.action}: ${String(error)}`);
    }
  }

  private energyAt(timeMs: number): number {
    const envelope = this.project.audio?.analysis?.energyEnvelope;
    if (!envelope?.length) return 0.32;
    let low = 0;
    let high = envelope.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (envelope[middle].timeMs <= timeMs) low = middle;
      else high = middle - 1;
    }
    return envelope[low]?.value ?? 0.32;
  }

  private applyMusicDrivenPerformance(): void {
    const energy = this.energyAt(this.currentTimeMs);
    this.room.setMusicEnergy(energy);
    for (const actor of this.project.actors) {
      if (this.activeLipSyncActors.has(actor.id)) this.room.setLipSync(actor.id, 0.08 + energy * 0.74);
      else this.room.resetLipSync(actor.id);
    }
  }

  private resetLipSync(): void {
    for (const actorId of this.activeLipSyncActors) this.room.resetLipSync(actorId);
  }

  private reportError(message: string): void {
    this.callbacks.onError?.(message.replace(/^Error:\s*/, ""));
  }

  dispose(): void {
    this.audio?.pause();
    this.scheduler.dispose();
    this.room.setFrameHandler(() => undefined);
  }
}
