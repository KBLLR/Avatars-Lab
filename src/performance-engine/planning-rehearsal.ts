import type { DirectorStage } from "../directors/types";
import type { PerformanceRoom } from "./room";
import type { ActorRuntimeCapabilities, PerformanceCatalog, PerformanceProject } from "./types";

interface PlanningVoiceConfig {
  baseUrl: string;
  model?: string;
  voice?: string;
  enabled: boolean;
}

export interface PlanningRehearsalCallbacks {
  onVoiceState?: (message: string) => void;
}

const stageLabel = (stage: DirectorStage): string => stage === "postfx"
  ? "PostFX Director"
  : `${stage[0].toUpperCase()}${stage.slice(1)} Director`;

class DirectorVoiceQueue {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(private config: PlanningVoiceConfig, private callbacks: PlanningRehearsalCallbacks) {}

  async start(): Promise<void> {
    this.generation += 1;
    if (!this.config.enabled || !this.config.model) {
      this.callbacks.onVoiceState?.("Director voice is off or no local TTS model is available");
      return;
    }
    this.context ||= new AudioContext();
    await this.context.resume();
    this.callbacks.onVoiceState?.(`Director briefings audible / ${this.config.model}`);
  }

  enqueue(stage: DirectorStage, summary: string): void {
    if (!this.config.enabled || !this.config.model || !summary.trim()) return;
    const generation = this.generation;
    this.queue = this.queue.then(async () => {
      if (generation !== this.generation || !this.context) return;
      this.callbacks.onVoiceState?.(`${stageLabel(stage)} speaking`);
      const response = await fetch(`${this.config.baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          input: `${stageLabel(stage)}. ${summary}`,
          voice: this.config.voice || "default",
          response_format: "wav",
          speed: stage === "camera" ? 1.04 : stage === "stage" ? 0.96 : 1,
        }),
      });
      if (!response.ok) throw new Error(`Director voice failed (${response.status}).`);
      if (generation !== this.generation) return;
      const buffer = await this.context.decodeAudioData((await response.arrayBuffer()).slice(0));
      if (generation !== this.generation) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      this.source = source;
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
      if (this.source === source) this.source = null;
    }).catch((error) => {
      this.callbacks.onVoiceState?.(error instanceof Error ? error.message : String(error));
    });
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  stop(): void {
    this.generation += 1;
    try { this.source?.stop(); } catch { /* already ended */ }
    this.source = null;
    this.queue = Promise.resolve();
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.context?.close();
    this.context = null;
  }
}

export class DirectorPlanningRehearsal {
  private voice: DirectorVoiceQueue;
  private timer = 0;
  private activeStage: DirectorStage = "performance";
  private shotIndex = 0;
  private actorIndex = 0;
  private actorIds: string[] = [];

  constructor(
    private room: PerformanceRoom,
    voiceConfig: PlanningVoiceConfig,
    callbacks: PlanningRehearsalCallbacks = {},
  ) {
    this.voice = new DirectorVoiceQueue(voiceConfig, callbacks);
  }

  async start(
    project: PerformanceProject,
    catalog: PerformanceCatalog,
    capabilities: Map<string, ActorRuntimeCapabilities>,
  ): Promise<void> {
    this.stopVisuals();
    this.actorIds = project.actors.map((actor) => actor.id);
    this.activeStage = "performance";
    this.shotIndex = 0;
    this.actorIndex = 0;
    await this.voice.start();
    const rehearsalClips = catalog.animations.filter((animation) => animation.loop &&
      (animation.category === "idle" || animation.category === "gesture"));
    for (const actor of project.actors) {
      if (!capabilities.get(actor.id)?.animationCompatible) continue;
      const clip = rehearsalClips.find((animation) =>
        animation.body === "any" || !actor.asset.body || animation.body === actor.asset.body,
      );
      if (clip) void this.room.playAnimation(actor.id, clip.url, { loop: true, speed: 0.28 }).catch(() => undefined);
    }
    await this.room.setStageEffects({ shader: "aurora", particles: "dust", physics: "none", intensity: 0.24, palette: "frost" });
    this.nextShot();
    this.timer = window.setInterval(() => this.nextShot(), 4_200);
  }

  focus(stage: DirectorStage): void {
    this.activeStage = stage;
    this.shotIndex += 1;
    this.nextShot();
  }

  briefing(stage: DirectorStage, summary: string): void {
    this.focus(stage);
    this.voice.enqueue(stage, summary);
  }

  async finish(project: PerformanceProject): Promise<void> {
    await this.voice.drain();
    this.stop(project);
  }

  private nextShot(): void {
    const actorId = this.actorIds.length ? this.actorIds[this.actorIndex % this.actorIds.length] : undefined;
    this.room.setPlanningShot(this.activeStage, actorId, this.shotIndex);
    this.actorIndex += 1;
    this.shotIndex += 1;
  }

  private stopVisuals(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  stop(project?: PerformanceProject): void {
    this.stopVisuals();
    this.voice.stop();
    for (const actorId of this.actorIds) this.room.stopAnimation(actorId);
    this.room.resetStageEffects();
    this.actorIds = [];
    if (project) this.room.setCameraPreset(project.actors.length > 1 ? "two-shot" : "portrait");
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.voice.dispose();
  }
}
