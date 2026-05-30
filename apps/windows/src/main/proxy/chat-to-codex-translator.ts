export function translateChatRequest(model: string, messages: readonly Record<string, unknown>[], original: Record<string, unknown>): Record<string, unknown> {
  const effort = typeof original.reasoning_effort === "string" ? original.reasoning_effort : "medium";
  const body: Record<string, unknown> = {
    model,
    stream: true,
    store: false,
    parallel_tool_calls: true,
    include: ["reasoning.encrypted_content"],
    reasoning: { effort, summary: "auto" }
  };

  let instructions = "";
  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : undefined;
    if (!role) {
      continue;
    }

    const content = extractMessageContent(message);
    if (role === "system" || role === "developer") {
      instructions = instructions ? `${instructions}\n${content}` : content;
      continue;
    }

    input.push({
      type: "message",
      role,
      content: [
        {
          type: role === "assistant" ? "output_text" : "input_text",
          text: content
        }
      ]
    });
  }

  body.instructions = instructions;
  body.input = input;

  if (Array.isArray(original.tools)) {
    const tools = original.tools
      .map(convertChatTool)
      .filter((tool): tool is Record<string, unknown> => tool !== undefined);
    if (tools.length > 0) {
      body.tools = tools;
    }
  }

  return body;
}

export function translateCodexSSEToChatCompletion(model: string, text: string): Record<string, unknown> {
  let fullText = "";
  let usage: unknown;

  for (const event of parseSSEEvents(text)) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      fullText += event.delta;
    }
    if (event.type === "response.completed" && isRecord(event.response)) {
      usage = event.response.usage;
    }
  }

  const result: Record<string, unknown> = {
    id: `chatcmpl-${crypto.randomUUID().slice(0, 12)}`,
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: fullText
        },
        finish_reason: "stop"
      }
    ]
  };
  if (usage !== undefined) {
    result.usage = usage;
  }
  return result;
}

function extractMessageContent(message: Record<string, unknown>): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
          return undefined;
        }
        return part.text;
      })
      .filter((part): part is string => part !== undefined)
      .join("\n");
  }

  return "";
}

function convertChatTool(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw) || !isRecord(raw.function) || typeof raw.function.name !== "string") {
    return undefined;
  }

  const tool: Record<string, unknown> = {
    type: "function",
    name: raw.function.name,
    strict: false
  };
  if (typeof raw.function.description === "string") {
    tool.description = raw.function.description;
  }
  if (isRecord(raw.function.parameters)) {
    const parameters = { ...raw.function.parameters };
    delete parameters.$schema;
    tool.parameters = parameters;
  }
  return tool;
}

function parseSSEEvents(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payload = line.slice("data: ".length).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (isRecord(parsed)) {
        events.push(parsed);
      }
    } catch {
      continue;
    }
  }
  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
