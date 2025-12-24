import type { PerformanceListItem, PerformanceRecord } from "./types";

export interface DataPoolTreeEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number | null;
  modified?: number | null;
}

export interface PerformanceStoreConfig {
  baseUrl?: string;
  rootDir?: string;
}

export interface PerformanceStore {
  list: () => Promise<PerformanceListItem[]>;
  load: (path: string) => Promise<PerformanceRecord>;
  save: (record: PerformanceRecord, options?: { targetDir?: string; fileName?: string }) => Promise<unknown>;
}

const DEFAULT_ROOT = "processed/performances";
const DEFAULT_TARGET = "processed/performances/{date}";

const normalizeBaseUrl = (baseUrl?: string): string | null => {
  if (!baseUrl) return null;
  return baseUrl.replace(/\/$/, "");
};

const ensureBaseUrl = (baseUrl?: string): string => {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("Missing data lake base URL.");
  }
  return normalized;
};

const readJson = async (response: Response) => {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Data lake error (${response.status}): ${detail}`);
  }
  return response.json();
};

const fetchTree = async (baseUrl: string, path: string): Promise<DataPoolTreeEntry[]> => {
  const response = await fetch(`${baseUrl}/api/lake/tree?path=${encodeURIComponent(path)}`);
  const data = await readJson(response);
  if (!Array.isArray(data)) return [];
  if (data.length && typeof data[0] === "object" && data[0]?.error) {
    return [];
  }
  return data as DataPoolTreeEntry[];
};

const queryJsonFile = async (baseUrl: string, path: string): Promise<PerformanceRecord> => {
  const safePath = path.replace(/'/g, "''");
  const sql = `SELECT * FROM read_json_auto('${safePath}') LIMIT 1`;
  const response = await fetch(`${baseUrl}/api/lake/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, limit: 1 })
  });
  const data = await readJson(response);
  const row = Array.isArray(data?.data) ? data.data[0] : null;
  if (!row) {
    throw new Error("No performance data found.");
  }
  return row as PerformanceRecord;
};

export const encodeFileToBase64 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
};

export const decodeBase64ToFile = (dataBase64: string, name: string, type: string): File => {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], name, { type });
};

export const createPerformanceStore = (config: PerformanceStoreConfig): PerformanceStore => {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const rootDir = config.rootDir || DEFAULT_ROOT;

  return {
    list: async () => {
      const url = ensureBaseUrl(baseUrl);
      const rootEntries = await fetchTree(url, rootDir);
      const results: PerformanceListItem[] = [];

      for (const entry of rootEntries) {
        if (entry.type === "file") {
          results.push({ path: entry.path, name: entry.name, modified: entry.modified ?? null });
        } else if (entry.type === "dir") {
          const nested = await fetchTree(url, entry.path);
          nested.forEach((item) => {
            if (item.type === "file") {
              results.push({ path: item.path, name: item.name, modified: item.modified ?? null });
            }
          });
        }
      }

      return results
        .filter((item) => item.name.endsWith(".json"))
        .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
    },
    load: async (path: string) => {
      const url = ensureBaseUrl(baseUrl);
      return queryJsonFile(url, path);
    },
    save: async (record: PerformanceRecord, options = {}) => {
      const url = ensureBaseUrl(baseUrl);
      const targetDir = options.targetDir || DEFAULT_TARGET;
      const fileName = options.fileName || `${record.id}.json`;
      const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
      const file = new File([blob], fileName, { type: "application/json" });

      const form = new FormData();
      form.append("file", file);
      form.append("target_dir", targetDir);

      const response = await fetch(`${url}/api/lake/ingest`, {
        method: "POST",
        body: form
      });
      return readJson(response);
    }
  };
};
