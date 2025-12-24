/**
 * Director Pipeline Orchestrator
 * Coordinates Performance → Stage → Camera director flow
 * Supports cancellation, progress events, fallback handling
 */

import { PerformanceDirector } from "../directors/performance-director";
import { StageDirector, StageDirectorContext } from "../directors/stage-director";
import { CameraDirector, CameraDirectorContext } from "../directors/camera-director";
import { DirectorOptions, AnalyzeOptions, DirectorResult } from "../directors/base-director";
import {
  DirectorPlan,
  DirectorStage,
  InputSection,
  MergedPlan,
  PlanSection,
  ProgressEvent,
  StreamChunkEvent,
  MOODS,
  CAMERA_VIEWS,
  LIGHT_PRESETS,
  clamp
} from "../directors/types";
import { chunkSections, mergeChunkedPlans, shouldChunk } from "../utils/chunker";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  baseUrl: string;
  model: string;
  style?: string;
  seed?: string;
  timeoutMs?: number;
  maxTokens?: number;
  retries?: number;
  streaming?: boolean;
  enableChunking?: boolean;
  parallelStageCamera?: boolean;
}

export interface OrchestratorCallbacks {
  onProgress?: (event: ProgressEvent) => void;
  onChunk?: (event: StreamChunkEvent) => void;
  onThoughts?: (stage: DirectorStage, thoughts: string) => void;
  onStageComplete?: (stage: DirectorStage, result: DirectorResult) => void;
  onFallback?: (reason: string) => void;
}

export interface PipelineInput {
  sections: InputSection[];
  durationMs: number;
  defaultLightPreset?: string;
  defaultCameraView?: string;
}

export interface PipelineResult {
  plan: MergedPlan;
  performanceResult?: DirectorResult;
  stageResult?: DirectorResult;
  cameraResult?: DirectorResult;
  totalDurationMs: number;
  usedFallback: boolean;
}

// ─────────────────────────────────────────────────────────────
// Orchestrator Class
// ─────────────────────────────────────────────────────────────

export class DirectorOrchestrator {
  private performanceDirector: PerformanceDirector;
  private stageDirector: StageDirector;
  private cameraDirector: CameraDirector;
  private abortController: AbortController | null = null;
  private options: OrchestratorOptions;

  constructor(options: OrchestratorOptions) {
    this.options = options;

    const directorOpts: DirectorOptions = {
      baseUrl: options.baseUrl,
      model: options.model,
      style: options.style,
      seed: options.seed,
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens,
      retries: options.retries,
      streaming: options.streaming
    };

    this.performanceDirector = new PerformanceDirector(directorOpts);
    this.stageDirector = new StageDirector(directorOpts);
    this.cameraDirector = new CameraDirector(directorOpts);
  }

  /**
   * Update the seed for fresh generation
   */
  updateSeed(seed?: string): void {
    const newSeed = seed || new Date().toISOString();
    const directorOpts: DirectorOptions = {
      baseUrl: this.options.baseUrl,
      model: this.options.model,
      style: this.options.style,
      seed: newSeed,
      timeoutMs: this.options.timeoutMs,
      maxTokens: this.options.maxTokens,
      retries: this.options.retries,
      streaming: this.options.streaming
    };

    this.performanceDirector = new PerformanceDirector(directorOpts);
    this.stageDirector = new StageDirector(directorOpts);
    this.cameraDirector = new CameraDirector(directorOpts);
  }

  /**
   * Run the full director pipeline
   */
  async run(
    input: PipelineInput,
    callbacks?: OrchestratorCallbacks
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const { sections, durationMs, defaultLightPreset = "neon", defaultCameraView = "upper" } = input;
    const { onProgress, onChunk, onThoughts, onStageComplete, onFallback } = callbacks || {};

    let performanceResult: DirectorResult | undefined;
    let stageResult: DirectorResult | undefined;
    let cameraResult: DirectorResult | undefined;
    let usedFallback = false;

    try {
      // ─────────────────────────────────────────────────────────
      // Stage 1: Performance Director (Required)
      // ─────────────────────────────────────────────────────────

      const analyzeOptions: AnalyzeOptions = {
        signal,
        onProgress,
        onChunk,
        onThoughts: (thoughts) => onThoughts?.("performance", thoughts)
      };

      // Check if we need to chunk for long songs
      if (this.options.enableChunking && shouldChunk(sections)) {
        performanceResult = await this.runChunkedPerformance(sections, durationMs, analyzeOptions);
      } else {
        performanceResult = await this.performanceDirector.analyze(
          sections,
          durationMs,
          undefined,
          analyzeOptions
        );
      }

      onStageComplete?.("performance", performanceResult);

      // Check if performance succeeded
      if (!performanceResult.plan || performanceResult.plan.sections.length === 0) {
        onFallback?.("Performance director returned no valid plan");
        usedFallback = true;

        return {
          plan: this.createFallbackPlan(sections, durationMs, defaultLightPreset, defaultCameraView),
          performanceResult,
          totalDurationMs: Date.now() - startTime,
          usedFallback: true
        };
      }

      // ─────────────────────────────────────────────────────────
      // Stage 2 & 3: Stage + Camera Directors
      // ─────────────────────────────────────────────────────────

      const stageContext: StageDirectorContext = {
        performancePlan: performanceResult.plan
      };

      if (this.options.parallelStageCamera !== false) {
        // Run Stage and Camera in parallel for speed
        const [stageSettled, cameraSettled] = await Promise.allSettled([
          this.stageDirector.analyze(sections, durationMs, stageContext, {
            signal,
            onProgress,
            onChunk,
            onThoughts: (thoughts) => onThoughts?.("stage", thoughts)
          }),
          // Camera gets performance plan, stage will be null since parallel
          this.cameraDirector.analyze(sections, durationMs, {
            performancePlan: performanceResult.plan,
            stagePlan: null
          } as CameraDirectorContext, {
            signal,
            onProgress,
            onChunk,
            onThoughts: (thoughts) => onThoughts?.("camera", thoughts)
          })
        ]);

        stageResult = stageSettled.status === "fulfilled" ? stageSettled.value : undefined;
        cameraResult = cameraSettled.status === "fulfilled" ? cameraSettled.value : undefined;

        if (stageSettled.status === "rejected") {
          console.warn("Stage director failed:", stageSettled.reason);
        }
        if (cameraSettled.status === "rejected") {
          console.warn("Camera director failed:", cameraSettled.reason);
        }
      } else {
        // Run sequentially (Stage first, then Camera with stage context)
        try {
          stageResult = await this.stageDirector.analyze(
            sections,
            durationMs,
            stageContext,
            {
              signal,
              onProgress,
              onChunk,
              onThoughts: (thoughts) => onThoughts?.("stage", thoughts)
            }
          );
          onStageComplete?.("stage", stageResult);
        } catch (err) {
          console.warn("Stage director failed:", err);
        }

        try {
          const cameraContext: CameraDirectorContext = {
            performancePlan: performanceResult.plan,
            stagePlan: stageResult?.plan || null
          };

          cameraResult = await this.cameraDirector.analyze(
            sections,
            durationMs,
            cameraContext,
            {
              signal,
              onProgress,
              onChunk,
              onThoughts: (thoughts) => onThoughts?.("camera", thoughts)
            }
          );
          onStageComplete?.("camera", cameraResult);
        } catch (err) {
          console.warn("Camera director failed:", err);
        }
      }

      // ─────────────────────────────────────────────────────────
      // Merge Plans
      // ─────────────────────────────────────────────────────────

      const mergedPlan = this.mergePlans(
        performanceResult.plan,
        stageResult?.plan || null,
        cameraResult?.plan || null,
        defaultLightPreset,
        defaultCameraView
      );

      // Collect director notes
      mergedPlan.performanceNotes = this.formatNotes(performanceResult);
      mergedPlan.stageNotes = stageResult ? this.formatNotes(stageResult) : undefined;
      mergedPlan.cameraNotes = cameraResult ? this.formatNotes(cameraResult) : undefined;

      return {
        plan: mergedPlan,
        performanceResult,
        stageResult,
        cameraResult,
        totalDurationMs: Date.now() - startTime,
        usedFallback
      };

    } catch (error) {
      // Handle cancellation
      if (error instanceof Error && error.message.includes("cancelled")) {
        onProgress?.({
          stage: "performance",
          status: "cancelled",
          message: "Pipeline cancelled by user"
        });
      }
      throw error;

    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel the running pipeline
   */
  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * Check if pipeline is currently running
   */
  isRunning(): boolean {
    return this.abortController !== null;
  }

  // ─────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Run performance director with chunking for long songs
   */
  private async runChunkedPerformance(
    sections: InputSection[],
    durationMs: number,
    options: AnalyzeOptions
  ): Promise<DirectorResult> {
    const chunks = chunkSections(sections, { maxSectionsPerChunk: 8 });
    const results: Array<DirectorPlan | null> = [];
    const startTime = Date.now();

    options.onProgress?.({
      stage: "performance",
      status: "running",
      message: `Processing ${chunks.length} chunks...`,
      chunk: 0,
      totalChunks: chunks.length
    });

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkDuration = chunk[chunk.length - 1].end_ms - chunk[0].start_ms;

      options.onProgress?.({
        stage: "performance",
        status: "running",
        message: `Chunk ${i + 1}/${chunks.length}`,
        chunk: i + 1,
        totalChunks: chunks.length
      });

      const result = await this.performanceDirector.analyze(
        chunk,
        chunkDuration,
        undefined,
        {
          ...options,
          onProgress: (e) => {
            options.onProgress?.({
              ...e,
              chunk: i + 1,
              totalChunks: chunks.length
            });
          }
        }
      );

      results.push(result.plan);

      // Small delay between chunks to prevent overwhelming
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    const merged = mergeChunkedPlans(results.filter(Boolean) as DirectorPlan[]);

    return {
      plan: {
        title: "Chunked Performance",
        sections: merged.sections,
        actions: merged.actions
      },
      response: null,
      durationMs: Date.now() - startTime
    };
  }

  /**
   * Merge plans from all three directors
   */
  private mergePlans(
    performancePlan: DirectorPlan,
    stagePlan: DirectorPlan | null,
    cameraPlan: DirectorPlan | null,
    defaultLight: string,
    defaultCamera: string
  ): MergedPlan {
    const sections: PlanSection[] = performancePlan.sections.map((section, index) => {
      const stageSection = stagePlan?.sections[index];
      const cameraSection = cameraPlan?.sections[index];

      // Merge notes from all directors
      const notes = [
        section.notes,
        stageSection?.notes,
        cameraSection?.notes
      ].filter(Boolean).join(" | ");

      // Merge actions from all directors
      const actions = [
        ...(section.actions || []),
        ...(stageSection?.actions || []),
        ...(cameraSection?.actions || [])
      ].sort((a, b) => a.time_ms - b.time_ms);

      return {
        ...section,
        light: stageSection?.light || section.light || defaultLight as PlanSection["light"],
        camera: cameraSection?.camera || section.camera || defaultCamera as PlanSection["camera"],
        notes: notes || undefined,
        actions: actions.length > 0 ? actions : undefined
      };
    });

    // Merge global actions
    const actions = [
      ...(performancePlan.actions || []),
      ...(stagePlan?.actions || []),
      ...(cameraPlan?.actions || [])
    ].sort((a, b) => a.time_ms - b.time_ms);

    return {
      title: performancePlan.title || "Performance Plan",
      sections,
      actions: actions.length > 0 ? actions : undefined,
      source: "llm"
    };
  }

  /**
   * Create a fallback plan when directors fail
   */
  private createFallbackPlan(
    sections: InputSection[],
    durationMs: number,
    defaultLight: string,
    defaultCamera: string
  ): MergedPlan {
    const moodOptions = MOODS.slice(0, 6); // neutral through angry
    const cameraOptions = CAMERA_VIEWS;
    const lightOptions = LIGHT_PRESETS;

    const planSections: PlanSection[] = sections.map((section, index) => {
      // Rotate through options for variety
      const mood = moodOptions[index % moodOptions.length];
      const camera = cameraOptions[index % cameraOptions.length];
      const light = lightOptions[index % lightOptions.length];

      // Generate a few random actions per section
      const actions: PlanSection["actions"] = [];
      const sectionDuration = section.end_ms - section.start_ms;

      // Add a gesture mid-section for longer sections
      if (sectionDuration > 3000) {
        const gestures = ["handup", "index", "ok", "thumbup", "shrug"];
        actions.push({
          time_ms: section.start_ms + Math.floor(sectionDuration * 0.4),
          action: "play_gesture",
          args: { gesture: gestures[index % gestures.length] }
        });
      }

      return {
        label: `Section ${index + 1}`,
        start_ms: section.start_ms,
        end_ms: section.end_ms,
        role: index % 3 === 0 ? "ensemble" : "solo" as PlanSection["role"],
        mood,
        camera,
        light,
        notes: "Heuristic fallback",
        actions: actions.length > 0 ? actions : undefined
      };
    });

    return {
      title: "Fallback Performance",
      sections: planSections,
      source: "heuristic"
    };
  }

  /**
   * Format director notes from result with full metadata
   * Captures all decisions for data-pool storage
   */
  private formatNotes(result: DirectorResult): string {
    const parts: string[] = [];
    const meta = result.meta;

    // Header with model info
    if (meta) {
      parts.push(`=== Director Analysis ===`);
      parts.push(`Model: ${meta.model}`);
      parts.push(`Style: ${meta.style}`);
      parts.push(`Timestamp: ${meta.timestamp}`);
      parts.push(`Duration: ${result.durationMs}ms`);
      parts.push(`Sections: ${meta.sectionCount}`);
      parts.push(`Parse Success: ${meta.parseSuccess ? 'Yes' : 'No'}`);
      if (meta.seed) {
        parts.push(`Seed: ${meta.seed.slice(0, 20)}...`);
      }
      parts.push(``);
    }

    // Creative decisions
    if (result.thoughts) {
      parts.push(`--- Creative Vision ---`);
      parts.push(result.thoughts);
      parts.push(``);
    }

    if (result.analysis) {
      parts.push(`--- Lyrical Analysis ---`);
      parts.push(result.analysis);
      parts.push(``);
    }

    if (result.selectionReason) {
      parts.push(`--- Selection Rationale ---`);
      parts.push(result.selectionReason);
      parts.push(``);
    }

    // Error info if any
    if (result.error) {
      parts.push(`--- Error ---`);
      parts.push(`${result.error.name}: ${result.error.message}`);
      parts.push(``);
    }

    // Section summary
    if (result.plan?.sections && result.plan.sections.length > 0) {
      parts.push(`--- Section Decisions ---`);
      result.plan.sections.forEach((section, i) => {
        const details = [
          section.mood && `mood:${section.mood}`,
          section.camera && `camera:${section.camera}`,
          section.light && `light:${section.light}`,
          section.role && `role:${section.role}`,
          section.actions?.length && `actions:${section.actions.length}`
        ].filter(Boolean).join(', ');
        parts.push(`  [${i + 1}] ${section.label}: ${details}`);
      });
    }

    return parts.join("\n") || "No notes available";
  }
}

// ─────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────

export function createOrchestrator(options: OrchestratorOptions): DirectorOrchestrator {
  return new DirectorOrchestrator(options);
}
