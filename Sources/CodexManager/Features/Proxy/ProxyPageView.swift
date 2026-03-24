import SwiftUI

struct ProxyPageView: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        ScrollView {
            VStack(spacing: LayoutRules.sectionSpacing) {
                if model.usesRemoteMacControl, model.showsRemoteControlCallout {
                    remoteControlCalloutSection
                }

                ApiProxySectionView(model: model)
                remoteCapabilitySection
                publicCapabilitySection
            }
            .padding(LayoutRules.pagePadding)
        }
        .scrollIndicators(.hidden)
        .task {
            await model.loadIfNeeded()
        }
    }

    private var remoteControlCalloutSection: some View {
        SectionCard(
            title: L10n.tr("proxy.callout.remote_control.title"),
            headerTrailing: {
                CloseGlassButton {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        model.showsRemoteControlCallout = false
                    }
                }
            }
        ) {
            Text(L10n.tr("proxy.callout.remote_control.message"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var remoteCapabilitySection: some View {
        if model.canManageRemoteServers {
            RemoteServersSectionView(model: model)
        } else {
            ProxyInfoOnlySection(
                title: L10n.tr("proxy.section.remote_servers"),
                message: L10n.tr("proxy.remote.unavailable_message")
            )
        }
    }

    @ViewBuilder
    private var publicCapabilitySection: some View {
        if model.canManagePublicTunnel {
            PublicAccessSection(model: model, onCopy: PlatformClipboard.copy)
        } else {
            ProxyInfoOnlySection(
                title: L10n.tr("proxy.section.public_access"),
                message: L10n.tr("proxy.public.unavailable_message")
            )
        }
    }
}
