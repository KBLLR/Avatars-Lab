type LegacyMessage = Record<string, any>;
type LegacyTool = Record<string, any>;

export function extractOpenResponseText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts: string[] = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (["output_text", "text"].includes(content?.type) && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
}

function normalizeTools(tools: LegacyTool[]) {
  return tools.map((tool) => {
    const fn = tool.function || tool;
    return {
      type: "function",
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters || { type: "object", properties: {} },
    };
  });
}

function normalizeInput(messages: LegacyMessage[]) {
  const input: LegacyMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      });
      continue;
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      if (message.content) input.push({ role: "assistant", content: message.content });
      for (const call of message.tool_calls) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function?.name,
          arguments: call.function?.arguments || "{}",
        });
      }
      continue;
    }
    input.push({ role: message.role, content: message.content });
  }
  return input;
}

function toLegacyAssistant(payload: any) {
  const toolCalls = (payload?.output || [])
    .filter((item: any) => item?.type === "function_call")
    .map((item: any) => ({
      id: item.call_id || item.id,
      type: "function",
      function: {
        name: item.name,
        arguments: item.arguments || "{}",
      },
    }));
  return {
    role: "assistant",
    content: extractOpenResponseText(payload) || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

export async function requestOpenResponsesTurn(options: {
  baseUrl: string;
  model: string;
  messages: LegacyMessage[];
  tools?: LegacyTool[];
  signal?: AbortSignal;
}) {
  const instructions = options.messages
    .filter((message) => message.role === "system")
    .map((message) => String(message.content || ""))
    .filter(Boolean)
    .join("\n\n");
  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model: options.model,
      input: normalizeInput(options.messages),
      ...(instructions ? { instructions } : {}),
      ...(options.tools?.length ? { tools: normalizeTools(options.tools), tool_choice: "auto" } : {}),
      stream: false,
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenResponses error (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  return {
    id: payload.id,
    choices: [{ message: toLegacyAssistant(payload), finish_reason: payload.status }],
    usage: payload.usage,
  };
}
