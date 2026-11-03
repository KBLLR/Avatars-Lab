/**
 * Camera Director
 * Designs camera movement and blocking based on performance + stage plans
 */

import { BaseDirector, DirectorOptions } from "./base-director";
import { CAMERA_ACTIONS_COMPACT, CAMERA_MOVEMENT_ACTIONS, InputSection, DirectorPlan, CAMERA_VIEWS } from "./types";

export interface CameraDirectorContext {
  performancePlan: DirectorPlan;
  stagePlan?: DirectorPlan | null;
  brief?: string;
  cast?: Array<{ id: string; label: string }>;
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
    const { performancePlan, stagePlan, brief, cast } = context || {};

    // Build compact sections with performance + stage context
    const compactSections = sections.map((section, index) => {
      const perfSection = performancePlan?.sections[index];
      const stgSection = stagePlan?.sections[index];
      return {
        i: index + 1,
        s: section.start_ms,
        e: section.end_ms,
        evidence: section.text.slice(0, 520),
        role: perfSection?.role || "solo",
        mood: perfSection?.mood || "neutral",
        light: stgSection?.light || "neon",
        performanceStory: perfSection?.notes || "",
      };
    });

    return `CAMERA DIRECTOR for avatar music video.

TASK: Direct the story through camera placement, subject selection, movement, lens, and editorial rhythm. Camera is the primary narrative system, not decoration.

CONSTRAINTS:
- Keep EXACT section count (${sections.length}) and timing bounds
- DO NOT change role, mood, or light - focus ONLY on camera
- Match camera energy to section mood and role
- Treat the OPERATOR STORY BRIEF as canon. Build a legible beginning, development, turn, climax, and resolution across the complete show
- Give every section purposeful coverage: establish geography, identify the active singer, then earn close-ups
- Put a concise story purpose in every section's notes: what changes, who owns the moment, and why the shot reveals it
- Use 1-3 camera actions per section at distinct time_ms values. Quiet passages can hold one composed shot; turns and climaxes should develop through 2-3 motivated shots
- Target the diarised singer when named in the section evidence
- Use exact actor IDs from CAST when the singer target is known
- Preserve screen direction and avoid disorienting angle changes unless the brief asks for rupture
- Let camera distance express relationship: shared wides establish bonds or conflict; singles assign point of view; close-ups must be earned by a lyric, decision, reveal, or emotional turn
- Carry visual information between sections. Do not reset to generic coverage at every boundary
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
- Low arousal → longer lens, longer takes, slow dolly or profile drift
- Rising energy → shorten transitions, widen parallax, move from two-shot to singer close-up
- Beat peaks → reserve punch, sweep, or handheld accents for structural moments

${this.buildSchemaInstruction().replace(/mood.*\|.*angry/g, 'camera: "full" | "mid" | "upper" | "head"')}

Note: In your output, include "camera" instead of "mood" for each section.

${this.buildStylePrompt()}
SEED: ${this.seed}
DURATION: ${Math.round(durationMs)}ms

OPERATOR STORY BRIEF:
${brief || "Follow the emotional and vocal evidence in the score."}

CAST:
${JSON.stringify(cast || [], null, 1)}

PERFORMANCE + STAGE CONTEXT:
${JSON.stringify(compactSections, null, 1)}`;
  }

  /** Camera plans may emit several purposeful cues per section. */
  protected estimateMaxTokens(sectionCount: number): number {
    const baseTokens = 1200;
    const perSectionTokens = 260;
    return Math.min(baseTokens + sectionCount * perSectionTokens, 5000);
  }
}
