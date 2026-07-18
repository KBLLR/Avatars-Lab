import type { PerformanceListItem, PerformanceRecord } from "./types";

export interface PerformanceStoreConfig {
  baseUrl?: string;
}

export interface PerformanceStore {
  list: () => Promise<PerformanceListItem[]>;
  load: (id: string) => Promise<PerformanceRecord>;
  loadAudio: (id: string, name: string, type: string) => Promise<File>;
  save: (
    record: PerformanceRecord,
    options?: { fileName?: string; audioFile?: File | null }
  ) => Promise<unknown>;
}

interface WarehouseItem {
  id: string;
  path: string;
  filename?: string | null;
  display_name?: string | null;
  modified_at?: string | null;
  capabilities?: Record<string, unknown> | null;
}

const HOUSE_ID = "avatar-labs";
const SOURCE_ID = "stage-director";

const normalizeBaseUrl = (baseUrl?: string): string | null => {
  if (!baseUrl) return null;
  return baseUrl.replace(/\/$/, "");
};

const ensureBaseUrl = (baseUrl?: string | null): string => {
  if (!baseUrl) throw new Error("Warehouse is not configured.");
  return baseUrl;
};

const readJson = async (response: Response) => {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Warehouse error (${response.status}): ${detail}`);
  }
  return response.json();
};

const safeFilename = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset.bin";

const publishAudio = async (
  baseUrl: string,
  record: PerformanceRecord,
  audioFile: File
): Promise<string> => {
  const filename = safeFilename(audioFile.name);
  const form = new FormData();
  form.append("file", audioFile, filename);
  form.append("metadata", JSON.stringify({
    id: `avatar-performance-audio-${record.id}`,
    kind: "audio",
    source: SOURCE_ID,
    house: HOUSE_ID,
    path: `houses/${HOUSE_ID}/performances/audio/${record.id}/${filename}`,
    filename,
    display_name: `${record.title} source audio`,
    tags: ["avatar-labs", "stage-director", "performance-source"],
    storage_tier: "T0-local",
    actor: "stage-director",
    surface: "avatar-labs",
    enrich: false,
    capabilities: { stage_director_source_audio: true }
  }));

  const response = await fetch(`${baseUrl}/publish`, { method: "POST", body: form });
  const payload = await readJson(response);
  if (typeof payload?.id !== "string") throw new Error("Warehouse did not return an audio item ID.");
  return payload.id;
};

export const decodeBase64ToFile = (dataBase64: string, name: string, type: string): File => {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
};

export const createPerformanceStore = (config: PerformanceStoreConfig): PerformanceStore => {
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  return {
    list: async () => {
      const url = ensureBaseUrl(baseUrl);
      const query = new URL(`${url}/query`);
      query.searchParams.set("house", HOUSE_ID);
      query.searchParams.set("kind", "performance");
      query.searchParams.set("source", SOURCE_ID);
      query.searchParams.set("sort", "recent");
      query.searchParams.set("limit", "100");
      const payload = await readJson(await fetch(query));
      const items: WarehouseItem[] = Array.isArray(payload?.items) ? payload.items : [];
      return items.map((item) => ({
        id: item.id,
        path: item.id,
        name: item.display_name || item.filename || item.path,
        modified: item.modified_at ? Date.parse(item.modified_at) : null
      }));
    },
    load: async (id: string) => {
      const url = ensureBaseUrl(baseUrl);
      const item: WarehouseItem = await readJson(
        await fetch(`${url}/item/${encodeURIComponent(id)}`)
      );
      const record = item.capabilities?.stage_director_record;
      if (!record || typeof record !== "object") {
        throw new Error("Warehouse item does not contain a Stage Director record.");
      }
      return record as PerformanceRecord;
    },
    loadAudio: async (id: string, name: string, type: string) => {
      const url = ensureBaseUrl(baseUrl);
      const response = await fetch(`${url}/stream/${encodeURIComponent(id)}`);
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Warehouse audio error (${response.status}): ${detail}`);
      }
      const blob = await response.blob();
      return new File([blob], name, { type: type || blob.type || "audio/mpeg" });
    },
    save: async (record, options = {}) => {
      const url = ensureBaseUrl(baseUrl);
      let audio = record.audio ? { ...record.audio, dataBase64: undefined } : null;
      if (options.audioFile && audio) {
        audio.warehouseId = await publishAudio(url, record, options.audioFile);
      }
      const nextRecord: PerformanceRecord = { ...record, audio };
      const date = record.createdAt.slice(0, 10);
      const fileName = safeFilename(options.fileName || `${record.id}.json`);
      const response = await fetch(`${url}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `avatar-performance-${record.id}`,
          kind: "performance",
          source: SOURCE_ID,
          house: HOUSE_ID,
          path: `houses/${HOUSE_ID}/performances/${date}/${fileName}`,
          filename: fileName,
          display_name: record.title,
          tags: ["avatar-labs", "stage-director", "performance-plan"],
          tier: "T0-local",
          actor: "stage-director",
          surface: "avatar-labs",
          enrich: false,
          capabilities: { stage_director_record: nextRecord }
        })
      });
      return readJson(response);
    }
  };
};
