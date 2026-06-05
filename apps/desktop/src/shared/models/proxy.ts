export const proxyEndpointIds = ["chatCompletions", "responses", "messages"] as const;

export type ProxyEndpointID = (typeof proxyEndpointIds)[number];

export interface ProxyEndpointDescriptor {
  id: ProxyEndpointID;
  method: "POST";
  path: string;
  description: string;
}

export interface ProxyRuntimeState {
  apiKey: string;
  availableModels: string[];
  isRunning: boolean;
  port: number;
  proxyURL: string;
}

export const proxyAvailableModels = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5-mini",
  "o3",
  "o3-pro",
  "o4-mini",
  "codex-mini-latest"
] as const;

export const proxyEndpoints: readonly ProxyEndpointDescriptor[] = [
  {
    id: "chatCompletions",
    method: "POST",
    path: "/v1/chat/completions",
    description: "OpenAI Chat Completions"
  },
  {
    id: "responses",
    method: "POST",
    path: "/v1/responses",
    description: "OpenAI Responses"
  },
  {
    id: "messages",
    method: "POST",
    path: "/v1/messages",
    description: "Anthropic Messages"
  }
];
