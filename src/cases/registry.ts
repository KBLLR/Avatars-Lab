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
    id: "engine-lab",
    code: "ENG",
    title: "Performance Engine",
    description: "WebGPU multi-actor room, threaded 10-layer timeline, TSL looks, and Warehouse projects.",
    href: "/engine-lab.html",
    icon: "SlidersHorizontal",
    status: "verified",
    renderer: "webgpu",
    services: ["warehouse", "rigging-portal"],
  },
  {
    id: "mocap-lab",
    code: "MCP",
    title: "Mocap Lab",
    description: "Motion2MixamoRig video-to-3D motion capture, Local MIA retargeting, and Rigging Portal sync.",
    href: "/mocap-lab.html",
    icon: "Video",
    status: "verified",
    renderer: "webgl",
    services: ["motion2mixamorig", "rigging-portal", "warehouse"],
  },
  {
    id: "gemma-avatar",
    code: "GEM",
    title: "Gemma Speech",
    description: "Streaming local TTS speech with audio-driven HeadAudio Oculus visemes.",
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
    description: "WebGPU-first operator bust with real-time ARKit 51 speech animation.",
    href: "/corex-head.html",
    icon: "ScanFace",
    status: "verified",
    renderer: "webgpu",
    services: ["gateway", "mlx-audio"],
  },
  {
    id: "said-face",
    code: "SAI",
    title: "SAiD Face",
    description: "Diffusion audio-to-ARKit 51 facial performance via local SAiD UNet1D.",
    href: "/said-face.html",
    icon: "AudioLines",
    status: "verified",
    renderer: "webgpu",
    services: ["gateway", "said"],
  },
  {
    id: "face-mirror",
    code: "FMR",
    title: "Face Mirror",
    description: "Private real-time MediaPipe webcam expression capture on a Core-X head.",
    href: "/face-mirror.html",
    icon: "ScanFace",
    status: "verified",
    renderer: "webgpu",
    services: ["camera-bridge"],
  },
  {
    id: "stage",
    code: "STG",
    title: "Stage Director",
    description: "Single & Duo avatar stage with Harmony LLM timeline direction and Warehouse publishing.",
    href: "/stage.html",
    icon: "MicVocal",
    status: "active",
    renderer: "webgl",
    services: ["gateway", "mlx-audio", "said", "warehouse"],
  },
  {
    id: "dance-studio",
    code: "DNC",
    title: "Dance Studio",
    description: "Mixamo & M2MR FBX choreography sequencer, BPM state machine, and timeline preview.",
    href: "/dance-studio.html",
    icon: "Activity",
    status: "active",
    renderer: "webgl",
    services: ["rigging-portal", "warehouse"],
  },
  {
    id: "gestures-lab",
    code: "GST",
    title: "Gesture Library",
    description: "52 ARKit blendshape inspector, mood templates, and Mixamo gesture triggers.",
    href: "/gestures-lab.html",
    icon: "Hand",
    status: "active",
    renderer: "webgl",
    services: ["rigging-portal"],
  },
  {
    id: "multi-modal",
    code: "MLT",
    title: "Multimodal Chat",
    description: "Embodied MLX voice/text conversation with push-to-talk, VAD, and persona inspector.",
    href: "/multi-modal.html",
    icon: "MessagesSquare",
    status: "active",
    renderer: "webgl",
    services: ["gateway", "mlx-llm", "mlx-audio", "mlx-vision"],
  },
];
