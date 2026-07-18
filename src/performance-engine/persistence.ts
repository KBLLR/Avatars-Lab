import { parsePerformanceProject } from "./project";
import type { PerformanceCatalog, PerformanceProject } from "./types";

const HOUSE_ID = "avatar-labs";
const SOURCE_ID = "performance-engine";

interface WarehouseItem {
  id: string;
  display_name?: string | null;
  filename?: string | null;
  path?: string | null;
  modified_at?: string | null;
  capabilities?: Record<string, unknown> | null;
}

export interface WarehouseProjectSummary {
  id: string;
  title: string;
  modifiedAt: string | null;
}

const readJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Warehouse error (${response.status}): ${detail.slice(0, 240)}`);
  }
  return response.json();
};

const safeFilename = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "performance.json";

const serializableProject = (project: PerformanceProject): PerformanceProject => ({
  ...project,
  audio: project.audio ? { ...project.audio, objectUrl: undefined } : undefined,
  updatedAt: new Date().toISOString(),
});

export class PerformanceWarehouseStore {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async list(): Promise<WarehouseProjectSummary[]> {
    const query = new URL(`${this.baseUrl}/query`);
    query.searchParams.set("house", HOUSE_ID);
    query.searchParams.set("kind", "performance-project");
    query.searchParams.set("source", SOURCE_ID);
    query.searchParams.set("sort", "recent");
    query.searchParams.set("limit", "50");
    const payload = await readJson(await fetch(query));
    const items = Array.isArray((payload as { items?: unknown[] })?.items)
      ? (payload as { items: WarehouseItem[] }).items
      : [];
    return items.map((item) => ({
      id: item.id,
      title: item.display_name || item.filename || item.path || item.id,
      modifiedAt: item.modified_at || null,
    }));
  }

  async load(id: string, catalog: PerformanceCatalog): Promise<PerformanceProject> {
    const payload = await readJson(await fetch(`${this.baseUrl}/item/${encodeURIComponent(id)}`));
    const item = payload as WarehouseItem;
    const project = item.capabilities?.performance_engine_project;
    if (!project) throw new Error("Warehouse item has no Performance Engine project payload.");
    return parsePerformanceProject(project, catalog);
  }

  async save(project: PerformanceProject, audioFile?: File | null): Promise<string> {
    const nextProject = serializableProject(project);
    if (audioFile && nextProject.audio) {
      nextProject.audio.warehouseId = await this.publishAudio(project, audioFile);
      project.audio!.warehouseId = nextProject.audio.warehouseId;
    }
    const filename = safeFilename(`${project.id}.json`);
    const response = await fetch(`${this.baseUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `avatar-performance-project-${project.id}`,
        kind: "performance-project",
        source: SOURCE_ID,
        house: HOUSE_ID,
        path: `houses/${HOUSE_ID}/performance-engine/${project.id}/${filename}`,
        filename,
        display_name: project.title,
        tags: ["avatar-labs", "performance-engine", "timeline", "threejs"],
        tier: "T0-local",
        actor: SOURCE_ID,
        surface: "avatar-labs",
        enrich: false,
        capabilities: { performance_engine_project: nextProject },
      }),
    });
    const payload = await readJson(response) as { id?: string };
    if (!payload.id) throw new Error("Warehouse did not return a project item ID.");
    return payload.id;
  }

  async loadAudio(id: string, name: string): Promise<File> {
    const response = await fetch(`${this.baseUrl}/stream/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Warehouse audio failed (${response.status}).`);
    const blob = await response.blob();
    return new File([blob], name, { type: blob.type || "audio/mpeg" });
  }

  private async publishAudio(project: PerformanceProject, file: File): Promise<string> {
    const filename = safeFilename(file.name);
    const form = new FormData();
    form.append("file", file, filename);
    form.append("metadata", JSON.stringify({
      id: `avatar-performance-audio-${project.id}`,
      kind: "audio",
      source: SOURCE_ID,
      house: HOUSE_ID,
      path: `houses/${HOUSE_ID}/performance-engine/${project.id}/audio/${filename}`,
      filename,
      display_name: `${project.title} score`,
      tags: ["avatar-labs", "performance-engine", "source-audio"],
      storage_tier: "T0-local",
      actor: SOURCE_ID,
      surface: "avatar-labs",
      enrich: false,
      capabilities: { performance_engine_audio: true },
    }));
    const payload = await readJson(await fetch(`${this.baseUrl}/publish`, {
      method: "POST",
      body: form,
    })) as { id?: string };
    if (!payload.id) throw new Error("Warehouse did not return an audio item ID.");
    return payload.id;
  }
}
