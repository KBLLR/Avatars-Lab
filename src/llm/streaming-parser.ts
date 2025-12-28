/**
 * Streaming JSON Parser
 * Parses partial JSON and extracts readable progress as it streams
 * Includes model-specific handling for different LLM output formats
 */

import type { DirectorResponse, PlanSection } from "../directors/types";
import {
  preprocessForModel,
  extractJsonFromResponse,
  getModelParser,
  parseHarmonyFormat,
  extractJsonFromHarmony
} from "./model-parsers";

export interface StreamingProgress {
  thoughtsSummary?: string;
  sectionsFound: number;
  currentSection?: Partial<PlanSection>;
  isComplete: boolean;
  rawLength: number;
}

/**
 * Extract progress information from partial JSON string
 */
export function extractStreamingProgress(partialJson: string): StreamingProgress {
  const progress: StreamingProgress = {
    sectionsFound: 0,
    isComplete: false,
    rawLength: partialJson.length
  };

  // Try to extract thoughts_summary first (usually appears early)
  const thoughtsMatch = partialJson.match(/"thoughts_summary"\s*:\s*"([^"]*)/);
  if (thoughtsMatch) {
    progress.thoughtsSummary = thoughtsMatch[1];
  }

  // Count completed sections (by counting role assignments which come at end of section)
  const sectionMatches = partialJson.match(/"role"\s*:\s*"(solo|ensemble)"/g);
  if (sectionMatches) {
    progress.sectionsFound = sectionMatches.length;
  }

  // Try to parse current section being written
  const lastSectionStart = partialJson.lastIndexOf('{"label"');
  if (lastSectionStart > 0) {
    const sectionFragment = partialJson.slice(lastSectionStart);
    const labelMatch = sectionFragment.match(/"label"\s*:\s*"([^"]*)/);
    if (labelMatch) {
      progress.currentSection = { label: labelMatch[1] };
    }
  }

  // Check if JSON appears complete
  const trimmed = partialJson.trim();
  if (trimmed.endsWith("}") || trimmed.endsWith("}]")) {
    try {
      JSON.parse(partialJson);
      progress.isComplete = true;
    } catch {
      // Not complete yet
    }
  }

  return progress;
}

/**
 * Parse context for model-specific handling
 */
export interface ParseContext {
  modelId?: string;
  debug?: boolean;
}

/**
 * Attempt to parse complete or partial director response
 * Now with model-specific preprocessing and handling
 */
export function parseDirectorResponse(
  raw: string,
  durationMs: number,
  context?: ParseContext
): DirectorResponse | null {
  const modelId = context?.modelId;
  const debug = context?.debug ?? false;
  const modelConfig = modelId ? getModelParser(modelId) : null;

  if (debug && modelConfig) {
    console.log(`[Parser] Using config for model: ${modelConfig.name}`);
  }

  // For harmony-enabled models, show channel breakdown
  if (debug && modelConfig?.useHarmonyParser) {
    const channels = parseHarmonyFormat(raw);
    console.log(`[Parser] Harmony channels detected:`);
    console.log(`  - ANALYSIS: ${channels.analysis?.length ?? 0} chars`);
    console.log(`  - COMMENTARY: ${channels.commentary?.length ?? 0} chars`);
    console.log(`  - FINAL: ${channels.final?.length ?? 0} chars`);
    if (channels.final) {
      console.log(`  - FINAL preview: ${channels.final.slice(0, 200)}...`);
    }

    // Try to extract JSON from harmony and show result
    const harmonyJson = extractJsonFromHarmony(raw);
    if (harmonyJson) {
      console.log(`[Parser] Harmony JSON extracted (${harmonyJson.length} chars):`);
      console.log(`  - Preview: ${harmonyJson.slice(0, 200)}...`);

      // Validate it's parseable
      try {
        JSON.parse(harmonyJson);
        console.log(`[Parser] Harmony JSON is valid!`);
      } catch (e) {
        console.log(`[Parser] Harmony JSON parse error: ${(e as Error).message}`);
      }
    } else {
      console.log(`[Parser] No JSON found in harmony output`);
    }
  }

  // Apply model-specific preprocessing
  let cleaned = preprocessForModel(raw, modelId);

  if (debug) {
    console.log(`[Parser] After preprocessing (${cleaned.length} chars):`, cleaned.slice(0, 200));
  }

  // Try to parse as-is first
  try {
    const parsed = JSON.parse(cleaned);
    return normalizeDirectorResponse(parsed, durationMs, modelConfig?.lenientStructure);
  } catch (e) {
    if (debug) {
      console.log(`[Parser] Direct parse failed:`, (e as Error).message);
    }
  }

  // Try model-aware JSON extraction
  const extracted = extractJsonFromResponse(raw, modelId);
  if (extracted && extracted !== cleaned) {
    if (debug) {
      console.log(`[Parser] Trying extracted JSON (${extracted.length} chars)`);
    }
    try {
      const parsed = JSON.parse(extracted);
      return normalizeDirectorResponse(parsed, durationMs, modelConfig?.lenientStructure);
    } catch {
      // Continue with repair
    }
  }

  // Try to repair truncated JSON
  const repaired = attemptJsonRepair(cleaned);
  if (repaired) {
    if (debug) {
      console.log(`[Parser] Trying repaired JSON (${repaired.length} chars)`);
    }
    try {
      const parsed = JSON.parse(repaired);
      return normalizeDirectorResponse(parsed, durationMs, modelConfig?.lenientStructure);
    } catch {
      // Repair failed
    }
  }

  // Last resort: try extracted + repair
  if (extracted) {
    const extractedRepaired = attemptJsonRepair(extracted);
    if (extractedRepaired) {
      try {
        const parsed = JSON.parse(extractedRepaired);
        return normalizeDirectorResponse(parsed, durationMs, modelConfig?.lenientStructure);
      } catch {
        // All attempts failed
      }
    }
  }

  if (debug) {
    console.log(`[Parser] All parsing attempts failed for model: ${modelId || 'unknown'}`);
    console.log(`[Parser] Raw input (first 500 chars): ${raw.slice(0, 500)}`);
    console.log(`[Parser] Cleaned input (first 500 chars): ${cleaned.slice(0, 500)}`);
    if (extracted) {
      console.log(`[Parser] Extracted JSON (first 500 chars): ${extracted.slice(0, 500)}`);
    }
  }

  return null;
}

/**
 * Normalize the director response to ensure consistent structure
 * @param lenient - If true, be more flexible with structure (accept nested formats)
 */
function normalizeDirectorResponse(
  parsed: unknown,
  durationMs: number,
  lenient = false
): DirectorResponse | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Handle both { plan: { sections: [...] } } and { sections: [...] } formats
  let planObj = (obj.plan && typeof obj.plan === "object")
    ? obj.plan as Record<string, unknown>
    : obj;

  // Lenient mode: try deeper nesting if sections not found
  if (lenient && !Array.isArray(planObj.sections)) {
    // Try { response: { plan: { sections: [...] } } }
    if (obj.response && typeof obj.response === "object") {
      const respObj = obj.response as Record<string, unknown>;
      if (respObj.plan && typeof respObj.plan === "object") {
        planObj = respObj.plan as Record<string, unknown>;
      } else if (Array.isArray(respObj.sections)) {
        planObj = respObj;
      }
    }
    // Try { result: { sections: [...] } }
    if (!Array.isArray(planObj.sections) && obj.result && typeof obj.result === "object") {
      const resultObj = obj.result as Record<string, unknown>;
      if (Array.isArray(resultObj.sections)) {
        planObj = resultObj;
      }
    }
  }

  if (!Array.isArray(planObj.sections)) {
    return null;
  }

  const sections: PlanSection[] = planObj.sections
    .filter((s: unknown) => s && typeof s === "object")
    .map((section: unknown) => normalizePlanSection(section as Record<string, unknown>, durationMs))
    .filter((s: PlanSection | null): s is PlanSection => s !== null);

  if (sections.length === 0) {
    return null;
  }

  return {
    thoughts_summary: typeof obj.thoughts_summary === "string" ? obj.thoughts_summary : undefined,
    analysis: typeof obj.analysis === "string" ? obj.analysis : undefined,
    selection_reason: typeof obj.selection_reason === "string" ? obj.selection_reason : undefined,
    plan: {
      title: typeof planObj.title === "string" ? planObj.title : "Performance Plan",
      sections,
      actions: normalizeActions(planObj.actions, 0, durationMs)
    }
  };
}

/**
 * Normalize a single plan section
 */
function normalizePlanSection(
  section: Record<string, unknown>,
  durationMs: number
): PlanSection | null {
  const start_ms = clamp(Number(section.start_ms) || 0, 0, durationMs);
  const end_ms = clamp(Number(section.end_ms) || durationMs, start_ms, durationMs);

  if (end_ms <= start_ms) {
    return null;
  }

  return {
    label: String(section.label || "Section"),
    start_ms,
    end_ms,
    role: section.role === "ensemble" ? "ensemble" : "solo",
    mood: isValidMood(section.mood) ? section.mood : undefined,
    camera: isValidCamera(section.camera) ? section.camera : undefined,
    light: isValidLight(section.light) ? section.light : undefined,
    notes: section.notes ? String(section.notes) : undefined,
    actions: normalizeActions(section.actions, start_ms, end_ms)
  };
}

/**
 * Normalize action array
 */
function normalizeActions(
  actions: unknown,
  minTime: number,
  maxTime: number
): PlanSection["actions"] {
  if (!Array.isArray(actions)) {
    return undefined;
  }

  const normalized = actions
    .filter((a: unknown) => a && typeof a === "object")
    .map((action: unknown) => {
      const a = action as Record<string, unknown>;
      const actionName = String(a.action || "");
      const args = (a.args && typeof a.args === "object")
        ? a.args as Record<string, unknown>
        : {};

      if ((actionName === "make_facial_expression" || actionName === "speak_emoji")) {
        const emojiValue = typeof args.emoji === "string" ? args.emoji.trim() : "";
        let normalized = emojiValue;

        if (!FACE_EMOJIS.has(normalized)) {
          const cleaned = emojiValue
            .toLowerCase()
            .replace(/[:_\\-\\s]/g, "")
            .replace(/(face|emoji)$/g, "");
          normalized = FACE_EMOJI_NAMES.get(cleaned) || EMOJI_FALLBACK;
        }

        if (!FACE_EMOJIS.has(normalized)) {
          normalized = EMOJI_FALLBACK;
        }

        args.emoji = normalized;
      }

      return {
        time_ms: clamp(Number(a.time_ms) || minTime, minTime, maxTime),
        action: actionName,
        args
      };
    })
    .filter((a): a is NonNullable<typeof a> => Boolean(a && a.action.length > 0));

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Attempt to repair truncated JSON
 */
function attemptJsonRepair(json: string): string | null {
  let repaired = json;

  // Count open/close brackets and braces
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const char of repaired) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") braces++;
    if (char === "}") braces--;
    if (char === "[") brackets++;
    if (char === "]") brackets--;
  }

  // If we're inside a string, close it
  if (inString) {
    repaired += '"';
  }

  // Close any open brackets/braces
  while (brackets > 0) {
    repaired += "]";
    brackets--;
  }
  while (braces > 0) {
    repaired += "}";
    braces--;
  }

  return repaired;
}

// Validation helpers
const VALID_MOODS = ["neutral", "happy", "love", "fear", "sad", "angry", "disgust", "sleep"];
const VALID_CAMERAS = ["full", "mid", "upper", "head"];
const VALID_LIGHTS = ["neon", "noir", "sunset", "frost", "crimson"];
const FACE_EMOJIS = new Set([
  "😐", "😶", "😏", "🙂", "🙃", "😊", "😇", "😀", "😃", "😄", "😁", "😆",
  "😝", "😋", "😛", "😜", "🤪", "😂", "🤣", "😅", "😉", "😭", "🥺", "😞",
  "😔", "😳", "☹️", "😚", "😘", "🥰", "😍", "🤩", "😡", "😠", "🤬", "😒",
  "😱", "😬", "🙄", "🤔", "👀", "😴"
]);
const EMOJI_FALLBACK = "😐";
const FACE_EMOJI_NAMES = new Map<string, string>([
  ["neutral", "😐"],
  ["happy", "😊"],
  ["smile", "🙂"],
  ["smiley", "😀"],
  ["joy", "😂"],
  ["laugh", "😂"],
  ["sad", "😔"],
  ["cry", "😭"],
  ["crying", "😭"],
  ["angry", "😠"],
  ["mad", "😠"],
  ["fear", "😱"],
  ["scared", "😱"],
  ["disgust", "😒"],
  ["gross", "😒"],
  ["love", "😍"],
  ["sleep", "😴"],
  ["sleepy", "😴"],
  ["tired", "😴"],
  ["confused", "🤔"],
  ["thinking", "🤔"],
  ["surprised", "😳"],
  ["shock", "😳"]
]);

function isValidMood(value: unknown): value is PlanSection["mood"] {
  return typeof value === "string" && VALID_MOODS.includes(value);
}

function isValidCamera(value: unknown): value is PlanSection["camera"] {
  return typeof value === "string" && VALID_CAMERAS.includes(value);
}

function isValidLight(value: unknown): value is PlanSection["light"] {
  return typeof value === "string" && VALID_LIGHTS.includes(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Create an incremental JSON validator that processes chunks
 * Now with model-aware parsing support
 */
export class IncrementalJsonValidator {
  private buffer = "";
  private lastProgress: StreamingProgress | null = null;
  private modelId?: string;
  private debug = false;

  constructor(options?: { modelId?: string; debug?: boolean }) {
    this.modelId = options?.modelId;
    this.debug = options?.debug ?? false;
  }

  setModelId(modelId: string): void {
    this.modelId = modelId;
  }

  append(chunk: string): StreamingProgress {
    this.buffer += chunk;
    this.lastProgress = extractStreamingProgress(this.buffer);
    return this.lastProgress;
  }

  getBuffer(): string {
    return this.buffer;
  }

  getProgress(): StreamingProgress | null {
    return this.lastProgress;
  }

  getModelId(): string | undefined {
    return this.modelId;
  }

  parse(durationMs: number): DirectorResponse | null {
    return parseDirectorResponse(this.buffer, durationMs, {
      modelId: this.modelId,
      debug: this.debug
    });
  }

  reset(): void {
    this.buffer = "";
    this.lastProgress = null;
  }
}
