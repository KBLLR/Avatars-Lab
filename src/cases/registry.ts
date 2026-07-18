export type CaseStatus = "active" | "verified" | "new" | "experimental";

export interface AvatarLabCase {
  id: string;
  code: string;
  title: string;
  description: string;
  href: string;
  icon: string;
  status: CaseStatus;
  renderer: "webgpu" | "webgl" | "dom";
  services: string[];
}

export const AVATAR_LAB_CASES: AvatarLabCase[] = [
  {
    id: "gemma-avatar",
    code: "GEM",
    title: "Gemma Avatar",
    description: "Streaming local speech with audio-driven Oculus visemes.",
    href: "/gemma-avatar.html",
    icon: "AudioWaveform",
    status: "verified",
    renderer: "webgl",
    services: ["gateway", "mlx-audio"],
  },
  {
    id: "corex-head",
    code: "CXH",
    title: "Core-X Head",
    description: "WebGPU-first operator head with ARKit speech animation.",
    href: "/corex-head.html",
    icon: "ScanFace",
    status: "verified",
    renderer: "webgpu",
    services: ["gateway", "mlx-audio"],
  },
  {
    id: "stage",
    code: "STG",
    title: "Stage Director",
    description: "Primary performance stage and timeline playback surface.",
    href: "/stage.html",
    icon: "MicVocal",
    status: "active",
    renderer: "webgl",
    services: ["gateway", "mlx-audio", "said"],
  },
  {
    id: "engine-lab",
    code: "ENG",
    title: "Performance Engine",
    description: "WebGPU multi-actor room, threaded timeline, TSL looks, and production projects.",
    href: "/engine-lab.html",
    icon: "SlidersHorizontal",
    status: "verified",
    renderer: "webgpu",
    services: ["warehouse"],
  },
  {
    id: "dance-studio",
    code: "DNC",
    title: "Dance Studio",
    description: "Mixamo-compatible choreography authoring and preview.",
    href: "/dance-studio.html",
    icon: "Activity",
    status: "new",
    renderer: "webgl",
    services: [],
  },
  {
    id: "gestures-lab",
    code: "GST",
    title: "Gestures Lab",
    description: "Pose, ARKit blendshape, and expression inspection.",
    href: "/gestures-lab.html",
    icon: "Hand",
    status: "new",
    renderer: "webgl",
    services: [],
  },
  {
    id: "multi-modal",
    code: "MLT",
    title: "Multi-Modal",
    description: "Combined visual, audio, and text analysis harness.",
    href: "/multi-modal.html",
    icon: "PanelsTopLeft",
    status: "experimental",
    renderer: "webgl",
    services: ["gateway", "mlx-audio", "mlx-vision"],
  },
  {
    id: "mlx-conversation",
    code: "MLX",
    title: "MLX Conversation",
    description: "Local voice conversation with mood and gesture actions.",
    href: "/mlx-conversation.html",
    icon: "MessagesSquare",
    status: "experimental",
    renderer: "webgl",
    services: ["gateway", "mlx-llm", "mlx-audio"],
  },
  {
    id: "composition-layer",
    code: "CMP",
    title: "Composition Layer",
    description: "Avatar typography, material, and background composition.",
    href: "/composition-layer.html",
    icon: "Layers3",
    status: "experimental",
    renderer: "webgl",
    services: ["gateway", "mflux"],
  },
  {
    id: "head-audio",
    code: "AUD",
    title: "HeadAudio Probe",
    description: "AudioWorklet and MFCC viseme diagnostics.",
    href: "/head-audio.html",
    icon: "Stethoscope",
    status: "active",
    renderer: "dom",
    services: ["gateway", "mlx-audio"],
  },
];
