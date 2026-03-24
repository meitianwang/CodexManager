import SwiftUI

enum ProxyFieldGroupStyle {
    case section
    case uppercaseCaption

    fileprivate var font: Font {
        switch self {
        case .section:
            .subheadline.weight(.semibold)
        case .uppercaseCaption:
            .caption2.weight(.bold)
        }
    }

    fileprivate func displayTitle(for title: String) -> String {
        switch self {
        case .section:
            title
        case .uppercaseCaption:
            title.uppercased()
        }
    }
}

enum ProxyCardTitleDisplayMode {
    case regular
    case uppercased

    fileprivate func displayTitle(for title: String) -> String {
        switch self {
        case .regular:
            title
        case .uppercased:
            title.uppercased()
        }
    }
}

struct ProxyInfoOnlySection: View {
    let title: String
    let message: String

    var body: some View {
        SectionCard(title: title) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

struct ProxyFieldGroup<Content: View>: View {
    let title: String
    var style: ProxyFieldGroupStyle = .section
    @ViewBuilder let content: Content

    init(
        title: String,
        style: ProxyFieldGroupStyle = .section,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.style = style
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(style.displayTitle(for: title))
                .font(style.font)
                .foregroundStyle(.secondary)
            content
        }
    }
}

struct ProxyStatusPill: View {
    let isRunning: Bool

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(isRunning ? Color.mint : Color.gray)
                .frame(width: 7, height: 7)
            Text(isRunning ? L10n.tr("proxy.status.running") : L10n.tr("proxy.status.stopped"))
        }
        .font(.subheadline.weight(.medium))
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .frostedCapsuleSurface()
    }
}

struct ProxyMetricPill: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .frostedCapsuleSurface()
    }
}

struct ProxyCopyableValueCard<Trailing: View>: View {
    let title: String
    let value: String
    let canCopy: Bool
    var titleDisplayMode: ProxyCardTitleDisplayMode = .regular
    var cornerRadius: CGFloat = 12
    var padding: CGFloat = 12
    var valueLineLimit: Int? = 1
    var valueTruncationMode: Text.TruncationMode = .middle
    @ViewBuilder let trailing: Trailing

    init(
        title: String,
        value: String,
        canCopy: Bool,
        titleDisplayMode: ProxyCardTitleDisplayMode = .regular,
        cornerRadius: CGFloat = 12,
        padding: CGFloat = 12,
        valueLineLimit: Int? = 1,
        valueTruncationMode: Text.TruncationMode = .middle,
        @ViewBuilder trailing: () -> Trailing = { EmptyView() }
    ) {
        self.title = title
        self.value = value
        self.canCopy = canCopy
        self.titleDisplayMode = titleDisplayMode
        self.cornerRadius = cornerRadius
        self.padding = padding
        self.valueLineLimit = valueLineLimit
        self.valueTruncationMode = valueTruncationMode
        self.trailing = trailing()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(titleDisplayMode.displayTitle(for: title))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                trailing
                Button("common.copy") {
                    PlatformClipboard.copy(canCopy ? value : nil)
                }
                .liquidGlassActionButtonStyle()
                .disabled(!canCopy)
            }
            Text(value)
                .font(.caption.monospaced())
                .lineLimit(valueLineLimit)
                .truncationMode(valueTruncationMode)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(padding)
        .cardSurface(cornerRadius: cornerRadius)
    }
}

struct ProxyInfoCard: View {
    let title: String
    let headline: String
    let detailText: String
    var headlineFont: Font = .headline
    var detailFont: Font = .caption
    var titleDisplayMode: ProxyCardTitleDisplayMode = .regular
    var headlineLineLimit: Int? = 1
    var headlineTruncationMode: Text.TruncationMode = .tail
    var detailLineLimit: Int? = 1
    var canCopy: Bool = false
    var allowsTextSelection: Bool = false
    var onCopy: (() -> Void)? = nil
    var cornerRadius: CGFloat = 12
    var padding: CGFloat = 12

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(titleDisplayMode.displayTitle(for: title))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let onCopy {
                    Button("common.copy", action: onCopy)
                        .liquidGlassActionButtonStyle()
                        .disabled(!canCopy)
                }
            }
            headlineView
            if !detailText.isEmpty {
                Text(detailText)
                    .font(detailFont)
                    .foregroundStyle(.secondary)
                    .lineLimit(detailLineLimit)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(padding)
        .cardSurface(cornerRadius: cornerRadius)
    }

    @ViewBuilder
    private var headlineView: some View {
        if allowsTextSelection {
            Text(headline)
                .font(headlineFont)
                .lineLimit(headlineLineLimit)
                .truncationMode(headlineTruncationMode)
                .textSelection(.enabled)
        } else {
            Text(headline)
                .font(headlineFont)
                .lineLimit(headlineLineLimit)
                .truncationMode(headlineTruncationMode)
        }
    }
}
