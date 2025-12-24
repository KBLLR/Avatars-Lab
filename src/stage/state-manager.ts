import type { TalkingHead } from "@met4citizen/talkinghead";
import type { StageState } from "./types";
import { createInitialState } from "./types";

export type StateListener = (state: StageState, changed: Partial<StageState>) => void;

export class StateManager {
  private state: StageState;
  private listeners: Set<StateListener> = new Set();

  constructor(initialState?: Partial<StageState>) {
    this.state = { ...createInitialState(), ...initialState };
  }

  getState(): Readonly<StageState> {
    return this.state;
  }

  update(partial: Partial<StageState>): void {
    const prev = this.state;
    this.state = { ...this.state, ...partial };
    this.notifyListeners(partial);
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(changed: Partial<StageState>): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, changed);
      } catch (e) {
        console.error("State listener error:", e);
      }
    }
  }

  getHead(): TalkingHead | null {
    return this.state.head;
  }

  requireHead(): TalkingHead {
    if (!this.state.head) {
      throw new Error("TalkingHead not initialized");
    }
    return this.state.head;
  }

  isPerforming(): boolean {
    return this.state.performing;
  }

  isAnalyzing(): boolean {
    return this.state.isAnalyzing;
  }

  hasAudioBuffer(): boolean {
    return this.state.audioBuffer !== null;
  }

  hasPlan(): boolean {
    return this.state.plan !== null;
  }

  isPlanApproved(): boolean {
    return this.state.planApproved;
  }
}

export const createStateManager = (initialState?: Partial<StageState>): StateManager => {
  return new StateManager(initialState);
};
