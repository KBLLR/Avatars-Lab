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
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${COREX_GATEWAY_URL}${path}`, init);
  if (!response.ok) throw new Error(`${path} failed (HTTP ${response.status})`);
  return response.json() as Promise<T>;
}

export const corexClient = {
  gatewayUrl: COREX_GATEWAY_URL,
  health: (signal?: AbortSignal) =>
    fetchJson<CorexHealth>("/health", { signal }),
  voices: async (signal?: AbortSignal): Promise<VoiceRecord[]> => {
    const payload = await fetchJson<{ voices?: Array<string | VoiceRecord> }>(
      "/v1/audio/voices",
      { signal },
    );
    return (payload.voices || []).map((voice) =>
      typeof voice === "string" ? { name: voice } : voice,
    );
  },
};
