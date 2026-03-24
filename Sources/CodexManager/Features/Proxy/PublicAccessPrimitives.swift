import SwiftUI

struct PublicAccessSwitchPill: View {
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 8) {
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
            Text(isOn ? L10n.tr("proxy.switch.on") : L10n.tr("proxy.switch.off"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .frostedCapsuleSurface(prominent: isOn, tint: isOn ? .accentColor : nil)
    }
}

struct PublicAccessModeCard: View {
    let kicker: String
    let title: String
    let message: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Text(kicker)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(12)
            .glassSelectableCard(selected: selected, cornerRadius: 12)
        }
        .buttonStyle(.plain)
        .background {
            GeometryReader { proxy in
                Color.clear
                    .preference(key: PublicAccessModeCardHeightKey.self, value: proxy.size.height)
            }
        }
    }
}

struct PublicAccessModeCardHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private extension PublicAccessTextTruncation {
    var swiftUIValue: Text.TruncationMode {
        switch self {
        case .tail:
            .tail
        case .middle:
            .middle
        }
    }
}

struct PublicAccessHeader: View {
    let isExpanded: Bool
    @Binding var isEnabled: Bool
    let onToggleExpanded: () -> Void
    let onToggleEnabled: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text(L10n.tr("proxy.section.public_access"))
                    .font(.headline)

                Spacer(minLength: 0)

                CollapseChevronButton(isExpanded: isExpanded, action: onToggleExpanded)
            }

            HStack(spacing: 10) {
                Text(L10n.tr("proxy.toggle.enable_public_access"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)

                Spacer(minLength: 0)

                PublicAccessSwitchPill(
                    isOn: Binding(
                        get: { isEnabled },
                        set: { value in
                            onToggleEnabled(value)
                        }
                    )
                )
            }
        }
    }
}

struct PublicAccessCalloutCard: View {
    let presentation: PublicAccessCalloutPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(presentation.title)
                .font(.headline)
            Text(presentation.message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .cardSurface(cornerRadius: 12)
    }
}

struct PublicAccessModeGrid: View {
    let descriptors: [PublicAccessModeCardDescriptor]
    let onSelectMode: (CloudflaredTunnelMode) -> Void

    @State private var cardHeight: CGFloat = 0

    var body: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(minimum: 0, maximum: .infinity), spacing: 10),
                GridItem(.flexible(minimum: 0, maximum: .infinity), spacing: 10)
            ],
            spacing: 10
        ) {
            ForEach(descriptors) { descriptor in
                PublicAccessModeCard(
                    kicker: descriptor.kicker,
                    title: descriptor.title,
                    message: descriptor.message,
                    selected: descriptor.selected
                ) {
                    onSelectMode(descriptor.mode)
                }
                .frame(height: cardHeight > 0 ? cardHeight : nil, alignment: .top)
                .disabled(!descriptor.isEnabled)
            }
        }
        .onPreferenceChange(PublicAccessModeCardHeightKey.self) { nextHeight in
            guard nextHeight > 0, abs(cardHeight - nextHeight) > 0.5 else { return }
            cardHeight = nextHeight
        }
    }
}

struct PublicAccessNamedTunnelForm: View {
    let apiToken: Binding<String>
    let accountID: Binding<String>
    let zoneID: Binding<String>
    let hostname: Binding<String>
    let isEnabled: Bool

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: LayoutRules.proxyPublicFieldMinWidth), spacing: 10)],
            spacing: 10
        ) {
            ProxyFieldGroup(title: L10n.tr("proxy.public.field.api_token")) {
                SecureField(
                    L10n.tr("proxy.public.field.api_token_placeholder"),
                    text: apiToken
                )
                .frostedRoundedInput()
                .disabled(!isEnabled)
            }

            ProxyFieldGroup(title: L10n.tr("proxy.public.field.account_id")) {
                TextField(
                    L10n.tr("proxy.public.field.account_id_placeholder"),
                    text: accountID
                )
                .frostedRoundedInput()
                .disabled(!isEnabled)
            }

            ProxyFieldGroup(title: L10n.tr("proxy.public.field.zone_id")) {
                TextField(
                    L10n.tr("proxy.public.field.zone_id_placeholder"),
                    text: zoneID
                )
                .frostedRoundedInput()
                .disabled(!isEnabled)
            }

            ProxyFieldGroup(title: L10n.tr("proxy.public.field.hostname")) {
                TextField(
                    L10n.tr("proxy.public.field.hostname_placeholder"),
                    text: hostname
                )
                .frostedRoundedInput()
                .disabled(!isEnabled)
            }
        }
    }
}

struct PublicAccessToolbar: View {
    let useHTTP2: Bool
    let canEditCloudflaredInput: Bool
    let actionButtons: [ProxyActionButtonDescriptor<PublicAccessActionIntent>]
    let onToggleHTTP2: (Bool) -> Void
    let onAction: @MainActor (PublicAccessActionIntent) async -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                http2ToggleRow
                actionStrip
            }
            .fixedSize(horizontal: true, vertical: false)
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 10) {
                http2ToggleRow
                actionStrip
            }
        }
    }

    private var http2ToggleRow: some View {
        HStack(spacing: 10) {
            Text(L10n.tr("proxy.toggle.use_http2"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            PublicAccessSwitchPill(
                isOn: Binding(
                    get: { useHTTP2 },
                    set: { value in
                        onToggleHTTP2(value)
                    }
                )
            )
            .disabled(!canEditCloudflaredInput)
        }
    }

    private var actionStrip: some View {
        ProxyActionStrip(
            buttons: actionButtons,
            layout: .row(scrollable: false),
            onAction: onAction
        )
    }
}

struct PublicAccessStatusGrid: View {
    let descriptors: [PublicAccessInfoCardDescriptor]
    let onCopy: (String?) -> Void

    var body: some View {
        LazyVStack(spacing: 10) {
            ForEach(descriptors) { descriptor in
                ProxyInfoCard(
                    title: descriptor.title,
                    headline: descriptor.headline,
                    detailText: descriptor.detailText,
                    headlineFont: .title3.weight(.semibold),
                    detailFont: .subheadline,
                    headlineLineLimit: 2,
                    headlineTruncationMode: descriptor.truncation.swiftUIValue,
                    canCopy: descriptor.copyValue != nil,
                    allowsTextSelection: descriptor.allowsTextSelection
                ) {
                    onCopy(descriptor.copyValue)
                }
            }
        }
    }
}
