import path from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import started from "electron-squirrel-startup";
import { appInfo } from "../shared/app-info";

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

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

ipcMain.handle("app:info", () => appInfo);

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
