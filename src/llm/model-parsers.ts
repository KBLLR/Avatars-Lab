/**
 * Model-Specific Parser Configurations
 *
 * Different LLM models have different output characteristics:
 * - Some wrap JSON in markdown code blocks
 * - Some use different field names or structures
 * - Some add preamble text before JSON
 * - Some have specific formatting quirks
 *
 * GPT-OSS models use the Harmony format with three channels:
 * - ANALYSIS: Reasoning/thinking content
 * - COMMENTARY: Tool/function calls
 * - FINAL: Response text (this is where our JSON lives)
 *
 * This module provides model-specific parsing strategies.
 */

// ─────────────────────────────────────────────────────────────
// Harmony Format Parser for GPT-OSS
// ─────────────────────────────────────────────────────────────

export interface HarmonyChannels {
  analysis?: string;    // Reasoning content
  commentary?: string;  // Tool calls
  final?: string;       // Response text (contains JSON)
}

/**
 * Parse GPT-OSS harmony format output
 * Extracts content from ANALYSIS, COMMENTARY, and FINAL channels
 * Exported for debugging
 */
export function parseHarmonyFormat(raw: string): HarmonyChannels {
  const channels: HarmonyChannels = {};

  // Remove <|end|> and <|endoftext|> tokens first
  let cleaned = raw.replace(/<\|end(?:oftext)?\|>/gi, '');

  // Common harmony channel markers (including GPT-OSS variations)
  const channelMarkers = [
    // Analysis/Reasoning variants
    { marker: /<\|analysis\|>/gi, channel: 'analysis' as const },
    { marker: /<\|reasoning\|>/gi, channel: 'analysis' as const },
    { marker: /<\|thinking\|>/gi, channel: 'analysis' as const },
    { marker: /<\|think\|>/gi, channel: 'analysis' as const },
    { marker: /<\|inner_thoughts\|>/gi, channel: 'analysis' as const },
    { marker: /<\|scratchpad\|>/gi, channel: 'analysis' as const },
    // Commentary/Tool variants
    { marker: /<\|commentary\|>/gi, channel: 'commentary' as const },
    { marker: /<\|tool_call\|>/gi, channel: 'commentary' as const },
    { marker: /<\|call\|>/gi, channel: 'commentary' as const },
    { marker: /<\|function\|>/gi, channel: 'commentary' as const },
    // Final/Response variants (most important for JSON extraction)
    { marker: /<\|final\|>/gi, channel: 'final' as const },
    { marker: /<\|message\|>/gi, channel: 'final' as const },
    { marker: /<\|response\|>/gi, channel: 'final' as const },
    { marker: /<\|output\|>/gi, channel: 'final' as const },
    { marker: /<\|answer\|>/gi, channel: 'final' as const },
    { marker: /<\|assistant\|>/gi, channel: 'final' as const },
  ];

  // Build regex for all known channel markers
  const allMarkersPattern = /<\|(?:analysis|reasoning|thinking|think|inner_thoughts|scratchpad|commentary|tool_call|call|function|final|message|response|output|answer|assistant)\|>/gi;

  // Try to extract content between channel markers
  for (const { marker, channel } of channelMarkers) {
    const matches = cleaned.match(marker);
    if (matches) {
      // Find content after this marker until next marker or end
      const markerIndex = cleaned.search(marker);
      if (markerIndex >= 0) {
        const afterMarker = cleaned.slice(markerIndex).replace(marker, '');
        // Find next channel marker
        const nextMarkerMatch = afterMarker.match(allMarkersPattern);
        const endIndex = nextMarkerMatch?.index ?? afterMarker.length;
        const content = afterMarker.slice(0, endIndex).trim();
        if (content) {
          channels[channel] = content;
        }
      }
    }
  }

  // If no channels found, check for any <|...|> tokens and strip them
  if (!channels.final && !channels.analysis) {
    // Check if there are ANY harmony-style tokens
    const hasTokens = /<\|[^|]+\|>/g.test(raw);
    if (hasTokens) {
      // Strip all tokens and treat entire content as final
      channels.final = cleaned.replace(/<\|[^|]+\|>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      // No tokens at all - raw content is the response
      channels.final = cleaned.trim();
    }
  }

  return channels;
}

/**
 * Extract JSON specifically from harmony FINAL channel
 * Exported for debugging and direct use
 */
export function extractJsonFromHarmony(raw: string): string | null {
  const channels = parseHarmonyFormat(raw);

  // Prefer FINAL channel for JSON
  let source = channels.final || channels.analysis || '';

  // If still no source, fall back to stripping tokens from raw
  if (!source) {
    source = raw.replace(/<\|[^|]+\|>/g, ' ').trim();
  }

  // Strategy 1: Find balanced JSON object
  const jsonObjects = findAllJsonObjects(source);
  if (jsonObjects.length > 0) {
    // Prefer objects that look like our expected format
    const directorJson = jsonObjects.find(obj =>
      obj.includes('"thoughts_summary"') ||
      obj.includes('"plan"') ||
      obj.includes('"sections"')
    );
    if (directorJson) {
      return directorJson;
    }
    // Otherwise return the largest object
    return jsonObjects.reduce((a, b) => a.length > b.length ? a : b);
  }

  // Strategy 2: Simple regex match for any JSON object
  const jsonMatch = source.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  // Strategy 3: Try to find JSON starting patterns and extract from there
  const jsonStarts = [
    source.indexOf('{"thoughts_summary"'),
    source.indexOf('{"plan"'),
    source.indexOf('{"sections"'),
    source.indexOf('{"analysis"'),
  ].filter(i => i >= 0);

  if (jsonStarts.length > 0) {
    const startIndex = Math.min(...jsonStarts);
    const fromStart = source.slice(startIndex);
    const endMatch = fromStart.match(/\}(?:\s*\})*\s*$/);
    if (endMatch) {
      return fromStart;
    }
  }

  return null;
}

export interface ModelParserConfig {
  /** Model ID pattern (regex or exact match) */
  pattern: string | RegExp;
  /** Human-readable name for logging */
  name: string;
  /** Pre-processing steps before JSON parsing */
  preprocess?: (raw: string) => string;
  /** Field name mappings (source -> target) */
  fieldMappings?: Record<string, string>;
  /** Whether model tends to wrap in markdown */
  stripMarkdown?: boolean;
  /** Whether model adds preamble text */
  stripPreamble?: boolean;
  /** Custom JSON extraction regex */
  jsonExtractor?: RegExp;
  /** Whether to be lenient with structure (accept nested or flat) */
  lenientStructure?: boolean;
  /** Whether model uses Harmony format (GPT-OSS) */
  useHarmonyParser?: boolean;
  /** Additional notes for debugging */
  notes?: string;
}

/**
 * Check if a JSON-like string is actually a schema example (not real JSON)
 * Schema examples contain unquoted type placeholders like: number, string, boolean
 */
function isSchemaExample(jsonLike: string): boolean {
  // Look for unquoted type placeholders that indicate this is a schema, not data
  // Match patterns like `: number` or `: string` that are NOT inside quotes
  const schemaPatterns = [
    /:\s*number\s*[,}\]]/,      // "field": number,
    /:\s*string\s*[,}\]]/,      // "field": string,
    /:\s*boolean\s*[,}\]]/,     // "field": boolean,
    /:\s*object\s*[,}\]]/,      // "field": object,
    /:\s*array\s*[,}\]]/,       // "field": array,
    /"\s*\|\s*"/,               // "value1" | "value2" (union types)
  ];

  for (const pattern of schemaPatterns) {
    if (pattern.test(jsonLike)) {
      return true;
    }
  }
  return false;
}

/**
 * Find all JSON objects in a string
 * Returns array of matched object strings, filtering out schema examples
 */
function findAllJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

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

    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const obj = text.slice(start, i + 1);
        // Filter out schema examples
        if (!isSchemaExample(obj)) {
          objects.push(obj);
        }
        start = -1;
      }
    }
  }

  return objects;
}

/**
 * Default parser configurations for known models
 */
export const MODEL_PARSERS: ModelParserConfig[] = [
  {
    pattern: /gpt-oss|gptoss/i,
    name: "GPT-OSS (Harmony)",
    stripMarkdown: true,
    stripPreamble: true,
    lenientStructure: true,
    useHarmonyParser: true,
    preprocess: (raw) => {
      // GPT-OSS uses Harmony format with channels: ANALYSIS, COMMENTARY, FINAL
      // First try to extract JSON from the FINAL channel
      const harmonyJson = extractJsonFromHarmony(raw);
      if (harmonyJson) {
        let cleaned = harmonyJson;
        // Fix common JSON issues
        cleaned = cleaned.replace(/(?<![\\])'([^']*)'(?=\s*[,}\]:)])/g, '"$1"');
        cleaned = cleaned.replace(/(?<!")(\b\w+\b)(?=\s*:)/g, '"$1"');
        return cleaned;
      }

      // Fallback: Strip all harmony tokens and try to find JSON
      let cleaned = raw;

      // Strip harmony special tokens
      cleaned = cleaned.replace(/<\|[^|]+\|>/g, " ");
      cleaned = cleaned.replace(/<\|[^>]*>/g, " ");

      // Look for main response object
      const mainResponsePatterns = [
        /\{\s*"thoughts_summary"/,
        /\{\s*"plan"\s*:/,
        /\{\s*"sections"\s*:/,
        /\{\s*"analysis"\s*:/
      ];

      for (const pattern of mainResponsePatterns) {
        const match = cleaned.match(pattern);
        if (match && match.index !== undefined) {
          cleaned = cleaned.slice(match.index);
          break;
        }
      }

      // Handle "analysis" prefix
      if (/^analysis\s+/i.test(cleaned)) {
        const jsonStart = cleaned.indexOf("{");
        if (jsonStart >= 0) {
          cleaned = cleaned.slice(jsonStart);
        }
      }

      // Find first JSON object
      if (!cleaned.trim().startsWith("{")) {
        const jsonStart = cleaned.indexOf("{");
        if (jsonStart >= 0) {
          cleaned = cleaned.slice(jsonStart);
        }
      }

      // Fallback to largest JSON object
      if (!mainResponsePatterns.some(p => p.test(cleaned))) {
        const allObjects = findAllJsonObjects(cleaned);
        if (allObjects.length > 0) {
          const largest = allObjects.reduce((a, b) =>
            a.length > b.length ? a : b
          );
          cleaned = largest;
        }
      }

      // Fix JSON syntax issues
      cleaned = cleaned.replace(/(?<![\\])'([^']*)'(?=\s*[,}\]:)])/g, '"$1"');
      cleaned = cleaned.replace(/(?<!")(\b\w+\b)(?=\s*:)/g, '"$1"');

      return cleaned;
    },
    notes: "GPT-OSS uses Harmony format with ANALYSIS/COMMENTARY/FINAL channels"
  },
  {
    pattern: /jinx/i,
    name: "Jinx GPT-OSS (Harmony)",
    stripMarkdown: true,
    stripPreamble: true,
    lenientStructure: true,
    useHarmonyParser: true,
    preprocess: (raw) => {
      // Jinx uses same Harmony format as GPT-OSS
      const harmonyJson = extractJsonFromHarmony(raw);
      if (harmonyJson) {
        let cleaned = harmonyJson;
        cleaned = cleaned.replace(/(?<![\\])'([^']*)'(?=\s*[,}\]:)])/g, '"$1"');
        cleaned = cleaned.replace(/(?<!")(\b\w+\b)(?=\s*:)/g, '"$1"');
        return cleaned;
      }

      // Fallback: Strip harmony tokens
      let cleaned = raw;
      cleaned = cleaned.replace(/<\|[^|]+\|>/g, " ");
      cleaned = cleaned.replace(/<\|[^>]*>/g, " ");

      // Look for main response object
      const mainResponsePatterns = [
        /\{\s*"thoughts_summary"/,
        /\{\s*"plan"\s*:/,
        /\{\s*"sections"\s*:/,
        /\{\s*"analysis"\s*:/
      ];

      for (const pattern of mainResponsePatterns) {
        const match = cleaned.match(pattern);
        if (match && match.index !== undefined) {
          cleaned = cleaned.slice(match.index);
          break;
        }
      }

      // Fallback to largest object
      if (!mainResponsePatterns.some(p => p.test(cleaned))) {
        const allObjects = findAllJsonObjects(cleaned);
        if (allObjects.length > 0) {
          const largest = allObjects.reduce((a, b) =>
            a.length > b.length ? a : b
          );
          cleaned = largest;
        }
      }

      return cleaned;
    },
    notes: "Jinx fine-tuned variant of GPT-OSS with Harmony format"
  },
  {
    pattern: /qwen/i,
    name: "Qwen",
    stripMarkdown: true,
    lenientStructure: true,
    notes: "Qwen models generally produce clean JSON but may use markdown"
  },
  {
    pattern: /llama/i,
    name: "Llama",
    stripMarkdown: true,
    stripPreamble: true,
    preprocess: (raw) => {
      let cleaned = raw;
      // Llama sometimes starts with "Here's" or similar
      if (/^(here'?s|the following|below|i'?ll)/i.test(cleaned.trim())) {
        const jsonStart = cleaned.indexOf("{");
        if (jsonStart > 0) {
          cleaned = cleaned.slice(jsonStart);
        }
      }
      return cleaned;
    },
    notes: "Llama models may add conversational preamble"
  },
  {
    pattern: /gemma/i,
    name: "Gemma",
    stripMarkdown: true,
    notes: "Gemma generally produces clean structured output"
  },
  {
    pattern: /phi/i,
    name: "Phi",
    stripMarkdown: true,
    lenientStructure: true,
    notes: "Phi models are generally good at following JSON format"
  },
  {
    pattern: /mistral/i,
    name: "Mistral",
    stripMarkdown: true,
    notes: "Mistral models typically produce clean JSON"
  },
  {
    pattern: /deepseek/i,
    name: "DeepSeek",
    stripMarkdown: true,
    stripPreamble: true,
    preprocess: (raw) => {
      let cleaned = raw;
      // DeepSeek often outputs thought chains in <think> tags
      cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
      return cleaned;
    },
    notes: "DeepSeek models using Chain of Thought"
  }
];

/**
 * Get parser config for a model ID
 */
export function getModelParser(modelId: string): ModelParserConfig | null {
  for (const config of MODEL_PARSERS) {
    const pattern = config.pattern;
    if (typeof pattern === "string") {
      if (modelId.toLowerCase().includes(pattern.toLowerCase())) {
        return config;
      }
    } else if (pattern.test(modelId)) {
      return config;
    }
  }
  return null;
}

/**
 * Apply model-specific preprocessing to raw LLM output
 */
export function preprocessForModel(raw: string, modelId?: string): string {
  let processed = raw;

  // Get model-specific config
  const config = modelId ? getModelParser(modelId) : null;

  // Apply model-specific preprocessing
  if (config?.preprocess) {
    processed = config.preprocess(processed);
  }

  // Common preprocessing steps
  processed = processed.trim();

  // Strip markdown code blocks
  if (!config || config.stripMarkdown !== false) {
    if (processed.startsWith("```json")) {
      processed = processed.slice(7);
    } else if (processed.startsWith("```")) {
      processed = processed.slice(3);
    }
    if (processed.endsWith("```")) {
      processed = processed.slice(0, -3);
    }
    processed = processed.trim();
  }

  // Strip common preamble patterns
  if (!config || config.stripPreamble !== false) {
    const preamblePatterns = [
      /^(here'?s?\s+(is\s+)?(the\s+)?(json|output|response|result)[:\s]*)/i,
      /^(the\s+following\s+(is\s+)?(the\s+)?)/i,
      /^(below\s+(is\s+)?(the\s+)?)/i,
      /^(i'?ll\s+(provide|give|generate)[:\s]*)/i,
      /^(generating[:\s]*)/i,
    ];

    for (const pattern of preamblePatterns) {
      const match = processed.match(pattern);
      if (match) {
        processed = processed.slice(match[0].length).trim();
        break;
      }
    }
  }

  return processed;
}

/**
 * Extended JSON extraction with model awareness
 */
export function extractJsonFromResponse(raw: string, modelId?: string): string | null {
  const processed = preprocessForModel(raw, modelId);

  // Try to find JSON object or array
  const objectMatch = processed.match(/\{[\s\S]*\}/);
  const arrayMatch = processed.match(/\[[\s\S]*\]/);

  if (objectMatch && arrayMatch) {
    // Return whichever appears first
    return objectMatch.index! < arrayMatch.index! ? objectMatch[0] : arrayMatch[0];
  }

  return objectMatch?.[0] || arrayMatch?.[0] || null;
}

/**
 * Normalize field names based on model config
 */
export function normalizeFieldNames(
  obj: Record<string, unknown>,
  modelId?: string
): Record<string, unknown> {
  const config = modelId ? getModelParser(modelId) : null;
  if (!config?.fieldMappings) {
    return obj;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const mappedKey = config.fieldMappings[key] || key;
    result[mappedKey] = value;
  }

  return result;
}

/**
 * Parse with model-specific handling
 */
export function parseWithModelConfig(
  raw: string,
  modelId?: string
): unknown | null {
  const jsonStr = extractJsonFromResponse(raw, modelId);
  if (!jsonStr) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return normalizeFieldNames(
      parsed as Record<string, unknown>,
      modelId
    );
  } catch {
    // Try repair
    const repaired = attemptJsonRepair(jsonStr);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired);
        return normalizeFieldNames(
          parsed as Record<string, unknown>,
          modelId
        );
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Attempt to repair common JSON issues
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

  // Remove trailing commas before closing brackets/braces
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");

  return repaired;
}
