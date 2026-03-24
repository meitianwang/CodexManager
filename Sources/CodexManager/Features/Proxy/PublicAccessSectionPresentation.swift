import Foundation

enum PublicAccessTextTruncation: Equatable {
    case tail
    case middle
}

struct PublicAccessCalloutPresentation: Equatable {
    let title: String
    let message: String
}

struct PublicAccessModeCardDescriptor: Identifiable, Equatable {
    let mode: CloudflaredTunnelMode
    let kicker: String
    let title: String
    let message: String
    let selected: Bool
    let isEnabled: Bool

    var id: String {
        mode.rawValue
    }
}

struct PublicAccessInfoCardDescriptor: Identifiable, Equatable {
    let id: String
    let title: String
    let headline: String
    let detailText: String
    let copyValue: String?
    let allowsTextSelection: Bool
    let truncation: PublicAccessTextTruncation
}

enum PublicAccessSectionPresentation {
    static func startLocalProxyCallout(
        isProxyRunning: Bool
    ) -> PublicAccessCalloutPresentation? {
        guard !isProxyRunning else { return nil }
        return PublicAccessCalloutPresentation(
            title: L10n.tr("proxy.public.callout.start_local_first_title"),
            message: L10n.tr("proxy.public.callout.start_local_first_message")
        )
    }

    static func quickModeCallout(
        mode: CloudflaredTunnelMode
    ) -> PublicAccessCalloutPresentation? {
        guard mode == .quick else { return nil }
        return PublicAccessCalloutPresentation(
            title: L10n.tr("proxy.public.quick_note_title"),
            message: L10n.tr("proxy.public.quick_note_message")
        )
    }

    static func modeCards(
        selectedMode: CloudflaredTunnelMode,
        isEnabled: Bool
    ) -> [PublicAccessModeCardDescriptor] {
        [
            PublicAccessModeCardDescriptor(
                mode: .quick,
                kicker: L10n.tr("proxy.public.mode.quick_kicker"),
                title: L10n.tr("proxy.public.mode.quick_title"),
                message: L10n.tr("proxy.public.mode.quick_message"),
                selected: selectedMode == .quick,
                isEnabled: isEnabled
            ),
            PublicAccessModeCardDescriptor(
                mode: .named,
                kicker: L10n.tr("proxy.public.mode.named_kicker"),
                title: L10n.tr("proxy.public.mode.named_title"),
                message: L10n.tr("proxy.public.mode.named_message"),
                selected: selectedMode == .named,
                isEnabled: isEnabled
            )
        ]
    }

    static func statusCards(
        status: CloudflaredStatus
    ) -> [PublicAccessInfoCardDescriptor] {
        [
            PublicAccessInfoCardDescriptor(
                id: "status",
                title: L10n.tr("proxy.public.status_title"),
                headline: status.running
                    ? L10n.tr("proxy.status.running")
                    : L10n.tr("proxy.status.stopped"),
                detailText: status.running
                    ? L10n.tr("proxy.public.status_running_message")
                    : L10n.tr("proxy.public.status_stopped_message"),
                copyValue: nil,
                allowsTextSelection: false,
                truncation: .tail
            ),
            PublicAccessInfoCardDescriptor(
                id: "url",
                title: L10n.tr("proxy.public.url_title"),
                headline: status.publicURL ?? L10n.tr("proxy.value.generated_after_start"),
                detailText: "",
                copyValue: status.publicURL,
                allowsTextSelection: true,
                truncation: .middle
            ),
            PublicAccessInfoCardDescriptor(
                id: "install-path",
                title: L10n.tr("proxy.public.install_path_title"),
                headline: status.binaryPath ?? L10n.tr("proxy.public.not_detected"),
                detailText: "",
                copyValue: nil,
                allowsTextSelection: false,
                truncation: .middle
            ),
            PublicAccessInfoCardDescriptor(
                id: "last-error",
                title: L10n.tr("proxy.detail.last_error"),
                headline: status.lastError ?? L10n.tr("common.none"),
                detailText: "",
                copyValue: nil,
                allowsTextSelection: false,
                truncation: .tail
            )
        ]
    }
}
