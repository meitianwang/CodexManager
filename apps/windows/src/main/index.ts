import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from "electron";
import started from "electron-squirrel-startup";
import { appInfo } from "../shared/app-info";
import { ipcChannels } from "../shared/ipc/schema";
import type { AccountSummary } from "../shared/models/accounts";
import { createWindowsAppContext, type WindowsAppContext } from "./app-context";
import { registerIpcHandlers } from "./ipc/handlers";
import { TrayService, type TrayMenuItem } from "./platform/tray-service";
import { BackgroundAccountMaintenanceService } from "./services/background-account-maintenance-service";

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let trayService: TrayService | undefined;
let backgroundAccountMaintenanceService: BackgroundAccountMaintenanceService | undefined;
let isQuitting = false;
const isSmokeTest = process.env.CODEX_MANAGER_ELECTRON_SMOKE_TEST === "1";
const smokeTestTimeoutMs = parsePositiveInteger(process.env.CODEX_MANAGER_ELECTRON_SMOKE_TIMEOUT_MS, 30_000);

interface CreateMainWindowOptions {
  beforeLoad?: (browserWindow: BrowserWindow) => void;
}

interface SmokeRendererState {
  activePage: string | null;
  bodyLength: number;
  hasBridge: boolean;
  pageTitle: string | null;
}

function rendererEntry(): string {
  return path.join(__dirname, "../renderer/index.html");
}

function preloadEntry(): string {
  return path.join(__dirname, "../preload/index.js");
}

function appIconPath(): string {
  return path.join(__dirname, "../../assets/icon.ico");
}

function createMainWindow(options: CreateMainWindowOptions = {}): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111318",
    icon: appIconPath(),
    show: false,
    title: appInfo.displayName,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadEntry(),
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  options.beforeLoad?.(mainWindow);

  const devServerURL = process.env.VITE_DEV_SERVER_URL;
  if (devServerURL) {
    void mainWindow.loadURL(devServerURL);
  } else {
    void mainWindow.loadFile(rendererEntry());
  }
  return mainWindow;
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
  }
  if (mainWindow?.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow?.show();
  mainWindow?.focus();
}

function publishAccounts(accounts: AccountSummary[]): void {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (!browserWindow.isDestroyed()) {
      browserWindow.webContents.send(ipcChannels.accountsChanged, accounts);
    }
  }
}

async function createTray(context: WindowsAppContext): Promise<TrayService> {
  const tray = new Tray(trayIconImage());
  const adapter = {
    setToolTip(value: string) {
      tray.setToolTip(value);
    },
    setContextMenu(items: readonly TrayMenuItem[]) {
      tray.setContextMenu(Menu.buildFromTemplate(items.map(toElectronMenuItem)));
    },
    onPrimaryClick(handler: () => void) {
      tray.on("click", handler);
    },
    destroy() {
      tray.destroy();
    }
  };
  const proxyState = await context.proxyRuntimeService.getState();

  return new TrayService({
    adapter,
    initialState: { proxyRunning: proxyState.isRunning },
    actions: {
      showWindow: showMainWindow,
      async refreshAccounts() {
        publishAccounts(await context.accountsCoordinator.refreshAllUsage());
      },
      async smartSwitch() {
        await context.accountsCoordinator.smartSwitch();
        publishAccounts(await context.accountsCoordinator.listAccounts());
      },
      async startProxy() {
        const state = await context.proxyRuntimeService.getState();
        const nextState = await context.proxyRuntimeService.start(state.port, state.apiKey);
        trayService?.updateState({ proxyRunning: nextState.isRunning });
      },
      async stopProxy() {
        const nextState = await context.proxyRuntimeService.stop();
        trayService?.updateState({ proxyRunning: nextState.isRunning });
      },
      quit() {
        isQuitting = true;
        app.quit();
      }
    },
    onActionError(action, error) {
      console.error(`Tray action failed: ${action}`, error);
    },
    tooltip: appInfo.displayName
  });
}

function toElectronMenuItem(item: TrayMenuItem): MenuItemConstructorOptions {
  if (item.type === "separator") {
    return { type: "separator" };
  }
  return {
    label: item.label ?? "",
    enabled: item.enabled,
    click: item.click
  };
}

function trayIconImage() {
  const svg = [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\">",
    "<rect width=\"32\" height=\"32\" rx=\"7\" fill=\"#d6f05f\"/>",
    "<path d=\"M10 16c0-4 2.7-6.8 6.7-6.8 2 0 3.7.7 5 2l-2.1 2.3c-.8-.8-1.7-1.2-2.9-1.2-2.1 0-3.5 1.5-3.5 3.7s1.4 3.7 3.5 3.7c1.3 0 2.3-.5 3.1-1.4l2.1 2.2c-1.3 1.5-3.1 2.3-5.3 2.3-3.9 0-6.6-2.8-6.6-6.8z\" fill=\"#111318\"/>",
    "</svg>"
  ].join("");
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

app.whenReady().then(async () => {
  const context = await createWindowsAppContext(app);
  registerIpcHandlers(ipcMain, context, {
    onProxyStateChanged(state) {
      trayService?.updateState({ proxyRunning: state.isRunning });
    }
  });
  if (!isSmokeTest) {
    trayService = await createTray(context);
  }
  const smokeTest = isSmokeTest ? createSmokeTestController() : undefined;
  createMainWindow({
    beforeLoad(browserWindow) {
      smokeTest?.attach(browserWindow);
    }
  });
  if (!isSmokeTest) {
    backgroundAccountMaintenanceService = new BackgroundAccountMaintenanceService({
      accountsCoordinator: context.accountsCoordinator,
      settingsCoordinator: context.settingsCoordinator,
      onAccountsUpdated: publishAccounts,
      onError(error) {
        console.error("Background account maintenance failed", error);
      }
    });
    backgroundAccountMaintenanceService.start();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  backgroundAccountMaintenanceService?.stop();
  trayService?.destroy();
});

app.on("window-all-closed", () => {
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});

function createSmokeTestController(): { attach: (browserWindow: BrowserWindow) => void } {
  let completed = false;
  const timeout = setTimeout(() => {
    failSmokeTest(new Error(`Smoke test timed out after ${smokeTestTimeoutMs}ms`));
  }, smokeTestTimeoutMs);

  function complete(exitCode: number): void {
    if (completed) {
      return;
    }
    completed = true;
    clearTimeout(timeout);
    isQuitting = true;
    backgroundAccountMaintenanceService?.stop();
    trayService?.destroy();
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      if (!browserWindow.isDestroyed()) {
        browserWindow.destroy();
      }
    }
    app.exit(exitCode);
  }

  function failSmokeTest(error: unknown): void {
    console.error("CodexManager Windows smoke test failed", error);
    complete(1);
  }

  async function verifyRenderer(browserWindow: BrowserWindow): Promise<void> {
    try {
      const state = await waitForRendererState(browserWindow);
      if (!state.hasBridge) {
        throw new Error("Preload IPC bridge is unavailable");
      }
      if (state.activePage !== "accounts") {
        throw new Error(`Expected Accounts page, got ${state.activePage ?? "unknown"}`);
      }
      if (!state.pageTitle || state.bodyLength < 100) {
        throw new Error(`Renderer did not finish painting the workspace: ${JSON.stringify(state)}`);
      }
      console.log(`CodexManager Windows smoke test passed: ${JSON.stringify(state)}`);
      complete(0);
    } catch (error) {
      failSmokeTest(error);
    }
  }

  return {
    attach(browserWindow) {
      browserWindow.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
        failSmokeTest(new Error(`Renderer failed to load (${errorCode}): ${errorDescription}`));
      });
      browserWindow.webContents.once("render-process-gone", (_event, details) => {
        failSmokeTest(new Error(`Renderer process exited unexpectedly: ${details.reason}`));
      });
      browserWindow.webContents.once("did-finish-load", () => {
        void verifyRenderer(browserWindow);
      });
    }
  };
}

async function waitForRendererState(browserWindow: BrowserWindow): Promise<SmokeRendererState> {
  const deadline = Date.now() + smokeTestTimeoutMs;
  let lastState: SmokeRendererState | undefined;
  while (Date.now() < deadline) {
    const state = await readRendererState(browserWindow);
    lastState = state;
    if (state.activePage && state.pageTitle && state.bodyLength > 0) {
      return state;
    }
    await delay(100);
  }
  throw new Error(`Renderer state did not become ready: ${JSON.stringify(lastState)}`);
}

async function readRendererState(browserWindow: BrowserWindow): Promise<SmokeRendererState> {
  const value = await browserWindow.webContents.executeJavaScript(
    `(() => {
      const shell = document.querySelector(".app-shell");
      return {
        activePage: shell?.getAttribute("data-active-page") ?? null,
        bodyLength: document.body?.innerText?.length ?? 0,
        hasBridge: Boolean(window.codexManager),
        pageTitle: document.querySelector("#page-title")?.textContent?.trim() ?? null
      };
    })()`,
    true
  );
  if (!isSmokeRendererState(value)) {
    throw new Error(`Unexpected renderer smoke state: ${JSON.stringify(value)}`);
  }
  return value;
}

function isSmokeRendererState(value: unknown): value is SmokeRendererState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const state = value as Record<string, unknown>;
  return (
    (typeof state.activePage === "string" || state.activePage === null) &&
    typeof state.bodyLength === "number" &&
    typeof state.hasBridge === "boolean" &&
    (typeof state.pageTitle === "string" || state.pageTitle === null)
  );
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
