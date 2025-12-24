/**
 * Performance Director
 * Analyzes lyrics and maps verbs/emotions to avatar actions
 */

import { BaseDirector, DirectorOptions } from "./base-director";
import { PERFORMANCE_ACTIONS_COMPACT, InputSection, MOODS, GESTURES } from "./types";

export class PerformanceDirector extends BaseDirector {
  constructor(options: DirectorOptions) {
    super("performance", options);
  }

  protected buildPrompt(
    sections: InputSection[],
    durationMs: number,
    _context?: unknown
  ): string {
    // Compact section format
    const compactSections = sections.map((section, index) => ({
      i: index + 1,
      s: section.start_ms,
      e: section.end_ms,
      t: section.text.slice(0, 200)
    }));

    return `PERFORMANCE DIRECTOR for avatar music video.

TASK: Analyze lyrics verse by verse. Detect verbs, actions, emotions. Map them to avatar function calls.

CONSTRAINTS:
- Keep EXACT section count (${sections.length}) and timing bounds
- Role: "solo" (avatar sings) or "ensemble" (avatar listens/reacts)
- Use actions SPARINGLY - 1-3 per section max
- Action times must be WITHIN section bounds
- thoughts_summary: ≤50 words, speakable, NO chain-of-thought

AVAILABLE MOODS: ${MOODS.join(", ")}
AVAILABLE GESTURES: ${GESTURES.join(", ")}

AVATAR ACTIONS (use snake_case):
${PERFORMANCE_ACTIONS_COMPACT.join("\n")}

${this.buildSchemaInstruction()}

${this.buildStylePrompt()}
SEED: ${this.seed}
DURATION: ${Math.round(durationMs)}ms

SECTIONS TO ANALYZE:
${JSON.stringify(compactSections, null, 1)}`;
  }
}
