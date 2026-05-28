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
    static var barButtonHeight: CGFloat { 28 }

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
        .frame(height: Self.barButtonHeight)
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
            HStack(spacing: 5) {
                Image(systemName: descriptor.systemImage)
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 13, height: 13)
                if let title = descriptor.title {
                    Text(title).lineLimit(1)
                }
            }
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
