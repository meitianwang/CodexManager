import type { CodexManagerAPI } from "../../preload";

declare global {
  interface Window {
    codexManager?: CodexManagerAPI;
  }
}

export {};
