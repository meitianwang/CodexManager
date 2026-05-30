import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { JSONValue } from "../../shared/models/json-value";
import type { AccountsImportResult, AccountsTransferPackage } from "../../shared/models/account-transfer";
import {
  accountsTransferCurrentVersion,
  accountsTransferFormatIdentifier
} from "../../shared/models/account-transfer";
import type { AccountSummary, AccountsStore, StoredAccount } from "../../shared/models/accounts";
import type { ChatGPTOAuthTokens, ExtractedAuth } from "../../shared/models/auth";
import type { SmartSwitchResult, SwitchAccountExecutionResult } from "../../shared/models/app";
import { idleSwitchAccountExecutionResult } from "../../shared/models/app";
import type { AppSettings, EditorAppID } from "../../shared/models/settings";
import type { UsageSnapshot } from "../../shared/models/usage";
import { accountKeyForExtractedAuth, accountKeyForStoredAccount, preferredMatchIndex } from "../../shared/domain/account-identity";
import { preferredPlanType } from "../../shared/domain/account-plan-resolver";
import { accountSummaries, toAccountSummary } from "../../shared/domain/accounts-store";
import { pickAutoSwitchTarget, sortByRemaining } from "../../shared/domain/account-ranking";
import { applyAccountsTransferMerge } from "../../shared/domain/accounts-transfer-merge";
import { stableStringify } from "../repositories/stable-json";
import { parseAccountsTransferPackage } from "../repositories/store-parsers";

export interface AccountsStoreRepositoryLike {
  loadStore(): Promise<AccountsStore>;
  saveStore(store: AccountsStore): Promise<void>;
}

export interface AuthRepositoryLike {
  readCurrentAuth(): Promise<JSONValue>;
  readCurrentAuthOptional(): Promise<JSONValue | undefined>;
  readAuth(path: string): Promise<JSONValue>;
  writeCurrentAuth(auth: JSONValue): Promise<void>;
  makeChatGPTAuth(tokens: ChatGPTOAuthTokens): JSONValue;
  replacingChatGPTTokens(auth: JSONValue, tokens: ChatGPTOAuthTokens): JSONValue;
  extractAuth(auth: JSONValue): ExtractedAuth;
}

export interface UsageServiceLike {
  fetchUsage(accessToken: string, accountId: string): Promise<UsageSnapshot>;
}

export interface SettingsRepositoryLike {
  loadSettings(): Promise<AppSettings>;
}

export interface ChatGPTOAuthLoginServiceLike {
  signInWithChatGPT(timeoutSeconds: number, allowedWorkspaceId?: string): Promise<ChatGPTOAuthTokens>;
}

export interface CodexCLIServiceLike {
  launchApp(workspacePath?: string): Promise<boolean>;
}

export interface EditorAppServiceLike {
  restartSelectedApps(
    targets: readonly EditorAppID[]
  ): Promise<{ restarted: EditorAppID[]; error?: string }> | { restarted: EditorAppID[]; error?: string };
}

export interface DateProviderLike {
  unixSecondsNow(): number;
  unixMillisecondsNow(): number;
}

export interface AccountsCoordinatorOptions {
  storeRepository: AccountsStoreRepositoryLike;
  authRepository: AuthRepositoryLike;
  settingsRepository?: SettingsRepositoryLike;
  usageService?: UsageServiceLike;
  chatGPTOAuthLoginService?: ChatGPTOAuthLoginServiceLike;
  codexCLIService?: CodexCLIServiceLike;
  editorAppService?: EditorAppServiceLike;
  dateProvider?: DateProviderLike;
  sourceDeviceID?: string;
}

export class AccountsCoordinator {
  private readonly storeRepository: AccountsStoreRepositoryLike;
  private readonly authRepository: AuthRepositoryLike;
  private readonly settingsRepository?: SettingsRepositoryLike;
  private readonly usageService?: UsageServiceLike;
  private readonly chatGPTOAuthLoginService?: ChatGPTOAuthLoginServiceLike;
  private readonly codexCLIService?: CodexCLIServiceLike;
  private readonly editorAppService?: EditorAppServiceLike;
  private readonly dateProvider: DateProviderLike;
  private readonly sourceDeviceID: string;

  constructor(options: AccountsCoordinatorOptions) {
    this.storeRepository = options.storeRepository;
    this.authRepository = options.authRepository;
    this.settingsRepository = options.settingsRepository;
    this.usageService = options.usageService;
    this.chatGPTOAuthLoginService = options.chatGPTOAuthLoginService;
    this.codexCLIService = options.codexCLIService;
    this.editorAppService = options.editorAppService;
    this.dateProvider =
      options.dateProvider ??
      {
        unixSecondsNow: () => Math.floor(Date.now() / 1000),
        unixMillisecondsNow: () => Date.now()
      };
    this.sourceDeviceID = options.sourceDeviceID ?? "windows-local";
  }

  async listAccounts(): Promise<AccountSummary[]> {
    const store = await this.storeRepository.loadStore();
    const didReconcileCurrentAuth = await this.reconcileCurrentAuthSnapshot(store);
    const didReconcile = this.reconcileStoredAccountMetadata(store);
    if (didReconcileCurrentAuth || didReconcile) {
      await this.storeRepository.saveStore(store);
    }
    return accountSummaries(store, await this.currentAuthAccountKey());
  }

  async importCurrentAuthAccount(customLabel?: string): Promise<AccountSummary> {
    return this.importAccount(await this.authRepository.readCurrentAuth(), customLabel);
  }

  async importAccountFile(path: string, customLabel: string | undefined, setAsCurrent: boolean): Promise<AccountSummary> {
    const authJson = await this.authRepository.readAuth(path);
    if (setAsCurrent) {
      await this.authRepository.writeCurrentAuth(authJson);
    }
    return this.importAccount(authJson, customLabel);
  }

  async addAccountViaLogin(customLabel?: string, timeoutSeconds = 10 * 60): Promise<AccountSummary> {
    if (!this.chatGPTOAuthLoginService) {
      throw new Error("ChatGPT OAuth login service is unavailable");
    }
    const tokens = await this.chatGPTOAuthLoginService.signInWithChatGPT(timeoutSeconds);
    return this.importAccount(this.authRepository.makeChatGPTAuth(tokens), customLabel);
  }

  async deleteAccount(id: string): Promise<void> {
    const store = await this.storeRepository.loadStore();
    store.accounts = store.accounts.filter((account) => account.id !== id);
    await this.storeRepository.saveStore(store);
  }

  async updateTeamAlias(id: string, alias: string | undefined): Promise<AccountSummary> {
    const store = await this.storeRepository.loadStore();
    const index = store.accounts.findIndex((account) => account.id === id);
    const account = store.accounts[index];
    if (index < 0 || !account) {
      throw new Error("Account was not found for update");
    }

    account.teamAlias = normalizeTeamName(alias);
    account.updatedAt = this.dateProvider.unixSecondsNow();
    await this.storeRepository.saveStore(store);
    return toAccountSummary(account, await this.currentAuthAccountKey());
  }

  async switchAccount(id: string): Promise<void> {
    const account = await this.prepareStoredAccountForSwitch(id);
    await this.updateCurrentAccountProjection(account.authJson);
  }

  async refreshAccountUsage(id: string): Promise<AccountSummary> {
    if (!this.usageService) {
      throw new Error("Usage service is unavailable");
    }

    const store = await this.storeRepository.loadStore();
    const index = store.accounts.findIndex((account) => account.id === id);
    const account = store.accounts[index];
    if (index < 0 || !account) {
      throw new Error("Account was not found for usage refresh");
    }

    const extracted = this.authRepository.extractAuth(account.authJson);
    const { usage, usageError } = await this.fetchUsage(extracted);
    account.usage = usage ?? account.usage;
    account.usageError = usageError;
    account.updatedAt = this.dateProvider.unixSecondsNow();
    store.accounts[index] = account;
    await this.storeRepository.saveStore(store);
    return toAccountSummary(account, await this.currentAuthAccountKey());
  }

  async refreshAllUsage(): Promise<AccountSummary[]> {
    const accounts = await this.listAccounts();
    for (const account of accounts) {
      await this.refreshAccountUsage(account.id);
    }
    return this.listAccounts();
  }

  async switchAccountAndApplySettings(id: string, workspacePath?: string): Promise<SwitchAccountExecutionResult> {
    const account = await this.prepareStoredAccountForSwitch(id);
    await this.updateCurrentAccountProjection(account.authJson);
    const settings = await this.settingsRepository?.loadSettings();
    if (!settings) {
      return { ...idleSwitchAccountExecutionResult };
    }
    return this.applySwitchSideEffects(settings, workspacePath);
  }

  async smartSwitch(): Promise<SmartSwitchResult | undefined> {
    const sorted = sortByRemaining(await this.listAccounts());
    const best = sorted[0];
    if (!best) {
      return undefined;
    }

    const execution = await this.switchAccountAndApplySettings(best.id);
    return { account: best, execution };
  }

  async autoSmartSwitchIfNeeded(): Promise<SmartSwitchResult | undefined> {
    const target = pickAutoSwitchTarget(await this.listAccounts());
    if (!target) {
      return undefined;
    }

    const execution = await this.switchAccountAndApplySettings(target.id);
    return { account: target, execution };
  }

  async makeAccountsTransferPackage(accountIds: ReadonlySet<string>): Promise<AccountsTransferPackage> {
    if (accountIds.size === 0) {
      throw new Error("No accounts were selected");
    }

    const store = await this.storeRepository.loadStore();
    const selectedAccounts = store.accounts.filter((account) => accountIds.has(account.id));
    if (selectedAccounts.length === 0) {
      throw new Error("Selected accounts package is empty");
    }

    return {
      format: accountsTransferFormatIdentifier,
      version: accountsTransferCurrentVersion,
      exportedAt: this.dateProvider.unixSecondsNow(),
      accounts: selectedAccounts
    };
  }

  async encodeAccountsTransferPackage(accountIds: ReadonlySet<string>): Promise<string> {
    return stableStringify(await this.makeAccountsTransferPackage(accountIds));
  }

  async loadAccountsTransferPackage(path: string): Promise<AccountsTransferPackage> {
    const packageJson = parseAccountsTransferPackage(JSON.parse(await readFile(path, "utf8")));
    validateAccountsTransferPackage(packageJson);
    return packageJson;
  }

  async importAccountsTransferPackage(
    accountPackage: AccountsTransferPackage,
    selectedAccountIds: ReadonlySet<string>
  ): Promise<AccountsImportResult> {
    validateAccountsTransferPackage(accountPackage);
    if (selectedAccountIds.size === 0) {
      throw new Error("No accounts were selected");
    }

    const store = await this.storeRepository.loadStore();
    const merged = applyAccountsTransferMerge(
      accountPackage.accounts,
      selectedAccountIds,
      store,
      this.dateProvider.unixSecondsNow(),
      { idGenerator: randomUUID }
    );
    if (merged.result.insertedCount + merged.result.updatedCount === 0) {
      throw new Error("No accounts were selected");
    }

    await this.storeRepository.saveStore(merged.store);
    return merged.result;
  }

  async importAccount(authJson: JSONValue, customLabel?: string): Promise<AccountSummary> {
    const extracted = this.authRepository.extractAuth(authJson);
    const { usage, usageError } = await this.fetchUsage(extracted);
    const now = this.dateProvider.unixSecondsNow();
    const trimmedLabel = customLabel?.trim();
    const account: StoredAccount = {
      id: randomUUID(),
      label: trimmedLabel || extracted.email || `Codex ${extracted.accountId.slice(0, 8)}`,
      email: extracted.email,
      accountId: extracted.accountId,
      planType: preferredPlanType(extracted.planType, usage?.planType),
      teamName: normalizeTeamName(extracted.teamName),
      authJson,
      addedAt: now,
      updatedAt: now,
      usage,
      usageError,
      principalId: extracted.principalId
    };

    const store = await this.storeRepository.loadStore();
    const existingIndex = matchingStoredAccountIndex(extracted, store.accounts);
    if (existingIndex !== undefined) {
      const existing = store.accounts[existingIndex];
      if (!existing) {
        throw new Error("Matched account index was invalid");
      }

      store.accounts[existingIndex] = {
        ...existing,
        label: account.label,
        email: account.email,
        teamName: account.teamName ?? existing.teamName,
        authJson: account.authJson,
        updatedAt: now,
        usage: usage ?? existing.usage,
        planType: preferredPlanType(extracted.planType, usage?.planType ?? existing.usage?.planType, existing.planType),
        usageError,
        principalId: extracted.principalId
      };
    } else {
      store.accounts.push(account);
    }

    await this.storeRepository.saveStore(store);
    const savedAccount = matchingStoredAccount(extracted, store.accounts);
    if (!savedAccount) {
      throw new Error("Imported account could not be found after save");
    }
    return toAccountSummary(savedAccount, await this.currentAuthAccountKey());
  }

  private async prepareStoredAccountForSwitch(id: string): Promise<StoredAccount> {
    const store = await this.storeRepository.loadStore();
    if (await this.reconcileCurrentAuthSnapshot(store)) {
      await this.storeRepository.saveStore(store);
    }

    const account = store.accounts.find((candidate) => candidate.id === id);
    if (!account) {
      throw new Error("Account was not found for switch");
    }
    return account;
  }

  private async updateCurrentAccountProjection(authJson: JSONValue): Promise<void> {
    const extracted = this.authRepository.extractAuth(authJson);
    const store = await this.storeRepository.loadStore();
    const matchedAccount = matchingStoredAccount(extracted, store.accounts);
    if (!matchedAccount) {
      throw new Error("Account was not found for switch");
    }

    store.currentSelection = {
      accountId: extracted.accountId,
      selectedAt: this.dateProvider.unixMillisecondsNow(),
      sourceDeviceID: this.sourceDeviceID,
      accountKey: accountKeyForStoredAccount(matchedAccount)
    };
    await this.storeRepository.saveStore(store);
    await this.authRepository.writeCurrentAuth(authJson);
  }

  private async applySwitchSideEffects(
    settings: AppSettings,
    workspacePath: string | undefined
  ): Promise<SwitchAccountExecutionResult> {
    const result: SwitchAccountExecutionResult = { ...idleSwitchAccountExecutionResult };

    if (settings.restartEditorsOnSwitch && this.editorAppService) {
      const restart = await this.editorAppService.restartSelectedApps(settings.restartEditorTargets);
      result.restartedEditorApps = restart.restarted;
      result.editorRestartError = restart.error;
    }

    if (settings.launchCodexAfterSwitch && this.codexCLIService) {
      result.usedFallbackCLI = await this.codexCLIService.launchApp(workspacePath);
    }

    return result;
  }

  private async currentAuthAccountKey(): Promise<string | undefined> {
    const auth = await this.authRepository.readCurrentAuthOptional();
    if (!auth) {
      return undefined;
    }

    try {
      return accountKeyForExtractedAuth(this.authRepository.extractAuth(auth));
    } catch {
      return undefined;
    }
  }

  private async reconcileCurrentAuthSnapshot(store: AccountsStore): Promise<boolean> {
    const currentAuth = await this.authRepository.readCurrentAuthOptional();
    if (!currentAuth) {
      return false;
    }

    let extracted: ExtractedAuth;
    try {
      extracted = this.authRepository.extractAuth(currentAuth);
    } catch {
      return false;
    }

    const index = matchingStoredAccountIndex(extracted, store.accounts);
    const account = index === undefined ? undefined : store.accounts[index];
    if (index === undefined || !account) {
      return false;
    }

    let didChange = false;
    if (stableStringify(account.authJson) !== stableStringify(currentAuth)) {
      account.authJson = currentAuth;
      didChange = true;
    }
    if (account.accountId !== extracted.accountId) {
      account.accountId = extracted.accountId;
      didChange = true;
    }
    if (account.email !== extracted.email) {
      account.email = extracted.email;
      didChange = true;
    }
    if (account.principalId !== extracted.principalId) {
      account.principalId = extracted.principalId;
      didChange = true;
    }

    const resolvedPlanType = preferredPlanType(extracted.planType, account.usage?.planType, account.planType);
    if (account.planType !== resolvedPlanType) {
      account.planType = resolvedPlanType;
      didChange = true;
    }

    const teamName = normalizeTeamName(extracted.teamName);
    if (teamName && normalizeTeamName(account.teamName) !== teamName) {
      account.teamName = teamName;
      didChange = true;
    }

    if (!didChange) {
      return false;
    }

    account.updatedAt = this.dateProvider.unixSecondsNow();
    store.accounts[index] = account;
    return true;
  }

  private reconcileStoredAccountMetadata(store: AccountsStore): boolean {
    let didChange = false;

    for (const account of store.accounts) {
      let reconciled: ExtractedAuth;
      try {
        reconciled = this.authRepository.extractAuth(account.authJson);
      } catch {
        continue;
      }

      if (account.email !== reconciled.email) {
        account.email = reconciled.email;
        didChange = true;
      }
      if (account.principalId !== reconciled.principalId) {
        account.principalId = reconciled.principalId;
        didChange = true;
      }

      const resolvedPlanType = preferredPlanType(reconciled.planType, account.usage?.planType, account.planType);
      if (account.planType !== resolvedPlanType) {
        account.planType = resolvedPlanType;
        didChange = true;
      }

      const teamName = normalizeTeamName(reconciled.teamName);
      if (teamName && normalizeTeamName(account.teamName) !== teamName) {
        account.teamName = teamName;
        didChange = true;
      }
    }

    return didChange;
  }

  private async fetchUsage(extracted: ExtractedAuth): Promise<{ usage?: UsageSnapshot; usageError?: string }> {
    if (!this.usageService) {
      return {};
    }

    try {
      return {
        usage: await this.usageService.fetchUsage(extracted.accessToken, extracted.accountId)
      };
    } catch (error) {
      return {
        usageError: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export function matchingStoredAccountIndex(extracted: ExtractedAuth, accounts: readonly StoredAccount[]): number | undefined {
  return preferredMatchIndex(extracted, accounts);
}

export function matchingStoredAccount(extracted: ExtractedAuth, accounts: readonly StoredAccount[]): StoredAccount | undefined {
  const index = matchingStoredAccountIndex(extracted, accounts);
  return index === undefined ? undefined : accounts[index];
}

export function validateAccountsTransferPackage(accountPackage: AccountsTransferPackage): void {
  if (accountPackage.format !== accountsTransferFormatIdentifier) {
    throw new Error("Accounts transfer package format is invalid");
  }
  if (accountPackage.version > accountsTransferCurrentVersion) {
    throw new Error(`Accounts transfer package version ${accountPackage.version} is unsupported`);
  }
  if (accountPackage.accounts.length === 0) {
    throw new Error("Accounts transfer package is empty");
  }
}

function normalizeTeamName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
