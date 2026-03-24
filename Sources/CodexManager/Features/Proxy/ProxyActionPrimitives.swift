import SwiftUI

enum ApiProxyActionIntent: Hashable {
    case refreshStatus
    case start
    case stop
}

enum PublicAccessActionIntent: Hashable {
    case install
    case refreshStatus
    case start
    case stop
}

enum ProxyActionRole: Equatable {
    case standard
    case destructive

    var buttonRole: ButtonRole? {
        switch self {
        case .standard:
            nil
        case .destructive:
            .destructive
        }
    }
}

enum ProxyActionSurfaceStyle: Equatable {
    case regular
    case prominent
    case dangerProminent

    var isProminent: Bool {
        switch self {
        case .regular:
            false
        case .prominent, .dangerProminent:
            true
        }
    }

    var tint: Color? {
        switch self {
        case .dangerProminent:
            .red
        default:
            nil
        }
    }
}

struct ProxyActionButtonDescriptor<Intent: Hashable>: Identifiable, Equatable {
    let intent: Intent
    let titleKey: String
    var role: ProxyActionRole = .standard
    var surfaceStyle: ProxyActionSurfaceStyle = .regular
    var isEnabled: Bool = true
    var showsProgress: Bool = false
    var minimumWidth: CGFloat? = nil

    var id: Intent { intent }
}

struct RemoteServerActionHelpDescriptor: Identifiable, Equatable {
    let action: RemoteServerAction
    let titleKey: String
    let messageKey: String

    var id: RemoteServerAction { action }
}

enum ProxyActionStripLayout: Equatable {
    case row(scrollable: Bool)
    case adaptiveGrid(minimumColumnWidth: CGFloat)
}

enum ProxyActionPresentation {
    static func apiProxyButtons(
        isRunning: Bool,
        isLoading: Bool
    ) -> [ProxyActionButtonDescriptor<ApiProxyActionIntent>] {
        let refresh = ProxyActionButtonDescriptor<ApiProxyActionIntent>(
            intent: .refreshStatus,
            titleKey: "proxy.action.refresh_status",
            isEnabled: !isLoading
        )

        let primary = ProxyActionButtonDescriptor<ApiProxyActionIntent>(
            intent: isRunning ? .stop : .start,
            titleKey: isRunning ? "proxy.action.stop_api_proxy" : "proxy.action.start_api_proxy",
            role: isRunning ? .destructive : .standard,
            surfaceStyle: .prominent,
            isEnabled: !isLoading
        )

        return [refresh, primary]
    }

    static func publicAccessInstallButton(
        isLoading: Bool
    ) -> ProxyActionButtonDescriptor<PublicAccessActionIntent> {
        ProxyActionButtonDescriptor<PublicAccessActionIntent>(
            intent: .install,
            titleKey: "proxy.public.install_action",
            surfaceStyle: .prominent,
            isEnabled: !isLoading
        )
    }

    static func publicAccessButtons(
        isRunning: Bool,
        isLoading: Bool,
        canStart: Bool
    ) -> [ProxyActionButtonDescriptor<PublicAccessActionIntent>] {
        let refresh = ProxyActionButtonDescriptor<PublicAccessActionIntent>(
            intent: .refreshStatus,
            titleKey: "proxy.public.refresh_status",
            isEnabled: !isLoading
        )

        let primary = ProxyActionButtonDescriptor<PublicAccessActionIntent>(
            intent: isRunning ? .stop : .start,
            titleKey: isRunning ? "proxy.public.stop_action" : "proxy.public.start_action",
            role: isRunning ? .destructive : .standard,
            surfaceStyle: isRunning ? .dangerProminent : .prominent,
            isEnabled: isRunning ? !isLoading : canStart
        )

        return [refresh, primary]
    }

    static func remoteServerButtons(
        isRunning: Bool,
        activeAction: RemoteServerAction?
    ) -> [ProxyActionButtonDescriptor<RemoteServerAction>] {
        let intents: [RemoteServerAction] = isRunning
            ? [.save, .removeLocal, .discover, .deploy, .syncAccounts, .refresh, .stop, .logs, .uninstall]
            : [.save, .removeLocal, .discover, .deploy, .syncAccounts, .refresh, .start, .logs, .uninstall]

        return intents.map { intent in
            ProxyActionButtonDescriptor(
                intent: intent,
                titleKey: titleKey(for: intent),
                role: role(for: intent),
                surfaceStyle: surfaceStyle(for: intent),
                isEnabled: activeAction == nil,
                showsProgress: activeAction == intent,
                minimumWidth: LayoutRules.proxyRemoteActionGridMinWidth
            )
        }
    }

    private static func titleKey(for intent: RemoteServerAction) -> String {
        switch intent {
        case .save:
            "common.save"
        case .removeLocal:
            "proxy.remote.action.remove_local"
        case .discover:
            "proxy.remote.action.discover"
        case .syncAccounts:
            "proxy.remote.action.sync_accounts"
        case .refresh:
            "common.refresh"
        case .deploy:
            "common.deploy"
        case .start:
            "common.start"
        case .stop:
            "common.stop"
        case .logs:
            "common.logs"
        case .uninstall:
            "proxy.remote.action.uninstall_remote"
        }
    }

    private static func role(for intent: RemoteServerAction) -> ProxyActionRole {
        switch intent {
        case .removeLocal, .stop, .uninstall:
            .destructive
        default:
            .standard
        }
    }

    private static func surfaceStyle(for intent: RemoteServerAction) -> ProxyActionSurfaceStyle {
        switch intent {
        case .save, .deploy, .syncAccounts:
            .prominent
        case .uninstall:
            .dangerProminent
        default:
            .regular
        }
    }
}

enum RemoteServerActionHelpPresentation {
    static func descriptors(
        from buttons: [ProxyActionButtonDescriptor<RemoteServerAction>]
    ) -> [RemoteServerActionHelpDescriptor] {
        buttons.map { button in
            RemoteServerActionHelpDescriptor(
                action: button.intent,
                titleKey: button.titleKey,
                messageKey: messageKey(for: button.intent)
            )
        }
    }

    private static func messageKey(for action: RemoteServerAction) -> String {
        switch action {
        case .save:
            "proxy.remote.help.save"
        case .removeLocal:
            "proxy.remote.help.remove_local"
        case .discover:
            "proxy.remote.help.discover"
        case .deploy:
            "proxy.remote.help.deploy"
        case .syncAccounts:
            "proxy.remote.help.sync_accounts"
        case .refresh:
            "proxy.remote.help.refresh"
        case .start:
            "proxy.remote.help.start"
        case .stop:
            "proxy.remote.help.stop"
        case .logs:
            "proxy.remote.help.logs"
        case .uninstall:
            "proxy.remote.help.uninstall_remote"
        }
    }
}

struct ProxyActionStrip<Intent: Hashable>: View {
    let buttons: [ProxyActionButtonDescriptor<Intent>]
    var layout: ProxyActionStripLayout = .row(scrollable: false)
    let onAction: @MainActor (Intent) async -> Void

    var body: some View {
        Group {
            switch layout {
            case .row(let scrollable):
                if scrollable {
                    ScrollView(.horizontal) {
                        buttonRow
                    }
                    .scrollIndicators(.hidden)
                } else {
                    buttonRow
                }
            case .adaptiveGrid(let minimumColumnWidth):
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: minimumColumnWidth), spacing: 8)],
                    spacing: 8
                ) {
                    ForEach(buttons) { button in
                        actionButton(button, expandsToFillWidth: true)
                    }
                }
            }
        }
    }

    private var buttonRow: some View {
        HStack(spacing: 8) {
            ForEach(buttons) { button in
                actionButton(button, expandsToFillWidth: false)
            }
        }
    }

    private func actionButton(
        _ button: ProxyActionButtonDescriptor<Intent>,
        expandsToFillWidth: Bool
    ) -> some View {
        Button(role: button.role.buttonRole) {
            Task { await onAction(button.intent) }
        } label: {
            if button.showsProgress {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: expandsToFillWidth ? .infinity : nil)
            } else {
                actionLabel(button, expandsToFillWidth: expandsToFillWidth)
            }
        }
        .frame(
            minWidth: button.minimumWidth,
            maxWidth: expandsToFillWidth ? .infinity : nil
        )
        .fixedSize(horizontal: !expandsToFillWidth, vertical: false)
        .liquidGlassActionButtonStyle(
            prominent: button.surfaceStyle.isProminent,
            tint: button.surfaceStyle.tint
        )
        .disabled(!button.isEnabled)
    }

    private func actionLabel(
        _ button: ProxyActionButtonDescriptor<Intent>,
        expandsToFillWidth: Bool
    ) -> some View {
        Text(LocalizedStringKey(button.titleKey))
            .lineLimit(1)
            .minimumScaleFactor(expandsToFillWidth ? 0.84 : 1)
            .frame(maxWidth: expandsToFillWidth ? .infinity : nil)
            .fixedSize(horizontal: !expandsToFillWidth, vertical: false)
    }
}
