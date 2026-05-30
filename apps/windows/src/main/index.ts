import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from "electron";
import started from "electron-squirrel-startup";
import { appInfo } from "../shared/app-info";
import { createWindowsAppContext, type WindowsAppContext } from "./app-context";
import { registerIpcHandlers } from "./ipc/handlers";
import { TrayService, type TrayMenuItem } from "./platform/tray-service";

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let trayService: TrayService | undefined;
let isQuitting = false;

function rendererEntry(): string {
  return path.join(__dirname, "../renderer/index.html");
}

function preloadEntry(): string {
  return path.join(__dirname, "../preload/index.js");
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111318",
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

  const devServerURL = process.env.VITE_DEV_SERVER_URL;
  if (devServerURL) {
    void mainWindow.loadURL(devServerURL);
  } else {
    void mainWindow.loadFile(rendererEntry());
  }
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
        await context.accountsCoordinator.refreshAllUsage();
      },
      async smartSwitch() {
        await context.accountsCoordinator.smartSwitch();
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
  trayService = await createTray(context);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  trayService?.destroy();
});

app.on("window-all-closed", () => {
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});
