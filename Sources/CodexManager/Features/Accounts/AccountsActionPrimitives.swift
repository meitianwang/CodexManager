import SwiftUI

struct AccountsActionStrip<Intent: Hashable>: View {
    let descriptors: [AccountsActionButtonDescriptor<Intent>]
    let onTrigger: (Intent) -> Void

    var body: some View {
        FlowLayout(spacing: LayoutRules.listRowSpacing) {
            ForEach(descriptors) { descriptor in
                AccountsActionBarButton(
                    descriptor: descriptor,
                    onTrigger: onTrigger
                )
            }
        }
    }
}

struct AccountsToolbarButtonGroup<Intent: Hashable>: View {
    let descriptors: [AccountsActionButtonDescriptor<Intent>]
    let onTrigger: (Intent) -> Void

    var body: some View {
        ForEach(descriptors) { descriptor in
            AccountsToolbarButton(
                descriptor: descriptor,
                onTrigger: onTrigger
            )
        }
    }
}

private struct AccountsActionBarButton<Intent: Hashable>: View {
    let descriptor: AccountsActionButtonDescriptor<Intent>
    let onTrigger: (Intent) -> Void

    var body: some View {
        Button {
            onTrigger(descriptor.intent)
        } label: {
            AccountsActionLabel(descriptor: descriptor)
        }
        .disabled(!descriptor.isEnabled)
        .codexManagerActionButtonStyle(
            prominent: descriptor.surfaceStyle != .neutral,
            tint: tintColor,
            density: .compact
        )
        .accessibilityLabel(Text(descriptor.accessibilityLabel))
    }

    private var tintColor: Color? {
        switch descriptor.surfaceStyle {
        case .neutral, .prominent:
            nil
        case .mint:
            AppTheme.accent
        }
    }
}

private struct AccountsToolbarButton<Intent: Hashable>: View {
    let descriptor: AccountsActionButtonDescriptor<Intent>
    let onTrigger: (Intent) -> Void

    var body: some View {
        Button {
            onTrigger(descriptor.intent)
        } label: {
            ToolbarIconLabel(
                systemImage: descriptor.systemImage,
                isSpinning: descriptor.isSpinning,
                opticalScale: descriptor.systemImage == "arrow.trianglehead.clockwise.rotate.90"
                    ? LayoutRules.toolbarRefreshIconOpticalScale
                    : 1
            )
        }
        .disabled(!descriptor.isEnabled)
        .accessibilityLabel(Text(descriptor.accessibilityLabel))
    }
}

private struct AccountsActionLabel<Intent: Hashable>: View {
    let descriptor: AccountsActionButtonDescriptor<Intent>

    var body: some View {
        switch descriptor.contentStyle {
        case .label:
            Label(descriptor.title ?? "", systemImage: descriptor.systemImage)
                .lineLimit(1)
        case .icon:
            ToolbarIconLabel(
                systemImage: descriptor.systemImage,
                isSpinning: descriptor.isSpinning,
                opticalScale: descriptor.systemImage == "arrow.trianglehead.clockwise.rotate.90"
                    ? LayoutRules.toolbarRefreshIconOpticalScale
                    : 1
            )
        }
    }
}
