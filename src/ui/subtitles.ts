/**
 * Subtitles Module
 *
 * A configurable subtitle/lyrics display system with:
 * - Multiple style presets (karaoke, cinema, minimal, neon, typewriter)
 * - Customizable fonts, sizes, colors
 * - Animation effects (fade, slide, bounce, glow)
 * - Position options (bottom, top, center)
 * - Word-level timing synchronization
 */

import type { WordTiming } from "../directors/types";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type SubtitlePosition = "bottom" | "top" | "center";
export type SubtitleAnimation = "none" | "fade" | "slide" | "bounce" | "typewriter" | "glow";
export type SubtitlePreset = "default" | "karaoke" | "cinema" | "minimal" | "neon" | "retro";

export interface SubtitleStyle {
  // Typography
  fontFamily: string;
  fontSize: number;           // in px
  fontWeight: number;
  letterSpacing: number;      // in px
  textTransform: "none" | "uppercase" | "lowercase" | "capitalize";

  // Colors
  textColor: string;
  activeColor: string;        // Color of current word
  shadowColor: string;
  backgroundColor: string;    // Background behind text

  // Layout
  position: SubtitlePosition;
  padding: number;            // in px
  maxWidth: number;           // in percentage of container
  lineHeight: number;

  // Effects
  animation: SubtitleAnimation;
  animationDuration: number;  // in ms
  textShadow: string;
  blur: number;               // Inactive word blur

  // Word display
  windowSize: number;         // Number of words visible
  wordSpacing: number;        // in px
  showPunctuation: boolean;
}

export interface SubtitleConfig {
  style: Partial<SubtitleStyle>;
  preset?: SubtitlePreset;
  enabled: boolean;
}

export interface SubtitleState {
  isActive: boolean;
  currentIndex: number;
  startTime: number | null;
  wordTimings: WordTiming | null;
  audioDuration: number;
}

// ─────────────────────────────────────────────────────────────
// Style Presets
// ─────────────────────────────────────────────────────────────

const DEFAULT_STYLE: SubtitleStyle = {
  fontFamily: "'Inter', 'SF Pro Display', -apple-system, sans-serif",
  fontSize: 32,
  fontWeight: 600,
  letterSpacing: 0,
  textTransform: "none",
  textColor: "rgba(255, 255, 255, 0.6)",
  activeColor: "#ffffff",
  shadowColor: "rgba(0, 0, 0, 0.8)",
  backgroundColor: "transparent",
  position: "bottom",
  padding: 24,
  maxWidth: 80,
  lineHeight: 1.4,
  animation: "fade",
  animationDuration: 200,
  textShadow: "0 2px 8px rgba(0, 0, 0, 0.5)",
  blur: 0,
  windowSize: 8,
  wordSpacing: 8,
  showPunctuation: true,
};

const STYLE_PRESETS: Record<SubtitlePreset, Partial<SubtitleStyle>> = {
  default: {},

  karaoke: {
    fontSize: 42,
    fontWeight: 700,
    textColor: "rgba(255, 255, 255, 0.4)",
    activeColor: "#f97316",
    animation: "glow",
    animationDuration: 150,
    textShadow: "0 0 20px rgba(249, 115, 22, 0.5), 0 2px 10px rgba(0, 0, 0, 0.8)",
    windowSize: 6,
    letterSpacing: 1,
  },

  cinema: {
    fontFamily: "'Georgia', 'Times New Roman', serif",
    fontSize: 28,
    fontWeight: 400,
    textColor: "#ffffff",
    activeColor: "#fbbf24",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    padding: 16,
    animation: "fade",
    animationDuration: 300,
    textShadow: "none",
    windowSize: 12,
    letterSpacing: 0.5,
  },

  minimal: {
    fontSize: 24,
    fontWeight: 400,
    textColor: "rgba(255, 255, 255, 0.5)",
    activeColor: "rgba(255, 255, 255, 0.9)",
    animation: "none",
    textShadow: "0 1px 3px rgba(0, 0, 0, 0.3)",
    windowSize: 5,
    padding: 16,
  },

  neon: {
    fontFamily: "'Orbitron', 'Rajdhani', monospace",
    fontSize: 36,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 3,
    textColor: "rgba(0, 255, 255, 0.4)",
    activeColor: "#00ffff",
    animation: "glow",
    animationDuration: 100,
    textShadow: "0 0 10px #00ffff, 0 0 20px #00ffff, 0 0 40px #0088ff",
    windowSize: 5,
  },

  retro: {
    fontFamily: "'VT323', 'Courier New', monospace",
    fontSize: 28,
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: 2,
    textColor: "#22c55e",
    activeColor: "#4ade80",
    animation: "typewriter",
    animationDuration: 50,
    textShadow: "0 0 5px #22c55e",
    windowSize: 10,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    padding: 20,
  },
};

// ─────────────────────────────────────────────────────────────
// Subtitle Renderer Class
// ─────────────────────────────────────────────────────────────

export class SubtitleRenderer {
  private container: HTMLElement;
  private element: HTMLElement;
  private style: SubtitleStyle;
  private state: SubtitleState;
  private rafId: number | null = null;
  private getCurrentTime: () => number;

  constructor(
    container: HTMLElement,
    config: SubtitleConfig = { style: {}, enabled: true },
    getCurrentTime: () => number = () => 0
  ) {
    this.container = container;
    this.getCurrentTime = getCurrentTime;

    // Merge preset with custom style
    const preset = config.preset || "default";
    this.style = {
      ...DEFAULT_STYLE,
      ...STYLE_PRESETS[preset],
      ...config.style,
    };

    this.state = {
      isActive: false,
      currentIndex: 0,
      startTime: null,
      wordTimings: null,
      audioDuration: 0,
    };

    // Create subtitle element
    this.element = document.createElement("div");
    this.element.className = "subtitle-container";
    this.applyStyles();
    this.container.appendChild(this.element);
  }

  private applyStyles(): void {
    const s = this.style;

    // Position styles
    const positionStyles: Record<SubtitlePosition, string> = {
      bottom: `bottom: ${s.padding}px; left: 50%; transform: translateX(-50%);`,
      top: `top: ${s.padding}px; left: 50%; transform: translateX(-50%);`,
      center: `top: 50%; left: 50%; transform: translate(-50%, -50%);`,
    };

    this.element.setAttribute("style", `
      position: absolute;
      ${positionStyles[s.position]}
      max-width: ${s.maxWidth}%;
      font-family: ${s.fontFamily};
      font-size: ${s.fontSize}px;
      font-weight: ${s.fontWeight};
      letter-spacing: ${s.letterSpacing}px;
      text-transform: ${s.textTransform};
      line-height: ${s.lineHeight};
      text-align: center;
      color: ${s.textColor};
      text-shadow: ${s.textShadow};
      background: ${s.backgroundColor};
      padding: ${s.backgroundColor !== "transparent" ? s.padding + "px" : "0"};
      border-radius: 8px;
      z-index: 100;
      pointer-events: none;
      transition: opacity ${s.animationDuration}ms ease;
    `);

    // Inject keyframe animations
    this.injectAnimationStyles();
  }

  private injectAnimationStyles(): void {
    const styleId = "subtitle-animations";
    if (document.getElementById(styleId)) return;

    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
      .subtitle-word {
        display: inline-block;
        transition: all 0.15s ease;
      }

      .subtitle-word.active {
        transform: scale(1.05);
      }

      .subtitle-word.fade-in {
        animation: subtitleFadeIn 0.2s ease forwards;
      }

      .subtitle-word.slide-in {
        animation: subtitleSlideIn 0.3s ease forwards;
      }

      .subtitle-word.bounce {
        animation: subtitleBounce 0.3s ease;
      }

      .subtitle-word.glow {
        animation: subtitleGlow 0.15s ease forwards;
      }

      .subtitle-word.typewriter {
        opacity: 0;
        animation: subtitleTypewriter 0.05s steps(1) forwards;
      }

      @keyframes subtitleFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes subtitleSlideIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes subtitleBounce {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
      }

      @keyframes subtitleGlow {
        from { filter: brightness(1); }
        to { filter: brightness(1.3); }
      }

      @keyframes subtitleTypewriter {
        to { opacity: 1; }
      }
    `;
    document.head.appendChild(styleEl);
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  start(wordTimings: WordTiming, audioDuration: number): void {
    this.state = {
      isActive: true,
      currentIndex: 0,
      startTime: this.getCurrentTime(),
      wordTimings,
      audioDuration,
    };

    this.element.style.opacity = "1";
    this.scheduleUpdate();
  }

  stop(): void {
    this.state.isActive = false;
    this.state.startTime = null;
    this.element.style.opacity = "0";

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    setTimeout(() => {
      this.element.innerHTML = "";
    }, this.style.animationDuration);
  }

  pause(): void {
    this.state.isActive = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume(): void {
    if (this.state.wordTimings && this.state.startTime !== null) {
      this.state.isActive = true;
      this.scheduleUpdate();
    }
  }

  setStyle(style: Partial<SubtitleStyle>): void {
    this.style = { ...this.style, ...style };
    this.applyStyles();
  }

  setPreset(preset: SubtitlePreset): void {
    this.style = {
      ...DEFAULT_STYLE,
      ...STYLE_PRESETS[preset],
    };
    this.applyStyles();
  }

  seek(timeMs: number): void {
    if (!this.state.wordTimings) return;

    const { wtimes } = this.state.wordTimings;
    let newIndex = 0;

    for (let i = 0; i < wtimes.length; i++) {
      if (wtimes[i] <= timeMs) {
        newIndex = i;
      } else {
        break;
      }
    }

    this.state.currentIndex = newIndex;
    this.render();
  }

  destroy(): void {
    this.stop();
    this.element.remove();
  }

  // ─────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────

  private scheduleUpdate(): void {
    if (!this.state.isActive) return;
    this.rafId = requestAnimationFrame(() => this.update());
  }

  private update(): void {
    if (!this.state.isActive || !this.state.wordTimings || this.state.startTime === null) {
      return;
    }

    const nowMs = (this.getCurrentTime() - this.state.startTime) * 1000;
    const { wtimes, wdurations } = this.state.wordTimings;

    // Find current word index
    let newIndex = this.state.currentIndex;
    while (
      newIndex < wtimes.length - 1 &&
      nowMs > wtimes[newIndex] + wdurations[newIndex]
    ) {
      newIndex++;
    }

    // Check if index changed
    const indexChanged = newIndex !== this.state.currentIndex;
    this.state.currentIndex = newIndex;

    // Render if changed
    if (indexChanged) {
      this.render();
    }

    // Check if finished
    if (nowMs > this.state.audioDuration * 1000 + 500) {
      this.stop();
      return;
    }

    this.scheduleUpdate();
  }

  private render(): void {
    const { wordTimings, currentIndex } = this.state;
    if (!wordTimings) return;

    const { words } = wordTimings;
    const s = this.style;

    // Calculate window
    const halfWindow = Math.floor(s.windowSize / 2);
    const start = Math.max(0, currentIndex - halfWindow);
    const end = Math.min(words.length, start + s.windowSize);

    // Build HTML
    const html = words.slice(start, end).map((word, idx) => {
      const absoluteIndex = start + idx;
      const isActive = absoluteIndex === currentIndex;
      const isPast = absoluteIndex < currentIndex;

      // Clean word if needed
      const displayWord = s.showPunctuation ? word : word.replace(/[^\w\s]/g, "");

      // Determine classes
      const classes = ["subtitle-word"];
      if (isActive) {
        classes.push("active");
        if (s.animation !== "none") {
          classes.push(s.animation === "glow" ? "glow" : s.animation + "-in");
        }
      }

      // Determine color
      const color = isActive
        ? s.activeColor
        : isPast
          ? s.textColor
          : s.textColor;

      // Determine opacity for non-active words
      const opacity = isActive ? 1 : isPast ? 0.4 : 0.7;

      return `<span
        class="${classes.join(" ")}"
        style="
          color: ${isActive ? s.activeColor : s.textColor};
          opacity: ${opacity};
          margin: 0 ${s.wordSpacing / 2}px;
          ${isActive && s.animation === "glow" ? `text-shadow: ${s.textShadow};` : ""}
        "
      >${displayWord}</span>`;
    }).join("");

    this.element.innerHTML = html;
  }
}

// ─────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────

export const createSubtitleRenderer = (
  container: HTMLElement,
  config?: SubtitleConfig,
  getCurrentTime?: () => number
): SubtitleRenderer => {
  return new SubtitleRenderer(container, config, getCurrentTime);
};

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

export { STYLE_PRESETS, DEFAULT_STYLE };
