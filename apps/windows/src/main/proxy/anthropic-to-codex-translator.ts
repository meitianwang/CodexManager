export interface AnthropicTranslation {
  codexBody: Record<string, unknown>;
  model: string;
  isStream: boolean;
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
  const parts = convertContent(message.content, "user");
  if (parts.length > 0) {
    input.push({ type: "message", role: "user", content: parts });
  }
}

function appendAssistantMessage(message: Record<string, unknown>, input: Record<string, unknown>[]): void {
  const parts = convertContent(message.content, "assistant");
  if (parts.length > 0) {
    input.push({ type: "message", role: "assistant", content: parts });
  }
}

function convertContent(content: unknown, role: "user" | "assistant"): Record<string, unknown>[] {
  if (typeof content === "string") {
    return [{ type: role === "assistant" ? "output_text" : "input_text", text: content }];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: Record<string, unknown>[] = [];
  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") {
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ type: role === "assistant" ? "output_text" : "input_text", text: part.text });
    }
  }
  return parts;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
