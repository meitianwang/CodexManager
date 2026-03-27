import Foundation
import Combine
#if canImport(AppKit)
import AppKit
#endif

enum ProxyEndpoint: String, CaseIterable, Identifiable {
    case chatCompletions = "/v1/chat/completions"
    case responses = "/v1/responses"
    case messages = "/v1/messages"

    var id: String { rawValue }

    var method: String { "POST" }

    var descriptionKey: String {
        switch self {
        case .chatCompletions: return "proxy.endpoint.chat_completions"
        case .responses: return "proxy.endpoint.responses"
        case .messages: return "proxy.endpoint.messages"
        }
    }
}

/// Single source of truth for the model list exposed by the proxy.
let proxyAvailableModels = [
    "gpt-5", "gpt-5-mini", "gpt-5-4",
    "o3", "o3-pro", "o4-mini",
    "codex-mini-latest",
]

@MainActor
final class ProxyPageModel: ObservableObject {
    private let proxyCoordinator: ProxyCoordinator?

    private let noticeScheduler = NoticeAutoDismissScheduler()

    @Published var isRunning = false
    @Published var port: String = String(ProxyCoordinator.defaultPort)
    @Published var apiKey: String = ""
    @Published var selectedEndpoint: ProxyEndpoint = .chatCompletions
    @Published var selectedModel: String = proxyAvailableModels[0]
    @Published var availableModels: [String] = proxyAvailableModels
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
            refreshModels()
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func stopProxy() async {
        guard let proxyCoordinator else { return }
        await proxyCoordinator.stop()
        isRunning = false
        apiKey = ""
        availableModels = proxyAvailableModels
        selectedModel = proxyAvailableModels[0]
        notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.stopped"))
    }

    private func refreshModels() {
        guard let proxyCoordinator else { return }
        Task {
            await proxyCoordinator.refreshModels()
            let fetched = await proxyCoordinator.fetchedModels
            if let fetched, !fetched.isEmpty {
                availableModels = fetched
                if !fetched.contains(selectedModel) {
                    selectedModel = fetched[0]
                }
            }
        }
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
