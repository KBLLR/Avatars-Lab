/**
 * Base Director Class
 * Abstract base for Performance, Stage, and Camera directors
 */

import { requestLLM, LLMRequestError } from "../llm/request";
import { parseDirectorResponse, IncrementalJsonValidator } from "../llm/streaming-parser";
import type {
  DirectorConfig,
  DirectorPlan,
  DirectorResponse,
  DirectorStage,
  InputSection,
  ProgressEvent,
  StreamChunkEvent,
  DEFAULT_DIRECTOR_CONFIG
} from "./types";

export interface DirectorOptions {
  baseUrl: string;
  model: string;
  style?: string;
  seed?: string;
  timeoutMs?: number;
  maxTokens?: number;
  retries?: number;
  streaming?: boolean;
}

export interface AnalyzeOptions {
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  onChunk?: (event: StreamChunkEvent) => void;
  onThoughts?: (thoughts: string) => void;
}

export interface DirectorResult {
  plan: DirectorPlan | null;
  response: DirectorResponse | null;
  thoughts?: string;
  analysis?: string;
  selectionReason?: string;
  error?: Error;
  durationMs: number;
}

/**
 * Abstract base class for all directors
 */
export abstract class BaseDirector {
  protected readonly stage: DirectorStage;
  protected readonly baseUrl: string;
  protected readonly model: string;
  protected readonly style: string;
  protected readonly seed: string;
  protected readonly timeoutMs: number;
  protected readonly maxTokens: number;
  protected readonly retries: number;
  protected readonly streaming: boolean;

  constructor(stage: DirectorStage, options: DirectorOptions) {
    this.stage = stage;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.style = options.style || "cinematic";
    this.seed = options.seed || new Date().toISOString();
    this.timeoutMs = options.timeoutMs || 45000;
    this.maxTokens = options.maxTokens || 1500;
    this.retries = options.retries || 2;
    this.streaming = options.streaming ?? true;
  }

  /**
   * Build the prompt for this director - must be implemented by subclasses
   */
  protected abstract buildPrompt(
    sections: InputSection[],
    durationMs: number,
    context?: unknown
  ): string;

  /**
   * Get the stage name for display
   */
  getStageName(): string {
    const names: Record<DirectorStage, string> = {
      performance: "Performance Director",
      stage: "Stage Director",
      camera: "Camera Director"
    };
    return names[this.stage];
  }

  /**
   * Analyze sections and generate a plan
   */
  async analyze(
    sections: InputSection[],
    durationMs: number,
    context?: unknown,
    options?: AnalyzeOptions
  ): Promise<DirectorResult> {
    const startTime = Date.now();
    const { signal, onProgress, onChunk, onThoughts } = options || {};

    // Emit starting progress
    onProgress?.({
      stage: this.stage,
      status: "running",
      message: `${this.getStageName()} analyzing...`
    });

    try {
      const prompt = this.buildPrompt(sections, durationMs, context);
      const validator = new IncrementalJsonValidator();
      let thoughtsEmitted = false;

      const response = await requestLLM({
        baseUrl: this.baseUrl,
        model: this.model,
        prompt,
        maxTokens: this.estimateMaxTokens(sections.length),
        temperature: 0.4,
        timeoutMs: this.timeoutMs,
        retries: this.retries,
        stream: this.streaming,
        signal,
        onChunk: this.streaming ? (chunk, accumulated) => {
          // Update validator with new chunk
          const progress = validator.append(chunk);

          // Emit chunk event
          onChunk?.({
            stage: this.stage,
            text: chunk,
            accumulated
          });

          // Emit thoughts as soon as we have them
          if (!thoughtsEmitted && progress.thoughtsSummary) {
            onThoughts?.(progress.thoughtsSummary);
            thoughtsEmitted = true;
          }

          // Update progress with section count
          if (progress.sectionsFound > 0) {
            onProgress?.({
              stage: this.stage,
              status: "running",
              message: `${this.getStageName()}: ${progress.sectionsFound} sections processed`,
              thoughtsPreview: progress.thoughtsSummary
            });
          }
        } : undefined,
        onProgress: (message) => {
          onProgress?.({
            stage: this.stage,
            status: "running",
            message
          });
        }
      });

      // Parse the response
      const rawContent = this.streaming ? validator.getBuffer() : response.content;
      const parsed = parseDirectorResponse(rawContent, durationMs);

      if (!parsed) {
        onProgress?.({
          stage: this.stage,
          status: "failed",
          message: `${this.getStageName()}: Invalid JSON response`
        });

        return {
          plan: null,
          response: null,
          error: new Error("Failed to parse director response as valid JSON"),
          durationMs: Date.now() - startTime
        };
      }

      // Extract metadata
      const thoughts = parsed.thoughts_summary || undefined;
      if (thoughts && !thoughtsEmitted) {
        onThoughts?.(thoughts);
      }

      onProgress?.({
        stage: this.stage,
        status: "complete",
        message: `${this.getStageName()}: ${parsed.plan.sections.length} sections planned`,
        thoughtsPreview: thoughts
      });

      return {
        plan: parsed.plan,
        response: parsed,
        thoughts: parsed.thoughts_summary,
        analysis: parsed.analysis,
        selectionReason: parsed.selection_reason,
        durationMs: Date.now() - startTime
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      const isCancelled = error instanceof LLMRequestError && error.code === "cancelled";
      const status = isCancelled ? "cancelled" : "failed";

      onProgress?.({
        stage: this.stage,
        status,
        message: `${this.getStageName()}: ${err.message}`
      });

      return {
        plan: null,
        response: null,
        error: err,
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Estimate max tokens needed based on section count
   */
  protected estimateMaxTokens(sectionCount: number): number {
    const baseTokens = 600;
    const perSectionTokens = 100;
    const estimated = baseTokens + sectionCount * perSectionTokens;
    return Math.min(Math.max(estimated, this.maxTokens), 4000);
  }

  /**
   * Build the common JSON schema instruction
   */
  protected buildSchemaInstruction(): string {
    return `OUTPUT FORMAT (strict JSON, no markdown):
{
  "thoughts_summary": "1-2 sentences, ≤50 words, speakable summary of your creative vision",
  "analysis": "brief analysis of the lyrical content",
  "selection_reason": "why you chose these actions",
  "plan": {
    "title": "creative title for this performance",
    "sections": [
      {
        "label": "section name",
        "start_ms": number,
        "end_ms": number,
        "role": "solo" | "ensemble",
        "mood": "neutral" | "happy" | "love" | "fear" | "sad" | "angry",
        "notes": "verbs:[...] emotions:[...] -> actions:[...]",
        "actions": [{ "time_ms": number, "action": "action_name", "args": {} }]
      }
    ]
  }
}`;
  }
}
