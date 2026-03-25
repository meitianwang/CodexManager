import Foundation
import Combine
#if canImport(AppKit)
import AppKit
#endif

@MainActor
final class ProxyPageModel: ObservableObject {
    let coordinator: ProxyCoordinator
    let settingsCoordinator: SettingsCoordinator
    let dateProvider: DateProviding
    let runtimePlatform: RuntimePlatform

    private let noticeScheduler = NoticeAutoDismissScheduler()

    var hasLoaded = false
    var didRunLaunchBootstrap = false
    var lastSyncedProxyConfiguration: ProxyConfiguration?

    @Published var proxyStatus: ApiProxyStatus = .idle
    @Published var preferredPortText = "8787"
    @Published var autoStartProxy = false

    // Model list
    @Published var availableModels: [String] = []
    @Published var isLoadingModels = false

    // cURL example
    @Published var selectedCurlModel: String?
    @Published var copiedField: String?

    // Claude Code config
    @Published var claudeOpusModel = ""
    @Published var claudeSonnetModel = ""
    @Published var claudeHaikuModel = ""
    @Published var claudeConfigSaving = false
    @Published var claudeConfigSaved = false
    @Published var claudeConfigResetting = false
    @Published var claudeConfigReset = false

    @Published var loading = false
    @Published var notice: NoticeMessage? {
        didSet {
            noticeScheduler.schedule(notice) { [weak self] in
                self?.notice = nil
            }
        }
    }

    init(
        coordinator: ProxyCoordinator,
        settingsCoordinator: SettingsCoordinator,
        dateProvider: DateProviding = SystemDateProvider(),
        runtimePlatform: RuntimePlatform = PlatformCapabilities.currentPlatform
    ) {
        self.coordinator = coordinator
        self.settingsCoordinator = settingsCoordinator
        self.dateProvider = dateProvider
        self.runtimePlatform = runtimePlatform
    }

    var apiProxyActionButtons: [ProxyActionButtonDescriptor<ApiProxyActionIntent>] {
        ProxyActionPresentation.apiProxyButtons(
            isRunning: proxyStatus.running,
            isLoading: loading
        )
    }

    func handleAPIProxyAction(_ intent: ApiProxyActionIntent) async {
        switch intent {
        case .refreshStatus:
            await refreshStatus()
        case .start:
            await startProxy()
        case .stop:
            await stopProxy()
        }
    }
}
