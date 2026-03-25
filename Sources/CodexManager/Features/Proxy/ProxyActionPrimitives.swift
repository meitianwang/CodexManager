import SwiftUI

enum ApiProxyActionIntent: Hashable {
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
}

struct ProxyActionStrip<Intent: Hashable>: View {
    let buttons: [ProxyActionButtonDescriptor<Intent>]
    let onAction: @MainActor (Intent) async -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                actionButtons
            }

            VStack(alignment: .leading, spacing: 8) {
                actionButtons
            }
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        ForEach(buttons) { button in
            actionButton(button)
        }
    }

    private func actionButton(
        _ button: ProxyActionButtonDescriptor<Intent>
    ) -> some View {
        Button(role: button.role.buttonRole) {
            Task { await onAction(button.intent) }
        } label: {
            if button.showsProgress {
                ProgressView()
                    .controlSize(.small)
            } else {
                Text(LocalizedStringKey(button.titleKey))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
        .liquidGlassActionButtonStyle(
            prominent: button.surfaceStyle.isProminent,
            tint: button.surfaceStyle.tint
        )
        .disabled(!button.isEnabled)
    }
}
