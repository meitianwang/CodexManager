import { codexSSEErrorFromEvent, parseCodexSSEEvents } from "./codex-sse";

export interface AnthropicTranslation {
  codexBody: Record<string, unknown>;
  model: string;
  isStream: boolean;
}

export interface AnthropicMessageResult {
  body: Record<string, unknown>;
  statusCode: number;
}

export function translateAnthropicRequest(json: Record<string, unknown>): AnthropicTranslation | undefined {
  if (typeof json.model !== "string" || !json.model) {
    return undefined;
  }

  const input: Record<string, unknown>[] = [];
  appendSystem(json.system, input);

  if (Array.isArray(json.messages)) {
    for (const raw of json.messages) {
      if (!isRecord(raw) || typeof raw.role !== "string") {
        continue;
      }
      if (raw.role === "user") {
        appendUserMessage(raw, input);
      } else if (raw.role === "assistant") {
        appendAssistantMessage(raw, input);
      }
    }
  }

  const body: Record<string, unknown> = {
    model: json.model,
    stream: true,
    store: false,
    instructions: "",
    parallel_tool_calls: true,
    include: ["reasoning.encrypted_content"],
    reasoning: { effort: reasoningEffort(json.thinking), summary: "auto" },
    input
  };

  const tools = convertAnthropicTools(json.tools);
  if (tools.length > 0) {
    body.tools = tools;
  }

  const toolChoice = convertToolChoice(json.tool_choice);
  if (toolChoice.choice !== undefined) {
    body.tool_choice = toolChoice.choice;
  }
  if (toolChoice.disableParallel) {
    body.parallel_tool_calls = false;
  }

  return {
    codexBody: body,
    model: json.model,
    isStream: typeof json.stream === "boolean" ? json.stream : true
  };
}

function appendSystem(system: unknown, input: Record<string, unknown>[]): void {
  if (typeof system === "string" && system) {
    input.push({ type: "message", role: "developer", content: [{ type: "input_text", text: system }] });
    return;
  }

  if (!Array.isArray(system)) {
    return;
  }

  const parts = system
    .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? { type: "input_text", text: part.text } : undefined))
    .filter((part): part is { type: string; text: string } => part !== undefined);
  if (parts.length > 0) {
    input.push({ type: "message", role: "developer", content: parts });
  }
}

function appendUserMessage(message: Record<string, unknown>, input: Record<string, unknown>[]): void {
  if (Array.isArray(message.content)) {
    let regularParts: Record<string, unknown>[] = [];
    for (const part of message.content) {
      if (!isRecord(part) || typeof part.type !== "string") {
        continue;
      }
      if (part.type === "tool_result") {
        if (regularParts.length > 0) {
          input.push({ type: "message", role: "user", content: regularParts });
          regularParts = [];
        }
        input.push({
          type: "function_call_output",
          call_id: typeof part.tool_use_id === "string" ? part.tool_use_id : "",
          output: stringifyToolResultContent(part.content)
        });
        continue;
      }

      const converted = convertSinglePart(part, "user");
      if (Object.keys(converted).length > 0) {
        regularParts.push(converted);
      }
    }
    if (regularParts.length > 0) {
      input.push({ type: "message", role: "user", content: regularParts });
    }
    return;
  }

  const parts = convertContent(message.content, "user");
  if (parts.length > 0) {
    input.push({ type: "message", role: "user", content: parts });
  }
}

function appendAssistantMessage(message: Record<string, unknown>, input: Record<string, unknown>[]): void {
  if (Array.isArray(message.content)) {
    let textParts: Record<string, unknown>[] = [];
    for (const part of message.content) {
      if (!isRecord(part) || typeof part.type !== "string") {
        continue;
      }
      if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
        textParts.push({ type: "output_text", text: part.text });
      } else if (part.type === "tool_use") {
        if (textParts.length > 0) {
          input.push({ type: "message", role: "assistant", content: textParts });
          textParts = [];
        }
        input.push({
          type: "function_call",
          call_id: typeof part.id === "string" ? part.id : "",
          name: typeof part.name === "string" ? part.name : "",
          arguments: stringifyJSON(part.input)
        });
      }
    }
    if (textParts.length > 0) {
      input.push({ type: "message", role: "assistant", content: textParts });
    }
    return;
  }

  const parts = convertContent(message.content, "assistant");
  if (parts.length > 0) {
    input.push({ type: "message", role: "assistant", content: parts });
  }
}

function convertContent(content: unknown, role: "user" | "assistant"): Record<string, unknown>[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: role === "assistant" ? "output_text" : "input_text", text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: Record<string, unknown>[] = [];
  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") {
      continue;
    }
    const converted = convertSinglePart(part, role);
    if (Object.keys(converted).length > 0) {
      parts.push(converted);
    }
  }
  return parts;
}

function convertSinglePart(part: Record<string, unknown>, role: "user" | "assistant"): Record<string, unknown> {
  if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
    return { type: role === "assistant" ? "output_text" : "input_text", text: part.text };
  }
  if (part.type !== "image" || !isRecord(part.source)) {
    return {};
  }

  if (part.source.type === "base64" && typeof part.source.media_type === "string" && typeof part.source.data === "string") {
    return {
      type: "input_image",
      image_url: `data:${part.source.media_type};base64,${part.source.data}`
    };
  }
  if (part.source.type === "url" && typeof part.source.url === "string") {
    return { type: "input_image", image_url: part.source.url };
  }
  return {};
}

function convertAnthropicTools(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((tool) => {
      const converted: Record<string, unknown> = {
        type: "function",
        name: typeof tool.name === "string" ? tool.name : "",
        description: typeof tool.description === "string" ? tool.description : "",
        strict: false
      };
      if (isRecord(tool.input_schema)) {
        const parameters = { ...tool.input_schema };
        delete parameters.$schema;
        converted.parameters = parameters;
      }
      return converted;
    });
}

function convertToolChoice(value: unknown): { choice?: unknown; disableParallel: boolean } {
  if (!isRecord(value)) {
    return { disableParallel: false };
  }

  const disableParallel = value.disable_parallel_tool_use === true;
  switch (value.type) {
    case "auto":
      return { choice: "auto", disableParallel };
    case "any":
      return { choice: "required", disableParallel };
    case "tool":
      return typeof value.name === "string"
        ? { choice: { type: "function", name: value.name }, disableParallel }
        : { disableParallel };
    default:
      return { disableParallel };
  }
}

function reasoningEffort(thinking: unknown): string {
  if (!isRecord(thinking) || typeof thinking.type !== "string") {
    return "medium";
  }
  switch (thinking.type) {
    case "disabled":
      return "low";
    case "enabled":
    case "adaptive":
    case "auto":
      return "high";
    default:
      return "medium";
  }
}

export function translateCodexSSEToAnthropicStream(model: string, text: string): string {
  const messageID = generateMessageID();
  const chunks: string[] = [
    formatEvent("message_start", {
      type: "message_start",
      message: {
        id: messageID,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    }),
    "event: ping\ndata: {\"type\":\"ping\"}\n\n"
  ];

  let contentIndex = 0;
  let blockOpen: "text" | "thinking" | "tool_use" | undefined;
  let hasToolCall = false;
  let outputTokens = 0;

  for (const event of parseCodexSSEEvents(text)) {
    const error = codexSSEErrorFromEvent(event);
    if (error) {
      if (blockOpen) {
        chunks.push(formatEvent("content_block_stop", { type: "content_block_stop", index: contentIndex }));
      }
      chunks.push(formatEvent("error", { type: "error", error: { type: "api_error", message: error.message } }));
      return chunks.join("");
    }

    switch (event.type) {
      case "response.output_text.delta": {
        const delta = typeof event.object.delta === "string" ? event.object.delta : "";
        if (!delta) {
          break;
        }
        if (!blockOpen) {
          chunks.push(formatEvent("content_block_start", {
            type: "content_block_start",
            index: contentIndex,
            content_block: { type: "text", text: "" }
          }));
          blockOpen = "text";
        }
        chunks.push(formatEvent("content_block_delta", {
          type: "content_block_delta",
          index: contentIndex,
          delta: { type: "text_delta", text: delta }
        }));
        break;
      }
      case "response.output_text.done":
        if (blockOpen) {
          chunks.push(formatEvent("content_block_stop", { type: "content_block_stop", index: contentIndex }));
          contentIndex += 1;
          blockOpen = undefined;
        }
        break;
      case "response.reasoning_summary_text.delta": {
        const delta = typeof event.object.delta === "string" ? event.object.delta : "";
        if (!delta) {
          break;
        }
        if (!blockOpen) {
          chunks.push(formatEvent("content_block_start", {
            type: "content_block_start",
            index: contentIndex,
            content_block: { type: "thinking", thinking: "" }
          }));
          blockOpen = "thinking";
        }
        chunks.push(formatEvent("content_block_delta", {
          type: "content_block_delta",
          index: contentIndex,
          delta: { type: "thinking_delta", thinking: delta }
        }));
        break;
      }
      case "response.reasoning_summary_text.done":
        if (blockOpen) {
          chunks.push(formatEvent("content_block_stop", { type: "content_block_stop", index: contentIndex }));
          contentIndex += 1;
          blockOpen = undefined;
        }
        break;
      case "response.output_item.added":
        if (!isRecord(event.object.item) || event.object.item.type !== "function_call") {
          break;
        }
        if (blockOpen) {
          chunks.push(formatEvent("content_block_stop", { type: "content_block_stop", index: contentIndex }));
          contentIndex += 1;
        }
        hasToolCall = true;
        blockOpen = "tool_use";
        chunks.push(formatEvent("content_block_start", {
          type: "content_block_start",
          index: contentIndex,
          content_block: {
            type: "tool_use",
            id: generateToolUseID(),
            name: typeof event.object.item.name === "string" ? event.object.item.name : "",
            input: {}
          }
        }));
        break;
      case "response.function_call_arguments.delta": {
        const delta = typeof event.object.delta === "string" ? event.object.delta : "";
        if (delta) {
          chunks.push(formatEvent("content_block_delta", {
            type: "content_block_delta",
            index: contentIndex,
            delta: { type: "input_json_delta", partial_json: delta }
          }));
        }
        break;
      }
      case "response.function_call_arguments.done":
      case "response.output_item.done":
        if (blockOpen === "tool_use") {
          chunks.push(formatEvent("content_block_stop", { type: "content_block_stop", index: contentIndex }));
          contentIndex += 1;
          blockOpen = undefined;
        }
        break;
      case "response.completed":
        if (isRecord(event.object.response) && isRecord(event.object.response.usage)) {
          outputTokens = integerValue(event.object.response.usage.output_tokens) ?? 0;
        }
        break;
      default:
        break;
    }
  }

  if (blockOpen) {
    chunks.push(formatEvent("content_block_stop", { type: "content_block_stop", index: contentIndex }));
  }

  chunks.push(formatEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: hasToolCall ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: outputTokens }
  }));
  chunks.push("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
  return chunks.join("");
}

export function translateCodexSSEToAnthropicMessage(model: string, text: string): AnthropicMessageResult {
  for (const event of parseCodexSSEEvents(text)) {
    const error = codexSSEErrorFromEvent(event);
    if (error) {
      return {
        body: anthropicErrorBody(error.message),
        statusCode: error.statusCode
      };
    }
    if (event.type === "response.completed" && isRecord(event.object.response)) {
      return {
        body: buildAnthropicMessage(event.object.response, model),
        statusCode: 200
      };
    }
  }

  return {
    body: anthropicErrorBody("Failed to collect upstream response"),
    statusCode: 502
  };
}

function buildAnthropicMessage(response: Record<string, unknown>, model: string): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  let hasToolCall = false;

  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (!isRecord(item) || typeof item.type !== "string") {
        continue;
      }
      if (item.type === "reasoning" && Array.isArray(item.summary)) {
        for (const summary of item.summary) {
          if (isRecord(summary) && summary.type === "summary_text" && typeof summary.text === "string" && summary.text) {
            content.push({ type: "thinking", thinking: summary.text });
          }
        }
      } else if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (isRecord(part) && part.type === "output_text" && typeof part.text === "string" && part.text) {
            content.push({ type: "text", text: part.text });
          }
        }
      } else if (item.type === "function_call") {
        hasToolCall = true;
        content.push({
          type: "tool_use",
          id: generateToolUseID(),
          name: typeof item.name === "string" ? item.name : "",
          input: parseJSONStringObject(typeof item.arguments === "string" ? item.arguments : "{}")
        });
      }
    }
  }

  const usage = isRecord(response.usage) ? response.usage : {};
  return {
    id: generateMessageID(),
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: hasToolCall ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: integerValue(usage.input_tokens) ?? 0,
      output_tokens: integerValue(usage.output_tokens) ?? 0
    }
  };
}

export function anthropicErrorBody(message: string): Record<string, unknown> {
  return {
    type: "error",
    error: { type: "api_error", message }
  };
}

function stringifyToolResultContent(content: unknown): string {
  if (content === undefined || content === null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : undefined))
      .filter((item): item is string => item !== undefined)
      .join("\n");
  }
  return stringifyJSON(content);
}

function stringifyJSON(value: unknown): string {
  if (value === undefined || value === null) {
    return "{}";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function parseJSONStringObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatEvent(event: string, object: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(object)}\n\n`;
}

function generateMessageID(): string {
  return `msg_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function generateToolUseID(): string {
  return `toolu_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
