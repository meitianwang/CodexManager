import { randomUUID } from "node:crypto";
import type { JSONValue } from "../../shared/models/json-value";
import type { AccountsImportResult, AccountsTransferPackage } from "../../shared/models/account-transfer";
import {
  accountsTransferCurrentVersion,
  accountsTransferFormatIdentifier
} from "../../shared/models/account-transfer";
import type { AccountSummary, AccountsStore, StoredAccount, WeeklyQuotaWarmupResult } from "../../shared/models/accounts";
import type { ChatGPTOAuthTokens, ExtractedAuth, WorkspaceMetadata } from "../../shared/models/auth";
import type { SmartSwitchResult, SwitchAccountExecutionResult } from "../../shared/models/app";
import { idleSwitchAccountExecutionResult } from "../../shared/models/app";
import type { AppSettings, EditorAppID } from "../../shared/models/settings";
import type { UsageSnapshot } from "../../shared/models/usage";
import { accountKeyForExtractedAuth, accountKeyForStoredAccount, normalizedAccountId, preferredMatchIndex } from "../../shared/domain/account-identity";
import { preferredPlanType } from "../../shared/domain/account-plan-resolver";
import { accountSummaries, toAccountSummary } from "../../shared/domain/accounts-store";
import { pickAutoSwitchTarget, sortByRemaining } from "../../shared/domain/account-ranking";
import { applyAccountsTransferMerge } from "../../shared/domain/accounts-transfer-merge";
import {
  authTokenNeedsPlanRepair,
  codexVisiblePlanFromAuth,
  refreshTokenFromAuth
} from "../repositories/auth-parsing";
import { stableStringify } from "../repositories/stable-json";
import { UnauthorizedError } from "./network-errors";

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
  refreshChatGPTTokens(refreshToken: string): Promise<ChatGPTOAuthTokens>;
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

export interface WeeklyQuotaWarmupServiceLike {
  warmUp(accessToken: string, accountId: string): Promise<void>;
}

export interface WorkspaceMetadataServiceLike {
  fetchWorkspaceMetadata(accessToken: string): Promise<WorkspaceMetadata[]>;
}

export interface AccountsCoordinatorOptions {
  storeRepository: AccountsStoreRepositoryLike;
  authRepository: AuthRepositoryLike;
  settingsRepository?: SettingsRepositoryLike;
  usageService?: UsageServiceLike;
  weeklyQuotaWarmupService?: WeeklyQuotaWarmupServiceLike;
  workspaceMetadataService?: WorkspaceMetadataServiceLike;
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
  private readonly weeklyQuotaWarmupService?: WeeklyQuotaWarmupServiceLike;
  private readonly workspaceMetadataService?: WorkspaceMetadataServiceLike;
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
    this.weeklyQuotaWarmupService = options.weeklyQuotaWarmupService;
    this.workspaceMetadataService = options.workspaceMetadataService;
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
    const didEnrich = await this.enrichStoredWorkspaceMetadataIfNeeded(store, false);
    if (didReconcileCurrentAuth || didReconcile || didEnrich) {
      await this.storeRepository.saveStore(store);
    }
    return accountSummaries(store, await this.currentAuthAccountKey());
  }

  async importCurrentAuthAccount(customLabel?: string): Promise<AccountSummary> {
    return this.importAccount(await this.authRepository.readCurrentAuth(), customLabel);
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

    const refreshed = await this.refreshStoredAccountUsage(account);
    store.accounts[index] = refreshed;
    await this.storeRepository.saveStore(store);
    return toAccountSummary(refreshed, await this.currentAuthAccountKey());
  }

  async refreshAllUsage(): Promise<AccountSummary[]> {
    const accounts = await this.listAccounts();
    for (const account of accounts) {
      await this.refreshAccountUsage(account.id);
    }
    return this.listAccounts();
  }

  async warmUpResetWeeklyQuotaAccounts(): Promise<WeeklyQuotaWarmupResult> {
    const now = this.dateProvider.unixSecondsNow();
    let store = await this.storeRepository.loadStore();
    if (await this.reconcileCurrentAuthSnapshot(store)) {
      await this.storeRepository.saveStore(store);
    }

    const targets = store.accounts.filter((account) => shouldWarmUpResetWeeklyQuota(account, now));
    if (targets.length === 0) {
      return {
        accounts: accountSummaries(store, await this.currentAuthAccountKey()),
        targetCount: 0,
        succeededCount: 0,
        failures: []
      };
    }

    if (!this.weeklyQuotaWarmupService) {
      throw new Error("Weekly quota warmup service is unavailable");
    }

    const succeededIds: string[] = [];
    const failures: WeeklyQuotaWarmupResult["failures"] = [];
    for (const target of targets) {
      store = await this.storeRepository.loadStore();
      const activeAccount = store.accounts.find((account) => account.id === target.id) ?? target;
      try {
        const extracted = this.authRepository.extractAuth(activeAccount.authJson);
        await this.weeklyQuotaWarmupService.warmUp(extracted.accessToken, extracted.accountId);
        succeededIds.push(activeAccount.id);
      } catch (error) {
        const message = errorMessage(error);
        failures.push({
          accountId: activeAccount.id,
          label: activeAccount.label,
          message
        });
        const index = store.accounts.findIndex((account) => account.id === activeAccount.id);
        const failedAccount = store.accounts[index];
        if (index >= 0 && failedAccount) {
          failedAccount.usageError = message;
          failedAccount.updatedAt = this.dateProvider.unixSecondsNow();
          store.accounts[index] = failedAccount;
          await this.storeRepository.saveStore(store);
        }
      }
    }

    for (const id of succeededIds) {
      await this.refreshAccountUsage(id);
    }

    return {
      accounts: await this.listAccounts(),
      targetCount: targets.length,
      succeededCount: succeededIds.length,
      failures
    };
  }

  async refreshWorkspaceMetadata(forceRemoteCheck: boolean): Promise<AccountSummary[]> {
    const store = await this.storeRepository.loadStore();
    const didChange = await this.enrichStoredWorkspaceMetadataIfNeeded(store, forceRemoteCheck);
    if (didChange) {
      await this.storeRepository.saveStore(store);
    }
    return accountSummaries(store, await this.currentAuthAccountKey());
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
    if (best.isCurrent) {
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
    let extracted = this.authRepository.extractAuth(authJson);
    const remoteWorkspaceName = await this.resolveRemoteWorkspaceName(extracted, true);
    if (remoteWorkspaceName) {
      extracted = { ...extracted, teamName: remoteWorkspaceName };
    }
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
    if (!this.accountNeedsCodexVisibleAuthRepair(account)) {
      return account;
    }

    const repairedAccount = await this.repairCodexVisibleAuth(account);
    const latestStore = await this.storeRepository.loadStore();
    const index = latestStore.accounts.findIndex((candidate) => candidate.id === id);
    const latestAccount = latestStore.accounts[index];
    if (index < 0 || !latestAccount) {
      throw new Error("Account was not found for switch");
    }

    latestStore.accounts[index] = mergePreparedAccount(repairedAccount, latestAccount);
    await this.storeRepository.saveStore(latestStore);
    return latestStore.accounts[index];
  }

  private accountNeedsCodexVisibleAuthRepair(account: StoredAccount): boolean {
    return authTokenNeedsPlanRepair(codexVisiblePlanFromAuth(account.authJson), expectedPlan(account));
  }

  private async repairCodexVisibleAuth(account: StoredAccount): Promise<StoredAccount> {
    const refreshToken = refreshTokenFromAuth(account.authJson);
    if (refreshToken && this.chatGPTOAuthLoginService) {
      try {
        const refreshed = await this.refreshStoredAccountAuth(account, refreshToken);
        if (!this.accountNeedsCodexVisibleAuthRepair(refreshed)) {
          return refreshed;
        }
      } catch {
        // Fall through to a bounded interactive OAuth repair, matching the macOS switch path.
      }
    }

    if (!this.chatGPTOAuthLoginService) {
      throw new Error("ChatGPT OAuth login service is unavailable");
    }

    const tokens = await this.chatGPTOAuthLoginService.signInWithChatGPT(10 * 60, account.accountId);
    const reauthorized = await this.storedAccountReplacingTokens(account, tokens);
    if (this.accountNeedsCodexVisibleAuthRepair(reauthorized)) {
      throw new UnauthorizedError(
        `Codex token plan mismatch: expected ${expectedPlan(reauthorized) ?? "paid"}, got ${codexVisiblePlanFromAuth(reauthorized.authJson) ?? "unknown"}`
      );
    }
    return reauthorized;
  }

  private async refreshStoredAccountAuth(account: StoredAccount, refreshToken: string): Promise<StoredAccount> {
    if (!this.chatGPTOAuthLoginService) {
      throw new Error("ChatGPT OAuth login service is unavailable");
    }
    const tokens = await this.chatGPTOAuthLoginService.refreshChatGPTTokens(refreshToken);
    return this.storedAccountReplacingTokens(account, tokens);
  }

  private async storedAccountReplacingTokens(
    account: StoredAccount,
    tokens: ChatGPTOAuthTokens
  ): Promise<StoredAccount> {
    const authJson = this.authRepository.replacingChatGPTTokens(account.authJson, tokens);
    let extracted = this.authRepository.extractAuth(authJson);
    if (normalizedAccountId(extracted.accountId) !== normalizedAccountId(account.accountId)) {
      throw new UnauthorizedError(`OAuth workspace mismatch: expected ${account.accountId}`);
    }

    const remoteWorkspaceName = await this.resolveRemoteWorkspaceName(extracted, true);
    if (remoteWorkspaceName) {
      extracted = { ...extracted, teamName: remoteWorkspaceName };
    }

    const { usage, usageError } = await this.fetchUsage(extracted);
    const teamName = normalizeTeamName(extracted.teamName);
    return {
      ...account,
      email: extracted.email ?? account.email,
      accountId: extracted.accountId,
      planType: preferredPlanType(extracted.planType, usage?.planType, account.planType),
      teamName: teamName ?? account.teamName,
      authJson,
      updatedAt: this.dateProvider.unixSecondsNow(),
      usage: usage ?? account.usage,
      usageError,
      principalId: extracted.principalId
    };
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

  private async refreshStoredAccountUsage(account: StoredAccount): Promise<StoredAccount> {
    const updated: StoredAccount = { ...account };
    try {
      const extracted = this.authRepository.extractAuth(updated.authJson);
      const usage = await this.fetchUsageRequired(extracted);
      updated.usage = usage;
      updated.usageError = undefined;
      updated.planType = preferredPlanType(extracted.planType, usage.planType, updated.planType);
      updated.email = extracted.email ?? updated.email;
      updated.principalId = extracted.principalId;
      const teamName = normalizeTeamName(extracted.teamName);
      if (teamName) {
        updated.teamName = teamName;
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return this.refreshAccountAuthAndRetryUsage(updated, error, false);
      }
      updated.usageError = errorMessage(error);
    }

    updated.updatedAt = this.dateProvider.unixSecondsNow();
    return updated;
  }

  private async refreshAccountAuthAndRetryUsage(
    account: StoredAccount,
    originalError: Error,
    allowInteractiveAuthRepair: boolean
  ): Promise<StoredAccount> {
    const updated: StoredAccount = { ...account };
    const currentAccountKey = await this.currentAuthAccountKey();
    const wasCurrentAccount = accountMatchesCurrentAuth(updated, currentAccountKey);

    try {
      const tokens = await this.repairedTokens(updated, originalError, allowInteractiveAuthRepair);
      const authJson = this.authRepository.replacingChatGPTTokens(updated.authJson, tokens);
      const extracted = this.authRepository.extractAuth(authJson);
      if (normalizedAccountId(extracted.accountId) !== normalizedAccountId(updated.accountId)) {
        throw new Error(`OAuth workspace mismatch: expected ${updated.accountId}`);
      }

      updated.authJson = authJson;
      updated.accountId = extracted.accountId;
      updated.email = extracted.email ?? updated.email;
      updated.principalId = extracted.principalId;
      const teamName = normalizeTeamName(extracted.teamName);
      if (teamName) {
        updated.teamName = teamName;
      }

      try {
        const usage = await this.fetchUsageRequired(extracted);
        updated.usage = usage;
        updated.usageError = undefined;
        updated.planType = preferredPlanType(extracted.planType, usage.planType, updated.planType);
      } catch (error) {
        updated.usageError = errorMessage(error);
        updated.planType = preferredPlanType(extracted.planType, updated.usage?.planType, updated.planType);
      }

      if (wasCurrentAccount || accountMatchesCurrentAuth(updated, currentAccountKey)) {
        await this.authRepository.writeCurrentAuth(authJson);
      }
    } catch (error) {
      updated.usageError = errorMessage(error);
    }

    updated.updatedAt = this.dateProvider.unixSecondsNow();
    return updated;
  }

  private async repairedTokens(
    account: StoredAccount,
    originalError: Error,
    allowInteractiveAuthRepair: boolean
  ): Promise<ChatGPTOAuthTokens> {
    if (!this.chatGPTOAuthLoginService) {
      throw originalError;
    }

    const refreshToken = refreshTokenFromAuth(account.authJson);
    if (refreshToken) {
      try {
        return await this.chatGPTOAuthLoginService.refreshChatGPTTokens(refreshToken);
      } catch (error) {
        if (!allowInteractiveAuthRepair) {
          throw error;
        }
      }
    } else if (!allowInteractiveAuthRepair) {
      throw originalError;
    }

    return this.chatGPTOAuthLoginService.signInWithChatGPT(10 * 60, account.accountId);
  }

  private async resolveRemoteWorkspaceName(
    extracted: ExtractedAuth,
    forceRemoteCheck: boolean
  ): Promise<string | undefined> {
    if (!this.workspaceMetadataService) {
      return undefined;
    }
    if (!shouldLookupRemoteWorkspaceName(extracted.teamName, extracted, forceRemoteCheck)) {
      return extracted.teamName;
    }

    try {
      const directory = await this.workspaceMetadataService.fetchWorkspaceMetadata(extracted.accessToken);
      return remoteWorkspaceName(extracted.accountId, directory) ?? extracted.teamName;
    } catch {
      return extracted.teamName;
    }
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

  private async enrichStoredWorkspaceMetadataIfNeeded(store: AccountsStore, forceRemoteCheck: boolean): Promise<boolean> {
    if (!this.workspaceMetadataService) {
      return false;
    }

    let didChange = false;
    const cachedDirectories = new Map<string, WorkspaceMetadata[]>();
    for (const account of store.accounts) {
      let extracted: ExtractedAuth;
      try {
        extracted = this.authRepository.extractAuth(account.authJson);
      } catch {
        continue;
      }

      if (!shouldLookupRemoteWorkspaceName(account.teamName, extracted, forceRemoteCheck)) {
        continue;
      }

      let directory = cachedDirectories.get(extracted.accessToken);
      if (!directory) {
        try {
          directory = await this.workspaceMetadataService.fetchWorkspaceMetadata(extracted.accessToken);
        } catch {
          continue;
        }
        cachedDirectories.set(extracted.accessToken, directory);
      }

      const workspaceName = remoteWorkspaceName(extracted.accountId, directory);
      if (workspaceName && account.teamName !== workspaceName) {
        account.teamName = workspaceName;
        didChange = true;
      }
    }

    return didChange;
  }

  private async fetchUsageRequired(extracted: ExtractedAuth): Promise<UsageSnapshot> {
    if (!this.usageService) {
      throw new Error("Usage service is unavailable");
    }
    return this.usageService.fetchUsage(extracted.accessToken, extracted.accountId);
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

function accountMatchesCurrentAuth(account: StoredAccount, currentAccountKey: string | undefined): boolean {
  return currentAccountKey !== undefined && accountKeyForStoredAccount(account) === currentAccountKey;
}

function mergePreparedAccount(prepared: StoredAccount, latest: StoredAccount): StoredAccount {
  return {
    ...latest,
    email: prepared.email,
    accountId: prepared.accountId,
    planType: prepared.planType,
    teamName: prepared.teamName ?? latest.teamName,
    authJson: prepared.authJson,
    updatedAt: prepared.updatedAt,
    usage: prepared.usage,
    usageError: prepared.usageError,
    principalId: prepared.principalId
  };
}

function expectedPlan(account: StoredAccount): string | undefined {
  return preferredPlanType(account.planType, account.usage?.planType);
}

function shouldWarmUpResetWeeklyQuota(account: StoredAccount, now: number): boolean {
  const oneWeek = account.usage?.oneWeek;
  return oneWeek !== undefined && oneWeek.usedPercent >= 100 && oneWeek.resetAt !== undefined && oneWeek.resetAt <= now;
}

function shouldLookupRemoteWorkspaceName(
  storedTeamName: string | undefined,
  extracted: ExtractedAuth,
  forceRemoteCheck: boolean
): boolean {
  const planType = extracted.planType?.trim().toLowerCase();
  if (planType !== "team" && planType !== "business" && planType !== "enterprise") {
    return false;
  }
  return forceRemoteCheck || normalizeTeamName(storedTeamName) === undefined;
}

function remoteWorkspaceName(accountId: string, metadata: readonly WorkspaceMetadata[]): string | undefined {
  const match = metadata.find((item) => item.accountId === accountId);
  const trimmed = match?.workspaceName?.trim();
  if (!trimmed || match?.structure?.toLowerCase() === "personal") {
    return undefined;
  }
  return trimmed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
