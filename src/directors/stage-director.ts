/**
 * Stage Director
 * Designs lighting and stage ambience based on performance plan
 */

import { BaseDirector, DirectorOptions } from "./base-director";
import { STAGE_ACTIONS_COMPACT, InputSection, DirectorPlan, LIGHT_PRESETS } from "./types";

export interface StageDirectorContext {
  performancePlan: DirectorPlan;
}

export class StageDirector extends BaseDirector {
  constructor(options: DirectorOptions) {
    super("stage", options);
  }

  protected buildPrompt(
    sections: InputSection[],
    durationMs: number,
    context?: StageDirectorContext
  ): string {
    const performancePlan = context?.performancePlan;

    // Build compact sections with performance context
    const compactSections = sections.map((section, index) => {
      const perfSection = performancePlan?.sections[index];
      return {
        i: index + 1,
        s: section.start_ms,
        e: section.end_ms,
        t: section.text.slice(0, 150),
        role: perfSection?.role || "solo",
        mood: perfSection?.mood || "neutral"
      };
    });

    return `STAGE DIRECTOR for avatar music video.

TASK: Design lighting and stage ambience that enhances the performance.

CONSTRAINTS:
- Keep EXACT section count (${sections.length}) and timing bounds
- DO NOT change role or mood - focus ONLY on lighting
- Match lighting energy to section mood
- Use light transitions sparingly - 1 per section max
- thoughts_summary: ≤40 words, speakable, NO chain-of-thought

LIGHT PRESETS: ${LIGHT_PRESETS.join(", ")}
- neon: vibrant, energetic, pink/cyan
- noir: moody, dramatic, high contrast
- sunset: warm, romantic, golden
- frost: cool, ethereal, blue-white
- crimson: intense, passionate, red

STAGE ACTIONS:
${STAGE_ACTIONS_COMPACT.join("\n")}

${this.buildSchemaInstruction().replace(/mood.*\|.*angry/g, 'light: "neon" | "noir" | "sunset" | "frost" | "crimson"')}

Note: In your output, include "light" instead of "mood" for each section.

STYLE: ${this.style}
SEED: ${this.seed}
DURATION: ${Math.round(durationMs)}ms

PERFORMANCE CONTEXT:
${JSON.stringify(compactSections, null, 1)}`;
  }

  /**
   * Override max tokens - stage director needs less
   */
  protected estimateMaxTokens(sectionCount: number): number {
    const baseTokens = 400;
    const perSectionTokens = 60;
    return Math.min(baseTokens + sectionCount * perSectionTokens, 2500);
  }
}
