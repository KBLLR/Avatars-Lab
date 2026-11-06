# Avatar Labs: Core-X Head & Audio2Face Modernization Walkthrough

**Date**: 2026-11-06  
**House**: `houses/avatar-labs-v0.2.0`  
**Route**: `http://127.0.0.1:5185/corex-head.html` and `http://127.0.0.1:5185/audio2face.html`  
**Status**: Complete & Verified  

---

## 1. Overview & Purpose

This upgrade modernizes Avatar Labs with canonical Core-X Three.js (r185+) and WebGPU capabilities, replacing legacy vertex rendering and flat textures with:
1. **Canonical Studio Lighting & Physical Material Realism**: Pure diffuse skin with calibrated GGX roughness, SSS extinction (eliminating black cutouts), wet cornea clearcoat (`0.28`), enamel teeth, double-sided alpha-tested hair cards, and PCF soft shadow maps.
2. **Expressive Speech Articulation Engine**: ARKit blendshape-driven phoneme mapping with an anatomical clamp preventing `mouthClose` from riding the lower lip over the upper lip during plosives and pauses.
3. **Pre-Speech Emotion Analysis & Dynamic Emotion Transitions**:
   - Parses bracketed emotion cues: `[Happy]`, `[Surprised]`, `[Thinking]`, `[Angry]`, `[Empathic]`, `[Excited]`, `[Neutral]`.
   - Strips tags cleanly so the TTS synthesizer speaks only clean natural text.
   - Fallback keyword sentiment analysis per sentence when no tags are provided.
   - Interactive emotion progress bar beneath the prompt displaying keyframe segments.
   - Layered kinematics: emotions drive upper face channels (brows, cheeks, eye widening, sneer) while speech visemes drive jaw and lips.
4. **All 9 Canonical Core-X Heads & Automatic Voice Assignment**:
   - Seamless switching across `kbllr`, `anja`, `susi-q`, `david`, `eli`, `sofia`, `nyx`, `vee`, and `nino`.
   - Companion hair GLBs automatically loaded and attached (`kbllr-hair`, `anja-hair`, `eli-hair`, `sofia-hair`, `susi-q-hair`, `nyx-hair`).
   - TTS voice automatically updates upon head selection according to the canonical Core-X contract (`avatar-config.ts`).
5. **Real-Time Live Mic Mode**: Streams user audio from the microphone directly into the `@met4citizen/headaudio` neural worklet at 60 FPS with live VU monitoring.

---

## 2. Architecture & File Matrix

```
houses/avatar-labs-v0.2.0/
├── corex-head.html                   # Performer stage UI, emotion timeline, voice selection
├── audio2face.html                   # Audio2Face calibration workbench & ARKit live monitor
├── src/
│   ├── corex-head.ts                 # Performer lifecycle, dynamic morph loop, live mic
│   ├── audio2face.ts                 # Worklet telemetry, blendshape monitor
│   ├── facial/
│   │   ├── emotion-analyzer.ts       # DynamicEmotionEngine & analyzeSpeechPrompt
│   │   └── phoneme-articulation.ts   # SpeechArticulationEngine (visemes & anatomical clamp)
│   ├── scene/
│   │   └── studio-scene-template.ts  # WebGPU/WebGL2 studio, PBR materials, eye calibration
│   └── styles/
│       └── audio2face-workbench.css  # Dark slate studio styling & timeline styling
```

---

## 3. Key Implementations

### A. Pre-Speech Emotion Analysis (`src/facial/emotion-analyzer.ts`)
```typescript
export interface EmotionKeyframe {
  emotion: EmotionState;
  textSnippet: string;
  charIndex: number;
  timeRatio: number; // 0.0 to 1.0 progress through speech
  label: string;
}

export function analyzeSpeechPrompt(rawPrompt: string): PromptEmotionAnalysis {
  // 1. Matches tags: [Happy], [Surprised], [Thinking], [Angry], [Empathic], [Excited], [Neutral]
  // 2. Computes character offsets and timeRatio progress points
  // 3. Produces cleanText without bracketed tags for TTS input
  // 4. Applies sentiment keyword heuristics if no tags are present
}

export class DynamicEmotionEngine {
  // Interpolates active ARKit emotional blendshapes (browInnerUp, browDownLeft/Right,
  // cheekSquintLeft/Right, eyeWideLeft/Right, noseSneerLeft/Right) over dtMs.
}
```

### B. Anatomically-Clamped Speech Articulation (`src/facial/phoneme-articulation.ts`)
In ARKit, `mouthClose` is purely a compensatory shape meant to seal the lips when `jawOpen > 0`. If `mouthClose` is fired during resting poses or amplified by high lip gain, it pulls the lower lip upward above the upper lip.
```typescript
// Strict anatomical clamp
if (rawTarget.mouthClose !== undefined) {
  const jaw = rawTarget.jawOpen ?? 0;
  rawTarget.mouthClose = Math.min(rawTarget.mouthClose, Math.max(0, jaw * 0.5), 0.12);
}
```

### C. Dynamic Performer Head & Voice Roster (`src/corex-head.ts`)
```typescript
export const HEAD_ROSTER: Record<string, HeadDefinition> = {
  kbllr:   { id: "kbllr",   voice: "lullabot",     hairUrl: "/corex-assets/avatars/heads/kbllr/kbllr-hair.glb" },
  anja:    { id: "anja",    voice: "katanja",      hairUrl: "/corex-assets/avatars/heads/anja/anja-hair.glb" },
  "susi-q":{ id: "susi-q",  voice: "katanja",      hairUrl: "/corex-assets/avatars/heads/susi-q/susi-q-hair.glb" },
  david:   { id: "david",   voice: "davido" },
  eli:     { id: "eli",     voice: "eli_luma",     hairUrl: "/corex-assets/avatars/heads/eli/eli-hair.glb" },
  sofia:   { id: "sofia",   voice: "sofi_v",       hairUrl: "/corex-assets/avatars/heads/sofia/sofia-hair.glb" },
  nyx:     { id: "nyx",     voice: "vicky_spice",  hairUrl: "/corex-assets/avatars/heads/nyx/nyx-hair.glb" },
  vee:     { id: "vee",     voice: "princess_leia" },
  nino:    { id: "nino",    voice: "ninoo" },
};
```
The render loop evaluates `const currentMeshes = stage ? stage.morphMeshes : morphMeshes;` dynamically, ensuring all switched heads animate immediately.

### D. ChatAvatar Eye Calibration Formula
ChatAvatar GLBs export eyeballs centered at the mesh root with small iris proportions. The canonical calibration applies:
- **Uniform Scale**: `1.28x` (expanding iris diameter to natural corneal ratio)
- **Orbital Depth**: `-0.52` along the local Z axis (pushing eyeballs safely back into the eye sockets)

---

## 4. Verification & Validation Commands

All commands verified cleanly:
```bash
# 1. Typecheck
npm --prefix houses/avatar-labs-v0.2.0 run typecheck
# Exit code 0 (clean)

# 2. Modernization contract test
npm --prefix houses/avatar-labs-v0.2.0 run test:modernization
# 12 routes OK, 1 house agent OK

# 3. Production build
npm --prefix houses/avatar-labs-v0.2.0 run build
# Built in 11.24s (0 errors)
```
