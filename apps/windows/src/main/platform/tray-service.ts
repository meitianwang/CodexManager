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
  proxyRunning: false
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
    const proxyItem: TrayMenuItem = this.state.proxyRunning
      ? this.actionItem("stopProxy", "Stop Proxy")
      : this.actionItem("startProxy", "Start Proxy");

    this.adapter.setContextMenu([
      this.actionItem("showWindow", "Show Window"),
      separator(),
      this.actionItem("refreshAccounts", "Refresh Accounts"),
      this.actionItem("smartSwitch", "Smart Switch"),
      proxyItem,
      separator(),
      this.actionItem("quit", "Quit", true)
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
