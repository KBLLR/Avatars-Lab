export const COREX_GATEWAY_URL = (
  import.meta.env.VITE_COREX_GATEWAY_URL || "http://127.0.0.1:8090"
).replace(/\/$/, "");

export interface CorexHealth {
  status?: string;
  services?: Record<string, { status?: string }>;
}

export interface VoiceRecord {
  name: string;
  description?: string;
  has_sample?: boolean;
}

async function fetchJson<T>(path: string, init?: RequestInit, baseUrl = COREX_GATEWAY_URL): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, init);
  if (!response.ok) throw new Error(`${path} failed (HTTP ${response.status})`);
  return response.json() as Promise<T>;
}

export const corexClient = {
  gatewayUrl: COREX_GATEWAY_URL,
  health: (signal?: AbortSignal) =>
    fetchJson<CorexHealth>("/health", { signal }),
  voices: async (signal?: AbortSignal, baseUrl?: string): Promise<VoiceRecord[]> => {
    const payload = await fetchJson<{ voices?: Array<string | VoiceRecord> }>(
      "/v1/audio/voices",
      { signal },
      baseUrl,
    );
    return (payload.voices || []).map((voice) =>
      typeof voice === "string" ? { name: voice } : voice,
    );
  },
};
