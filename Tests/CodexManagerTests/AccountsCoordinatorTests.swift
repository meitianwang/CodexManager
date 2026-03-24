import XCTest
@testable import CodexManager

final class AccountsCoordinatorTests: XCTestCase {
    func testAccountsUsageRefreshPlanningTargetsCurrentAndNearResetAccounts() {
        let now: Int64 = 1_763_216_000
        let policy = AccountsUsageRefreshPlanningPolicy(nonCurrentResetLeadTimeSeconds: 60)
        let accounts = [
            makeAccountSummary(
                id: "acct-current",
                accountID: "account-current",
                isCurrent: true,
                usage: makeUsageSnapshot(fetchedAt: now - 300, fiveHourResetAt: now + 600)
            ),
            makeAccountSummary(
                id: "acct-near-reset",
                accountID: "account-near-reset",
                isCurrent: false,
                usage: makeUsageSnapshot(fetchedAt: now - 300, fiveHourResetAt: now + 45)
            ),
            makeAccountSummary(
                id: "acct-idle",
                accountID: "account-idle",
                isCurrent: false,
                usage: makeUsageSnapshot(fetchedAt: now - 300, fiveHourResetAt: now + 600)
            ),
            AccountSummary(
                id: "acct-error",
                label: "acct-error",
                email: "error@example.com",
                accountID: "account-error",
                planType: "pro",
                teamName: nil,
                teamAlias: nil,
                addedAt: now,
                updatedAt: now,
                usage: makeUsageSnapshot(fetchedAt: now - 300, fiveHourResetAt: now + 600),
                usageError: "timeout",
                isCurrent: false
            )
        ]

        XCTAssertEqual(
            policy.targetAccountIDs(from: accounts, now: now),
            ["acct-current", "acct-near-reset", "acct-error"]
        )
    }

    func testListAccountsBackfillsWorkspaceNameFromRemoteMetadata() async throws {
        let now: Int64 = 1_763_216_000
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(
                version: 1,
                accounts: [
                    StoredAccount(
                        id: "acct-1",
                        label: "Team",
                        email: "test@example.com",
                        accountID: "account-1",
                        planType: "team",
                        teamName: nil,
                        teamAlias: nil,
                        authJSON: .object([:]),
                        addedAt: now,
                        updatedAt: now,
                        usage: nil,
                        usageError: nil
                    )
                ],
                currentSelection: nil
            )
        )
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: RemoteLookupAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: now,
                    planType: "team",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            workspaceMetadataService: StubWorkspaceMetadataService(
                metadata: [WorkspaceMetadata(accountID: "account-1", workspaceName: "remote-space", structure: "workspace")]
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        let accounts = try await coordinator.listAccounts()
        let savedStore = try storeRepository.loadStore()

        XCTAssertEqual(accounts.first?.teamName, "remote-space")
        XCTAssertEqual(savedStore.accounts.first?.teamName, "remote-space")
    }

    func testListAccountsReconcilesStoredWorkspaceMetadataFromAuthJSON() async throws {
        let now: Int64 = 1_763_216_000
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(
                version: 1,
                accounts: [
                    StoredAccount(
                        id: "acct-1",
                        label: "Test",
                        email: nil,
                        accountID: "account-1",
                        planType: nil,
                        teamName: nil,
                        teamAlias: nil,
                        authJSON: .object([:]),
                        addedAt: now,
                        updatedAt: now,
                        usage: nil,
                        usageError: nil
                    )
                ],
                currentSelection: nil
            )
        )
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: StubAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: now,
                    planType: "team",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        let accounts = try await coordinator.listAccounts()
        let savedStore = try storeRepository.loadStore()

        XCTAssertEqual(accounts.first?.email, "test@example.com")
        XCTAssertEqual(accounts.first?.planType, "pro")
        XCTAssertEqual(accounts.first?.teamName, "workspace-x")
        XCTAssertEqual(savedStore.accounts.first?.teamName, "workspace-x")
    }

    func testListAccountsDoesNotClearStoredWorkspaceNameWhenAuthLacksTeamName() async throws {
        let now: Int64 = 1_763_216_000
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(
                version: 1,
                accounts: [
                    StoredAccount(
                        id: "acct-1",
                        label: "Test",
                        email: "test@example.com",
                        accountID: "account-1",
                        planType: "team",
                        teamName: "remote-space",
                        teamAlias: nil,
                        authJSON: .object([:]),
                        addedAt: now,
                        updatedAt: now,
                        usage: nil,
                        usageError: nil
                    )
                ],
                currentSelection: nil
            )
        )
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: RemoteLookupAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: now,
                    planType: "team",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        let accounts = try await coordinator.listAccounts()
        let savedStore = try storeRepository.loadStore()

        XCTAssertEqual(accounts.first?.teamName, "remote-space")
        XCTAssertEqual(savedStore.accounts.first?.teamName, "remote-space")
    }

    func testImportCurrentAuthPrefersRemoteWorkspaceMetadata() async throws {
        let now: Int64 = 1_763_216_000
        let storeRepository = InMemoryAccountsStoreRepository(store: AccountsStore())
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: RemoteLookupAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: now,
                    planType: "team",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            workspaceMetadataService: StubWorkspaceMetadataService(
                metadata: [WorkspaceMetadata(accountID: "account-1", workspaceName: "remote-space", structure: "workspace")]
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        let imported = try await coordinator.importCurrentAuthAccount(customLabel: nil)
        let savedStore = try storeRepository.loadStore()

        XCTAssertEqual(imported.teamName, "remote-space")
        XCTAssertEqual(savedStore.accounts.first?.teamName, "remote-space")
    }

    func testForcedRefreshBypassesUsageThrottle() async throws {
        let now: Int64 = 1_763_216_000
        let existingUsage = UsageSnapshot(
            fetchedAt: now,
            planType: "pro",
            fiveHour: UsageWindow(usedPercent: 10, windowSeconds: 18_000, resetAt: nil),
            oneWeek: UsageWindow(usedPercent: 20, windowSeconds: 604_800, resetAt: nil),
            credits: nil
        )
        let store = AccountsStore(
            version: 1,
            accounts: [
                StoredAccount(
                    id: "acct-1",
                    label: "Test",
                    email: "test@example.com",
                    accountID: "account-1",
                    planType: "pro",
                    teamName: nil,
                    teamAlias: nil,
                    authJSON: .object([:]),
                    addedAt: now,
                    updatedAt: now,
                    usage: existingUsage,
                    usageError: nil
                )
            ],
            currentSelection: nil
        )
        let usageService = CountingUsageService(result: existingUsage)
        let coordinator = AccountsCoordinator(
            storeRepository: InMemoryAccountsStoreRepository(store: store),
            settingsRepository: TestSettingsRepository(),
            authRepository: StubAuthRepository(),
            usageService: usageService,
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        _ = try await coordinator.refreshUsage()
        XCTAssertEqual(usageService.callCount, 0)

        _ = try await coordinator.refreshUsage(force: true)
        XCTAssertEqual(usageService.callCount, 1)
    }

    func testSelectiveUsageRefreshOnlyRequestsTargetAccounts() async throws {
        let now: Int64 = 1_763_216_000
        let store = AccountsStore(
            version: 1,
            accounts: [
                makeStoredAccount(id: "acct-1", accountID: "account-1", now: now),
                makeStoredAccount(id: "acct-2", accountID: "account-2", now: now),
                makeStoredAccount(id: "acct-3", accountID: "account-3", now: now),
            ],
            currentSelection: nil
        )
        let usageService = RecordingAccountUsageService(
            results: [
                "account-1": makeUsageSnapshot(fetchedAt: now, fiveHourResetAt: now + 300),
                "account-2": makeUsageSnapshot(fetchedAt: now, fiveHourResetAt: now + 300),
                "account-3": makeUsageSnapshot(fetchedAt: now, fiveHourResetAt: now + 300),
            ]
        )
        let authRepository = MultiAccountAuthRepository(
            extractedByAccountID: [
                "account-1": makeExtractedAuth(accountID: "account-1"),
                "account-2": makeExtractedAuth(accountID: "account-2"),
                "account-3": makeExtractedAuth(accountID: "account-3"),
            ]
        )
        let coordinator = AccountsCoordinator(
            storeRepository: InMemoryAccountsStoreRepository(store: store),
            settingsRepository: TestSettingsRepository(),
            authRepository: authRepository,
            usageService: usageService,
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        _ = try await coordinator.refreshUsage(accountIDs: ["acct-1", "acct-3"], force: true)

        let requestedAccountIDs = await usageService.readRequestedAccountIDs()
        XCTAssertEqual(requestedAccountIDs, ["account-1", "account-3"])
    }

    func testRefreshAllUsageDoesNotClearStoredWorkspaceNameWhenAuthLacksTeamName() async throws {
        let now: Int64 = 1_763_216_000
        let existingUsage = UsageSnapshot(
            fetchedAt: now - 60,
            planType: "team",
            fiveHour: UsageWindow(usedPercent: 10, windowSeconds: 18_000, resetAt: nil),
            oneWeek: nil,
            credits: nil
        )
        let store = AccountsStore(
            version: 1,
            accounts: [
                StoredAccount(
                    id: "acct-1",
                    label: "Test",
                    email: "test@example.com",
                    accountID: "account-1",
                    planType: "team",
                    teamName: "remote-space",
                    teamAlias: nil,
                    authJSON: .object([:]),
                    addedAt: now,
                    updatedAt: now,
                    usage: existingUsage,
                    usageError: nil
                )
            ],
            currentSelection: nil
        )
        let storeRepository = InMemoryAccountsStoreRepository(store: store)
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: RemoteLookupAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: now,
                    planType: "team",
                    fiveHour: UsageWindow(usedPercent: 25, windowSeconds: 18_000, resetAt: nil),
                    oneWeek: nil,
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        let accounts = try await coordinator.refreshUsage(force: true)
        let savedStore = try storeRepository.loadStore()

        XCTAssertEqual(accounts.first?.teamName, "remote-space")
        XCTAssertEqual(savedStore.accounts.first?.teamName, "remote-space")
    }

    func testRefreshAllUsageDoesNotBlockOnWorkspaceMetadataLookup() async throws {
        let now: Int64 = 1_763_216_000
        let store = AccountsStore(
            version: 1,
            accounts: [
                StoredAccount(
                    id: "acct-1",
                    label: "Test",
                    email: nil,
                    accountID: "account-1",
                    planType: nil,
                    teamName: nil,
                    teamAlias: nil,
                    authJSON: .object([:]),
                    addedAt: now,
                    updatedAt: now,
                    usage: nil,
                    usageError: nil
                )
            ],
            currentSelection: nil
        )
        let metadataService = RecordingWorkspaceMetadataService(
            metadata: [WorkspaceMetadata(accountID: "account-1", workspaceName: "remote-space", structure: "workspace")]
        )
        let coordinator = AccountsCoordinator(
            storeRepository: InMemoryAccountsStoreRepository(store: store),
            settingsRepository: TestSettingsRepository(),
            authRepository: RemoteLookupAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: now,
                    planType: "team",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            workspaceMetadataService: metadataService,
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        let accounts = try await coordinator.refreshUsage(force: true)

        XCTAssertEqual(metadataService.callCount, 0)
        XCTAssertNil(accounts.first?.teamName)

        let enrichedAccounts = try await coordinator.refreshWorkspaceMetadata(forceRemoteCheck: true)
        XCTAssertEqual(metadataService.callCount, 1)
        XCTAssertEqual(enrichedAccounts.first?.teamName, "remote-space")
    }

    func testRefreshAllUsageSeriallyStreamsPartialAccountUpdates() async throws {
        let now: Int64 = 1_763_216_000
        let store = AccountsStore(
            version: 1,
            accounts: [
                StoredAccount(
                    id: "acct-1",
                    label: "First",
                    email: "first@example.com",
                    accountID: "account-1",
                    planType: "pro",
                    teamName: nil,
                    teamAlias: nil,
                    authJSON: .object(["account_id": .string("account-1")]),
                    addedAt: now,
                    updatedAt: now,
                    usage: nil,
                    usageError: nil
                ),
                StoredAccount(
                    id: "acct-2",
                    label: "Second",
                    email: "second@example.com",
                    accountID: "account-2",
                    planType: "pro",
                    teamName: nil,
                    teamAlias: nil,
                    authJSON: .object(["account_id": .string("account-2")]),
                    addedAt: now,
                    updatedAt: now,
                    usage: nil,
                    usageError: nil
                )
            ],
            currentSelection: nil
        )
        let usageService = AccountIDUsageService(
            results: [
                "account-1": UsageSnapshot(
                    fetchedAt: now,
                    planType: "pro",
                    fiveHour: UsageWindow(usedPercent: 10, windowSeconds: 18_000, resetAt: nil),
                    oneWeek: nil,
                    credits: nil
                ),
                "account-2": UsageSnapshot(
                    fetchedAt: now,
                    planType: "pro",
                    fiveHour: UsageWindow(usedPercent: 80, windowSeconds: 18_000, resetAt: nil),
                    oneWeek: nil,
                    credits: nil
                )
            ]
        )
        let coordinator = AccountsCoordinator(
            storeRepository: InMemoryAccountsStoreRepository(store: store),
            settingsRepository: TestSettingsRepository(),
            authRepository: MultiAccountAuthRepository(
                extractedByAccountID: [
                    "account-1": ExtractedAuth(
                        accountID: "account-1",
                        accessToken: "token-1",
                        email: "first@example.com",
                        planType: "pro",
                        teamName: nil
                    ),
                    "account-2": ExtractedAuth(
                        accountID: "account-2",
                        accessToken: "token-2",
                        email: "second@example.com",
                        planType: "pro",
                        teamName: nil
                    )
                ]
            ),
            usageService: usageService,
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )

        let recorder = PartialUpdateRecorder()
        let accounts = try await coordinator.refreshUsage(
            force: true,
            serial: true,
            onPartialUpdate: { accounts in
                await recorder.record(accounts)
            }
        )
        let partialUpdates = await recorder.values()

        XCTAssertEqual(partialUpdates.count, 2)
        XCTAssertEqual(partialUpdates.first?.count, 2)
        XCTAssertNotNil(partialUpdates.first?[0].usage)
        XCTAssertNil(partialUpdates.first?[1].usage)
        XCTAssertNotNil(partialUpdates.last?[0].usage)
        XCTAssertNotNil(partialUpdates.last?[1].usage)
        XCTAssertEqual(accounts, partialUpdates.last)
    }

    func testSwitchAccountOnIOSSkipsMacOnlySideEffects() async throws {
        let now: Int64 = 1_763_216_000
        let account = StoredAccount(
            id: "acct-1",
            label: "Test",
            email: "test@example.com",
            accountID: "account-1",
            planType: "pro",
            teamName: nil,
            teamAlias: nil,
            authJSON: .object([:]),
            addedAt: now,
            updatedAt: now,
            usage: nil,
            usageError: nil
        )
        let store = AccountsStore(
            version: 1,
            accounts: [account],
            currentSelection: nil
        )
        let codexService = RecordingCodexCLIService()
        let editorService = RecordingEditorAppService()
        let authRepository = RecordingAuthRepository()
        let storeRepository = InMemoryAccountsStoreRepository(store: store)
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(settings: AppSettings(
                launchAtStartup: false,
                launchCodexAfterSwitch: true,
                autoSmartSwitch: false,
                syncOpencodeOpenaiAuth: false,
                restartEditorsOnSwitch: true,
                restartEditorTargets: [.cursor],
                autoStartApiProxy: false,
                remoteServers: [],
                locale: AppLocale.english.identifier
            )),
            authRepository: authRepository,
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: now,
                    planType: "pro",
                    fiveHour: UsageWindow(usedPercent: 0, windowSeconds: 18_000, resetAt: nil),
                    oneWeek: UsageWindow(usedPercent: 0, windowSeconds: 604_800, resetAt: nil),
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: codexService,
            editorAppService: editorService,
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now),
            runtimePlatform: .iOS
        )

        _ = try await coordinator.switchAccountAndApplySettings(id: account.id)

        XCTAssertEqual(authRepository.writtenAccountCount, 0)
        XCTAssertEqual(codexService.launchCallCount, 0)
        XCTAssertEqual(editorService.restartCallCount, 0)
        XCTAssertEqual(try storeRepository.loadStore().currentSelection?.accountID, account.accountID)
    }

    @MainActor
    func testAccountsPageModelBootstrapsFromInitialAccounts() {
        let account = AccountSummary(
            id: "acct-1",
            label: "Bootstrap",
            email: "bootstrap@example.com",
            accountID: "account-1",
            planType: "pro",
            teamName: nil,
            teamAlias: nil,
            addedAt: 1,
            updatedAt: 1,
            usage: nil,
            usageError: nil,
            isCurrent: true
        )
        let coordinator = AccountsCoordinator(
            storeRepository: InMemoryAccountsStoreRepository(store: AccountsStore()),
            settingsRepository: TestSettingsRepository(),
            authRepository: StubAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: 1,
                    planType: "pro",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService()
        )
        let model = AccountsPageModel(
            coordinator: coordinator,
            onLocalAccountsChanged: nil,
            initialAccounts: [account]
        )

        XCTAssertTrue(model.hasResolvedInitialState)
        XCTAssertEqual(model.state, AccountsPageModel.makeViewState(accounts: [account], cloudSyncAvailable: true))
    }

    @MainActor
    func testAccountsPageModelRemoteRefreshActivityDoesNotDriveToolbarSpinner() {
        let coordinator = AccountsCoordinator(
            storeRepository: InMemoryAccountsStoreRepository(store: AccountsStore()),
            settingsRepository: TestSettingsRepository(),
            authRepository: StubAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: 1,
                    planType: "pro",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService()
        )
        let model = AccountsPageModel(
            coordinator: coordinator,
            manualRefreshService: StubAccountsManualRefreshService()
        )

        XCTAssertFalse(model.isRefreshSpinnerActive)
        XCTAssertTrue(model.canRefreshUsageAction)

        model.syncRemoteUsageRefreshActivity(isRefreshing: true)
        XCTAssertFalse(model.isRefreshSpinnerActive)
        XCTAssertTrue(model.canRefreshUsageAction)

        model.syncRemoteUsageRefreshActivity(isRefreshing: false)
        XCTAssertFalse(model.isRefreshSpinnerActive)
        XCTAssertTrue(model.canRefreshUsageAction)
    }

    @MainActor
    func testAccountsPageViewStoreDoesNotRepublishContentForNoticeChanges() async {
        let model = makeAccountsPageModelForViewStoreTests(
            initialAccounts: [
                makeAccountSummary(
                    id: "acct-1",
                    accountID: "account-1",
                    isCurrent: true,
                    usage: nil
                )
            ]
        )
        let store = AccountsPageViewStore(model: model)
        let initialContent = store.contentPresentation

        model.notice = NoticeMessage(style: .info, text: "refreshed")
        await Task.yield()

        XCTAssertEqual(store.contentPresentation, initialContent)
    }

    @MainActor
    func testAccountsPageViewStoreActionBarChangesDoNotRepublishContent() async {
        let model = makeAccountsPageModelForViewStoreTests(
            initialAccounts: [
                makeAccountSummary(
                    id: "acct-1",
                    accountID: "account-1",
                    isCurrent: true,
                    usage: nil
                )
            ]
        )
        let store = AccountsPageViewStore(model: model)
        let initialContent = store.contentPresentation

        model.isAdding = true
        await Task.yield()

        XCTAssertEqual(store.contentPresentation, initialContent)
        let addButton = store.macActionBarPresentation.descriptors.first {
            $0.intent == AccountsPageActionIntent.addAccount
        }
        XCTAssertEqual(addButton?.isEnabled, false)
    }

    @MainActor
    func testAccountsPageViewStoreRepublishesContentForCardStateChanges() async {
        let model = makeAccountsPageModelForViewStoreTests(
            initialAccounts: [
                makeAccountSummary(
                    id: "acct-1",
                    accountID: "account-1",
                    isCurrent: true,
                    usage: nil
                ),
                makeAccountSummary(
                    id: "acct-2",
                    accountID: "account-2",
                    isCurrent: false,
                    usage: nil
                )
            ]
        )
        let store = AccountsPageViewStore(model: model)
        let initialContent = store.contentPresentation

        model.refreshingAccountIDs = ["acct-2"]
        await Task.yield()

        XCTAssertNotEqual(store.contentPresentation, initialContent)

        guard case .content(let cards) = store.contentPresentation.state else {
            return XCTFail("Expected content presentation")
        }

        XCTAssertEqual(cards.count, 2)
        XCTAssertEqual(cards.first { $0.id == "acct-1" }?.refreshing, false)
        XCTAssertEqual(cards.first { $0.id == "acct-2" }?.refreshing, true)
    }

    @MainActor
    func testAccountsPageModelManualRefreshShowsSpinnerAndRestoresActionState() async {
        let coordinator = AccountsCoordinator(
            storeRepository: InMemoryAccountsStoreRepository(store: AccountsStore()),
            settingsRepository: TestSettingsRepository(),
            authRepository: StubAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: 1,
                    planType: "pro",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService()
        )

        let started = expectation(description: "manual refresh started")
        let gate = ManualRefreshGate()
        let callCounter = ManualRefreshCallCounter()
        let model = AccountsPageModel(
            coordinator: coordinator,
            manualRefreshService: BlockingAccountsManualRefreshService(
                gate: gate,
                callCounter: callCounter,
                onStart: { started.fulfill() }
            )
        )

        let refreshTask = Task { await model.refreshUsage() }
        await fulfillment(of: [started], timeout: 1.0)

        XCTAssertTrue(model.isRefreshSpinnerActive)
        XCTAssertTrue(model.canRefreshUsageAction)

        // Toolbar button stays tappable while a refresh is in progress,
        // but refresh action is guarded against concurrent re-entry.
        await model.refreshUsage()
        let callCountDuringRefresh = await callCounter.value
        XCTAssertEqual(callCountDuringRefresh, 1)

        await gate.open()
        _ = await refreshTask.result

        XCTAssertFalse(model.isRefreshSpinnerActive)
        XCTAssertTrue(model.canRefreshUsageAction)
    }

    @MainActor
    func testAccountsPageModelSkipsManualRefreshWhileBackgroundUsageRefreshIsActive() async {
        let coordinator = AccountsCoordinator(
            storeRepository: InMemoryAccountsStoreRepository(store: AccountsStore()),
            settingsRepository: TestSettingsRepository(),
            authRepository: StubAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: 1,
                    planType: "pro",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService()
        )
        let gate = ManualRefreshGate()
        let callCounter = ManualRefreshCallCounter()
        let model = AccountsPageModel(
            coordinator: coordinator,
            manualRefreshService: BlockingAccountsManualRefreshService(
                gate: gate,
                callCounter: callCounter,
                onStart: {}
            )
        )
        model.syncRemoteUsageRefreshActivity(isRefreshing: true)

        await model.refreshUsage()
        let callCount = await callCounter.value

        XCTAssertEqual(callCount, 0)
        await gate.open()
    }

    @MainActor
    func testAccountsPageModelLocalMutationTriggersImmediateCloudSync() async {
        let now: Int64 = 1_763_216_000
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(
                accounts: [
                    StoredAccount(
                        id: "acct-1",
                        label: "Primary",
                        email: "primary@example.com",
                        accountID: "account-1",
                        planType: "pro",
                        teamName: "workspace-x",
                        teamAlias: nil,
                        authJSON: .object([:]),
                        addedAt: now,
                        updatedAt: now,
                        usage: nil,
                        usageError: nil
                    )
                ]
            )
        )
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: StubAuthRepository(),
            usageService: CountingUsageService(
                result: UsageSnapshot(
                    fetchedAt: now,
                    planType: "pro",
                    fiveHour: nil,
                    oneWeek: nil,
                    credits: nil
                )
            ),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService()
        )
        let syncSpy = SpyAccountsLocalMutationSyncService()
        let model = AccountsPageModel(
            coordinator: coordinator,
            localAccountsMutationSyncService: syncSpy,
            onLocalAccountsChanged: { accounts in
                syncSpy.acceptLocalAccountsSnapshot(accounts)
            }
        )

        await model.saveTeamAlias(id: "acct-1", alias: "Renamed")

        for _ in 0..<10 where syncSpy.syncCallCount == 0 {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertEqual(syncSpy.syncCallCount, 1)
        XCTAssertEqual(syncSpy.acceptedSnapshots.last?.first?.teamAlias, "Renamed")
    }

    @MainActor
    func testAccountsPageModelSingleAccountRefreshTargetsOnlyOneAccountAndSyncsMutation() async {
        let now: Int64 = 1_763_216_000
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(
                accounts: [
                    makeStoredAccount(id: "acct-1", accountID: "account-1", now: now),
                    makeStoredAccount(id: "acct-2", accountID: "account-2", now: now),
                ]
            )
        )
        let usageService = RecordingAccountUsageService(
            results: [
                "account-1": makeUsageSnapshot(fetchedAt: now, fiveHourResetAt: now + 300),
                "account-2": makeUsageSnapshot(fetchedAt: now, fiveHourResetAt: now + 600),
            ]
        )
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: MultiAccountAuthRepository(
                extractedByAccountID: [
                    "account-1": makeExtractedAuth(accountID: "account-1"),
                    "account-2": makeExtractedAuth(accountID: "account-2"),
                ]
            ),
            usageService: usageService,
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )
        let syncSpy = SpyAccountsLocalMutationSyncService()
        let model = AccountsPageModel(
            coordinator: coordinator,
            localAccountsMutationSyncService: syncSpy,
            onLocalAccountsChanged: { accounts in
                syncSpy.acceptLocalAccountsSnapshot(accounts)
            }
        )

        await model.refreshUsage(forAccountID: "acct-2")

        let requestedAccountIDs = await usageService.readRequestedAccountIDs()
        XCTAssertEqual(requestedAccountIDs, ["account-2"])

        for _ in 0..<10 where syncSpy.syncCallCount == 0 {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertEqual(syncSpy.syncCallCount, 1)
        XCTAssertTrue(model.refreshingAccountIDs.isEmpty)
        if case .content(let accounts) = model.state {
            XCTAssertEqual(accounts.count, 2)
            XCTAssertNil(accounts.first(where: { $0.id == "acct-1" })?.usage)
            XCTAssertNotNil(accounts.first(where: { $0.id == "acct-2" })?.usage)
        } else {
            XCTFail("Expected refreshed accounts content state")
        }
    }

    @MainActor
    func testTrayMenuModelPushesInitialLocalAccountsBaselineDuringCloudReconciliation() async {
        let now: Int64 = 1_763_216_000
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(
                accounts: [
                    makeStoredAccount(id: "acct-1", accountID: "account-1", now: now)
                ]
            )
        )
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: RecordingAuthRepository(),
            usageService: CountingUsageService(result: makeUsageSnapshot(fetchedAt: now)),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )
        let cloudSyncService = SpyAccountsCloudSyncService(pullResult: .noChange)
        let trayModel = TrayMenuModel(
            accountsCoordinator: coordinator,
            settingsCoordinator: SettingsCoordinator(
                settingsRepository: TestSettingsRepository(),
                launchAtStartupService: StubLaunchAtStartupService()
            ),
            cloudSyncService: cloudSyncService,
            currentAccountSelectionSyncService: nil,
            backgroundRefreshPolicy: .init(
                initialRefreshDelay: .zero,
                cloudReconciliationInterval: .seconds(3),
                usageRefreshInterval: .seconds(30),
                refreshUsageOnRecurringTick: false,
                cloudSyncMode: .pushLocalAccounts,
                applyRemoteSelectionSwitchEffects: false
            ),
            dateProvider: FixedDateProvider(now: now),
            initialAccounts: []
        )

        await trayModel.reconcileCloudStateNow()

        let pushCallCount = await cloudSyncService.readPushCallCount()
        XCTAssertEqual(pushCallCount, 1)
        XCTAssertEqual(trayModel.accounts.map(\.accountID), ["account-1"])
    }

    @MainActor
    func testTrayMenuModelSyncLocalMutationAlsoSyncsConfiguredRemoteAccounts() async {
        let now: Int64 = 1_763_216_000
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(
                accounts: [
                    makeStoredAccount(id: "acct-1", accountID: "account-1", now: now)
                ]
            )
        )
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: TestSettingsRepository(),
            authRepository: RecordingAuthRepository(),
            usageService: CountingUsageService(result: makeUsageSnapshot(fetchedAt: now)),
            chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
            codexCLIService: StubCodexCLIService(),
            editorAppService: StubEditorAppService(),
            opencodeAuthSyncService: StubOpencodeAuthSyncService(),
            dateProvider: FixedDateProvider(now: now)
        )
        let cloudSyncService = SpyAccountsCloudSyncService(pullResult: .noChange)
        let remoteSyncService = SpyRemoteAccountsMutationSyncService()
        let trayModel = TrayMenuModel(
            accountsCoordinator: coordinator,
            settingsCoordinator: SettingsCoordinator(
                settingsRepository: TestSettingsRepository(),
                launchAtStartupService: StubLaunchAtStartupService()
            ),
            cloudSyncService: cloudSyncService,
            currentAccountSelectionSyncService: nil,
            remoteAccountsMutationSyncService: remoteSyncService,
            backgroundRefreshPolicy: .init(
                initialRefreshDelay: .zero,
                cloudReconciliationInterval: .seconds(3),
                usageRefreshInterval: .seconds(30),
                refreshUsageOnRecurringTick: false,
                cloudSyncMode: .pushLocalAccounts,
                applyRemoteSelectionSwitchEffects: false
            ),
            dateProvider: FixedDateProvider(now: now),
            initialAccounts: []
        )

        await trayModel.syncLocalAccountsMutationNow()

        let pushCallCount = await cloudSyncService.readPushCallCount()
        XCTAssertEqual(pushCallCount, 1)
        let remoteSyncCallCount = await remoteSyncService.readCallCount()
        XCTAssertEqual(remoteSyncCallCount, 1)
    }
}

private func makeAccountSummary(
    id: String,
    accountID: String,
    isCurrent: Bool,
    usage: UsageSnapshot?
) -> AccountSummary {
    AccountSummary(
        id: id,
        label: id,
        email: "\(accountID)@example.com",
        accountID: accountID,
        planType: "pro",
        teamName: nil,
        teamAlias: nil,
        addedAt: 1,
        updatedAt: 1,
        usage: usage,
        usageError: nil,
        isCurrent: isCurrent
    )
}

@MainActor
private func makeAccountsPageModelForViewStoreTests(
    initialAccounts: [AccountSummary]
) -> AccountsPageModel {
    let coordinator = AccountsCoordinator(
        storeRepository: InMemoryAccountsStoreRepository(store: AccountsStore()),
        settingsRepository: TestSettingsRepository(),
        authRepository: StubAuthRepository(),
        usageService: CountingUsageService(
            result: UsageSnapshot(
                fetchedAt: 1,
                planType: "pro",
                fiveHour: nil,
                oneWeek: nil,
                credits: nil
            )
        ),
        chatGPTOAuthLoginService: StubChatGPTOAuthLoginService(),
        codexCLIService: StubCodexCLIService(),
        editorAppService: StubEditorAppService(),
        opencodeAuthSyncService: StubOpencodeAuthSyncService()
    )

    return AccountsPageModel(
        coordinator: coordinator,
        onLocalAccountsChanged: nil,
        initialAccounts: initialAccounts
    )
}

private func makeStoredAccount(
    id: String,
    accountID: String,
    now: Int64
) -> StoredAccount {
    StoredAccount(
        id: id,
        label: id,
        email: "\(accountID)@example.com",
        accountID: accountID,
        planType: "pro",
        teamName: nil,
        teamAlias: nil,
        authJSON: .object([
            "account_id": .string(accountID)
        ]),
        addedAt: now,
        updatedAt: now,
        usage: nil,
        usageError: nil
    )
}

private func makeUsageSnapshot(
    fetchedAt: Int64,
    fiveHourResetAt: Int64? = nil,
    oneWeekResetAt: Int64? = nil
) -> UsageSnapshot {
    UsageSnapshot(
        fetchedAt: fetchedAt,
        planType: "pro",
        fiveHour: UsageWindow(
            usedPercent: 10,
            windowSeconds: 18_000,
            resetAt: fiveHourResetAt
        ),
        oneWeek: UsageWindow(
            usedPercent: 20,
            windowSeconds: 604_800,
            resetAt: oneWeekResetAt
        ),
        credits: nil
    )
}

private func makeExtractedAuth(accountID: String) -> ExtractedAuth {
    ExtractedAuth(
        accountID: accountID,
        accessToken: "token-\(accountID)",
        email: "\(accountID)@example.com",
        planType: "pro",
        teamName: "workspace-\(accountID)"
    )
}

private final class InMemoryAccountsStoreRepository: AccountsStoreRepository, @unchecked Sendable {
    private var store: AccountsStore

    init(store: AccountsStore) {
        self.store = store
    }

    func loadStore() throws -> AccountsStore {
        store
    }

    func saveStore(_ store: AccountsStore) throws {
        self.store = store
    }
}

private final class CountingUsageService: UsageService, @unchecked Sendable {
    private(set) var callCount = 0
    private let result: UsageSnapshot

    init(result: UsageSnapshot) {
        self.result = result
    }

    func fetchUsage(accessToken: String, accountID: String) async throws -> UsageSnapshot {
        _ = accessToken
        _ = accountID
        callCount += 1
        return result
    }
}

private final class AccountIDUsageService: UsageService, @unchecked Sendable {
    private let results: [String: UsageSnapshot]

    init(results: [String: UsageSnapshot]) {
        self.results = results
    }

    func fetchUsage(accessToken: String, accountID: String) async throws -> UsageSnapshot {
        _ = accessToken
        guard let result = results[accountID] else {
            throw AppError.invalidData("Missing usage snapshot for \(accountID)")
        }
        return result
    }
}

private actor RecordingAccountUsageService: UsageService {
    private let results: [String: UsageSnapshot]
    private(set) var requestedAccountIDs: [String] = []

    init(results: [String: UsageSnapshot]) {
        self.results = results
    }

    func fetchUsage(accessToken: String, accountID: String) async throws -> UsageSnapshot {
        _ = accessToken
        requestedAccountIDs.append(accountID)
        guard let result = results[accountID] else {
            throw AppError.invalidData("Missing usage snapshot for \(accountID)")
        }
        return result
    }

    func readRequestedAccountIDs() -> [String] {
        requestedAccountIDs
    }
}

private struct FixedDateProvider: DateProviding {
    let now: Int64

    func unixSecondsNow() -> Int64 {
        now
    }
}

private final class StubWorkspaceMetadataService: WorkspaceMetadataService, @unchecked Sendable {
    private let metadata: [WorkspaceMetadata]

    init(metadata: [WorkspaceMetadata]) {
        self.metadata = metadata
    }

    func fetchWorkspaceMetadata(accessToken: String) async throws -> [WorkspaceMetadata] {
        _ = accessToken
        return metadata
    }
}

private final class RecordingWorkspaceMetadataService: WorkspaceMetadataService, @unchecked Sendable {
    private(set) var callCount = 0
    private let metadata: [WorkspaceMetadata]

    init(metadata: [WorkspaceMetadata]) {
        self.metadata = metadata
    }

    func fetchWorkspaceMetadata(accessToken: String) async throws -> [WorkspaceMetadata] {
        _ = accessToken
        callCount += 1
        return metadata
    }
}

private final class StubAccountsManualRefreshService: AccountsManualRefreshServiceProtocol, @unchecked Sendable {
    func performManualRefresh(
        onPartialUpdate: @escaping @MainActor ([AccountSummary]) -> Void
    ) async throws -> [AccountSummary] {
        _ = onPartialUpdate
        return []
    }
}

private actor SpyRemoteAccountsMutationSyncService: RemoteAccountsMutationSyncServiceProtocol {
    private var callCount = 0

    func syncConfiguredRemoteAccounts() async -> RemoteAccountsMutationSyncReport {
        callCount += 1
        return .empty
    }

    func readCallCount() -> Int {
        callCount
    }
}

@MainActor
private final class SpyAccountsLocalMutationSyncService: AccountsLocalMutationSyncServiceProtocol {
    private(set) var acceptedSnapshots: [[AccountSummary]] = []
    private(set) var syncCallCount = 0

    func acceptLocalAccountsSnapshot(_ accounts: [AccountSummary]) {
        acceptedSnapshots.append(accounts)
    }

    func syncLocalAccountsMutationNow() async {
        syncCallCount += 1
    }
}

private actor ManualRefreshGate {
    private var continuation: CheckedContinuation<Void, Never>?

    func wait() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func open() {
        continuation?.resume()
        continuation = nil
    }
}

private actor ManualRefreshCallCounter {
    private(set) var value = 0

    func increment() {
        value += 1
    }
}

private final class BlockingAccountsManualRefreshService: AccountsManualRefreshServiceProtocol, @unchecked Sendable {
    private let gate: ManualRefreshGate
    private let callCounter: ManualRefreshCallCounter
    private let onStart: @Sendable () -> Void

    init(
        gate: ManualRefreshGate,
        callCounter: ManualRefreshCallCounter,
        onStart: @escaping @Sendable () -> Void
    ) {
        self.gate = gate
        self.callCounter = callCounter
        self.onStart = onStart
    }

    func performManualRefresh(
        onPartialUpdate: @escaping @MainActor ([AccountSummary]) -> Void
    ) async throws -> [AccountSummary] {
        _ = onPartialUpdate
        await callCounter.increment()
        onStart()
        await gate.wait()
        return []
    }
}

private final class StubAuthRepository: AuthRepository, @unchecked Sendable {
    func readCurrentAuth() throws -> JSONValue { .null }
    func readCurrentAuthOptional() throws -> JSONValue? { nil }
    func readAuth(from url: URL) throws -> JSONValue {
        _ = url
        return .null
    }
    func writeCurrentAuth(_ auth: JSONValue) throws {
        _ = auth
    }
    func removeCurrentAuth() throws {}
    func makeChatGPTAuth(from tokens: ChatGPTOAuthTokens) throws -> JSONValue {
        _ = tokens
        return .null
    }
    func extractAuth(from auth: JSONValue) throws -> ExtractedAuth {
        _ = auth
        return ExtractedAuth(
            accountID: "account-1",
            accessToken: "token-1",
            email: "test@example.com",
            planType: "pro",
            teamName: "workspace-x"
        )
    }
}

private final class RemoteLookupAuthRepository: AuthRepository, @unchecked Sendable {
    func readCurrentAuth() throws -> JSONValue { .object([:]) }
    func readCurrentAuthOptional() throws -> JSONValue? { .object([:]) }
    func readAuth(from url: URL) throws -> JSONValue {
        _ = url
        return .object([:])
    }
    func writeCurrentAuth(_ auth: JSONValue) throws {
        _ = auth
    }
    func removeCurrentAuth() throws {}
    func makeChatGPTAuth(from tokens: ChatGPTOAuthTokens) throws -> JSONValue {
        _ = tokens
        return .object([:])
    }
    func extractAuth(from auth: JSONValue) throws -> ExtractedAuth {
        _ = auth
        return ExtractedAuth(
            accountID: "account-1",
            accessToken: "token-1",
            email: "test@example.com",
            planType: "team",
            teamName: nil
        )
    }
}

private final class RecordingAuthRepository: AuthRepository, @unchecked Sendable {
    private(set) var writtenAccountCount = 0

    func readCurrentAuth() throws -> JSONValue { .null }
    func readCurrentAuthOptional() throws -> JSONValue? { nil }
    func readAuth(from url: URL) throws -> JSONValue {
        _ = url
        return .null
    }
    func writeCurrentAuth(_ auth: JSONValue) throws {
        _ = auth
        writtenAccountCount += 1
    }
    func removeCurrentAuth() throws {}
    func makeChatGPTAuth(from tokens: ChatGPTOAuthTokens) throws -> JSONValue {
        _ = tokens
        return .null
    }
    func extractAuth(from auth: JSONValue) throws -> ExtractedAuth {
        _ = auth
        return ExtractedAuth(
            accountID: "account-1",
            accessToken: "token-1",
            email: "test@example.com",
            planType: "pro",
            teamName: "workspace-x"
        )
    }
}

private final class MultiAccountAuthRepository: AuthRepository, @unchecked Sendable {
    private let extractedByAccountID: [String: ExtractedAuth]

    init(extractedByAccountID: [String: ExtractedAuth]) {
        self.extractedByAccountID = extractedByAccountID
    }

    func readCurrentAuth() throws -> JSONValue { .null }
    func readCurrentAuthOptional() throws -> JSONValue? { nil }
    func readAuth(from url: URL) throws -> JSONValue {
        _ = url
        return .null
    }
    func writeCurrentAuth(_ auth: JSONValue) throws {
        _ = auth
    }
    func removeCurrentAuth() throws {}
    func makeChatGPTAuth(from tokens: ChatGPTOAuthTokens) throws -> JSONValue {
        _ = tokens
        return .null
    }
    func extractAuth(from auth: JSONValue) throws -> ExtractedAuth {
        guard case .object(let payload) = auth,
              case .string(let accountID)? = payload["account_id"],
              let extracted = extractedByAccountID[accountID] else {
            throw AppError.invalidData("Missing extracted auth for test payload")
        }
        return extracted
    }
}

private actor PartialUpdateRecorder {
    private var snapshots: [[AccountSummary]] = []

    func record(_ accounts: [AccountSummary]) {
        snapshots.append(accounts)
    }

    func values() -> [[AccountSummary]] {
        snapshots
    }
}

private final class StubChatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol, @unchecked Sendable {
    func signInWithChatGPT(timeoutSeconds: TimeInterval) async throws -> ChatGPTOAuthTokens {
        _ = timeoutSeconds
        return ChatGPTOAuthTokens(accessToken: "", refreshToken: "", idToken: "", apiKey: nil)
    }
}

private final class StubCodexCLIService: CodexCLIServiceProtocol, @unchecked Sendable {
    func launchApp(workspacePath: String?) throws -> Bool {
        _ = workspacePath
        return false
    }
}

private final class RecordingCodexCLIService: CodexCLIServiceProtocol, @unchecked Sendable {
    private(set) var launchCallCount = 0

    func launchApp(workspacePath: String?) throws -> Bool {
        _ = workspacePath
        launchCallCount += 1
        return false
    }
}

private final class StubEditorAppService: EditorAppServiceProtocol, @unchecked Sendable {
    func listInstalledApps() -> [InstalledEditorApp] { [] }
    func restartSelectedApps(_ targets: [EditorAppID]) -> (restarted: [EditorAppID], error: String?) {
        _ = targets
        return ([], nil)
    }
}

private final class RecordingEditorAppService: EditorAppServiceProtocol, @unchecked Sendable {
    private(set) var restartCallCount = 0

    func listInstalledApps() -> [InstalledEditorApp] { [] }

    func restartSelectedApps(_ targets: [EditorAppID]) -> (restarted: [EditorAppID], error: String?) {
        _ = targets
        restartCallCount += 1
        return ([], nil)
    }
}

private final class StubOpencodeAuthSyncService: OpencodeAuthSyncServiceProtocol, @unchecked Sendable {
    func syncFromCodexAuth(_ authJSON: JSONValue) throws {
        _ = authJSON
    }
}

private actor SpyAccountsCloudSyncService: AccountsCloudSyncServiceProtocol {
    private(set) var pushCallCount = 0
    private let pullResult: AccountsCloudSyncPullResult

    init(pullResult: AccountsCloudSyncPullResult) {
        self.pullResult = pullResult
    }

    func pushLocalAccountsIfNeeded() async throws {
        pushCallCount += 1
    }

    func pullRemoteAccountsIfNeeded(
        currentTime: Int64,
        maximumSnapshotAgeSeconds: Int64
    ) async throws -> AccountsCloudSyncPullResult {
        _ = currentTime
        _ = maximumSnapshotAgeSeconds
        return pullResult
    }

    func ensurePushSubscriptionIfNeeded() async throws {}

    func readPushCallCount() -> Int {
        pushCallCount
    }
}

private final class StubLaunchAtStartupService: LaunchAtStartupServiceProtocol, @unchecked Sendable {
    func setEnabled(_ enabled: Bool) throws {
        _ = enabled
    }

    func syncWithStoreValue(_ enabled: Bool) throws {
        _ = enabled
    }
}
