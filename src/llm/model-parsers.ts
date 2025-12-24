/**
 * Model-Specific Parser Configurations
 *
 * Different LLM models have different output characteristics:
 * - Some wrap JSON in markdown code blocks
 * - Some use different field names or structures
 * - Some add preamble text before JSON
 * - Some have specific formatting quirks
 *
 * This module provides model-specific parsing strategies.
 */

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
  /** Additional notes for debugging */
  notes?: string;
}

/**
 * Find all JSON objects in a string
 * Returns array of matched object strings
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
        objects.push(text.slice(start, i + 1));
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
    name: "GPT-OSS",
    stripMarkdown: true,
    stripPreamble: true,
    lenientStructure: true,
    preprocess: (raw) => {
      let cleaned = raw;

      // Strip special tokens: <|channel|>, <|message|>, <|end|>, etc.
      cleaned = cleaned.replace(/<\|[^|]+\|>/g, " ");

      // Strip any remaining < followed by | patterns that might be malformed
      cleaned = cleaned.replace(/<\|[^>]*>/g, " ");

      // GPT-OSS sometimes outputs small JSON fragments first, then the real response
      // Look for the main response object containing "thoughts_summary" or "plan" or "sections"
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

      // If no main response pattern found, fall back to finding the largest JSON object
      if (!mainResponsePatterns.some(p => p.test(cleaned))) {
        const allObjects = findAllJsonObjects(cleaned);
        if (allObjects.length > 0) {
          // Pick the largest object (most likely the full response)
          const largest = allObjects.reduce((a, b) =>
            a.length > b.length ? a : b
          );
          cleaned = largest;
        }
      }

      // GPT-OSS sometimes uses single quotes - convert to double
      // But only outside of already quoted strings
      cleaned = cleaned.replace(/(?<![\\])'([^']*)'(?=\s*[,}\]:)])/g, '"$1"');

      return cleaned;
    },
    notes: "GPT-OSS models may output fragments first, use special tokens, and inconsistent quoting"
  },
  {
    pattern: /jinx/i,
    name: "Jinx GPT-OSS",
    stripMarkdown: true,
    stripPreamble: true,
    lenientStructure: true,
    preprocess: (raw) => {
      let cleaned = raw;

      // Strip special tokens (same as GPT-OSS)
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
    notes: "Jinx fine-tuned variant of GPT-OSS with same token handling"
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
