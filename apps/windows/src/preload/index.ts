import { contextBridge, ipcRenderer } from "electron";
import type { AppInfo } from "../shared/app-info";

export interface CodexManagerAPI {
  getAppInfo: () => Promise<AppInfo>;
}

const api: CodexManagerAPI = {
  getAppInfo: () => ipcRenderer.invoke("app:info") as Promise<AppInfo>
};

contextBridge.exposeInMainWorld("codexManager", api);
