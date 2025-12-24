const withTimeout = async (promise, timeoutMs, label) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await promise(controller.signal);
    return response;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms${label ? `: ${label}` : ""}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 8000) => {
  return withTimeout((signal) => fetch(url, { ...options, signal }), timeoutMs, url);
};

const fetchJson = async (url, options = {}, timeoutMs = 8000) => {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { response, text, json: parsed };
};

export {
  fetchWithTimeout,
  fetchJson
};
