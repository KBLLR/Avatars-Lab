/**
 * Lab Event Bus
 * Central communication layer for all lab modules
 */

export type EventHandler<T = unknown> = (data: T) => void;

export interface EventBus {
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;
  off(event: string, handler: EventHandler): void;
  emit<T = unknown>(event: string, data?: T): void;
  once<T = unknown>(event: string, handler: EventHandler<T>): () => void;
  clear(): void;
}

export const createEventBus = (): EventBus => {
  const handlers = new Map<string, Set<EventHandler>>();

  const on = <T = unknown>(event: string, handler: EventHandler<T>): (() => void) => {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => off(event, handler as EventHandler);
  };

  const off = (event: string, handler: EventHandler): void => {
    handlers.get(event)?.delete(handler);
  };

  const emit = <T = unknown>(event: string, data?: T): void => {
    const eventHandlers = handlers.get(event);
    if (eventHandlers) {
      eventHandlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[EventBus] Error in handler for "${event}":`, error);
        }
      });
    }

    // Also emit to wildcard listeners
    const wildcardHandlers = handlers.get("*");
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => {
        try {
          handler({ event, data });
        } catch (error) {
          console.error(`[EventBus] Error in wildcard handler:`, error);
        }
      });
    }
  };

  const once = <T = unknown>(event: string, handler: EventHandler<T>): (() => void) => {
    const wrappedHandler: EventHandler<T> = (data) => {
      off(event, wrappedHandler as EventHandler);
      handler(data);
    };
    return on(event, wrappedHandler);
  };

  const clear = (): void => {
    handlers.clear();
  };

  return { on, off, emit, once, clear };
};

// Event type definitions for type safety
export interface LabEvents {
  // Avatar events
  "avatar:add": { id: string; model: string; position?: string };
  "avatar:remove": { id: string };
  "avatar:speak": { id: string; text: string; audio?: ArrayBuffer };
  "avatar:speaking": { id: string; active: boolean };
  "avatar:gesture": { id: string; gesture: string; duration?: number };
  "avatar:mood": { id: string; mood: string };
  "avatar:ready": { id: string };
  "avatar:error": { id: string; error: Error };

  // Chat events
  "chat:message": {
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    avatarId?: string;
    timestamp: number;
  };
  "chat:tool_call": {
    id: string;
    messageId: string;
    name: string;
    args: Record<string, unknown>;
    status: "pending" | "running" | "success" | "error";
  };
  "chat:tool_result": {
    id: string;
    callId: string;
    result: unknown;
    error?: string;
  };
  "chat:typing": { avatarId: string; active: boolean };
  "chat:clear": {};

  // Stage events
  "stage:layout": { mode: "single" | "split" | "grid" | "focus" };
  "stage:focus": { avatarId: string };
  "stage:light": { preset: string; avatarId?: string };
  "stage:camera": { view: string; avatarId?: string };
  "stage:resize": { width: number; height: number };

  // Session events
  "session:start": { config?: Record<string, unknown> };
  "session:end": {};
  "session:pause": {};
  "session:resume": {};
  "session:error": { error: Error };
  "session:status": { status: string };

  // Voice events
  "voice:start": {};
  "voice:stop": {};
  "voice:level": { level: number };
  "voice:transcript": { text: string; final: boolean };
  "voice:mode": { mode: "push" | "vad" };

  // Tool events
  "tool:register": {
    name: string;
    description: string;
    schema: Record<string, unknown>;
  };
  "tool:unregister": { name: string };
  "tool:execute": { name: string; args: Record<string, unknown>; callId: string };
  "tool:result": { callId: string; result: unknown; error?: string };
  "tool:list": { tools: string[] };

  // Model events
  "model:load": { type: "llm" | "stt" | "tts"; model: string };
  "model:unload": { type: "llm" | "stt" | "tts" };
  "model:ready": { type: "llm" | "stt" | "tts"; model: string };
  "model:error": { type: "llm" | "stt" | "tts"; error: Error };

  // Card events
  "card:toggle": { id: string; collapsed: boolean };
  "card:focus": { id: string };
  "card:state": { id: string; state: Record<string, unknown> };
}

// Type-safe event bus wrapper
export interface TypedEventBus extends EventBus {
  on<K extends keyof LabEvents>(event: K, handler: EventHandler<LabEvents[K]>): () => void;
  emit<K extends keyof LabEvents>(event: K, data: LabEvents[K]): void;
  once<K extends keyof LabEvents>(event: K, handler: EventHandler<LabEvents[K]>): () => void;
}

export const createTypedEventBus = (): TypedEventBus => {
  return createEventBus() as TypedEventBus;
};
