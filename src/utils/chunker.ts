/**
 * Chunker Utility
 * Splits sections into manageable batches for LLM processing
 */

import type { InputSection, PlanSection } from "../directors/types";

export interface ChunkingOptions {
  maxSectionsPerChunk?: number;
  minSectionsPerChunk?: number;
  preferNaturalBreaks?: boolean;
}

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
  maxSectionsPerChunk: 8,
  minSectionsPerChunk: 3,
  preferNaturalBreaks: true
};

/**
 * Chunk sections into batches for processing
 * Tries to find natural breaks (long pauses) between sections
 */
export function chunkSections(
  sections: InputSection[],
  options?: ChunkingOptions
): InputSection[][] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (sections.length <= opts.maxSectionsPerChunk) {
    return [sections];
  }

  const chunks: InputSection[][] = [];

  if (opts.preferNaturalBreaks) {
    // Find natural break points (gaps > 1 second between sections)
    const breakPoints: number[] = [];
    for (let i = 1; i < sections.length; i++) {
      const gap = sections[i].start_ms - sections[i - 1].end_ms;
      if (gap > 1000) {
        breakPoints.push(i);
      }
    }

    // Use natural breaks if they create reasonable chunk sizes
    if (breakPoints.length > 0) {
      let lastBreak = 0;
      for (const breakPoint of breakPoints) {
        const chunkSize = breakPoint - lastBreak;
        if (chunkSize >= opts.minSectionsPerChunk && chunkSize <= opts.maxSectionsPerChunk) {
          chunks.push(sections.slice(lastBreak, breakPoint));
          lastBreak = breakPoint;
        }
      }
      // Don't forget the last chunk
      if (lastBreak < sections.length) {
        const remaining = sections.slice(lastBreak);
        if (remaining.length <= opts.maxSectionsPerChunk) {
          chunks.push(remaining);
        } else {
          // Split remaining evenly
          chunks.push(...splitEvenly(remaining, opts.maxSectionsPerChunk));
        }
      }

      if (chunks.length > 0) {
        return chunks;
      }
    }
  }

  // Fall back to even splitting
  return splitEvenly(sections, opts.maxSectionsPerChunk);
}

/**
 * Split array into even chunks
 */
function splitEvenly<T>(items: T[], maxPerChunk: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += maxPerChunk) {
    chunks.push(items.slice(i, i + maxPerChunk));
  }
  return chunks;
}

/**
 * Merge chunked plan results back together
 */
export function mergeChunkedPlans(
  chunks: Array<{ sections: PlanSection[]; actions?: Array<{ time_ms: number; action: string; args?: Record<string, unknown> }> } | null>
): { sections: PlanSection[]; actions?: Array<{ time_ms: number; action: string; args?: Record<string, unknown> }> } {
  const allSections: PlanSection[] = [];
  const allActions: Array<{ time_ms: number; action: string; args?: Record<string, unknown> }> = [];

  for (const chunk of chunks) {
    if (chunk) {
      allSections.push(...chunk.sections);
      if (chunk.actions) {
        allActions.push(...chunk.actions);
      }
    }
  }

  // Sort actions by time
  allActions.sort((a, b) => a.time_ms - b.time_ms);

  return {
    sections: allSections,
    actions: allActions.length > 0 ? allActions : undefined
  };
}

/**
 * Estimate if chunking is needed based on section count and complexity
 */
export function shouldChunk(sections: InputSection[], threshold = 10): boolean {
  if (sections.length <= threshold) {
    return false;
  }

  // Also check total text length
  const totalTextLength = sections.reduce((acc, s) => acc + s.text.length, 0);
  if (totalTextLength > 3000) {
    return true;
  }

  return sections.length > threshold;
}
