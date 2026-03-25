import Foundation
import Combine

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
    @Published var apiProxySectionExpanded = false

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
