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
    private var accountsWidgetSnapshotCancellable: AnyCancellable?

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
            let launchAtStartupService = LaunchAtStartupService()
            let cloudSyncService = CloudKitAccountsSyncService(storeRepository: storeRepository)
            let cloudSyncAvailabilityService = CloudSyncAvailabilityService()
            let currentAccountSelectionSyncService = CloudKitCurrentAccountSelectionSyncService(
                storeRepository: storeRepository,
                authRepository: authRepository
            )
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
                editorAppService: editorAppService
            )
            let trayModel = TrayMenuModel(
                accountsCoordinator: accountsCoordinator,
                settingsCoordinator: settingsCoordinator,
                cloudSyncService: cloudSyncService,
                currentAccountSelectionSyncService: currentAccountSelectionSyncService,
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
        accountsModel: AccountsPageModel,
        settingsModel: SettingsPageModel,
        trayModel: TrayMenuModel
    ) {
        self.settingsCoordinator = settingsCoordinator
        self.accountsWidgetSnapshotWriter = accountsWidgetSnapshotWriter
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
