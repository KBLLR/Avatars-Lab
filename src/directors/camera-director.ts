/**
 * Camera Director
 * Designs camera movement and blocking based on performance + stage plans
 */

import { BaseDirector, DirectorOptions } from "./base-director";
import { CAMERA_ACTIONS_COMPACT, CAMERA_MOVEMENT_ACTIONS, InputSection, DirectorPlan, CAMERA_VIEWS } from "./types";

export interface CameraDirectorContext {
  performancePlan: DirectorPlan;
  stagePlan?: DirectorPlan | null;
}

export class CameraDirector extends BaseDirector {
  constructor(options: DirectorOptions) {
    super("camera", options);
  }

  protected buildPrompt(
    sections: InputSection[],
    durationMs: number,
    context?: CameraDirectorContext
  ): string {
    const { performancePlan, stagePlan } = context || {};

    // Build compact sections with performance + stage context
    const compactSections = sections.map((section, index) => {
      const perfSection = performancePlan?.sections[index];
      const stgSection = stagePlan?.sections[index];
      return {
        i: index + 1,
        s: section.start_ms,
        e: section.end_ms,
        t: section.text.slice(0, 120),
        role: perfSection?.role || "solo",
        mood: perfSection?.mood || "neutral",
        light: stgSection?.light || "neon"
      };
    });

    return `CAMERA DIRECTOR for avatar music video.

TASK: Design camera movement that enhances the emotional impact of the performance.

CONSTRAINTS:
- Keep EXACT section count (${sections.length}) and timing bounds
- DO NOT change role, mood, or light - focus ONLY on camera
- Match camera energy to section mood and role
- Use camera changes sparingly - 1-2 per section max
- thoughts_summary: ≤40 words, speakable, NO chain-of-thought
- IMPORTANT: You MUST output valid JSON only. Start your response immediately with "{".


CAMERA VIEWS: ${CAMERA_VIEWS.join(", ")}
- full: wide shot, full body
- mid: waist up, expressive
- upper: chest up, intimate
- head: close-up, intense emotion

CAMERA ACTIONS:
${CAMERA_ACTIONS_COMPACT.join("\n")}

CAMERA MOVEMENTS (cinematic):
${CAMERA_MOVEMENT_ACTIONS.join("\n")}

MOVEMENT GUIDE:
- dolly: Move toward (negative) or away (positive) from subject
- pan: Horizontal rotation in degrees
- tilt: Vertical rotation in degrees
- orbit: Circular path around subject
- shake: Handheld camera effect for intensity/energy
- punch: Quick zoom for impact moments
- sweep: Arc movement from start to end angle

CAMERA LANGUAGE GUIDE:
- High energy moments → quick cuts, closer shots
- Emotional verses → slow push-ins, head/upper
- Ensemble sections → wider shots, full/mid
- Climax → dramatic camera, tight close-ups
- Resolution → pull back to wider shots

${this.buildSchemaInstruction().replace(/mood.*\|.*angry/g, 'camera: "full" | "mid" | "upper" | "head"')}

Note: In your output, include "camera" instead of "mood" for each section.

${this.buildStylePrompt()}
SEED: ${this.seed}
DURATION: ${Math.round(durationMs)}ms

PERFORMANCE + STAGE CONTEXT:
${JSON.stringify(compactSections, null, 1)}`;
  }

  /**
   * Override max tokens - camera director needs less
   */
  protected estimateMaxTokens(sectionCount: number): number {
    const baseTokens = 800;
    const perSectionTokens = 150;
    return Math.min(baseTokens + sectionCount * perSectionTokens, 4000);
  }
}
