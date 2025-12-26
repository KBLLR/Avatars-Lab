/**
 * mflux Client
 * Client for MLX image generation service
 */

import type {
  GenerationRequest,
  GenerationResponse,
  GeneratedImage,
  PromptStyle,
  ImageSize
} from './types';

// Default configuration
const DEFAULT_CONFIG = {
  baseUrl: 'http://127.0.0.1:8080',
  timeout: 120000,  // 2 minutes for image generation
  retries: 2
};

// Prompt style presets
export const PROMPT_STYLES: PromptStyle[] = [
  {
    id: 'photorealistic',
    name: 'Photorealistic',
    suffix: ', photorealistic, high detail, 8k, professional photography',
    description: 'Photo-quality realistic images'
  },
  {
    id: 'abstract',
    name: 'Abstract',
    suffix: ', abstract art, geometric shapes, bold colors, artistic',
    description: 'Non-representational artistic images'
  },
  {
    id: 'texture',
    name: 'Seamless Texture',
    suffix: ', seamless tileable texture, texture map, high detail, 4k, pbr material',
    description: 'Tileable textures for 3D surfaces'
  },
  {
    id: 'pattern',
    name: 'Pattern',
    suffix: ', repeating pattern, seamless, decorative, graphic design',
    description: 'Repeating decorative patterns'
  },
  {
    id: 'illustration',
    name: 'Illustration',
    suffix: ', digital illustration, artistic, stylized, detailed',
    description: 'Digital art illustrations'
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    suffix: ', cinematic lighting, dramatic, film still, movie scene',
    description: 'Film-quality dramatic images'
  },
  {
    id: 'minimal',
    name: 'Minimal',
    suffix: ', minimalist, clean, simple, modern design',
    description: 'Clean minimal aesthetics'
  },
  {
    id: 'raw',
    name: 'Raw (No Style)',
    suffix: '',
    description: 'No style modification to prompt'
  }
];

export interface MfluxClientConfig {
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}

export interface GenerateOptions {
  prompt: string;
  model?: 'flux-schnell' | 'flux-dev';
  size?: ImageSize;
  style?: string;  // Style preset ID
  seed?: number;
  onProgress?: (status: string) => void;
}

/**
 * Create mflux client instance
 */
export function createMfluxClient(config: MfluxClientConfig = {}) {
  const baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
  const timeout = config.timeout || DEFAULT_CONFIG.timeout;
  const retries = config.retries || DEFAULT_CONFIG.retries;

  /**
   * Check if mflux service is available
   */
  async function isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${baseUrl}/health`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get available models
   */
  async function getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${baseUrl}/v1/models`);
      if (!response.ok) throw new Error('Failed to fetch models');

      const data = await response.json();
      return data.data
        ?.filter((m: { id: string }) =>
          m.id.includes('flux') || m.id.includes('mflux')
        )
        .map((m: { id: string }) => m.id) || [];
    } catch {
      return ['flux-schnell', 'flux-dev'];  // Fallback defaults
    }
  }

  /**
   * Generate image from prompt
   */
  async function generate(options: GenerateOptions): Promise<GeneratedImage> {
    const {
      prompt,
      model = 'flux-schnell',
      size = '512x512',
      style,
      seed,
      onProgress
    } = options;

    // Apply style suffix if specified
    let enhancedPrompt = prompt;
    if (style) {
      const stylePreset = PROMPT_STYLES.find(s => s.id === style);
      if (stylePreset) {
        enhancedPrompt = prompt + stylePreset.suffix;
      }
    }

    // Parse size
    const [width, height] = size.split('x').map(Number);

    const requestBody: Record<string, unknown> = {
      model,
      prompt: enhancedPrompt,
      n: 1,
      size,
      response_format: 'b64_json'
    };

    if (seed !== undefined) {
      requestBody.seed = seed;
    }

    // Add model-specific parameters
    if (model === 'flux-dev') {
      requestBody.num_inference_steps = 50;
      requestBody.guidance_scale = 7.5;
    } else {
      requestBody.num_inference_steps = 4;
      requestBody.guidance_scale = 0;
    }

    onProgress?.('Starting generation...');

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        onProgress?.(`Generating image${attempt > 0 ? ` (retry ${attempt})` : ''}...`);

        const response = await fetch(`${baseUrl}/v1/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error?.message || `Generation failed: ${response.status}`
          );
        }

        const data: GenerationResponse = await response.json();

        if (!data.data || data.data.length === 0) {
          throw new Error('No image data in response');
        }

        onProgress?.('Generation complete!');

        return {
          b64_json: data.data[0].b64_json,
          revised_prompt: enhancedPrompt
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Generation timed out');
        }

        if (attempt < retries) {
          onProgress?.(`Retrying (${attempt + 1}/${retries})...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error('Generation failed after retries');
  }

  /**
   * Convert base64 to Image element
   */
  function base64ToImage(base64: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = `data:image/png;base64,${base64}`;
    });
  }

  /**
   * Convert base64 to Blob
   */
  function base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }

  return {
    isAvailable,
    getModels,
    generate,
    base64ToImage,
    base64ToBlob,
    styles: PROMPT_STYLES
  };
}

// Export singleton instance with default config
export const mfluxClient = createMfluxClient();
