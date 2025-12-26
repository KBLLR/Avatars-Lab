/**
 * Image Applicator
 * Applies generated images to various canvas targets
 */

import type { ApplicationTarget } from './types';

export interface ApplicatorContext {
  // Canvas elements
  bgCanvas?: HTMLCanvasElement;
  geoCanvas?: HTMLCanvasElement;

  // WebGL contexts (if available)
  gl?: WebGLRenderingContext | WebGL2RenderingContext;

  // Texture references for 3D
  albedoTexture?: WebGLTexture;
  displacementTexture?: WebGLTexture;
  emissiveTexture?: WebGLTexture;

  // Callback for texture updates
  onTextureUpdate?: (target: ApplicationTarget, texture: WebGLTexture | ImageData) => void;
}

/**
 * Create image applicator instance
 */
export function createImageApplicator(context: ApplicatorContext) {
  const { bgCanvas, gl, onTextureUpdate } = context;

  /**
   * Apply image to background canvas
   */
  function applyToBackground(image: HTMLImageElement): void {
    if (!bgCanvas) {
      console.warn('Background canvas not available');
      return;
    }

    const ctx = bgCanvas.getContext('2d');
    if (!ctx) return;

    // Draw image to fill canvas
    ctx.drawImage(image, 0, 0, bgCanvas.width, bgCanvas.height);

    onTextureUpdate?.('background', ctx.getImageData(0, 0, bgCanvas.width, bgCanvas.height));
  }

  /**
   * Apply image as WebGL texture (for 3D geometry)
   */
  function applyAsTexture(
    image: HTMLImageElement,
    target: 'texture' | 'displacement' | 'emissive'
  ): WebGLTexture | null {
    if (!gl) {
      console.warn('WebGL context not available');
      return null;
    }

    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Upload image data
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image
    );

    // Generate mipmaps
    gl.generateMipmap(gl.TEXTURE_2D);

    onTextureUpdate?.(target, texture);

    return texture;
  }

  /**
   * Convert image to grayscale for displacement maps
   */
  function toGrayscale(image: HTMLImageElement): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create canvas context');

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i] = gray;     // R
      data[i + 1] = gray; // G
      data[i + 2] = gray; // B
      // Alpha stays the same
    }

    return imageData;
  }

  /**
   * Apply image as displacement map (grayscale conversion)
   */
  function applyAsDisplacement(image: HTMLImageElement): WebGLTexture | null {
    if (!gl) {
      console.warn('WebGL context not available');
      return null;
    }

    const grayscaleData = toGrayscale(image);

    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      image.width,
      image.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(grayscaleData.data.buffer)
    );

    gl.generateMipmap(gl.TEXTURE_2D);

    onTextureUpdate?.('displacement', texture);

    return texture;
  }

  /**
   * Apply image as semi-transparent overlay
   */
  function applyAsOverlay(
    image: HTMLImageElement,
    opacity: number = 0.5
  ): void {
    if (!bgCanvas) {
      console.warn('Background canvas not available');
      return;
    }

    const ctx = bgCanvas.getContext('2d');
    if (!ctx) return;

    ctx.globalAlpha = opacity;
    ctx.drawImage(image, 0, 0, bgCanvas.width, bgCanvas.height);
    ctx.globalAlpha = 1.0;

    onTextureUpdate?.('overlay', ctx.getImageData(0, 0, bgCanvas.width, bgCanvas.height));
  }

  /**
   * Apply image to specified target
   */
  function apply(
    image: HTMLImageElement,
    target: ApplicationTarget,
    options: { opacity?: number } = {}
  ): WebGLTexture | null {
    switch (target) {
      case 'background':
        applyToBackground(image);
        return null;

      case 'texture':
        return applyAsTexture(image, 'texture');

      case 'displacement':
        return applyAsDisplacement(image);

      case 'emissive':
        return applyAsTexture(image, 'emissive');

      case 'overlay':
        applyAsOverlay(image, options.opacity);
        return null;

      default:
        console.warn(`Unknown application target: ${target}`);
        return null;
    }
  }

  /**
   * Apply base64 image data to target
   */
  async function applyBase64(
    base64: string,
    target: ApplicationTarget,
    options: { opacity?: number } = {}
  ): Promise<WebGLTexture | null> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const result = apply(img, target, options);
        resolve(result);
      };
      img.onerror = () => reject(new Error('Failed to load image from base64'));
      img.src = `data:image/png;base64,${base64}`;
    });
  }

  return {
    apply,
    applyBase64,
    applyToBackground,
    applyAsTexture,
    applyAsDisplacement,
    applyAsOverlay,
    toGrayscale
  };
}
