import type { AppLocaleID } from "../../shared/models/settings";

export type TrayActionID = "showWindow" | "refreshAccounts" | "smartSwitch" | "startProxy" | "stopProxy" | "quit";

export interface TrayMenuItem {
  id?: TrayActionID;
  label?: string;
  type?: "normal" | "separator";
  enabled?: boolean;
  click?: () => void;
}

export interface TrayAdapter {
  destroy?(): void;
  onPrimaryClick?(handler: () => void): void;
  setContextMenu(items: readonly TrayMenuItem[]): void;
  setToolTip(value: string): void;
}

export interface TrayServiceActions {
  showWindow(): void | Promise<void>;
  refreshAccounts(): void | Promise<void>;
  smartSwitch(): void | Promise<void>;
  startProxy(): void | Promise<void>;
  stopProxy(): void | Promise<void>;
  quit(): void | Promise<void>;
}

export interface TrayServiceState {
  busy: boolean;
  locale: AppLocaleID;
  proxyRunning: boolean;
}

export interface TrayServiceOptions {
  actions: TrayServiceActions;
  adapter: TrayAdapter;
  initialState?: Partial<TrayServiceState>;
  onActionError?: (action: TrayActionID, error: unknown) => void;
  tooltip?: string;
}

const defaultState: TrayServiceState = {
  busy: false,
  locale: "en",
  proxyRunning: false
};

type TrayMessageKey = "showWindow" | "refreshAccounts" | "smartSwitch" | "startProxy" | "stopProxy" | "quit";

const trayMessages: Record<AppLocaleID, Record<TrayMessageKey, string>> = {
  en: {
    showWindow: "Show Window",
    refreshAccounts: "Refresh Accounts",
    smartSwitch: "Smart Switch",
    startProxy: "Start Proxy",
    stopProxy: "Stop Proxy",
    quit: "Quit"
  },
  "zh-Hans": {
    showWindow: "显示窗口",
    refreshAccounts: "刷新账号",
    smartSwitch: "智能切换",
    startProxy: "启动代理",
    stopProxy: "停止代理",
    quit: "退出"
  },
  "zh-Hant": {
    showWindow: "顯示視窗",
    refreshAccounts: "重新整理帳號",
    smartSwitch: "智慧切換",
    startProxy: "啟動代理",
    stopProxy: "停止代理",
    quit: "退出"
  },
  ja: {
    showWindow: "ウィンドウを表示",
    refreshAccounts: "アカウントを更新",
    smartSwitch: "スマート切替",
    startProxy: "プロキシを開始",
    stopProxy: "プロキシを停止",
    quit: "終了"
  },
  ko: {
    showWindow: "창 표시",
    refreshAccounts: "계정 새로고침",
    smartSwitch: "스마트 전환",
    startProxy: "프록시 시작",
    stopProxy: "프록시 중지",
    quit: "종료"
  },
  fr: {
    showWindow: "Afficher la fenetre",
    refreshAccounts: "Actualiser les comptes",
    smartSwitch: "Bascule intelligente",
    startProxy: "Demarrer le proxy",
    stopProxy: "Arreter le proxy",
    quit: "Quitter"
  },
  de: {
    showWindow: "Fenster anzeigen",
    refreshAccounts: "Konten aktualisieren",
    smartSwitch: "Smart wechseln",
    startProxy: "Proxy starten",
    stopProxy: "Proxy stoppen",
    quit: "Beenden"
  },
  it: {
    showWindow: "Mostra finestra",
    refreshAccounts: "Aggiorna account",
    smartSwitch: "Cambio smart",
    startProxy: "Avvia proxy",
    stopProxy: "Ferma proxy",
    quit: "Esci"
  },
  es: {
    showWindow: "Mostrar ventana",
    refreshAccounts: "Actualizar cuentas",
    smartSwitch: "Cambio inteligente",
    startProxy: "Iniciar proxy",
    stopProxy: "Detener proxy",
    quit: "Salir"
  },
  ru: {
    showWindow: "Показать окно",
    refreshAccounts: "Обновить аккаунты",
    smartSwitch: "Умное переключение",
    startProxy: "Запустить прокси",
    stopProxy: "Остановить прокси",
    quit: "Выйти"
  },
  nl: {
    showWindow: "Venster tonen",
    refreshAccounts: "Accounts vernieuwen",
    smartSwitch: "Slim wisselen",
    startProxy: "Proxy starten",
    stopProxy: "Proxy stoppen",
    quit: "Afsluiten"
  }
};

export class TrayService {
  private state: TrayServiceState;
  private readonly actions: TrayServiceActions;
  private readonly adapter: TrayAdapter;
  private readonly onActionError: (action: TrayActionID, error: unknown) => void;

  constructor(options: TrayServiceOptions) {
    this.actions = options.actions;
    this.adapter = options.adapter;
    this.onActionError = options.onActionError ?? (() => undefined);
    this.state = {
      ...defaultState,
      ...options.initialState
    };

    this.adapter.setToolTip(options.tooltip ?? "CodexManager");
    this.adapter.onPrimaryClick?.(() => {
      void this.runAction("showWindow");
    });
    this.render();
  }

  updateState(patch: Partial<TrayServiceState>): void {
    this.state = {
      ...this.state,
      ...patch
    };
    this.render();
  }

  destroy(): void {
    this.adapter.destroy?.();
  }

  private render(): void {
    const t = trayMessages[this.state.locale];
    const proxyItem: TrayMenuItem = this.state.proxyRunning
      ? this.actionItem("stopProxy", t.stopProxy)
      : this.actionItem("startProxy", t.startProxy);

    this.adapter.setContextMenu([
      this.actionItem("showWindow", t.showWindow),
      separator(),
      this.actionItem("refreshAccounts", t.refreshAccounts),
      this.actionItem("smartSwitch", t.smartSwitch),
      proxyItem,
      separator(),
      this.actionItem("quit", t.quit, true)
    ]);
  }

  private actionItem(id: TrayActionID, label: string, alwaysEnabled = false): TrayMenuItem {
    return {
      id,
      label,
      type: "normal",
      enabled: alwaysEnabled || !this.state.busy,
      click: () => {
        void this.runAction(id);
      }
    };
  }

  private async runAction(id: TrayActionID): Promise<void> {
    try {
      await this.actions[id]();
    } catch (error) {
      this.onActionError(id, error);
    }
  }
}

function separator(): TrayMenuItem {
  return { type: "separator" };
}
