/**
 * Generative Module Types
 * Types for mflux image generation and canvas application
 */

// Generation request parameters
export interface GenerationRequest {
  prompt: string;
  negativePrompt?: string;
  model: 'flux-schnell' | 'flux-dev';
  size: ImageSize;
  numImages?: number;
  seed?: number;
  guidanceScale?: number;
  numInferenceSteps?: number;
}

export type ImageSize = '512x512' | '768x768' | '1024x1024' | '512x768' | '768x512';

// Generation response
export interface GenerationResponse {
  id: string;
  created: number;
  data: GeneratedImage[];
}

export interface GeneratedImage {
  url?: string;           // URL if response_format is 'url'
  b64_json?: string;      // Base64 if response_format is 'b64_json'
  revised_prompt?: string;
}

// Application targets for generated images
export type ApplicationTarget =
  | 'background'     // Canvas background layer
  | 'texture'        // 3D geometry albedo texture
  | 'displacement'   // Height/displacement map
  | 'emissive'       // Emissive/glow map
  | 'overlay';       // Semi-transparent overlay

// Generation history entry
export interface GenerationHistoryEntry {
  id: string;
  timestamp: number;
  prompt: string;
  model: string;
  size: ImageSize;
  imageData: string;     // Base64 encoded
  appliedTo?: ApplicationTarget;
}

// Generative module state
export interface GenerativeState {
  isGenerating: boolean;
  currentPrompt: string;
  selectedModel: 'flux-schnell' | 'flux-dev';
  selectedSize: ImageSize;
  lastGeneration?: GeneratedImage;
  history: GenerationHistoryEntry[];
  error?: string;
}

// Style presets for prompt enhancement
export interface PromptStyle {
  id: string;
  name: string;
  suffix: string;   // Added to user prompt
  description: string;
}

// Events
export type GenerativeEvent =
  | { type: 'GENERATE_START'; prompt: string }
  | { type: 'GENERATE_SUCCESS'; result: GeneratedImage }
  | { type: 'GENERATE_ERROR'; error: string }
  | { type: 'APPLY_IMAGE'; target: ApplicationTarget; imageData: string }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_MODEL'; model: 'flux-schnell' | 'flux-dev' }
  | { type: 'SET_SIZE'; size: ImageSize };
