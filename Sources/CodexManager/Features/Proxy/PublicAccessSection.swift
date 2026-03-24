import SwiftUI

struct PublicAccessSection: View {
    @ObservedObject var model: ProxyPageModel
    let onCopy: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PublicAccessHeader(
                isExpanded: model.cloudflaredSectionExpanded,
                isEnabled: model.publicAccessEnabledBinding,
                onToggleExpanded: toggleExpanded,
                onToggleEnabled: model.dispatchPublicAccessEnabledUpdate
            )

            if model.cloudflaredSectionExpanded {
                expandedContent
            }
        }
        .padding(16)
        .cardSurface(cornerRadius: LayoutRules.cardRadius)
    }

    @ViewBuilder
    private var expandedContent: some View {
        if let presentation = PublicAccessSectionPresentation.startLocalProxyCallout(
            isProxyRunning: model.proxyStatus.running
        ) {
            PublicAccessCalloutCard(presentation: presentation)
        }

        if !model.cloudflaredStatus.installed {
            installCard
        } else {
            PublicAccessModeGrid(
                descriptors: PublicAccessSectionPresentation.modeCards(
                    selectedMode: model.cloudflaredTunnelMode,
                    isEnabled: model.canEditCloudflaredInput
                ),
                onSelectMode: model.updateCloudflaredTunnelMode
            )

            if let presentation = PublicAccessSectionPresentation.quickModeCallout(
                mode: model.cloudflaredTunnelMode
            ) {
                PublicAccessCalloutCard(presentation: presentation)
            }

            if model.cloudflaredTunnelMode == .named {
                PublicAccessNamedTunnelForm(
                    apiToken: model.cloudflaredAPITokenBinding,
                    accountID: model.cloudflaredAccountIDBinding,
                    zoneID: model.cloudflaredZoneIDBinding,
                    hostname: model.cloudflaredHostnameBinding,
                    isEnabled: model.canEditCloudflaredInput
                )
            }

            PublicAccessToolbar(
                useHTTP2: model.cloudflaredUseHTTP2,
                canEditCloudflaredInput: model.canEditCloudflaredInput,
                actionButtons: model.publicAccessActionButtons,
                onToggleHTTP2: model.updateCloudflaredUseHTTP2,
                onAction: model.handlePublicAccessAction
            )

            PublicAccessStatusGrid(
                descriptors: PublicAccessSectionPresentation.statusCards(
                    status: model.cloudflaredStatus
                ),
                onCopy: onCopy
            )
        }
    }

    private var installCard: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.tr("proxy.public.not_installed_label"))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                Text(L10n.tr("proxy.public.install_title"))
                    .font(.headline)
                Text(L10n.tr("proxy.public.install_message"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            ProxyActionStrip(
                buttons: [model.publicAccessInstallButton],
                onAction: model.handlePublicAccessAction
            )
        }
        .padding(12)
        .cardSurface(cornerRadius: 12)
    }

    private func toggleExpanded() {
        withAnimation(.easeInOut(duration: 0.2)) {
            model.cloudflaredSectionExpanded.toggle()
        }
    }
}
