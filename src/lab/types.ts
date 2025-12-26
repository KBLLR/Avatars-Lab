/**
 * Lab Types
 * Shared type definitions for the modular lab system
 */

import type { EventBus } from "./event-bus";

// ─────────────────────────────────────────────────────────────────────────────
// Card System
// ─────────────────────────────────────────────────────────────────────────────

export interface CardState {
  id: string;
  collapsed: boolean;
  [key: string]: unknown;
}

export interface LabCard<S extends CardState = CardState> {
  id: string;
  title: string;
  icon?: string;
  collapsed: boolean;

  // Lifecycle
  init(bus: EventBus): void;
  destroy(): void;

  // State
  getState(): S;
  setState(state: Partial<S>): void;

  // Render
  render(): HTMLElement;
  update?(): void;
}

export interface CardConfig {
  id: string;
  title: string;
  icon?: string;
  collapsed?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar System
// ─────────────────────────────────────────────────────────────────────────────

export type AvatarPosition = "left" | "right" | "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface AvatarConfig {
  id: string;
  model: string;
  name?: string;
  position?: AvatarPosition;
  systemPrompt?: string;
  voice?: string;
}

export interface AvatarInstance {
  id: string;
  config: AvatarConfig;
  head: unknown; // TalkingHead instance
  speaking: boolean;
  mood: string;
  ready: boolean;
}

export interface AvatarRoute {
  from: string;        // Avatar ID or 'user'
  to: string[];        // Target avatar IDs
  mode: "broadcast" | "direct" | "round-robin";
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage System
// ─────────────────────────────────────────────────────────────────────────────

export type StageLayout = "single" | "split" | "grid" | "focus";

export interface StageConfig {
  layout: StageLayout;
  background?: string;
  lighting?: string;
}

export interface StageState {
  layout: StageLayout;
  focusedAvatarId?: string;
  avatars: Map<string, AvatarInstance>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat System
// ─────────────────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  avatarId?: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  messageId: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "success" | "error";
  result?: unknown;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool System
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface LabTool {
  name: string;
  description: string;
  parameters: ToolSchema;

  // Execution
  execute(args: Record<string, unknown>): Promise<ToolResult>;

  // UI (optional)
  renderCall?(args: Record<string, unknown>): HTMLElement;
  renderResult?(result: ToolResult): HTMLElement;
}

export interface ToolRegistry {
  tools: Map<string, LabTool>;
  register(tool: LabTool): void;
  unregister(name: string): void;
  get(name: string): LabTool | undefined;
  list(): LabTool[];
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice System
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceMode = "push" | "vad";

export interface VoiceConfig {
  mode: VoiceMode;
  vadThreshold?: number;
  sttModel?: string;
  ttsModel?: string;
}

export interface VoiceState {
  active: boolean;
  mode: VoiceMode;
  level: number;
  transcript: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session System
// ─────────────────────────────────────────────────────────────────────────────

export type SessionStatus = "idle" | "active" | "paused" | "error";

export interface SessionConfig {
  avatars: AvatarConfig[];
  routing?: AvatarRoute[];
  tools?: string[];
  voice?: VoiceConfig;
  stage?: StageConfig;
}

export interface SessionState {
  status: SessionStatus;
  config: SessionConfig;
  messages: ChatMessage[];
  startTime?: number;
  error?: Error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lab Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface LabConfig {
  container: string | HTMLElement;
  session?: SessionConfig;
  cards?: Array<new () => LabCard>;
  modules?: {
    stage?: boolean;
    chat?: boolean;
    tools?: boolean;
    controls?: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module System
// ─────────────────────────────────────────────────────────────────────────────

export interface LabModule {
  id: string;
  name: string;

  // Lifecycle
  init(bus: EventBus, container: HTMLElement): void;
  destroy(): void;

  // State
  getState(): Record<string, unknown>;
}
