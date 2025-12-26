/**
 * Generative Input UI Component
 * Renders the bottom bar UI for mflux image generation
 */

import { createMfluxClient, PROMPT_STYLES } from './mflux-client';
import { createImageApplicator } from './image-applicator';
import type { ApplicationTarget, ImageSize, GenerationHistoryEntry } from './types';

export interface GenerativeUIConfig {
  container: HTMLElement;
  bgCanvas?: HTMLCanvasElement;
  gl?: WebGLRenderingContext | WebGL2RenderingContext;
  baseUrl?: string;
  onGenerate?: (imageData: string) => void;
  onApply?: (target: ApplicationTarget, imageData: string) => void;
  onError?: (error: string) => void;
}

export interface GenerativeUIState {
  isGenerating: boolean;
  selectedStyle: string;
  selectedSize: ImageSize;
  selectedModel: 'flux-schnell' | 'flux-dev';
  history: GenerationHistoryEntry[];
  lastImageData?: string;
}

/**
 * Create and mount the generative input UI
 */
export function createGenerativeUI(config: GenerativeUIConfig) {
  const { container, bgCanvas, gl, baseUrl, onGenerate, onApply, onError } = config;

  // Initialize clients
  const mflux = createMfluxClient({ baseUrl });
  const applicator = createImageApplicator({
    bgCanvas,
    gl,
    onTextureUpdate: (target, _texture) => {
      console.log(`Texture updated: ${target}`);
    }
  });

  // State
  const state: GenerativeUIState = {
    isGenerating: false,
    selectedStyle: 'texture',
    selectedSize: '512x512',
    selectedModel: 'flux-schnell',
    history: []
  };

  // Create UI HTML
  const html = `
    <div class="gen-module" id="generative-module">
      <div class="gen-header">
        <span class="gen-title">Image Generator</span>
        <span class="gen-status" id="gen-status">Ready</span>
      </div>

      <div class="gen-input-row">
        <input
          type="text"
          id="gen-prompt"
          class="gen-prompt"
          placeholder="Describe your image... (e.g., 'alien organic surface', 'neon grid pattern')"
          autocomplete="off"
        />
      </div>

      <div class="gen-controls-row">
        <select id="gen-style" class="gen-select">
          ${PROMPT_STYLES.map(s =>
            `<option value="${s.id}" ${s.id === state.selectedStyle ? 'selected' : ''}>${s.name}</option>`
          ).join('')}
        </select>

        <select id="gen-size" class="gen-select">
          <option value="512x512">512x512</option>
          <option value="768x768">768x768</option>
          <option value="1024x1024">1024x1024</option>
          <option value="512x768">512x768 (Portrait)</option>
          <option value="768x512">768x512 (Landscape)</option>
        </select>

        <select id="gen-model" class="gen-select">
          <option value="flux-schnell">Schnell (Fast)</option>
          <option value="flux-dev">Dev (Quality)</option>
        </select>

        <button id="gen-submit" class="gen-button primary">
          <span class="gen-btn-text">Generate</span>
          <span class="gen-btn-loader"></span>
        </button>
      </div>

      <div class="gen-output-row" id="gen-output" style="display: none;">
        <div class="gen-preview-container">
          <img id="gen-preview" class="gen-preview" alt="Generated image" />
        </div>

        <div class="gen-apply-controls">
          <span class="gen-apply-label">Apply to:</span>
          <button class="gen-apply-btn" data-target="background">Background</button>
          <button class="gen-apply-btn" data-target="texture">Texture</button>
          <button class="gen-apply-btn" data-target="displacement">Displacement</button>
          <button class="gen-apply-btn" data-target="emissive">Emissive</button>
        </div>
      </div>

      <div class="gen-history" id="gen-history">
        <!-- History thumbnails will be added here -->
      </div>
    </div>
  `;

  // Inject HTML
  container.innerHTML = html;

  // Get element references
  const elements = {
    module: container.querySelector('#generative-module') as HTMLElement,
    prompt: container.querySelector('#gen-prompt') as HTMLInputElement,
    style: container.querySelector('#gen-style') as HTMLSelectElement,
    size: container.querySelector('#gen-size') as HTMLSelectElement,
    model: container.querySelector('#gen-model') as HTMLSelectElement,
    submit: container.querySelector('#gen-submit') as HTMLButtonElement,
    status: container.querySelector('#gen-status') as HTMLElement,
    output: container.querySelector('#gen-output') as HTMLElement,
    preview: container.querySelector('#gen-preview') as HTMLImageElement,
    history: container.querySelector('#gen-history') as HTMLElement,
    applyButtons: container.querySelectorAll('.gen-apply-btn') as NodeListOf<HTMLButtonElement>
  };

  // Update UI state
  function setGenerating(isGenerating: boolean) {
    state.isGenerating = isGenerating;
    elements.submit.classList.toggle('loading', isGenerating);
    elements.submit.disabled = isGenerating;
    elements.prompt.disabled = isGenerating;
  }

  function setStatus(text: string) {
    elements.status.textContent = text;
  }

  function showPreview(imageData: string) {
    elements.preview.src = `data:image/png;base64,${imageData}`;
    elements.output.style.display = 'flex';
    state.lastImageData = imageData;
  }

  function addToHistory(entry: GenerationHistoryEntry) {
    state.history.unshift(entry);
    if (state.history.length > 10) state.history.pop();
    renderHistory();
  }

  function renderHistory() {
    elements.history.innerHTML = state.history.map(entry => `
      <div class="gen-history-item" data-id="${entry.id}">
        <img src="data:image/png;base64,${entry.imageData}" alt="${entry.prompt}" />
      </div>
    `).join('');

    // Add click handlers for history items
    elements.history.querySelectorAll('.gen-history-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        const entry = state.history.find(h => h.id === id);
        if (entry) {
          showPreview(entry.imageData);
          elements.prompt.value = entry.prompt;
        }
      });
    });
  }

  // Event handlers
  async function handleGenerate() {
    const prompt = elements.prompt.value.trim();
    if (!prompt) {
      setStatus('Enter a prompt');
      return;
    }

    setGenerating(true);
    setStatus('Generating...');

    try {
      const result = await mflux.generate({
        prompt,
        model: state.selectedModel,
        size: state.selectedSize,
        style: state.selectedStyle,
        onProgress: setStatus
      });

      if (result.b64_json) {
        showPreview(result.b64_json);

        const entry: GenerationHistoryEntry = {
          id: `gen-${Date.now()}`,
          timestamp: Date.now(),
          prompt,
          model: state.selectedModel,
          size: state.selectedSize,
          imageData: result.b64_json
        };
        addToHistory(entry);

        onGenerate?.(result.b64_json);
        setStatus('Complete!');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      setStatus(`Error: ${message}`);
      onError?.(message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleApply(target: ApplicationTarget) {
    if (!state.lastImageData) {
      setStatus('No image to apply');
      return;
    }

    try {
      setStatus(`Applying to ${target}...`);
      await applicator.applyBase64(state.lastImageData, target);
      onApply?.(target, state.lastImageData);
      setStatus(`Applied to ${target}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Apply failed';
      setStatus(`Error: ${message}`);
      onError?.(message);
    }
  }

  // Bind events
  elements.submit.addEventListener('click', handleGenerate);

  elements.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  });

  elements.style.addEventListener('change', () => {
    state.selectedStyle = elements.style.value;
  });

  elements.size.addEventListener('change', () => {
    state.selectedSize = elements.size.value as ImageSize;
  });

  elements.model.addEventListener('change', () => {
    state.selectedModel = elements.model.value as 'flux-schnell' | 'flux-dev';
  });

  elements.applyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target as ApplicationTarget;
      handleApply(target);
    });
  });

  // Public API
  return {
    getState: () => ({ ...state }),
    setPrompt: (prompt: string) => { elements.prompt.value = prompt; },
    generate: handleGenerate,
    apply: handleApply,
    destroy: () => { container.innerHTML = ''; }
  };
}

/**
 * CSS styles for the generative UI
 * Can be injected or imported
 */
export const GENERATIVE_UI_STYLES = `
  .gen-module {
    background: var(--glass, rgba(9,9,11,0.92));
    border: 1px solid var(--bd, #3f3f46);
    border-radius: var(--radius, 10px);
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .gen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .gen-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg, #fafafa);
  }

  .gen-status {
    font-size: 10px;
    color: var(--accent, #a78bfa);
    opacity: 0.8;
  }

  .gen-input-row {
    display: flex;
    gap: 8px;
  }

  .gen-prompt {
    flex: 1;
    background: var(--ui, #18181b);
    border: 1px solid var(--bd, #3f3f46);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12px;
    color: var(--fg, #fafafa);
    outline: none;
    transition: border-color 0.2s;
  }

  .gen-prompt:focus {
    border-color: var(--accent, #a78bfa);
  }

  .gen-prompt:disabled {
    opacity: 0.5;
  }

  .gen-controls-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .gen-select {
    background: var(--ui, #18181b);
    border: 1px solid var(--bd, #3f3f46);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 10px;
    color: var(--fg, #fafafa);
    cursor: pointer;
    min-width: 100px;
  }

  .gen-button {
    background: var(--ui, #18181b);
    border: 1px solid var(--bd, #3f3f46);
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg, #fafafa);
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gen-button.primary {
    background: var(--accent, #a78bfa);
    border-color: var(--accent, #a78bfa);
    color: #000;
  }

  .gen-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }

  .gen-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .gen-button.loading .gen-btn-text {
    opacity: 0;
  }

  .gen-button.loading .gen-btn-loader {
    display: block;
  }

  .gen-btn-loader {
    display: none;
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    position: absolute;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .gen-output-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding-top: 8px;
    border-top: 1px solid var(--bd, #3f3f46);
  }

  .gen-preview-container {
    width: 80px;
    height: 80px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--bd, #3f3f46);
    flex-shrink: 0;
  }

  .gen-preview {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .gen-apply-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .gen-apply-label {
    font-size: 10px;
    color: var(--fg, #fafafa);
    opacity: 0.6;
    width: 100%;
    margin-bottom: 2px;
  }

  .gen-apply-btn {
    background: var(--ui, #18181b);
    border: 1px solid var(--bd, #3f3f46);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 10px;
    color: var(--fg, #fafafa);
    cursor: pointer;
    transition: all 0.15s;
  }

  .gen-apply-btn:hover {
    background: var(--ui-hover, #27272a);
    border-color: var(--accent, #a78bfa);
  }

  .gen-history {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 4px 0;
  }

  .gen-history-item {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--bd, #3f3f46);
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.15s;
  }

  .gen-history-item:hover {
    border-color: var(--accent, #a78bfa);
  }

  .gen-history-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;
