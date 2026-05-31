import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from "electron";
import started from "electron-squirrel-startup";
import { appInfo } from "../shared/app-info";
import { ipcChannels } from "../shared/ipc/schema";
import type { AccountSummary } from "../shared/models/accounts";
import type { StoredAccount } from "../shared/models/accounts";
import type { JSONValue } from "../shared/models/json-value";
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
const smokePages = ["accounts", "proxy", "settings"] as const;

interface CreateMainWindowOptions {
  beforeLoad?: (browserWindow: BrowserWindow) => void;
}

type SmokePageID = (typeof smokePages)[number];

interface SmokeRendererState {
  activePage: string | null;
  bodyLength: number;
  hasBridge: boolean;
  pageTitle: string | null;
}

interface SmokeUISnapshot {
  activePage: string;
  bodyLength: number;
  fingerprint: SmokeUIFingerprint;
  page: SmokePageID;
  pageTitle: string;
  screenshotByteLength?: number;
  screenshotHeight?: number;
  screenshotPath?: string;
  screenshotWidth?: number;
}

interface SmokeUIFingerprint {
  accounts?: {
    accountCount: number;
    actionButtons: string[];
    currentBadgeCount: number;
    hasSmokeAccount: boolean;
    hasSmokeEmail: boolean;
    toolbarButtons: string[];
  };
  navItemCount: number;
  proxy?: {
    actionButtons: string[];
    codeCopyButtonCount: number;
    endpointPaths: string[];
    formLabels: string[];
    modelChipCount: number;
    sectionHeadings: string[];
    statusText: string;
  };
  settings?: {
    footerButtons: string[];
    languageOptionCount: number;
    sectionHeadings: string[];
    selectLabels: string[];
    toggleLabels: string[];
  };
  sidebarBrand: string;
  sidebarStatus: string;
}

interface SmokeWorkflowState {
  persistence: SmokePersistenceState;
  proxyHealthOK: boolean;
  proxyPort: number;
  proxyUnauthorizedStatus: number;
  settingsLocale: string;
  switchedAccountId: string;
}

interface SmokePersistenceState {
  accountsCount: number;
  accountsJsonExists: boolean;
  codexAuthAccountId: string;
  codexAuthExists: boolean;
  currentSelectionAccountId: string | null;
  settingsJsonExists: boolean;
  settingsLocale: string;
  settingsProxyPort: number;
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
    width: 960,
    height: 536,
    minWidth: 900,
    minHeight: 520,
    maxWidth: 1080,
    backgroundColor: "#fafafc",
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
  trayService?.updateState({ accounts });
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
  const settings = await context.settingsCoordinator.currentSettings();
  const accounts = await context.accountsCoordinator.listAccounts();

  return new TrayService({
    adapter,
    initialState: { accounts, locale: settings.locale, proxyRunning: proxyState.isRunning },
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
    "<rect width=\"32\" height=\"32\" rx=\"7\" fill=\"#5933d6\"/>",
    "<path d=\"M10 16c0-4 2.7-6.8 6.7-6.8 2 0 3.7.7 5 2l-2.1 2.3c-.8-.8-1.7-1.2-2.9-1.2-2.1 0-3.5 1.5-3.5 3.7s1.4 3.7 3.5 3.7c1.3 0 2.3-.5 3.1-1.4l2.1 2.2c-1.3 1.5-3.1 2.3-5.3 2.3-3.9 0-6.6-2.8-6.6-6.8z\" fill=\"#ffffff\"/>",
    "</svg>"
  ].join("");
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

app.whenReady().then(async () => {
  const context = await createWindowsAppContext(app);
  registerIpcHandlers(ipcMain, context, {
    onAccountsChanged: publishAccounts,
    onProxyStateChanged(state) {
      trayService?.updateState({ proxyRunning: state.isRunning });
    },
    onSettingsChanged(settings) {
      trayService?.updateState({ locale: settings.locale });
    }
  });
  if (!isSmokeTest) {
    trayService = await createTray(context);
  }
  const smokeTest = isSmokeTest ? createSmokeTestController(context) : undefined;
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

function createSmokeTestController(context: WindowsAppContext): { attach: (browserWindow: BrowserWindow) => void } {
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
    writeSmokeResult({
      error: error instanceof Error ? error.message : String(error),
      status: "failed"
    });
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
      const workflows = await verifySmokeWorkflows(context);
      const uiSnapshots = await captureSmokeUISnapshots(browserWindow);
      writeSmokeResult({ state, uiSnapshots, workflows, status: "passed" });
      console.log(`CodexManager Windows smoke test passed: ${JSON.stringify({ state, uiSnapshots, workflows })}`);
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
        pageTitle: document.querySelector(".workspace .page-title")?.textContent?.trim() ?? null
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

async function waitForSmokePage(browserWindow: BrowserWindow, page: SmokePageID): Promise<SmokeRendererState> {
  const deadline = Date.now() + smokeTestTimeoutMs;
  let lastState: SmokeRendererState | undefined;
  while (Date.now() < deadline) {
    const state = await readRendererState(browserWindow);
    lastState = state;
    if (state.activePage === page && state.pageTitle === smokePageLabel(page) && state.bodyLength > 100) {
      return state;
    }
    await delay(100);
  }
  throw new Error(`Renderer did not activate ${page}: ${JSON.stringify(lastState)}`);
}

async function captureSmokeUISnapshots(browserWindow: BrowserWindow): Promise<SmokeUISnapshot[]> {
  const screenshotDirectory = smokeScreenshotDirectory();
  if (screenshotDirectory !== undefined) {
    mkdirSync(screenshotDirectory, { recursive: true });
  }
  if (!browserWindow.isVisible()) {
    browserWindow.show();
  }
  browserWindow.focus();

  const snapshots: SmokeUISnapshot[] = [];
  for (const page of smokePages) {
    await activateSmokePage(browserWindow, page);
    const state = await waitForSmokePage(browserWindow, page);
    const fingerprint = await waitForSmokeUIFingerprint(browserWindow, page);
    await delay(150);

    const snapshot: SmokeUISnapshot = {
      activePage: page,
      bodyLength: state.bodyLength,
      fingerprint,
      page,
      pageTitle: smokePageLabel(page)
    };
    if (screenshotDirectory !== undefined) {
      const screenshotPath = path.join(screenshotDirectory, `${page}.png`);
      const image = await browserWindow.capturePage();
      const png = image.toPNG();
      const size = image.getSize();
      if (png.byteLength === 0) {
        throw new Error(`Smoke screenshot for ${page} was empty`);
      }
      if (size.width <= 0 || size.height <= 0) {
        throw new Error(`Smoke screenshot for ${page} had invalid dimensions: ${size.width}x${size.height}`);
      }
      writeFileSync(screenshotPath, png);
      snapshot.screenshotByteLength = png.byteLength;
      snapshot.screenshotHeight = size.height;
      snapshot.screenshotPath = screenshotPath;
      snapshot.screenshotWidth = size.width;
    }
    snapshots.push(snapshot);
  }
  return snapshots;
}

async function waitForSmokeUIFingerprint(browserWindow: BrowserWindow, page: SmokePageID): Promise<SmokeUIFingerprint> {
  const deadline = Date.now() + smokeTestTimeoutMs;
  let lastFingerprint: SmokeUIFingerprint | undefined;
  while (Date.now() < deadline) {
    const fingerprint = await readSmokeUIFingerprint(browserWindow);
    lastFingerprint = fingerprint;
    if (smokeUIFingerprintReady(fingerprint, page)) {
      return fingerprint;
    }
    await delay(100);
  }
  throw new Error(`Renderer did not expose the expected ${page} UI fingerprint: ${JSON.stringify(lastFingerprint)}`);
}

async function readSmokeUIFingerprint(browserWindow: BrowserWindow): Promise<SmokeUIFingerprint> {
  const value = await browserWindow.webContents.executeJavaScript(
    `(() => {
      const text = (selector) => Array.from(document.querySelectorAll(selector))
        .map((element) => element.textContent?.trim() ?? "")
        .filter((value) => value.length > 0);
      const labels = (selector) => Array.from(document.querySelectorAll(selector))
        .map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "")
        .filter((value) => value.length > 0);
      const endpointPaths = Array.from(document.querySelectorAll(".endpoint-row code"))
        .map((element) => element.textContent?.trim() ?? "")
        .filter((value) => value.length > 0);
      const bodyText = document.body?.innerText ?? "";
      const fingerprint = {
        navItemCount: document.querySelectorAll(".nav-list .nav-item").length,
        sidebarBrand: document.querySelector(".brand-block h1")?.textContent?.trim() ?? "",
        sidebarStatus: document.querySelector(".sidebar-status-row")?.textContent?.trim() ?? ""
      };

      if (document.querySelector(".accounts-layout")) {
        fingerprint.accounts = {
          accountCount: document.querySelectorAll(".account-row").length,
          actionButtons: labels(".account-actions button"),
          currentBadgeCount: Array.from(document.querySelectorAll(".badge")).filter((element) => element.textContent?.trim() === "CURRENT").length,
          hasSmokeAccount: bodyText.includes("Smoke account") || bodyText.includes("Smoke Team") || bodyText.includes("smoke@example.com"),
          hasSmokeEmail: bodyText.includes("smoke@example.com"),
          toolbarButtons: labels(".toolbar button")
        };
      }

      if (document.querySelector(".proxy-layout")) {
        fingerprint.proxy = {
          actionButtons: labels(".proxy-actions button"),
          codeCopyButtonCount: document.querySelectorAll(".code-copy-button").length,
          endpointPaths,
          formLabels: labels(".proxy-form-row label, .api-key-field label"),
          modelChipCount: document.querySelectorAll(".model-chip").length,
          sectionHeadings: text(".proxy-layout h2, .proxy-layout h3"),
          statusText: document.querySelector(".status-pill")?.textContent?.trim() ?? ""
        };
      }

      if (document.querySelector(".settings-layout")) {
        fingerprint.settings = {
          footerButtons: labels(".settings-footer button"),
          languageOptionCount: document.querySelectorAll("select[aria-label='Language'] option").length,
          sectionHeadings: text(".settings-layout h2, .settings-layout h3"),
          selectLabels: labels(".select-row label"),
          toggleLabels: labels(".toggle-row label")
        };
      }

      return fingerprint;
    })()`,
    true
  );
  if (!isSmokeUIFingerprint(value)) {
    throw new Error(`Unexpected renderer smoke UI fingerprint: ${JSON.stringify(value)}`);
  }
  return value;
}

function smokeUIFingerprintReady(fingerprint: SmokeUIFingerprint, page: SmokePageID): boolean {
  if (fingerprint.navItemCount !== 3 || fingerprint.sidebarBrand !== appInfo.displayName || !fingerprint.sidebarStatus.includes("Proxy:")) {
    return false;
  }
  if (page === "accounts") {
    return (
      fingerprint.accounts !== undefined &&
      fingerprint.accounts.accountCount === 1 &&
      fingerprint.accounts.currentBadgeCount === 1 &&
      fingerprint.accounts.hasSmokeAccount &&
      fingerprint.accounts.hasSmokeEmail &&
      includesAll(fingerprint.accounts.toolbarButtons, [
        "Export accounts",
        "Import file",
        "Import current auth",
        "Add account",
        "Smart switch",
        "Warm up weekly quota"
      ]) &&
      includesAll(fingerprint.accounts.actionButtons, ["Switch", "Refresh", "Delete"])
    );
  }
  if (page === "proxy") {
    return (
      fingerprint.proxy !== undefined &&
      includesAll(fingerprint.proxy.sectionHeadings, ["Proxy", "Proxy Control", "Endpoints", "Available Models", "Usage"]) &&
      includesAll(fingerprint.proxy.endpointPaths, ["/v1/chat/completions", "/v1/responses", "/v1/messages"]) &&
      includesAll(fingerprint.proxy.formLabels, ["Port", "API key"]) &&
      includesAll(fingerprint.proxy.actionButtons, ["Start"]) &&
      fingerprint.proxy.codeCopyButtonCount === 2 &&
      fingerprint.proxy.modelChipCount >= 3 &&
      fingerprint.proxy.statusText === "Stopped"
    );
  }
  return (
    fingerprint.settings !== undefined &&
    includesAll(fingerprint.settings.sectionHeadings, ["Settings", "General", "Switch Behavior", "Language"]) &&
    includesAll(fingerprint.settings.toggleLabels, [
      "Launch at startup",
      "Auto-start API proxy on launch",
      "Launch Codex after switch",
      "Auto smart switch",
      "Restart editors on switch"
    ]) &&
    includesAll(fingerprint.settings.selectLabels, ["Editor restart target", "Language"]) &&
    includesAll(fingerprint.settings.footerButtons, ["GitHub Star", "Quit"]) &&
    fingerprint.settings.languageOptionCount === 11
  );
}

function includesAll(values: readonly string[], expectedValues: readonly string[]): boolean {
  return expectedValues.every((expected) => values.includes(expected));
}

function isSmokeUIFingerprint(value: unknown): value is SmokeUIFingerprint {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.navItemCount === "number" &&
    typeof value.sidebarBrand === "string" &&
    typeof value.sidebarStatus === "string"
  );
}

async function activateSmokePage(browserWindow: BrowserWindow, page: SmokePageID): Promise<void> {
  const label = smokePageLabel(page);
  const didClick = await browserWindow.webContents.executeJavaScript(
    `(() => {
      const buttons = Array.from(document.querySelectorAll(".nav-list button"));
      const button = buttons.find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }
      button.click();
      return true;
    })()`,
    true
  );
  if (didClick !== true) {
    throw new Error(`Smoke navigation button was not found for ${page}`);
  }
}

function smokePageLabel(page: SmokePageID): string {
  if (page === "accounts") {
    return "Accounts";
  }
  if (page === "proxy") {
    return "Proxy";
  }
  return "Settings";
}

function smokeScreenshotDirectory(): string | undefined {
  const value = process.env.CODEX_MANAGER_ELECTRON_SMOKE_SCREENSHOT_DIR;
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

async function verifySmokeWorkflows(context: WindowsAppContext): Promise<SmokeWorkflowState> {
  const smokeAccountId = "smoke-account";
  const smokeChatGPTAccountId = "acct-smoke";
  const smokeEmail = "smoke@example.com";
  const authJson = makeSmokeAuth(smokeChatGPTAccountId, smokeEmail);
  const now = Math.floor(Date.now() / 1000);
  const account: StoredAccount = {
    id: smokeAccountId,
    label: "Smoke account",
    email: smokeEmail,
    accountId: smokeChatGPTAccountId,
    planType: "plus",
    teamName: "Smoke Team",
    authJson,
    addedAt: now,
    updatedAt: now,
    principalId: smokeEmail
  };

  await context.storeRepository.saveStore({
    version: 1,
    accounts: [account]
  });
  await context.accountsCoordinator.switchAccount(smokeAccountId);
  publishAccounts(await context.accountsCoordinator.listAccounts());

  const currentAuth = context.authRepository.extractAuth(await context.authRepository.readCurrentAuth());
  if (currentAuth.accountId !== smokeChatGPTAccountId) {
    throw new Error(`Smoke account switch wrote ${currentAuth.accountId}, expected ${smokeChatGPTAccountId}`);
  }

  await context.settingsCoordinator.updateSettings({
    locale: "en",
    proxyPort: 0,
    proxyApiKey: "sk-local-smoke"
  });
  const settings = await context.settingsCoordinator.currentSettings();
  if (settings.locale !== "en" || settings.proxyApiKey !== "sk-local-smoke") {
    throw new Error(`Smoke settings did not persist: ${JSON.stringify(settings)}`);
  }

  const proxyState = await context.proxyRuntimeService.start(0, "sk-local-smoke");
  try {
    const healthResponse = await fetch(`${proxyState.proxyURL}/health`);
    const healthBody = await healthResponse.json() as { status?: unknown };
    if (!healthResponse.ok || healthBody.status !== "ok") {
      throw new Error(`Smoke proxy health failed with ${healthResponse.status}: ${JSON.stringify(healthBody)}`);
    }

    const unauthorizedResponse = await fetch(`${proxyState.proxyURL}/v1/responses`, {
      body: JSON.stringify({ input: [], model: "gpt-5" }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    if (unauthorizedResponse.status !== 401) {
      throw new Error(`Smoke proxy auth expected 401, got ${unauthorizedResponse.status}`);
    }

    const persistence = readSmokePersistenceState(context, smokeChatGPTAccountId);
    if (
      !persistence.accountsJsonExists ||
      !persistence.settingsJsonExists ||
      !persistence.codexAuthExists ||
      persistence.accountsCount !== 1 ||
      persistence.currentSelectionAccountId !== smokeChatGPTAccountId ||
      persistence.codexAuthAccountId !== smokeChatGPTAccountId ||
      persistence.settingsLocale !== "en" ||
      persistence.settingsProxyPort !== 0
    ) {
      throw new Error(`Smoke persistence check failed: ${JSON.stringify(persistence)}`);
    }

    return {
      persistence,
      proxyHealthOK: true,
      proxyPort: proxyState.port,
      proxyUnauthorizedStatus: unauthorizedResponse.status,
      settingsLocale: settings.locale,
      switchedAccountId: currentAuth.accountId
    };
  } finally {
    await context.proxyRuntimeService.stop();
  }
}

function readSmokePersistenceState(context: WindowsAppContext, expectedAccountId: string): SmokePersistenceState {
  const accountsJsonExists = existsSync(context.paths.accountStorePath);
  const settingsJsonExists = existsSync(context.paths.settingsStorePath);
  const codexAuthExists = existsSync(context.paths.codexAuthPath);
  const accountStore = accountsJsonExists ? readJSONFile(context.paths.accountStorePath) : {};
  const settingsStore = settingsJsonExists ? readJSONFile(context.paths.settingsStorePath) : {};
  const codexAuth = codexAuthExists ? readJSONFile(context.paths.codexAuthPath) : {};
  const accountStoreObject = isRecord(accountStore) ? accountStore : {};
  const settingsObject = isRecord(settingsStore) ? settingsStore : {};
  const currentSelection = isRecord(accountStoreObject.currentSelection) ? accountStoreObject.currentSelection : {};
  const accounts = Array.isArray(accountStoreObject.accounts) ? accountStoreObject.accounts : [];
  const extractedAuth = codexAuthExists
    ? context.authRepository.extractAuth(codexAuth)
    : { accountId: "" };
  const codexAuthAccountId = extractedAuth.accountId ?? "";
  if (codexAuthExists && codexAuthAccountId !== expectedAccountId) {
    throw new Error(`Smoke persisted auth account is ${codexAuthAccountId}, expected ${expectedAccountId}`);
  }

  return {
    accountsCount: accounts.length,
    accountsJsonExists,
    codexAuthAccountId,
    codexAuthExists,
    currentSelectionAccountId: typeof currentSelection.accountId === "string" ? currentSelection.accountId : null,
    settingsJsonExists,
    settingsLocale: typeof settingsObject.locale === "string" ? settingsObject.locale : "",
    settingsProxyPort: typeof settingsObject.proxyPort === "number" ? settingsObject.proxyPort : 0
  };
}

function readJSONFile(filePath: string): JSONValue {
  return JSON.parse(readFileSync(filePath, "utf8")) as JSONValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeSmokeAuth(accountId: string, email: string): JSONValue {
  return {
    auth_mode: "chatgpt",
    last_refresh: new Date(0).toISOString(),
    tokens: {
      access_token: "smoke-access-token",
      account_id: accountId,
      id_token: makeSmokeJwt({
        email,
        sub: email,
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId,
          chatgpt_plan_type: "plus",
          chatgpt_team_name: "Smoke Team"
        }
      }),
      principal_id: email,
      refresh_token: "smoke-refresh-token"
    }
  };
}

function makeSmokeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
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

function writeSmokeResult(result: {
  error?: string;
  state?: SmokeRendererState;
  status: "failed" | "passed";
  uiSnapshots?: SmokeUISnapshot[];
  workflows?: SmokeWorkflowState;
}): void {
  const resultPath = process.env.CODEX_MANAGER_ELECTRON_SMOKE_RESULT_PATH;
  if (!resultPath) {
    return;
  }
  mkdirSync(path.dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result)}\n`, "utf8");
}
