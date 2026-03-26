import Foundation
import Combine
#if canImport(AppKit)
import AppKit
#endif

@MainActor
final class ProxyPageModel: ObservableObject {
    private let proxyCoordinator: ProxyCoordinator?

    private let noticeScheduler = NoticeAutoDismissScheduler()

    @Published var isRunning = false
    @Published var port: String = String(ProxyCoordinator.defaultPort)
    @Published var apiKey: String = ""
    @Published var notice: NoticeMessage? {
        didSet {
            noticeScheduler.schedule(notice) { [weak self] in
                self?.notice = nil
            }
        }
    }

    var proxyURL: String {
        "http://localhost:\(port)"
    }

    init(proxyCoordinator: ProxyCoordinator) {
        self.proxyCoordinator = proxyCoordinator
    }

    /// Placeholder for platforms where proxy is unavailable.
    fileprivate init() {
        self.proxyCoordinator = nil
    }

    static let placeholder = ProxyPageModel()

    func toggleProxy() {
        Task {
            if isRunning {
                await stopProxy()
            } else {
                await startProxy()
            }
        }
    }

    func startProxy() async {
        guard let proxyCoordinator else { return }

        guard let portValue = UInt16(port), portValue > 0 else {
            notice = NoticeMessage(
                style: .error,
                text: L10n.tr("error.proxy_runtime.invalid_port_format", port)
            )
            return
        }

        do {
            try await proxyCoordinator.start(port: portValue)
            apiKey = await proxyCoordinator.currentAPIKey ?? ""
            isRunning = true
            notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.started"))
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func stopProxy() async {
        guard let proxyCoordinator else { return }
        await proxyCoordinator.stop()
        isRunning = false
        apiKey = ""
        notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.stopped"))
    }

    #if canImport(AppKit)
    func copyProxyURL() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(proxyURL, forType: .string)
        notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.url_copied"))
    }
    #endif
}
