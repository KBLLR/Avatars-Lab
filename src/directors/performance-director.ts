/**
 * Performance Director
 * Analyzes lyrics and maps verbs/emotions to avatar actions
 */

import { BaseDirector, DirectorOptions } from "./base-director";
import { PERFORMANCE_ACTIONS_COMPACT, InputSection, MOODS, GESTURES } from "./types";

export interface PerformanceDirectorContext {
  brief?: string;
  cast?: Array<{
    id: string;
    label: string;
    kind: "head" | "body";
    body?: "M" | "F";
    animationCompatible: boolean;
    performanceMode: "portrait-head" | "full-body";
  }>;
  animations?: Array<{
    id: string;
    label: string;
    category: string;
    rig: string;
    body: "M" | "F" | "any";
    loop: boolean;
  }>;
}

export class PerformanceDirector extends BaseDirector {
  constructor(options: DirectorOptions) {
    super("performance", options);
  }

  protected buildPrompt(
    sections: InputSection[],
    durationMs: number,
    context?: PerformanceDirectorContext
  ): string {
    // Compact section format
    const compactSections = sections.map((section, index) => ({
      i: index + 1,
      s: section.start_ms,
      e: section.end_ms,
      t: section.text.slice(0, 200)
    }));

    const castContext = context?.cast?.length
      ? `\nCAST (use exact actor_id values):\n${JSON.stringify(context.cast, null, 1)}`
      : "";
    const animationContext = context?.animations?.length
      ? `\nVERIFIED ANIMATION CATALOG (use exact animation_id values only):\n${JSON.stringify(context.animations, null, 1)}`
      : "";
    const showContext = context?.brief
      ? `\nOPERATOR SHOW BRIEF:\n${context.brief.slice(0, 2400)}`
      : "";

    return `PERFORMANCE DIRECTOR and showrunner for an avatar performance.

TASK: Create the performance arc and blocking. Analyze each section, detect actions and emotions, and map them to avatar function calls.

CONSTRAINTS:
- Keep EXACT section count (${sections.length}) and timing bounds
- Role: "solo" (avatar sings) or "ensemble" (avatar listens/reacts)
- Use actions SPARINGLY - 1-3 per section max
- Action times must be WITHIN section bounds
- When a verified animation catalog is provided, use play_animation with exact animation_id and actor_id values
- Never invent animation URLs, animation IDs, or actor IDs
- Give each animation-compatible cast member meaningful blocking across the show
- Rig-less head performers are portrait actors: prioritize make_facial_expression, make_eye_contact, look_at_camera, and set_value; never assign body motion clips to them
- Full-body performers own choreography and spatial blocking; do not reduce them to static portrait behavior
- Treat the operator brief as story canon, not optional flavor
- Build a causal arc across the whole show: setup, development, turn, climax, and changed final image
- In every section's notes, state the story beat, active point of view, relationship change, and blocking objective in one concise sentence
- Avoid four unrelated mood tableaux. Each section must inherit and transform something established earlier
- thoughts_summary: ≤50 words, speakable, NO chain-of-thought

AVAILABLE MOODS: ${MOODS.join(", ")}
AVAILABLE GESTURES: ${GESTURES.join(", ")}

AVATAR ACTIONS (use snake_case):
${PERFORMANCE_ACTIONS_COMPACT.join("\n")}
play_animation(animation_id: string, actor_id: string, duration_ms?: number, loop?: bool, speed?: number)

${this.buildSchemaInstruction()}

${this.buildStylePrompt()}
SEED: ${this.seed}
DURATION: ${Math.round(durationMs)}ms
${showContext}${castContext}${animationContext}

SECTIONS TO ANALYZE:
${JSON.stringify(compactSections, null, 1)}`;
  }
}
