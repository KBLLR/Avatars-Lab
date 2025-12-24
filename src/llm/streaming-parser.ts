/**
 * Streaming JSON Parser
 * Parses partial JSON and extracts readable progress as it streams
 */

import type { DirectorResponse, PlanSection } from "../directors/types";

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
 * Attempt to parse complete or partial director response
 */
export function parseDirectorResponse(
  raw: string,
  durationMs: number
): DirectorResponse | null {
  // Clean up common LLM output issues
  let cleaned = raw.trim();

  // Remove markdown code blocks if present
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Try to parse as-is first
  try {
    const parsed = JSON.parse(cleaned);
    return normalizeDirectorResponse(parsed, durationMs);
  } catch {
    // Continue with repair attempts
  }

  // Try to repair truncated JSON
  const repaired = attemptJsonRepair(cleaned);
  if (repaired) {
    try {
      const parsed = JSON.parse(repaired);
      return normalizeDirectorResponse(parsed, durationMs);
    } catch {
      // Repair failed
    }
  }

  return null;
}

/**
 * Normalize the director response to ensure consistent structure
 */
function normalizeDirectorResponse(
  parsed: unknown,
  durationMs: number
): DirectorResponse | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Handle both { plan: { sections: [...] } } and { sections: [...] } formats
  const planObj = (obj.plan && typeof obj.plan === "object")
    ? obj.plan as Record<string, unknown>
    : obj;

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
      return {
        time_ms: clamp(Number(a.time_ms) || minTime, minTime, maxTime),
        action: String(a.action || ""),
        args: (a.args && typeof a.args === "object") ? a.args as Record<string, unknown> : {}
      };
    })
    .filter(a => a.action.length > 0);

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
 */
export class IncrementalJsonValidator {
  private buffer = "";
  private lastProgress: StreamingProgress | null = null;

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

  parse(durationMs: number): DirectorResponse | null {
    return parseDirectorResponse(this.buffer, durationMs);
  }

  reset(): void {
    this.buffer = "";
    this.lastProgress = null;
  }
}
