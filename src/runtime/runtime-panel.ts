import type { ModelRuntimeStatus, RuntimePanelElements } from "./types";

export const trimModelId = (value?: string | null): string => {
  if (!value) return "-";
  if (value.length <= 52) return value;
  return `${value.slice(0, 24)}...${value.slice(-18)}`;
};

export const setRuntimeStatusText = (els: RuntimePanelElements, text: string): void => {
  els.llmRuntimeStatus.textContent = text;
};

export const setRuntimeValue = (el: HTMLElement, value: string, title?: string | null): void => {
  el.textContent = value;
  if (title) {
    el.title = title;
  } else {
    el.removeAttribute("title");
  }
};

export const setRuntimeBusy = (els: RuntimePanelElements, busy: boolean): void => {
  els.llmRuntimeRefresh.disabled = busy;
  els.llmRuntimeUnload.disabled = busy;
  els.llmRuntimeLoad.disabled = busy;
};

export const fetchModelRuntimeStatus = async (llmBaseUrl: string): Promise<ModelRuntimeStatus | null> => {
  if (!llmBaseUrl) {
    return null;
  }
  const statusUrl = `${llmBaseUrl}/internal/models/status`;
  const diagnosticsUrl = `${llmBaseUrl}/internal/diagnostics`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(statusUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      return await response.json();
    }
    if (response.status !== 404) {
      throw new Error(`Status endpoint error (${response.status})`);
    }
  } catch {
    // fall through to diagnostics
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(diagnosticsUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`Diagnostics endpoint error (${response.status})`);
    }
    const diagnostics = await response.json();
    return {
      status: diagnostics.status,
      loaded: diagnostics.handler_initialized,
      model_id: diagnostics.loaded_model?.model_id,
      model_path: diagnostics.loaded_model?.model_path,
      model_type: diagnostics.loaded_model?.model_type,
      queue: diagnostics.queue || null,
      config: diagnostics.config || null
    };
  } catch {
    return null;
  }
};

export const updateRuntimePanel = (els: RuntimePanelElements, status: ModelRuntimeStatus | null): void => {
  if (!status) {
    setRuntimeValue(els.llmRuntimeLoaded, "Unavailable");
    setRuntimeValue(els.llmRuntimeType, "-");
    setRuntimeValue(els.llmRuntimeModel, "-");
    setRuntimeValue(els.llmRuntimeQueue, "-");
    setRuntimeValue(els.llmRuntimeActive, "-");
    setRuntimeValue(els.llmRuntimeConfig, "-");
    setRuntimeStatusText(els, "LLM diagnostics unavailable.");
    return;
  }

  const loaded = status.loaded ? "Loaded" : "Not loaded";
  const modelId = status.model_id || status.model_path || "";
  const modelType = status.model_type || "-";
  const queueStats = status.queue?.queue_stats;
  const activeRequests = queueStats?.active_requests ?? 0;
  const queued = queueStats?.queue_size ?? 0;
  const activeStreams = status.queue?.active_streams ?? 0;
  const configBits: string[] = [];

  if (status.config?.max_concurrency != null) {
    configBits.push(`max:${status.config.max_concurrency}`);
  }
  if (status.config?.queue_size != null) {
    configBits.push(`q:${status.config.queue_size}`);
  }
  if (status.config?.queue_timeout != null) {
    configBits.push(`timeout:${status.config.queue_timeout}s`);
  }
  if (typeof status.config?.mlx_warmup === "boolean") {
    configBits.push(status.config.mlx_warmup ? "warmup:on" : "warmup:off");
  }

  setRuntimeValue(els.llmRuntimeLoaded, loaded);
  setRuntimeValue(els.llmRuntimeType, modelType);
  setRuntimeValue(els.llmRuntimeModel, trimModelId(modelId), modelId || null);
  setRuntimeValue(els.llmRuntimeQueue, `${activeRequests} active / ${queued} queued`);
  setRuntimeValue(els.llmRuntimeActive, `${activeStreams} streams`);
  setRuntimeValue(els.llmRuntimeConfig, configBits.length ? configBits.join(" | ") : "-");
  setRuntimeStatusText(els, "LLM status updated.");
};

export const refreshRuntimePanel = async (
  els: RuntimePanelElements,
  llmBaseUrl?: string
): Promise<void> => {
  if (!llmBaseUrl) {
    updateRuntimePanel(els, null);
    setRuntimeStatusText(els, "Missing LLM base URL.");
    return;
  }
  setRuntimeBusy(els, true);
  setRuntimeStatusText(els, "Refreshing...");
  const status = await fetchModelRuntimeStatus(llmBaseUrl);
  updateRuntimePanel(els, status);
  setRuntimeBusy(els, false);
};

export const unloadRuntimeModel = async (
  els: RuntimePanelElements,
  llmBaseUrl?: string
): Promise<void> => {
  if (!llmBaseUrl) {
    setRuntimeStatusText(els, "Missing LLM base URL.");
    return;
  }
  setRuntimeBusy(els, true);
  setRuntimeStatusText(els, "Unloading model...");
  const response = await fetch(`${llmBaseUrl}/internal/models/unload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force: els.llmRuntimeForce.checked })
  });
  if (!response.ok) {
    const detail = await response.text();
    setRuntimeStatusText(els, `Unload failed (${response.status}): ${detail}`);
    setRuntimeBusy(els, false);
    return;
  }
  await refreshRuntimePanel(els, llmBaseUrl);
  setRuntimeBusy(els, false);
};

export const loadRuntimeModel = async (
  els: RuntimePanelElements,
  llmBaseUrl?: string
): Promise<void> => {
  if (!llmBaseUrl) {
    setRuntimeStatusText(els, "Missing LLM base URL.");
    return;
  }
  const modelId = els.llmRuntimeModelSelect.value;
  if (!modelId) {
    setRuntimeStatusText(els, "Select a model to load.");
    return;
  }
  setRuntimeBusy(els, true);
  setRuntimeStatusText(els, `Loading ${modelId}...`);
  const response = await fetch(`${llmBaseUrl}/internal/models/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, force: els.llmRuntimeForce.checked })
  });
  if (!response.ok) {
    const detail = await response.text();
    setRuntimeStatusText(els, `Load failed (${response.status}): ${detail}`);
    setRuntimeBusy(els, false);
    return;
  }
  await refreshRuntimePanel(els, llmBaseUrl);
  setRuntimeBusy(els, false);
};
