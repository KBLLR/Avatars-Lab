/// <reference lib="webworker" />

import { compilePerformanceProject } from "./schedule";
import type { PerformanceProject } from "./types";

self.onmessage = (event: MessageEvent<{ id: number; project: PerformanceProject }>) => {
  const { id, project } = event.data;
  try {
    self.postMessage({ id, ok: true, schedule: compilePerformanceProject(project) });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
