export const codexAppProviderId = "codexmanager";
export const codexAppDefaultModel = "gpt-5.5";
export const codexAppProxyApiKeyEnvironmentVariable = "CODEXMANAGER_PROXY_API_KEY";

export const codexAppIntegrationStates = ["not_configured", "configured", "drifted", "restorable"] as const;

export type CodexAppIntegrationState = (typeof codexAppIntegrationStates)[number];

export interface CodexAppIntegrationStatus {
  configPath: string;
  hasBackup: boolean;
  model: string;
  providerId: string;
  proxyURL: string;
  state: CodexAppIntegrationState;
  error?: string;
  warning?: string;
}
