import { BaseDirector, DirectorOptions } from "./base-director";
import { InputSection, DirectorPlan, POSTPROCESSING_ACTIONS } from "./types";

export interface PostFXDirectorContext {
  performancePlan: DirectorPlan;
}

export class PostFXDirector extends BaseDirector {
  constructor(options: DirectorOptions) {
    super("postfx", options);
  }

  protected buildPrompt(
    sections: InputSection[],
    durationMs: number,
    context?: PostFXDirectorContext
  ): string {
    const performancePlan = context?.performancePlan;

    const sectionsText = sections
      .map((s, i) => {
        const perfSection = performancePlan?.sections[i];
        const mood = perfSection?.mood || "neutral";
        return `[${i + 1}] "${s.text.substring(0, 50)}..." (${Math.round(s.start_ms)}ms - ${Math.round(s.end_ms)}ms) Mood: ${mood}`;
      })
      .join("\n");

    return `POST-PROCESSING DIRECTOR for avatar music video.

TASK: Add visual polish using Bloom, Vignette, and other effects.

CONSTRAINTS:
- Use effects sparingly - 1 per section max, or none.
- Match effect to MOOD:
  - Happy/Love/High Energy -> Bloom
  - Sad/Fear/Noir -> Vignette
  - Glitch/Techno -> Digital artifacts (if available)
- thoughts_summary: ≤40 words, speakable, NO chain-of-thought

ACTIONS AVAILABLE:
${POSTPROCESSING_ACTIONS.join("\n")}

${this.buildSchemaInstruction().replace(/mood.*\|.*angry/g, 'effects: "bloom" | "vignette" | "clean"')}

Note: In your output, include "effects" instead of "mood" for each section.

${this.buildStylePrompt()}
SEED: ${this.seed}
DURATION: ${Math.round(durationMs)}ms

SONG SECTIONS:
${sectionsText}`;
  }
}
