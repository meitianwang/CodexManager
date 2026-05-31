import type { AppLocaleID } from "../../shared/models/settings";
import type { AccountSummary } from "../../shared/models/accounts";
import type { UsageWindow } from "../../shared/models/usage";

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
  accounts: AccountSummary[];
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
  accounts: [],
  busy: false,
  locale: "en",
  proxyRunning: false
};

type TrayMessageKey =
  | "showWindow"
  | "refreshAccounts"
  | "smartSwitch"
  | "startProxy"
  | "stopProxy"
  | "quit"
  | "currentAccount"
  | "noAccount"
  | "accountsCount"
  | "remaining"
  | "titlePlaceholder"
  | "title";

const trayMessages: Record<AppLocaleID, Record<TrayMessageKey, string>> = {
  en: {
    showWindow: "Open Main Panel",
    refreshAccounts: "Refresh Accounts",
    smartSwitch: "Smart Switch",
    startProxy: "Start Proxy",
    stopProxy: "Stop Proxy",
    quit: "Quit",
    currentAccount: "Using: {account}",
    noAccount: "No account selected",
    accountsCount: "{count} accounts",
    remaining: "{remaining} remaining",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  "zh-Hans": {
    showWindow: "打开主面板",
    refreshAccounts: "刷新账号",
    smartSwitch: "智能切换",
    startProxy: "启动代理",
    stopProxy: "停止代理",
    quit: "退出",
    currentAccount: "正在使用：{account}",
    noAccount: "未选择账号",
    accountsCount: "{count} 个账号",
    remaining: "剩余 {remaining}",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  "zh-Hant": {
    showWindow: "顯示視窗",
    refreshAccounts: "重新整理帳號",
    smartSwitch: "智慧切換",
    startProxy: "啟動代理",
    stopProxy: "停止代理",
    quit: "退出",
    currentAccount: "正在使用：{account}",
    noAccount: "未選擇帳號",
    accountsCount: "{count} 個帳號",
    remaining: "剩餘 {remaining}",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  ja: {
    showWindow: "メインパネルを開く",
    refreshAccounts: "アカウントを更新",
    smartSwitch: "スマート切替",
    startProxy: "プロキシを開始",
    stopProxy: "プロキシを停止",
    quit: "終了",
    currentAccount: "使用中: {account}",
    noAccount: "アカウント未選択",
    accountsCount: "{count} 個のアカウント",
    remaining: "残り {remaining}",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  ko: {
    showWindow: "메인 패널 열기",
    refreshAccounts: "계정 새로고침",
    smartSwitch: "스마트 전환",
    startProxy: "프록시 시작",
    stopProxy: "프록시 중지",
    quit: "종료",
    currentAccount: "사용 중: {account}",
    noAccount: "선택된 계정 없음",
    accountsCount: "{count}개 계정",
    remaining: "{remaining} 남음",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  fr: {
    showWindow: "Afficher la fenetre",
    refreshAccounts: "Actualiser les comptes",
    smartSwitch: "Bascule intelligente",
    startProxy: "Demarrer le proxy",
    stopProxy: "Arreter le proxy",
    quit: "Quitter",
    currentAccount: "Utilise : {account}",
    noAccount: "Aucun compte selectionne",
    accountsCount: "{count} comptes",
    remaining: "{remaining} restant",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  de: {
    showWindow: "Fenster anzeigen",
    refreshAccounts: "Konten aktualisieren",
    smartSwitch: "Smart wechseln",
    startProxy: "Proxy starten",
    stopProxy: "Proxy stoppen",
    quit: "Beenden",
    currentAccount: "Aktiv: {account}",
    noAccount: "Kein Konto ausgewahlt",
    accountsCount: "{count} Konten",
    remaining: "{remaining} verbleibend",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  it: {
    showWindow: "Mostra finestra",
    refreshAccounts: "Aggiorna account",
    smartSwitch: "Cambio smart",
    startProxy: "Avvia proxy",
    stopProxy: "Ferma proxy",
    quit: "Esci",
    currentAccount: "In uso: {account}",
    noAccount: "Nessun account selezionato",
    accountsCount: "{count} account",
    remaining: "{remaining} rimanente",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  es: {
    showWindow: "Mostrar ventana",
    refreshAccounts: "Actualizar cuentas",
    smartSwitch: "Cambio inteligente",
    startProxy: "Iniciar proxy",
    stopProxy: "Detener proxy",
    quit: "Salir",
    currentAccount: "En uso: {account}",
    noAccount: "No hay cuenta seleccionada",
    accountsCount: "{count} cuentas",
    remaining: "{remaining} restante",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  ru: {
    showWindow: "Показать окно",
    refreshAccounts: "Обновить аккаунты",
    smartSwitch: "Умное переключение",
    startProxy: "Запустить прокси",
    stopProxy: "Остановить прокси",
    quit: "Выйти",
    currentAccount: "Используется: {account}",
    noAccount: "Аккаунт не выбран",
    accountsCount: "Аккаунтов: {count}",
    remaining: "Осталось {remaining}",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  },
  nl: {
    showWindow: "Venster tonen",
    refreshAccounts: "Accounts vernieuwen",
    smartSwitch: "Slim wisselen",
    startProxy: "Proxy starten",
    stopProxy: "Proxy stoppen",
    quit: "Afsluiten",
    currentAccount: "Actief: {account}",
    noAccount: "Geen account geselecteerd",
    accountsCount: "{count} accounts",
    remaining: "{remaining} resterend",
    titlePlaceholder: "5h -- / 1w --",
    title: "5h {five} / 1w {week}"
  }
};

export class TrayService {
  private state: TrayServiceState;
  private readonly actions: TrayServiceActions;
  private readonly adapter: TrayAdapter;
  private readonly onActionError: (action: TrayActionID, error: unknown) => void;
  private readonly tooltipPrefix: string;

  constructor(options: TrayServiceOptions) {
    this.actions = options.actions;
    this.adapter = options.adapter;
    this.onActionError = options.onActionError ?? (() => undefined);
    this.tooltipPrefix = options.tooltip ?? "CodexManager";
    this.state = {
      ...defaultState,
      ...options.initialState
    };

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
    const currentAccount = this.state.accounts.find((account) => account.isCurrent);
    const proxyItem: TrayMenuItem = this.state.proxyRunning
      ? this.actionItem("stopProxy", t.stopProxy)
      : this.actionItem("startProxy", t.startProxy);

    this.adapter.setToolTip(`${this.tooltipPrefix} - ${trayTitle(currentAccount, t)}`);
    this.adapter.setContextMenu([
      this.actionItem("showWindow", t.showWindow),
      separator(),
      ...this.statusItems(currentAccount, t),
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

  private statusItems(currentAccount: AccountSummary | undefined, t: Record<TrayMessageKey, string>): TrayMenuItem[] {
    const items: TrayMenuItem[] = [];
    if (currentAccount) {
      items.push(disabledItem(formatMessage(t.currentAccount, { account: accountDisplayName(currentAccount) })));
    } else {
      items.push(disabledItem(t.noAccount));
    }

    items.push(disabledItem(formatMessage(t.accountsCount, { count: String(this.state.accounts.length) })));

    if (currentAccount) {
      items.push(disabledItem(formatMessage(t.remaining, { remaining: percent(remainingValue(currentAccount.usage?.fiveHour)) })));
    }
    return items;
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

function disabledItem(label: string): TrayMenuItem {
  return {
    label,
    type: "normal",
    enabled: false
  };
}

function trayTitle(currentAccount: AccountSummary | undefined, t: Record<TrayMessageKey, string>): string {
  if (!currentAccount) {
    return t.titlePlaceholder;
  }
  return formatMessage(t.title, {
    five: percent(remainingValue(currentAccount.usage?.fiveHour)),
    week: percent(remainingValue(currentAccount.usage?.oneWeek))
  });
}

function accountDisplayName(account: AccountSummary): string {
  return account.email ?? account.label;
}

function remainingValue(window: UsageWindow | undefined): number | undefined {
  if (!window) {
    return undefined;
  }
  return Math.max(0, 100 - window.usedPercent);
}

function percent(value: number | undefined): string {
  if (value === undefined) {
    return "--";
  }
  return `${Math.round(value)}%`;
}

function formatMessage(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}
