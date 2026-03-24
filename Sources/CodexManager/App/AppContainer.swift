import Foundation
import Combine
#if canImport(AppKit)
import AppKit
#endif

@MainActor
final class AppContainer {
    let accountsModel: AccountsPageModel
    let settingsModel: SettingsPageModel
    let trayModel: TrayMenuModel

    private let settingsCoordinator: SettingsCoordinator
    private let accountsWidgetSnapshotWriter: AccountsWidgetSnapshotWriter
    private let proxyCoordinator: ProxyCoordinator
    private let proxyControlCloudSyncService: CloudKitProxyControlSyncService
    private var accountsWidgetSnapshotCancellable: AnyCancellable?

    lazy var proxyControlBridge: ProxyControlBridge = ProxyControlBridge(
        proxyCoordinator: proxyCoordinator,
        settingsCoordinator: settingsCoordinator,
        cloudSyncService: proxyControlCloudSyncService
    )

    lazy var proxyModel: ProxyPageModel = ProxyPageModel(
        coordinator: proxyCoordinator,
        settingsCoordinator: settingsCoordinator,
        proxyControlCloudSyncService: proxyControlCloudSyncService,
        localProxyCommandService: proxyControlBridge,
        chooseIdentityFilePath: {
            #if canImport(AppKit)
            let panel = NSOpenPanel()
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.canCreateDirectories = false
            panel.title = "Select SSH key file"
            guard panel.runModal() == .OK else { return nil }
            return panel.url?.path
            #else
            return nil
            #endif
        }
    )

    static func liveOrCrash() -> AppContainer {
        do {
            let paths = try FileSystemPaths.live()
            let storeRepository = StoreFileRepository(paths: paths)
            let settingsRepository = SettingsFileRepository(paths: paths)
            let authRepository = AuthFileRepository(paths: paths)
            let initialAccounts = try initialAccountsSnapshot(using: storeRepository)
            let usageService = DefaultUsageService(configPath: paths.codexConfigPath)
            let workspaceMetadataService = DefaultWorkspaceMetadataService(configPath: paths.codexConfigPath)
            let chatGPTOAuthLoginService = OpenAIChatGPTOAuthLoginService(configPath: paths.codexConfigPath)
            let codexCLIService = CodexCLIService()
            let editorAppService = EditorAppService()
            let opencodeSyncService = OpencodeAuthSyncService()
            let launchAtStartupService = LaunchAtStartupService()
            let cloudSyncService = CloudKitAccountsSyncService(storeRepository: storeRepository)
            let cloudSyncAvailabilityService = CloudSyncAvailabilityService()
            let currentAccountSelectionSyncService = CloudKitCurrentAccountSelectionSyncService(
                storeRepository: storeRepository,
                authRepository: authRepository
            )
            let proxyCoordinator = ProxyCoordinator(
                proxyService: SwiftNativeProxyRuntimeService(
                    paths: paths,
                    storeRepository: storeRepository,
                    settingsRepository: settingsRepository,
                    authRepository: authRepository
                ),
                cloudflaredService: CloudflaredService(paths: paths),
                remoteService: RemoteProxyService(
                    repoRoot: RepositoryLocator.findRepoRoot(startingAt: URL(fileURLWithPath: #filePath)),
                    sourceAccountStorePath: paths.accountStorePath
                )
            )
            let proxyControlCloudSyncService = CloudKitProxyControlSyncService()

            let settingsCoordinator = SettingsCoordinator(
                settingsRepository: settingsRepository,
                launchAtStartupService: launchAtStartupService
            )
            try launchAtStartupService.syncWithStoreValue(settingsRepository.loadSettings().launchAtStartup)
            let accountsWidgetSnapshotWriter = AccountsWidgetSnapshotWriter(
                localeProvider: {
                    let identifier = (try? await settingsCoordinator.currentSettings().locale)
                        ?? AppLocale.systemDefault.identifier
                    return Locale(identifier: AppLocale.resolve(identifier).identifier)
                }
            )
            let accountsCoordinator = AccountsCoordinator(
                storeRepository: storeRepository,
                settingsRepository: settingsRepository,
                authRepository: authRepository,
                usageService: usageService,
                workspaceMetadataService: workspaceMetadataService,
                chatGPTOAuthLoginService: chatGPTOAuthLoginService,
                codexCLIService: codexCLIService,
                editorAppService: editorAppService,
                opencodeAuthSyncService: opencodeSyncService
            )
            let remoteAccountsMutationSyncService = RemoteAccountsMutationSyncService(
                settingsCoordinator: settingsCoordinator,
                proxyCoordinator: proxyCoordinator
            )
            let trayModel = TrayMenuModel(
                accountsCoordinator: accountsCoordinator,
                settingsCoordinator: settingsCoordinator,
                cloudSyncService: cloudSyncService,
                currentAccountSelectionSyncService: currentAccountSelectionSyncService,
                remoteAccountsMutationSyncService: remoteAccountsMutationSyncService,
                backgroundRefreshPolicy: .forPlatform(PlatformCapabilities.currentPlatform),
                initialAccounts: initialAccounts
            )
            let settingsModel = SettingsPageModel(
                settingsCoordinator: settingsCoordinator,
                editorAppService: editorAppService,
                onSettingsUpdated: { settings in
                    trayModel.applySettings(settings)
                    Task {
                        await accountsWidgetSnapshotWriter.write(accounts: trayModel.accounts)
                    }
                },
                onQuitRequested: {
                    #if canImport(AppKit)
                    NSApp.terminate(nil)
                    #endif
                }
            )

            return AppContainer(
                settingsCoordinator: settingsCoordinator,
                accountsWidgetSnapshotWriter: accountsWidgetSnapshotWriter,
                proxyCoordinator: proxyCoordinator,
                proxyControlCloudSyncService: proxyControlCloudSyncService,
                accountsModel: AccountsPageModel(
                    coordinator: accountsCoordinator,
                    manualRefreshService: trayModel,
                    localAccountsMutationSyncService: trayModel,
                    currentAccountSelectionSyncService: currentAccountSelectionSyncService,
                    cloudSyncAvailabilityService: cloudSyncAvailabilityService,
                    onLocalAccountsChanged: { accounts in
                        trayModel.acceptLocalAccountsSnapshot(accounts)
                    },
                    initialAccounts: initialAccounts
                ),
                settingsModel: settingsModel,
                trayModel: trayModel
            )
        } catch {
            fatalError("Failed to bootstrap Swift migration app: \(error.localizedDescription)")
        }
    }

    private init(
        settingsCoordinator: SettingsCoordinator,
        accountsWidgetSnapshotWriter: AccountsWidgetSnapshotWriter,
        proxyCoordinator: ProxyCoordinator,
        proxyControlCloudSyncService: CloudKitProxyControlSyncService,
        accountsModel: AccountsPageModel,
        settingsModel: SettingsPageModel,
        trayModel: TrayMenuModel
    ) {
        self.settingsCoordinator = settingsCoordinator
        self.accountsWidgetSnapshotWriter = accountsWidgetSnapshotWriter
        self.proxyCoordinator = proxyCoordinator
        self.proxyControlCloudSyncService = proxyControlCloudSyncService
        self.accountsModel = accountsModel
        self.settingsModel = settingsModel
        self.trayModel = trayModel
        accountsWidgetSnapshotCancellable = trayModel.$accounts
            .removeDuplicates()
            .sink { [accountsWidgetSnapshotWriter] accounts in
                Task {
                    await accountsWidgetSnapshotWriter.write(accounts: accounts)
                }
            }
        Task {
            await accountsWidgetSnapshotWriter.write(accounts: trayModel.accounts)
        }
    }

    private static func initialAccountsSnapshot(
        using storeRepository: StoreFileRepository
    ) throws -> [AccountSummary] {
        let store = try storeRepository.loadStore()
        return store.accountSummaries(currentAccountKey: nil)
    }
}
