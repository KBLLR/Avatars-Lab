import type { LightPresetConfig } from "./types";

export const directorModelFallback = "hf/mlx-community__gpt-oss-20b-MXFP4-Q8";
export const directorMaxTokens = 700;

export const lightPresets: Record<string, LightPresetConfig> = {
  spotlight: {
    label: "Spotlight",
    ambient: 0.1,
    direct: 2,
    spot: 28,
    ambientColor: "#0a0a0a",
    directColor: "#1a1a1a",
    spotColor: "#ffffff"
  },
  neon: {
    label: "Neon Drift",
    ambient: 0.7,
    direct: 18,
    spot: 22,
    ambientColor: "#fbd1ff",
    directColor: "#ff5f7a",
    spotColor: "#5bf2d6"
  },
  noir: {
    label: "Noir Edge",
    ambient: 0.3,
    direct: 10,
    spot: 6,
    ambientColor: "#4d5a6a",
    directColor: "#f5f0e7",
    spotColor: "#5b7b9f"
  },
  sunset: {
    label: "Sunset Pulse",
    ambient: 1.0,
    direct: 20,
    spot: 16,
    ambientColor: "#ffc998",
    directColor: "#ff8c6a",
    spotColor: "#ffb347"
  },
  frost: {
    label: "Frost Lens",
    ambient: 0.6,
    direct: 14,
    spot: 20,
    ambientColor: "#b7d3ff",
    directColor: "#6cc1ff",
    spotColor: "#d3f7ff"
  },
  crimson: {
    label: "Crimson Room",
    ambient: 0.8,
    direct: 22,
    spot: 18,
    ambientColor: "#ffb3c8",
    directColor: "#ff405a",
    spotColor: "#ff7f50"
  }
};

export const gestures = ["handup", "index", "ok", "thumbup", "thumbdown", "side", "shrug"] as const;
export const moods = ["neutral", "happy", "love", "fear", "sad", "angry"] as const;
export const cameraViews = ["full", "mid", "upper", "head"] as const;

export const stageFunctionDefs = [
  {
    type: "function",
    name: "set_mood",
    description: "Set the avatar mood (applies mood animations and morph baselines).",
    parameters: {
      type: "object",
      properties: {
        mood: {
          type: "string",
          enum: ["neutral", "happy", "angry", "sad", "fear", "disgust", "love", "sleep"],
          description: "Mood name"
        }
      },
      required: ["mood"]
    }
  },
  {
    type: "function",
    name: "play_gesture",
    description: "Play a named hand gesture or animated emoji.",
    parameters: {
      type: "object",
      properties: {
        gesture: {
          type: "string",
          description: "Gesture name or emoji (e.g. 'handup', 'index', 'ok', 'thumbup', 'thumbdown', 'side', 'shrug', 'namaste' or emoji character)"
        },
        duration: { type: "number", description: "Duration in seconds (optional)." },
        mirror: { type: "boolean", description: "If true, mirror gesture to the other hand (optional)." },
        ms: { type: "number", description: "Transition time in milliseconds (optional)." }
      },
      required: ["gesture"]
    }
  },
  {
    type: "function",
    name: "stop_gesture",
    description: "Stop current gesture (graceful transition).",
    parameters: {
      type: "object",
      properties: {
        ms: { type: "number", description: "Transition time in milliseconds (optional)." }
      }
    }
  },
  {
    type: "function",
    name: "make_facial_expression",
    description: "Trigger a facial expression using an emoji template.",
    parameters: {
      type: "object",
      properties: {
        emoji: { type: "string", description: "Single face emoji, or expression name like happy/sad/angry/neutral/fear/disgust/sleep. Non-face emoji map to 😐." },
        duration: { type: "number", description: "Duration in seconds (optional)." }
      },
      required: ["emoji"]
    }
  },
  {
    type: "function",
    name: "speak_break",
    description: "Insert a pause/break into the speech/animation queue.",
    parameters: {
      type: "object",
      properties: {
        duration_ms: { type: "number", description: "Break length in milliseconds." }
      },
      required: ["duration_ms"]
    }
  },
  {
    type: "function",
    name: "speak_marker",
    description: "Insert a marker callback into the speech queue (useful for timing).",
    parameters: {
      type: "object",
      properties: {
        marker: { type: "string", description: "Marker id or name. Client will receive marker event." }
      },
      required: ["marker"]
    }
  },
  {
    type: "function",
    name: "look_at",
    description: "Make the avatar look at a screen position (x,y) for t milliseconds.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "Normalized screen X position (0..1) or pixel value depending on your UI." },
        y: { type: "number", description: "Normalized screen Y position (0..1) or pixel value depending on your UI." },
        t: { type: "number", description: "Duration in milliseconds (optional)." }
      },
      required: ["x", "y"]
    }
  },
  {
    type: "function",
    name: "look_at_camera",
    description: "Make the avatar look at the camera for t milliseconds.",
    parameters: {
      type: "object",
      properties: {
        t: { type: "number", description: "Duration in milliseconds." }
      },
      required: ["t"]
    }
  },
  {
    type: "function",
    name: "make_eye_contact",
    description: "Force the avatar to maintain eye contact for t milliseconds.",
    parameters: {
      type: "object",
      properties: {
        t: { type: "number", description: "Duration in milliseconds." }
      },
      required: ["t"]
    }
  },
  {
    type: "function",
    name: "set_value",
    description: "Set a morph-target (blendshape) or custom property value with optional transition.",
    parameters: {
      type: "object",
      properties: {
        mt: { type: "string", description: "Morph-target name or custom property (see allowed list)." },
        value: { type: "number", description: "Target value." },
        ms: { type: "number", description: "Transition time in milliseconds (optional)." }
      },
      required: ["mt", "value"]
    }
  },
  {
    type: "function",
    name: "get_value",
    description: "Read the current value of a morph-target or custom property.",
    parameters: {
      type: "object",
      properties: {
        mt: { type: "string", description: "Morph-target or custom property name." }
      },
      required: ["mt"]
    }
  },
  {
    type: "function",
    name: "play_background_audio",
    description: "Play looped background or ambient audio.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Audio URL to play." },
        volume: { type: "number", description: "Volume (0..1, optional)." }
      },
      required: ["url"]
    }
  },
  {
    type: "function",
    name: "stop_background_audio",
    description: "Stop background audio playback.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "start",
    description: "Start/restart the TalkingHead animation loop.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "stop",
    description: "Stop the TalkingHead animation loop.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "start_listening",
    description: "Begin VAD/listening using the client's analyser settings (server may just forward the command).",
    parameters: {
      type: "object",
      properties: {
        listeningSilenceThresholdLevel: { type: "number" },
        listeningSilenceThresholdMs: { type: "number" },
        listeningActiveThresholdLevel: { type: "number" },
        listeningActiveThresholdMs: { type: "number" }
      }
    }
  },
  {
    type: "function",
    name: "stop_listening",
    description: "Stop VAD/listening.",
    parameters: {
      type: "object",
      properties: {}
    }
  }
] as const;
