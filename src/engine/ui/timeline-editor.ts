/**
 * Timeline Editor UI Component
 *
 * Multi-track timeline visualization for the performance engine.
 * Swiss design inspired - minimal, grid-based, functional.
 */

import type {
  Timeline,
  TimelineBlock,
  LayerConfig,
  LayerType,
  TimelineMarker,
} from "../types";
import { LAYER_TYPES } from "../types";

// ============================================
// Types & Configuration
// ============================================

export interface TimelineEditorConfig {
  /** Pixels per millisecond at zoom level 1.0 */
  basePixelsPerMs: number;
  /** Track height in pixels */
  trackHeight: number;
  /** Track header width in pixels */
  headerWidth: number;
  /** Minimum block width in pixels */
  minBlockWidth: number;
  /** Snap to grid interval in ms (0 = disabled) */
  snapInterval_ms: number;
  /** Show time ruler */
  showRuler: boolean;
  /** Show markers */
  showMarkers: boolean;
  /** Enable block selection */
  enableSelection: boolean;
  /** Enable block dragging */
  enableDragging: boolean;
}

const DEFAULT_CONFIG: TimelineEditorConfig = {
  basePixelsPerMs: 0.1,
  trackHeight: 48,
  headerWidth: 120,
  minBlockWidth: 8,
  snapInterval_ms: 100,
  showRuler: true,
  showMarkers: true,
  enableSelection: true,
  enableDragging: true,
};

export interface TimelineEditorState {
  zoom: number;
  scrollX: number;
  scrollY: number;
  playhead_ms: number;
  isPlaying: boolean;
  selectedBlockIds: Set<string>;
  hoveredBlockId: string | null;
  dragState: DragState | null;
}

interface DragState {
  blockId: string;
  startX: number;
  startTime_ms: number;
  startDuration_ms: number;
  mode: "move" | "resize-start" | "resize-end";
}

interface ClipboardData {
  blocks: TimelineBlock[];
  copyTime_ms: number;
}

interface UndoAction {
  type: "move" | "resize" | "delete" | "add" | "paste";
  blockId: string;
  before: Partial<TimelineBlock>;
  after: Partial<TimelineBlock>;
}

export type TimelineEventType =
  | "block:select"
  | "block:deselect"
  | "block:move"
  | "block:resize"
  | "block:delete"
  | "block:add"
  | "block:copy"
  | "block:paste"
  | "block:duplicate"
  | "playhead:seek"
  | "zoom:change"
  | "undo"
  | "redo"
  | "save"
  | "export"
  | "import";

export interface TimelineEvent {
  type: TimelineEventType;
  blockId?: string;
  blockIds?: string[];
  time_ms?: number;
  duration_ms?: number;
  zoom?: number;
  blocks?: TimelineBlock[];
  timeline?: Timeline;
  file?: File;
}

type TimelineEventHandler = (event: TimelineEvent) => void;

// ============================================
// Layer Colors (Swiss-inspired palette)
// ============================================

const LAYER_COLORS: Record<LayerType, { bg: string; border: string; text: string }> = {
  viseme: { bg: "#2E7D32", border: "#1B5E20", text: "#E8F5E9" },
  dance: { bg: "#1565C0", border: "#0D47A1", text: "#E3F2FD" },
  blendshape: { bg: "#E65100", border: "#BF360C", text: "#FFF3E0" },
  lighting: { bg: "#F9A825", border: "#F57F17", text: "#212121" },
  camera: { bg: "#6A1B9A", border: "#4A148C", text: "#F3E5F5" },
  fx: { bg: "#C2185B", border: "#880E4F", text: "#FCE4EC" },
};

// ============================================
// Timeline Editor Component
// ============================================

export class TimelineEditor {
  private container: HTMLElement;
  private config: TimelineEditorConfig;
  private state: TimelineEditorState;
  private timeline: Timeline | null = null;

  // DOM Elements
  private root: HTMLElement | null = null;
  private rulerCanvas: HTMLCanvasElement | null = null;
  private tracksContainer: HTMLElement | null = null;
  private playheadElement: HTMLElement | null = null;
  private blocksContainer: HTMLElement | null = null;

  // Event handling
  private eventHandlers: Map<TimelineEventType, Set<TimelineEventHandler>> = new Map();
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Clipboard & Undo/Redo
  private clipboard: ClipboardData | null = null;
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private maxUndoSteps = 50;

  // Snap guides
  private snapGuides: number[] = [];
  private showSnapGuide = false;
  private snapGuideX = 0;

  constructor(
    container: HTMLElement,
    config: Partial<TimelineEditorConfig> = {}
  ) {
    this.container = container;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      playhead_ms: 0,
      isPlaying: false,
      selectedBlockIds: new Set(),
      hoveredBlockId: null,
      dragState: null,
    };

    this.init();
  }

  // ─────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────

  private init(): void {
    this.createDOM();
    this.attachEventListeners();
    this.setupResizeObserver();
  }

  private createDOM(): void {
    // Root container
    this.root = document.createElement("div");
    this.root.className = "timeline-editor";
    this.root.innerHTML = `
      <div class="timeline-toolbar">
        <div class="timeline-controls">
          <button class="timeline-btn" data-action="play" title="Play/Pause (Space)">
            <span class="icon">▶</span>
          </button>
          <button class="timeline-btn" data-action="stop" title="Stop">
            <span class="icon">■</span>
          </button>
          <span class="timeline-time">00:00.000</span>
          <span class="timeline-sep">│</span>
          <button class="timeline-btn" data-action="undo" title="Undo (Cmd+Z)">↶</button>
          <button class="timeline-btn" data-action="redo" title="Redo (Cmd+Shift+Z)">↷</button>
        </div>
        <div class="timeline-edit">
          <button class="timeline-btn" data-action="copy" title="Copy (Cmd+C)">⎘</button>
          <button class="timeline-btn" data-action="paste" title="Paste (Cmd+V)">⎗</button>
          <button class="timeline-btn" data-action="duplicate" title="Duplicate (Cmd+D)">⧉</button>
          <button class="timeline-btn" data-action="delete" title="Delete (Del)">✕</button>
        </div>
        <div class="timeline-file">
          <button class="timeline-btn" data-action="save" title="Save (Cmd+S)">💾</button>
          <button class="timeline-btn" data-action="export" title="Export JSON">📤</button>
          <button class="timeline-btn" data-action="import" title="Import JSON">📥</button>
          <input type="file" id="timeline-import-input" accept=".json" style="display: none;" />
        </div>
        <div class="timeline-zoom">
          <button class="timeline-btn" data-action="zoom-out" title="Zoom Out (-)">−</button>
          <span class="zoom-level">100%</span>
          <button class="timeline-btn" data-action="zoom-in" title="Zoom In (+)">+</button>
          <button class="timeline-btn" data-action="fit" title="Fit to View">◻</button>
        </div>
      </div>
      <div class="timeline-body">
        <div class="timeline-headers"></div>
        <div class="timeline-content">
          <canvas class="timeline-ruler"></canvas>
          <div class="timeline-tracks"></div>
          <div class="timeline-playhead"></div>
          <div class="timeline-markers"></div>
          <div class="timeline-snap-guide"></div>
        </div>
      </div>
      <div class="timeline-property-panel" style="display: none;">
        <div class="property-header">
          <span class="property-title">Block Properties</span>
          <button class="property-close" data-action="close-properties">×</button>
        </div>
        <div class="property-content">
          <div class="property-row">
            <label>Label</label>
            <input type="text" class="property-input" data-prop="label" />
          </div>
          <div class="property-row">
            <label>Start (ms)</label>
            <input type="number" class="property-input" data-prop="start_ms" step="100" />
          </div>
          <div class="property-row">
            <label>Duration (ms)</label>
            <input type="number" class="property-input" data-prop="duration_ms" step="100" min="100" />
          </div>
          <div class="property-row">
            <label>Ease In</label>
            <select class="property-input" data-prop="easeIn">
              <option value="">None</option>
              <option value="linear">Linear</option>
              <option value="easeIn">Ease In</option>
              <option value="easeOut">Ease Out</option>
              <option value="easeInOut">Ease In/Out</option>
            </select>
          </div>
          <div class="property-row">
            <label>Ease Out</label>
            <select class="property-input" data-prop="easeOut">
              <option value="">None</option>
              <option value="linear">Linear</option>
              <option value="easeIn">Ease In</option>
              <option value="easeOut">Ease Out</option>
              <option value="easeInOut">Ease In/Out</option>
            </select>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.root);

    // Cache DOM references
    this.rulerCanvas = this.root.querySelector(".timeline-ruler");
    this.tracksContainer = this.root.querySelector(".timeline-tracks");
    this.playheadElement = this.root.querySelector(".timeline-playhead");
    this.blocksContainer = this.tracksContainer;

    // Inject styles
    this.injectStyles();
  }

  private injectStyles(): void {
    if (document.getElementById("timeline-editor-styles")) return;

    const style = document.createElement("style");
    style.id = "timeline-editor-styles";
    style.textContent = `
      .timeline-editor {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: transparent;
        color: #e0e0e0;
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 11px;
        user-select: none;
        border: none;
      }

      /* Toolbar - hidden when in overlay (use parent toolbar) */
      .timeline-toolbar {
        display: none;
      }

      /* Show toolbar when not in overlay */
      .timeline-editor:not(.in-overlay) .timeline-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(26, 26, 26, 0.9);
        border-bottom: 1px solid rgba(51, 51, 51, 0.5);
      }

      .timeline-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .timeline-btn {
        background: rgba(42, 42, 42, 0.8);
        border: 1px solid rgba(68, 68, 68, 0.6);
        color: #e0e0e0;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 12px;
        border-radius: 2px;
        transition: background 0.1s;
      }

      .timeline-btn:hover {
        background: rgba(58, 58, 58, 0.9);
      }

      .timeline-btn:active {
        background: rgba(74, 74, 74, 0.9);
      }

      .timeline-time {
        font-variant-numeric: tabular-nums;
        color: #4fc3f7;
        min-width: 80px;
      }

      .timeline-zoom {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .zoom-level {
        min-width: 48px;
        text-align: center;
        color: #9e9e9e;
      }

      /* Body */
      .timeline-body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      /* Headers */
      .timeline-headers {
        width: ${this.config.headerWidth}px;
        flex-shrink: 0;
        background: rgba(20, 20, 20, 0.85);
        border-right: 1px solid rgba(51, 51, 51, 0.5);
        overflow-y: auto;
        scrollbar-width: none;
      }

      .timeline-headers::-webkit-scrollbar {
        display: none;
      }

      .track-header {
        height: ${this.config.trackHeight}px;
        display: flex;
        align-items: center;
        padding: 0 12px;
        border-bottom: 1px solid #222;
        gap: 8px;
      }

      .track-color {
        width: 4px;
        height: 24px;
        border-radius: 2px;
      }

      .track-name {
        flex: 1;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #9e9e9e;
      }

      .track-mute {
        opacity: 0.5;
        cursor: pointer;
        font-size: 10px;
      }

      .track-mute:hover {
        opacity: 1;
      }

      /* Content */
      .timeline-content {
        flex: 1;
        position: relative;
        overflow: auto;
      }

      /* Ruler */
      .timeline-ruler {
        position: sticky;
        top: 0;
        left: 0;
        height: 24px;
        width: 100%;
        background: rgba(20, 20, 20, 0.85);
        border-bottom: 1px solid rgba(51, 51, 51, 0.5);
        z-index: 10;
      }

      /* Tracks */
      .timeline-tracks {
        position: relative;
        min-height: 100%;
      }

      .timeline-track {
        height: ${this.config.trackHeight}px;
        border-bottom: 1px solid rgba(26, 26, 26, 0.6);
        position: relative;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255,255,255,0.015) 50%,
          transparent 100%
        );
      }

      .timeline-track:nth-child(odd) {
        background: rgba(255,255,255,0.008);
      }

      /* Blocks */
      .timeline-block {
        position: absolute;
        height: calc(${this.config.trackHeight}px - 8px);
        top: 4px;
        border-radius: 3px;
        cursor: pointer;
        display: flex;
        align-items: center;
        padding: 0 6px;
        font-size: 9px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        transition: transform 0.1s, box-shadow 0.1s;
        border: 1px solid transparent;
      }

      .timeline-block:hover {
        transform: scaleY(1.05);
        z-index: 5;
      }

      .timeline-block.selected {
        border-color: #fff;
        box-shadow: 0 0 0 1px #fff;
        z-index: 10;
      }

      .timeline-block .block-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .timeline-block .block-duration {
        opacity: 0.7;
        font-size: 8px;
        margin-left: 4px;
      }

      /* Resize handles */
      .timeline-block .resize-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 6px;
        cursor: ew-resize;
        opacity: 0;
      }

      .timeline-block:hover .resize-handle {
        opacity: 1;
        background: rgba(255,255,255,0.2);
      }

      .resize-handle.left { left: 0; }
      .resize-handle.right { right: 0; }

      /* Playhead */
      .timeline-playhead {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: #ff5722;
        z-index: 20;
        pointer-events: none;
      }

      .timeline-playhead::before {
        content: "";
        position: absolute;
        top: 0;
        left: -5px;
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 8px solid #ff5722;
      }

      /* Markers */
      .timeline-markers {
        position: absolute;
        top: 24px;
        left: 0;
        right: 0;
        pointer-events: none;
      }

      .timeline-marker {
        position: absolute;
        top: 0;
        width: 1px;
        height: 100%;
        opacity: 0.5;
      }

      .timeline-marker .marker-label {
        position: absolute;
        top: 0;
        left: 4px;
        font-size: 8px;
        padding: 2px 4px;
        background: inherit;
        border-radius: 2px;
        white-space: nowrap;
      }

      /* Grid overlay */
      .timeline-grid {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        background-image: repeating-linear-gradient(
          90deg,
          transparent,
          transparent calc(100px - 1px),
          rgba(255,255,255,0.05) calc(100px - 1px),
          rgba(255,255,255,0.05) 100px
        );
      }

      /* Toolbar edit buttons */
      .timeline-edit {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .timeline-file {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
        padding-left: 8px;
        border-left: 1px solid #333;
      }

      .timeline-sep {
        color: #444;
        margin: 0 4px;
      }

      .timeline-btn[data-action="undo"],
      .timeline-btn[data-action="redo"] {
        font-size: 14px;
        padding: 4px 6px;
      }

      .timeline-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      /* Snap guide */
      .timeline-snap-guide {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: #4fc3f7;
        opacity: 0;
        pointer-events: none;
        z-index: 15;
        transition: opacity 0.1s;
      }

      .timeline-snap-guide.visible {
        opacity: 1;
      }

      .timeline-snap-guide::before {
        content: "";
        position: absolute;
        top: 0;
        left: -3px;
        width: 7px;
        height: 7px;
        background: #4fc3f7;
        border-radius: 50%;
      }

      /* Property Panel */
      .timeline-property-panel {
        position: absolute;
        top: 50px;
        right: 10px;
        width: 220px;
        background: rgba(20, 20, 20, 0.95);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(68, 68, 68, 0.6);
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        z-index: 100;
      }

      .property-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(51, 51, 51, 0.6);
      }

      .property-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #9e9e9e;
      }

      .property-close {
        background: none;
        border: none;
        color: #666;
        font-size: 16px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }

      .property-close:hover {
        color: #fff;
      }

      .property-content {
        padding: 12px;
      }

      .property-row {
        margin-bottom: 10px;
      }

      .property-row:last-child {
        margin-bottom: 0;
      }

      .property-row label {
        display: block;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #888;
        margin-bottom: 4px;
      }

      .property-input {
        width: 100%;
        padding: 6px 8px;
        border-radius: 4px;
        border: 1px solid #444;
        background: #0a0a0a;
        color: #e0e0e0;
        font-size: 12px;
        font-family: inherit;
      }

      .property-input:focus {
        outline: none;
        border-color: #4fc3f7;
      }

      /* Block dragging state */
      .timeline-block.dragging {
        opacity: 0.8;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        z-index: 20;
      }

      /* Ghost block for paste preview */
      .timeline-block.ghost {
        opacity: 0.4;
        border: 1px dashed #fff;
        pointer-events: none;
      }
    `;

    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────
  // Event Listeners
  // ─────────────────────────────────────────────────────────────

  private attachEventListeners(): void {
    if (!this.root) return;

    // Toolbar buttons
    this.root.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest("[data-action]") as HTMLElement;
      if (!btn) return;

      const action = btn.dataset.action;
      switch (action) {
        case "play":
          this.togglePlay();
          break;
        case "stop":
          this.stop();
          break;
        case "zoom-in":
          this.setZoom(this.state.zoom * 1.25);
          break;
        case "zoom-out":
          this.setZoom(this.state.zoom * 0.8);
          break;
        case "fit":
          this.fitToView();
          break;
        case "undo":
          this.undo();
          break;
        case "redo":
          this.redo();
          break;
        case "copy":
          this.copySelectedBlocks();
          break;
        case "paste":
          this.pasteBlocks();
          break;
        case "duplicate":
          this.duplicateSelectedBlocks();
          break;
        case "delete":
          this.deleteSelectedBlocks();
          break;
        case "close-properties":
          this.hidePropertyPanel();
          break;
        case "save":
          this.emitSave();
          break;
        case "export":
          this.emitExport();
          break;
        case "import":
          this.triggerImport();
          break;
      }
    });

    // File import handler
    const importInput = this.root.querySelector("#timeline-import-input") as HTMLInputElement;
    if (importInput) {
      importInput.addEventListener("change", (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          this.emit({ type: "import", file });
          importInput.value = ""; // Reset for next import
        }
      });
    }

    // Block interactions
    if (this.tracksContainer) {
      this.tracksContainer.addEventListener("click", (e) => {
        const block = (e.target as HTMLElement).closest(".timeline-block") as HTMLElement;
        if (block) {
          this.selectBlock(block.dataset.blockId || "", e.shiftKey);
        } else {
          // Click on track - seek to position
          const rect = this.tracksContainer!.getBoundingClientRect();
          const x = e.clientX - rect.left + this.state.scrollX;
          const time_ms = this.pixelsToMs(x);
          this.seek(time_ms);
        }
      });

      // Drag handling
      this.tracksContainer.addEventListener("mousedown", (e) => {
        const target = e.target as HTMLElement;
        const block = target.closest(".timeline-block") as HTMLElement;
        if (!block) return;

        const handle = target.closest(".resize-handle");
        const mode = handle?.classList.contains("left")
          ? "resize-start"
          : handle?.classList.contains("right")
          ? "resize-end"
          : "move";

        const blockData = this.getBlockById(block.dataset.blockId || "");
        if (!blockData) return;

        this.state.dragState = {
          blockId: block.dataset.blockId || "",
          startX: e.clientX,
          startTime_ms: blockData.start_ms,
          startDuration_ms: blockData.duration_ms,
          mode,
        };

        e.preventDefault();
      });
    }

    // Global mouse events for dragging
    document.addEventListener("mousemove", this.handleMouseMove.bind(this));
    document.addEventListener("mouseup", this.handleMouseUp.bind(this));

    // Scroll sync between headers and tracks
    const content = this.root.querySelector(".timeline-content");
    const headers = this.root.querySelector(".timeline-headers");
    if (content && headers) {
      content.addEventListener("scroll", () => {
        headers.scrollTop = content.scrollTop;
        this.state.scrollX = content.scrollLeft;
        this.state.scrollY = content.scrollTop;
        this.updateRuler();
        this.updatePlayhead();
      });

      // Mouse wheel zoom and horizontal pan
      content.addEventListener("wheel", (e) => {
        const wheelEvent = e as WheelEvent;

        // Ctrl/Cmd + wheel = zoom
        if (wheelEvent.ctrlKey || wheelEvent.metaKey) {
          e.preventDefault();
          const zoomFactor = wheelEvent.deltaY > 0 ? 0.9 : 1.1;
          const rect = content.getBoundingClientRect();
          const mouseX = wheelEvent.clientX - rect.left;

          // Zoom centered on mouse position
          const mouseTime = this.pixelsToMs(mouseX + this.state.scrollX);
          this.setZoom(this.state.zoom * zoomFactor);

          // Adjust scroll to keep mouse position stable
          const newMouseX = this.msToPixels(mouseTime);
          content.scrollLeft = newMouseX - mouseX;
        }
        // Shift + wheel = horizontal scroll
        else if (wheelEvent.shiftKey) {
          e.preventDefault();
          content.scrollLeft += wheelEvent.deltaY;
        }
      }, { passive: false });
    }

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Skip if typing in an input
      if ((e.target as HTMLElement).tagName === "INPUT" ||
          (e.target as HTMLElement).tagName === "TEXTAREA" ||
          (e.target as HTMLElement).tagName === "SELECT") return;

      if (!this.root?.contains(document.activeElement) &&
          document.activeElement !== document.body) return;

      const isMeta = e.metaKey || e.ctrlKey;

      switch (e.key) {
        case " ":
          e.preventDefault();
          this.togglePlay();
          break;

        case "Delete":
        case "Backspace":
          if (!isMeta) {
            e.preventDefault();
            this.deleteSelectedBlocks();
          }
          break;

        case "Escape":
          this.clearSelection();
          this.hidePropertyPanel();
          break;

        case "z":
          if (isMeta) {
            e.preventDefault();
            if (e.shiftKey) {
              this.redo();
            } else {
              this.undo();
            }
          }
          break;

        case "c":
          if (isMeta) {
            e.preventDefault();
            this.copySelectedBlocks();
          }
          break;

        case "v":
          if (isMeta) {
            e.preventDefault();
            this.pasteBlocks();
          }
          break;

        case "d":
          if (isMeta) {
            e.preventDefault();
            this.duplicateSelectedBlocks();
          }
          break;

        case "a":
          if (isMeta) {
            e.preventDefault();
            this.selectAllBlocks();
          }
          break;

        case "i":
          if (isMeta) {
            e.preventDefault();
            this.showPropertyPanel();
          }
          break;

        case "+":
        case "=":
          if (isMeta) {
            e.preventDefault();
            this.setZoom(this.state.zoom * 1.25);
          }
          break;

        case "-":
          if (isMeta) {
            e.preventDefault();
            this.setZoom(this.state.zoom * 0.8);
          }
          break;

        case "0":
          if (isMeta) {
            e.preventDefault();
            this.setZoom(1);
          }
          break;

        case "s":
          if (isMeta) {
            e.preventDefault();
            this.emitSave();
          }
          break;

        case "e":
          if (isMeta && e.shiftKey) {
            e.preventDefault();
            this.emitExport();
          }
          break;

        case "o":
          if (isMeta) {
            e.preventDefault();
            this.triggerImport();
          }
          break;
      }
    });

    // Double-click to show property panel
    if (this.tracksContainer) {
      this.tracksContainer.addEventListener("dblclick", (e) => {
        const block = (e.target as HTMLElement).closest(".timeline-block") as HTMLElement;
        if (block) {
          this.selectBlock(block.dataset.blockId || "");
          this.showPropertyPanel();
        }
      });
    }

    // Property panel input changes
    this.root.querySelector(".timeline-property-panel")?.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      const prop = input.dataset.prop;
      if (!prop || this.state.selectedBlockIds.size !== 1) return;

      const blockId = [...this.state.selectedBlockIds][0];
      const block = this.getBlockById(blockId);
      if (!block) return;

      let value: string | number = input.value;
      if (input.type === "number") {
        value = parseFloat(value) || 0;
      }

      this.updateBlockProperty(blockId, prop, value);
    });
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.state.dragState || !this.config.enableDragging) return;

    const deltaX = e.clientX - this.state.dragState.startX;
    const deltaTime_ms = this.pixelsToMs(deltaX);

    let newStart = this.state.dragState.startTime_ms;
    let newDuration = this.state.dragState.startDuration_ms;

    switch (this.state.dragState.mode) {
      case "move":
        newStart = Math.max(0, this.state.dragState.startTime_ms + deltaTime_ms);
        break;
      case "resize-start":
        newStart = Math.max(0, this.state.dragState.startTime_ms + deltaTime_ms);
        newDuration = Math.max(100, this.state.dragState.startDuration_ms - deltaTime_ms);
        break;
      case "resize-end":
        newDuration = Math.max(100, this.state.dragState.startDuration_ms + deltaTime_ms);
        break;
    }

    // Snap to grid with visual feedback
    const snapped = this.snapToGrid(newStart, this.state.dragState.mode);
    newStart = snapped.time;

    // Show/hide snap guide
    const snapGuide = this.root?.querySelector(".timeline-snap-guide") as HTMLElement;
    if (snapGuide) {
      if (snapped.snapped) {
        snapGuide.style.left = `${this.msToPixels(snapped.time) - this.state.scrollX}px`;
        snapGuide.classList.add("visible");
      } else {
        snapGuide.classList.remove("visible");
      }
    }

    // Update visual position
    const blockEl = this.root?.querySelector(`[data-block-id="${this.state.dragState.blockId}"]`) as HTMLElement;
    if (blockEl) {
      blockEl.classList.add("dragging");
      blockEl.style.left = `${this.msToPixels(newStart)}px`;
      blockEl.style.width = `${Math.max(this.config.minBlockWidth, this.msToPixels(newDuration))}px`;
    }
  }

  private handleMouseUp(_e: MouseEvent): void {
    // Hide snap guide
    const snapGuide = this.root?.querySelector(".timeline-snap-guide") as HTMLElement;
    if (snapGuide) {
      snapGuide.classList.remove("visible");
    }

    if (!this.state.dragState) return;

    const blockEl = this.root?.querySelector(`[data-block-id="${this.state.dragState.blockId}"]`) as HTMLElement;
    if (blockEl) {
      blockEl.classList.remove("dragging");

      const newStart = this.pixelsToMs(parseFloat(blockEl.style.left));
      const newDuration = this.pixelsToMs(parseFloat(blockEl.style.width));
      const block = this.getBlockById(this.state.dragState.blockId);

      if (block) {
        // Record undo action
        this.pushUndo({
          type: this.state.dragState.mode === "move" ? "move" : "resize",
          blockId: this.state.dragState.blockId,
          before: { start_ms: block.start_ms, duration_ms: block.duration_ms },
          after: { start_ms: newStart, duration_ms: newDuration },
        });

        // Update block data
        block.start_ms = newStart;
        block.duration_ms = newDuration;
      }

      if (this.state.dragState.mode === "move") {
        this.emit({
          type: "block:move",
          blockId: this.state.dragState.blockId,
          time_ms: newStart,
        });
      } else {
        this.emit({
          type: "block:resize",
          blockId: this.state.dragState.blockId,
          time_ms: newStart,
          duration_ms: newDuration,
        });
      }
    }

    this.state.dragState = null;
  }

  private snapToGrid(time_ms: number, mode: string): { time: number; snapped: boolean } {
    if (this.config.snapInterval_ms <= 0) {
      return { time: time_ms, snapped: false };
    }

    // Build snap points from grid and other blocks
    const snapPoints: number[] = [];

    // Grid snap points
    const gridSnap = Math.round(time_ms / this.config.snapInterval_ms) * this.config.snapInterval_ms;
    snapPoints.push(gridSnap);

    // Snap to other block edges
    if (this.timeline) {
      for (const block of this.timeline.blocks) {
        if (this.state.dragState && block.id === this.state.dragState.blockId) continue;
        snapPoints.push(block.start_ms);
        snapPoints.push(block.start_ms + block.duration_ms);
      }

      // Snap to markers
      for (const marker of this.timeline.markers) {
        snapPoints.push(marker.time_ms);
      }
    }

    // Snap to playhead
    snapPoints.push(this.state.playhead_ms);

    // Find closest snap point within threshold
    const threshold = this.pixelsToMs(8); // 8 pixels
    let closest = time_ms;
    let minDist = threshold;
    let snapped = false;

    for (const point of snapPoints) {
      const dist = Math.abs(time_ms - point);
      if (dist < minDist) {
        minDist = dist;
        closest = point;
        snapped = true;
      }
    }

    return { time: snapped ? closest : time_ms, snapped };
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.updateRuler();
    });

    if (this.root) {
      this.resizeObserver.observe(this.root);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Timeline Data
  // ─────────────────────────────────────────────────────────────

  setTimeline(timeline: Timeline): void {
    this.timeline = timeline;
    this.render();
  }

  getTimeline(): Timeline | null {
    return this.timeline;
  }

  private getBlockById(id: string): TimelineBlock | undefined {
    return this.timeline?.blocks.find((b) => b.id === id);
  }

  // ─────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.timeline || !this.root) return;

    this.renderHeaders();
    this.renderTracks();
    this.renderBlocks();
    this.renderMarkers();
    this.updateRuler();
    this.updatePlayhead();
  }

  private renderHeaders(): void {
    const headers = this.root?.querySelector(".timeline-headers");
    if (!headers || !this.timeline) return;

    headers.innerHTML = "";

    // Add ruler spacer
    const spacer = document.createElement("div");
    spacer.style.height = "24px";
    headers.appendChild(spacer);

    for (const layer of this.timeline.layers) {
      const colors = LAYER_COLORS[layer.type];
      const header = document.createElement("div");
      header.className = "track-header";
      header.innerHTML = `
        <div class="track-color" style="background: ${colors.bg}"></div>
        <span class="track-name">${layer.name}</span>
        <span class="track-mute" data-layer="${layer.id}">${layer.muted ? "🔇" : "🔊"}</span>
      `;
      headers.appendChild(header);
    }
  }

  private renderTracks(): void {
    if (!this.tracksContainer || !this.timeline) return;

    this.tracksContainer.innerHTML = "";

    const totalWidth = this.msToPixels(this.timeline.duration_ms);

    for (const layer of this.timeline.layers) {
      const track = document.createElement("div");
      track.className = "timeline-track";
      track.dataset.layerId = layer.id;
      track.style.width = `${totalWidth}px`;
      this.tracksContainer.appendChild(track);
    }
  }

  private renderBlocks(): void {
    if (!this.tracksContainer || !this.timeline) return;

    // Remove existing blocks
    this.tracksContainer.querySelectorAll(".timeline-block").forEach((el) => el.remove());

    // Group blocks by layer
    const blocksByLayer = new Map<string, TimelineBlock[]>();
    for (const block of this.timeline.blocks) {
      const existing = blocksByLayer.get(block.layerId) || [];
      existing.push(block);
      blocksByLayer.set(block.layerId, existing);
    }

    // Render blocks on each track
    const tracks = this.tracksContainer.querySelectorAll(".timeline-track");
    tracks.forEach((track) => {
      const layerId = (track as HTMLElement).dataset.layerId || "";
      const blocks = blocksByLayer.get(layerId) || [];

      for (const block of blocks) {
        const blockEl = this.createBlockElement(block);
        track.appendChild(blockEl);
      }
    });
  }

  private createBlockElement(block: TimelineBlock): HTMLElement {
    const colors = LAYER_COLORS[block.layerType];
    const isSelected = this.state.selectedBlockIds.has(block.id);

    const el = document.createElement("div");
    el.className = `timeline-block ${isSelected ? "selected" : ""}`;
    el.dataset.blockId = block.id;
    el.style.left = `${this.msToPixels(block.start_ms)}px`;
    el.style.width = `${Math.max(this.config.minBlockWidth, this.msToPixels(block.duration_ms))}px`;
    el.style.background = colors.bg;
    el.style.borderColor = colors.border;
    el.style.color = colors.text;

    const label = block.label || block.layerType;
    const durationSec = (block.duration_ms / 1000).toFixed(1);

    el.innerHTML = `
      <span class="block-label">${label}</span>
      <span class="block-duration">${durationSec}s</span>
      <div class="resize-handle left"></div>
      <div class="resize-handle right"></div>
    `;

    return el;
  }

  private renderMarkers(): void {
    if (!this.config.showMarkers || !this.timeline) return;

    const container = this.root?.querySelector(".timeline-markers");
    if (!container) return;

    container.innerHTML = "";

    for (const marker of this.timeline.markers) {
      const el = document.createElement("div");
      el.className = "timeline-marker";
      el.style.left = `${this.msToPixels(marker.time_ms)}px`;
      el.style.background = marker.color || "#fff";
      el.innerHTML = `<span class="marker-label">${marker.label}</span>`;
      container.appendChild(el);
    }
  }

  private updateRuler(): void {
    if (!this.rulerCanvas || !this.timeline) return;

    const canvas = this.rulerCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Calculate tick interval based on zoom
    const pixelsPerSec = this.config.basePixelsPerMs * 1000 * this.state.zoom;
    let tickInterval = 1000; // 1 second
    if (pixelsPerSec > 100) tickInterval = 500;
    if (pixelsPerSec > 200) tickInterval = 100;
    if (pixelsPerSec < 50) tickInterval = 2000;
    if (pixelsPerSec < 25) tickInterval = 5000;

    const majorEvery = tickInterval * 5;

    // Draw ticks
    const startMs = this.state.scrollX / (this.config.basePixelsPerMs * this.state.zoom);
    const endMs = startMs + rect.width / (this.config.basePixelsPerMs * this.state.zoom);

    ctx.fillStyle = "#666";
    ctx.font = "9px SF Mono, monospace";
    ctx.textAlign = "center";

    for (let ms = Math.floor(startMs / tickInterval) * tickInterval; ms <= endMs; ms += tickInterval) {
      const x = this.msToPixels(ms) - this.state.scrollX;
      const isMajor = ms % majorEvery === 0;

      ctx.strokeStyle = isMajor ? "#555" : "#333";
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 8 : 14);
      ctx.lineTo(x, 24);
      ctx.stroke();

      if (isMajor) {
        const timeStr = this.formatTime(ms);
        ctx.fillText(timeStr, x, 10);
      }
    }
  }

  private updatePlayhead(): void {
    if (!this.playheadElement) return;

    const x = this.msToPixels(this.state.playhead_ms) - this.state.scrollX;
    this.playheadElement.style.left = `${x}px`;
    this.playheadElement.style.display = x >= 0 ? "block" : "none";

    // Update time display
    const timeEl = this.root?.querySelector(".timeline-time");
    if (timeEl) {
      timeEl.textContent = this.formatTime(this.state.playhead_ms);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Playback Controls
  // ─────────────────────────────────────────────────────────────

  play(): void {
    this.state.isPlaying = true;
    this.updatePlayButton();
  }

  pause(): void {
    this.state.isPlaying = false;
    this.updatePlayButton();
  }

  togglePlay(): void {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  stop(): void {
    this.state.isPlaying = false;
    this.state.playhead_ms = 0;
    this.updatePlayhead();
    this.updatePlayButton();
  }

  seek(time_ms: number): void {
    this.state.playhead_ms = Math.max(0, time_ms);
    if (this.timeline) {
      this.state.playhead_ms = Math.min(this.state.playhead_ms, this.timeline.duration_ms);
    }
    this.updatePlayhead();
    this.emit({ type: "playhead:seek", time_ms: this.state.playhead_ms });
  }

  setPlayhead(time_ms: number): void {
    this.state.playhead_ms = time_ms;
    this.updatePlayhead();
  }

  private updatePlayButton(): void {
    const btn = this.root?.querySelector('[data-action="play"] .icon');
    if (btn) {
      btn.textContent = this.state.isPlaying ? "⏸" : "▶";
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Zoom & Navigation
  // ─────────────────────────────────────────────────────────────

  setZoom(zoom: number): void {
    this.state.zoom = Math.max(0.1, Math.min(10, zoom));
    this.render();
    this.emit({ type: "zoom:change", zoom: this.state.zoom });

    // Update zoom display
    const zoomEl = this.root?.querySelector(".zoom-level");
    if (zoomEl) {
      zoomEl.textContent = `${Math.round(this.state.zoom * 100)}%`;
    }
  }

  fitToView(): void {
    if (!this.timeline || !this.tracksContainer) return;

    const containerWidth = this.tracksContainer.clientWidth;
    const timelineWidth = this.timeline.duration_ms * this.config.basePixelsPerMs;
    const zoom = containerWidth / timelineWidth;
    this.setZoom(zoom);
  }

  // ─────────────────────────────────────────────────────────────
  // Selection
  // ─────────────────────────────────────────────────────────────

  selectBlock(blockId: string, addToSelection = false): void {
    if (!addToSelection) {
      this.clearSelection();
    }

    this.state.selectedBlockIds.add(blockId);
    this.updateBlockSelection();
    this.emit({ type: "block:select", blockId });
  }

  deselectBlock(blockId: string): void {
    this.state.selectedBlockIds.delete(blockId);
    this.updateBlockSelection();
    this.emit({ type: "block:deselect", blockId });
  }

  clearSelection(): void {
    this.state.selectedBlockIds.clear();
    this.updateBlockSelection();
  }

  private updateBlockSelection(): void {
    this.root?.querySelectorAll(".timeline-block").forEach((el) => {
      const blockId = (el as HTMLElement).dataset.blockId || "";
      el.classList.toggle("selected", this.state.selectedBlockIds.has(blockId));
    });
  }

  deleteSelectedBlocks(): void {
    if (this.state.selectedBlockIds.size === 0 || !this.timeline) return;

    for (const blockId of this.state.selectedBlockIds) {
      const block = this.getBlockById(blockId);
      if (block) {
        // Record undo action
        this.pushUndo({
          type: "delete",
          blockId,
          before: { ...block },
          after: {},
        });

        // Remove from timeline
        const index = this.timeline.blocks.findIndex((b) => b.id === blockId);
        if (index >= 0) {
          this.timeline.blocks.splice(index, 1);
        }
      }
      this.emit({ type: "block:delete", blockId });
    }

    this.clearSelection();
    this.render();
  }

  selectAllBlocks(): void {
    if (!this.timeline) return;

    for (const block of this.timeline.blocks) {
      this.state.selectedBlockIds.add(block.id);
    }
    this.updateBlockSelection();
  }

  // ─────────────────────────────────────────────────────────────
  // Copy/Paste/Duplicate
  // ─────────────────────────────────────────────────────────────

  copySelectedBlocks(): void {
    if (this.state.selectedBlockIds.size === 0 || !this.timeline) return;

    const blocks: TimelineBlock[] = [];
    let minTime = Infinity;

    for (const blockId of this.state.selectedBlockIds) {
      const block = this.getBlockById(blockId);
      if (block) {
        blocks.push({ ...block });
        minTime = Math.min(minTime, block.start_ms);
      }
    }

    this.clipboard = {
      blocks,
      copyTime_ms: minTime,
    };

    this.emit({ type: "block:copy", blockIds: [...this.state.selectedBlockIds] });
  }

  pasteBlocks(): void {
    if (!this.clipboard || !this.timeline) return;

    const pasteTime = this.state.playhead_ms;
    const offset = pasteTime - this.clipboard.copyTime_ms;
    const newBlockIds: string[] = [];

    for (const block of this.clipboard.blocks) {
      const newBlock: TimelineBlock = {
        ...block,
        id: `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        start_ms: block.start_ms + offset,
      };

      this.timeline.blocks.push(newBlock);
      newBlockIds.push(newBlock.id);

      this.pushUndo({
        type: "paste",
        blockId: newBlock.id,
        before: {},
        after: { ...newBlock },
      });
    }

    this.clearSelection();
    for (const id of newBlockIds) {
      this.state.selectedBlockIds.add(id);
    }

    this.render();
    this.emit({ type: "block:paste", blockIds: newBlockIds, blocks: this.clipboard.blocks });
  }

  duplicateSelectedBlocks(): void {
    if (this.state.selectedBlockIds.size === 0 || !this.timeline) return;

    const newBlockIds: string[] = [];

    for (const blockId of this.state.selectedBlockIds) {
      const block = this.getBlockById(blockId);
      if (!block) continue;

      // Duplicate with offset
      const newBlock: TimelineBlock = {
        ...block,
        id: `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        start_ms: block.start_ms + block.duration_ms + 100,
        label: block.label ? `${block.label} (copy)` : undefined,
      };

      this.timeline.blocks.push(newBlock);
      newBlockIds.push(newBlock.id);

      this.pushUndo({
        type: "add",
        blockId: newBlock.id,
        before: {},
        after: { ...newBlock },
      });
    }

    this.clearSelection();
    for (const id of newBlockIds) {
      this.state.selectedBlockIds.add(id);
    }

    this.render();
    this.emit({ type: "block:duplicate", blockIds: newBlockIds });
  }

  // ─────────────────────────────────────────────────────────────
  // Undo/Redo
  // ─────────────────────────────────────────────────────────────

  private pushUndo(action: UndoAction): void {
    this.undoStack.push(action);
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    // Clear redo stack when new action is performed
    this.redoStack = [];
    this.updateUndoRedoButtons();
  }

  undo(): void {
    if (this.undoStack.length === 0 || !this.timeline) return;

    const action = this.undoStack.pop()!;
    this.redoStack.push(action);

    const block = this.getBlockById(action.blockId);

    switch (action.type) {
      case "move":
      case "resize":
        if (block && action.before.start_ms !== undefined) {
          block.start_ms = action.before.start_ms;
          block.duration_ms = action.before.duration_ms!;
        }
        break;

      case "delete":
        // Restore deleted block
        if (action.before) {
          this.timeline.blocks.push(action.before as TimelineBlock);
        }
        break;

      case "add":
      case "paste":
        // Remove added block
        const index = this.timeline.blocks.findIndex((b) => b.id === action.blockId);
        if (index >= 0) {
          this.timeline.blocks.splice(index, 1);
        }
        break;
    }

    this.render();
    this.updateUndoRedoButtons();
    this.emit({ type: "undo" });
  }

  redo(): void {
    if (this.redoStack.length === 0 || !this.timeline) return;

    const action = this.redoStack.pop()!;
    this.undoStack.push(action);

    const block = this.getBlockById(action.blockId);

    switch (action.type) {
      case "move":
      case "resize":
        if (block && action.after.start_ms !== undefined) {
          block.start_ms = action.after.start_ms;
          block.duration_ms = action.after.duration_ms!;
        }
        break;

      case "delete":
        // Remove block again
        const index = this.timeline.blocks.findIndex((b) => b.id === action.blockId);
        if (index >= 0) {
          this.timeline.blocks.splice(index, 1);
        }
        break;

      case "add":
      case "paste":
        // Re-add block
        if (action.after) {
          this.timeline.blocks.push(action.after as TimelineBlock);
        }
        break;
    }

    this.render();
    this.updateUndoRedoButtons();
    this.emit({ type: "redo" });
  }

  private updateUndoRedoButtons(): void {
    const undoBtn = this.root?.querySelector('[data-action="undo"]') as HTMLButtonElement;
    const redoBtn = this.root?.querySelector('[data-action="redo"]') as HTMLButtonElement;

    if (undoBtn) {
      undoBtn.disabled = this.undoStack.length === 0;
    }
    if (redoBtn) {
      redoBtn.disabled = this.redoStack.length === 0;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Property Panel
  // ─────────────────────────────────────────────────────────────

  showPropertyPanel(): void {
    if (this.state.selectedBlockIds.size !== 1) return;

    const panel = this.root?.querySelector(".timeline-property-panel") as HTMLElement;
    if (!panel) return;

    const blockId = [...this.state.selectedBlockIds][0];
    const block = this.getBlockById(blockId);
    if (!block) return;

    // Populate inputs
    const labelInput = panel.querySelector('[data-prop="label"]') as HTMLInputElement;
    const startInput = panel.querySelector('[data-prop="start_ms"]') as HTMLInputElement;
    const durationInput = panel.querySelector('[data-prop="duration_ms"]') as HTMLInputElement;
    const easeInSelect = panel.querySelector('[data-prop="easeIn"]') as HTMLSelectElement;
    const easeOutSelect = panel.querySelector('[data-prop="easeOut"]') as HTMLSelectElement;

    if (labelInput) labelInput.value = block.label || "";
    if (startInput) startInput.value = String(block.start_ms);
    if (durationInput) durationInput.value = String(block.duration_ms);
    if (easeInSelect) easeInSelect.value = block.easeIn || "";
    if (easeOutSelect) easeOutSelect.value = block.easeOut || "";

    panel.style.display = "block";
  }

  hidePropertyPanel(): void {
    const panel = this.root?.querySelector(".timeline-property-panel") as HTMLElement;
    if (panel) {
      panel.style.display = "none";
    }
  }

  updateBlockProperty(blockId: string, prop: string, value: string | number): void {
    const block = this.getBlockById(blockId);
    if (!block) return;

    // Record undo
    const before: Partial<TimelineBlock> = {};
    const after: Partial<TimelineBlock> = {};

    switch (prop) {
      case "label":
        before.label = block.label;
        after.label = value as string;
        block.label = value as string;
        break;
      case "start_ms":
        before.start_ms = block.start_ms;
        after.start_ms = value as number;
        block.start_ms = value as number;
        break;
      case "duration_ms":
        before.duration_ms = block.duration_ms;
        after.duration_ms = Math.max(100, value as number);
        block.duration_ms = Math.max(100, value as number);
        break;
      case "easeIn":
        before.easeIn = block.easeIn;
        after.easeIn = value as TimelineBlock["easeIn"];
        block.easeIn = value as TimelineBlock["easeIn"];
        break;
      case "easeOut":
        before.easeOut = block.easeOut;
        after.easeOut = value as TimelineBlock["easeOut"];
        block.easeOut = value as TimelineBlock["easeOut"];
        break;
    }

    this.pushUndo({
      type: "resize",
      blockId,
      before,
      after,
    });

    this.render();
  }

  // ─────────────────────────────────────────────────────────────
  // Save/Export/Import
  // ─────────────────────────────────────────────────────────────

  private emitSave(): void {
    if (!this.timeline) return;
    this.emit({ type: "save", timeline: this.timeline });
  }

  private emitExport(): void {
    if (!this.timeline) return;
    this.emit({ type: "export", timeline: this.timeline });
  }

  private triggerImport(): void {
    const input = this.root?.querySelector("#timeline-import-input") as HTMLInputElement;
    if (input) {
      input.click();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Event System
  // ─────────────────────────────────────────────────────────────

  on(type: TimelineEventType, handler: TimelineEventHandler): void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }
    this.eventHandlers.get(type)!.add(handler);
  }

  off(type: TimelineEventType, handler: TimelineEventHandler): void {
    this.eventHandlers.get(type)?.delete(handler);
  }

  private emit(event: TimelineEvent): void {
    this.eventHandlers.get(event.type)?.forEach((handler) => handler(event));
  }

  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────

  private msToPixels(ms: number): number {
    return ms * this.config.basePixelsPerMs * this.state.zoom;
  }

  private pixelsToMs(pixels: number): number {
    return pixels / (this.config.basePixelsPerMs * this.state.zoom);
  }

  private formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const millis = ms % 1000;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
  }

  // ─────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.eventHandlers.clear();

    if (this.root) {
      this.root.remove();
    }
  }
}

// ============================================
// Factory Function
// ============================================

export function createTimelineEditor(
  container: HTMLElement,
  config?: Partial<TimelineEditorConfig>
): TimelineEditor {
  return new TimelineEditor(container, config);
}
