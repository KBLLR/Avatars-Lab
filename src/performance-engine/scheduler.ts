import { compilePerformanceProject } from "./schedule";
import type { CompiledSchedule, PerformanceProject } from "./types";

interface PendingRequest {
  resolve: (schedule: CompiledSchedule) => void;
  reject: (error: Error) => void;
  project: PerformanceProject;
}

export class PerformanceScheduler {
  private worker: Worker | null = null;
  private activeMode: "worker" | "main-thread" = "main-thread";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  get mode(): "worker" | "main-thread" {
    return this.activeMode;
  }

  constructor() {
    try {
      this.worker = new Worker(new URL("./schedule.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event) => {
        const payload = event.data as {
          id: number;
          ok: boolean;
          schedule?: CompiledSchedule;
          error?: string;
        };
        const request = this.pending.get(payload.id);
        if (!request) return;
        this.pending.delete(payload.id);
        if (payload.ok && payload.schedule) request.resolve(payload.schedule);
        else request.reject(new Error(payload.error || "Schedule worker failed."));
      };
      this.worker.onerror = (event) => {
        const error = new Error(event.message || "Schedule worker crashed.");
        for (const request of this.pending.values()) {
          try {
            request.resolve(compilePerformanceProject(request.project));
          } catch {
            request.reject(error);
          }
        }
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
        this.activeMode = "main-thread";
      };
      this.activeMode = "worker";
    } catch {
      this.activeMode = "main-thread";
    }
  }

  compile(project: PerformanceProject): Promise<CompiledSchedule> {
    if (!this.worker) return Promise.resolve(compilePerformanceProject(project));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, project });
      try {
        this.worker!.postMessage({ id, project });
      } catch {
        this.pending.delete(id);
        this.worker?.terminate();
        this.worker = null;
        this.activeMode = "main-thread";
        resolve(compilePerformanceProject(project));
      }
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
