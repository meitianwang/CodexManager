import type { AccountSummary } from "./accounts";
import type { EditorAppID } from "./settings";

export interface InstalledEditorApp {
  id: EditorAppID;
  label: string;
}

export interface SwitchAccountExecutionResult {
  usedFallbackCLI: boolean;
  restartedEditorApps: EditorAppID[];
  editorRestartError?: string;
}

export const idleSwitchAccountExecutionResult: SwitchAccountExecutionResult = {
  usedFallbackCLI: false,
  restartedEditorApps: []
};

export interface SmartSwitchResult {
  account: AccountSummary;
  execution: SwitchAccountExecutionResult;
}
