/**
 * Robust LLM Request Client
 * Features: timeout, retry with exponential backoff, streaming, abort support
 */

export interface LLMRequestOptions {
  baseUrl: string;
  prompt: string;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  stream?: boolean;
  onChunk?: (chunk: string, accumulated: string) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export interface LLMResponse {
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class LLMRequestError extends Error {
  constructor(
    message: string,
    public readonly code: "timeout" | "network" | "server" | "parse" | "cancelled",
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "LLMRequestError";
  }
}

const DEFAULT_SYSTEM_PROMPT =
  "Return valid JSON only. No markdown code blocks. No prose before or after the JSON.";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Make a robust LLM request with timeout, retry, and optional streaming
 */
export async function requestLLM(options: LLMRequestOptions): Promise<LLMResponse> {
  const {
    baseUrl,
    prompt,
    model,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxTokens = 1500,
    temperature = 0.4,
    timeoutMs = 45000,
    retries = 2,
    retryDelayMs = 1000,
    stream = false,
    onChunk,
    onProgress,
    signal: externalSignal
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Create abort controller for this attempt
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Combine external signal with our timeout signal
    const handleExternalAbort = () => {
      controller.abort();
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        throw new LLMRequestError("Request cancelled", "cancelled", undefined, false);
      }
      externalSignal.addEventListener("abort", handleExternalAbort);
    }

    try {
      // Set timeout
      timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      if (attempt > 0) {
        const waitMs = retryDelayMs * Math.pow(2, attempt - 1);
        onProgress?.(`Retry ${attempt}/${retries} in ${waitMs}ms...`);
        await delay(waitMs);
      }

      onProgress?.(`Requesting LLM (attempt ${attempt + 1}/${retries + 1})...`);

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": stream ? "text/event-stream" : "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          stream,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ]
        })
      });

      // Clear timeout since we got a response
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        const isRetryable = response.status >= 500 || response.status === 429;
        throw new LLMRequestError(
          `LLM server error: ${response.status} - ${errorText}`,
          "server",
          response.status,
          isRetryable
        );
      }

      // Handle streaming response
      if (stream && response.body && onChunk) {
        const content = await parseStreamingResponse(response.body, onChunk, controller.signal);
        return { content, finishReason: "stop" };
      }

      // Handle regular JSON response
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || "";
      const finishReason = data?.choices?.[0]?.finish_reason;
      const usage = data?.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0
      } : undefined;

      return { content, finishReason, usage };

    } catch (err) {
      // Clear timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Check if it's an external abort
      if (externalSignal?.aborted) {
        throw new LLMRequestError("Request cancelled by user", "cancelled", undefined, false);
      }

      // Handle abort (timeout)
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new LLMRequestError(
          `Request timed out after ${timeoutMs}ms`,
          "timeout",
          undefined,
          true
        );
      } else if (err instanceof LLMRequestError) {
        lastError = err;
        if (!err.retryable) {
          throw err;
        }
      } else if (err instanceof TypeError) {
        // Network error
        lastError = new LLMRequestError(
          `Network error: ${err.message}`,
          "network",
          undefined,
          true
        );
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      // Don't retry if we've exhausted attempts
      if (attempt === retries) {
        throw lastError;
      }

      onProgress?.(`Request failed: ${lastError.message}. Retrying...`);

    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener("abort", handleExternalAbort);
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

/**
 * Parse SSE streaming response from the LLM
 */
async function parseStreamingResponse(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: string, accumulated: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new LLMRequestError("Streaming cancelled", "cancelled", undefined, false);
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed === "data: [DONE]") {
          continue;
        }

        if (trimmed.startsWith("data: ")) {
          try {
            const jsonStr = trimmed.slice(6);
            const payload = JSON.parse(jsonStr);
            const delta = payload?.choices?.[0]?.delta?.content;

            if (delta) {
              accumulated += delta;
              onChunk(delta, accumulated);
            }
          } catch {
            // Partial JSON, continue collecting
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim() && buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
      try {
        const payload = JSON.parse(buffer.trim().slice(6));
        const delta = payload?.choices?.[0]?.delta?.content;
        if (delta) {
          accumulated += delta;
          onChunk(delta, accumulated);
        }
      } catch {
        // Ignore parse errors on final chunk
      }
    }

    return accumulated;

  } finally {
    reader.releaseLock();
  }
}

/**
 * Quick non-streaming request helper
 */
export async function quickRequest(
  baseUrl: string,
  model: string,
  prompt: string,
  options?: Partial<LLMRequestOptions>
): Promise<string> {
  const response = await requestLLM({
    baseUrl,
    model,
    prompt,
    ...options
  });
  return response.content;
}
