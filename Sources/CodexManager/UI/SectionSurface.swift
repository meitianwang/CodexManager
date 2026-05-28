import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

#if os(macOS)
struct MacPageScrollContainer<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LayoutRules.sectionSpacing) {
                content
            }
            .padding(.horizontal, LayoutRules.macPageHorizontalPadding)
            .padding(.top, LayoutRules.macPageTopPadding)
            .padding(.bottom, LayoutRules.macPageBottomPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.hidden)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(AppTheme.windowBackground)
    }
}
#endif

struct SectionCard<Content: View, HeaderTrailing: View>: View {
    let title: String
    @ViewBuilder let headerTrailing: HeaderTrailing
    @ViewBuilder let content: Content

    init(title: String, @ViewBuilder content: () -> Content) where HeaderTrailing == EmptyView {
        self.title = title
        self.headerTrailing = EmptyView()
        self.content = content()
    }

    init(
        title: String,
        @ViewBuilder headerTrailing: () -> HeaderTrailing,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.headerTrailing = headerTrailing()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                headerTrailing
            }
            content
        }
        .padding(14)
        .cardSurface(cornerRadius: LayoutRules.cardRadius)
    }
}

struct CollapseChevronButton: View {
    let isExpanded: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
        }
        .liquidGlassActionButtonStyle(density: .compact)
        .help(isExpanded ? L10n.tr("accounts.action.collapse_all") : L10n.tr("accounts.action.expand_all"))
    }
}

struct CloseGlassButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
        }
        .accessibilityLabel(L10n.tr("common.close"))
        .liquidGlassActionButtonStyle(density: .compact)
    }
}

struct LanguageMenuButton<Label: View>: View {
    let currentLocale: AppLocale
    let onSelectLocale: (AppLocale) -> Void
    @ViewBuilder let label: Label

    init(
        currentLocale: AppLocale,
        onSelectLocale: @escaping (AppLocale) -> Void,
        @ViewBuilder label: () -> Label
    ) {
        self.currentLocale = currentLocale
        self.onSelectLocale = onSelectLocale
        self.label = label()
    }

    var body: some View {
        Menu {
            ForEach(AppLocale.allCases) { locale in
                Button {
                    onSelectLocale(locale)
                } label: {
                    HStack {
                        Text(L10n.tr(locale.displayNameKey))
                        if locale == currentLocale {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            label
        }
        .accessibilityLabel(Text("settings.language"))
    }
}

struct ToolbarIconLabel: View {
    let systemImage: String
    var isSpinning = false
    var opticalScale = CGFloat(1)

    var body: some View {
        baseIcon
            .modifier(ToolbarIconSpinModifier(isSpinning: isSpinning))
    }

    private var baseIcon: some View {
        Image(systemName: systemImage)
            .font(.system(size: LayoutRules.toolbarIconPointSize, weight: .semibold))
            .foregroundStyle(.primary)
            .scaleEffect(opticalScale)
    }
}

private struct ToolbarIconSpinModifier: ViewModifier {
    let isSpinning: Bool

    func body(content: Content) -> some View {
        if #available(iOS 18.0, macOS 15.0, *) {
            content
                .symbolEffect(.rotate.byLayer, options: .repeating, isActive: isSpinning)
        } else {
            content
                .rotationEffect(.degrees(isSpinning ? 360 : 0))
                .animation(
                    isSpinning
                        ? .linear(duration: 1).repeatForever(autoreverses: false)
                        : .easeOut(duration: 0.2),
                    value: isSpinning
                )
        }
    }
}

struct CardSurfaceModifier: ViewModifier {
    let cornerRadius: CGFloat
    let tint: Color?

    func body(content: Content) -> some View {
        content
            .background { backgroundSurface }
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(separatorColor, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.045), radius: 12, x: 0, y: 6)
    }

    private var backgroundSurface: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(AppTheme.panelBackground)
            if let tint {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(tint.opacity(0.08))
            }
        }
    }

    private var separatorColor: Color {
        AppTheme.separator
    }
}

enum FrostedChromeTokens {
    static var separatorColor: Color {
        AppTheme.separator
    }

    static func tintedGlass(prominent: Bool, tint: Color?) -> Color {
        if let tint {
            return tint.opacity(prominent ? 1 : 0.08)
        }
        return prominent ? AppTheme.accent : AppTheme.controlBackground
    }
}

struct FrostedCapsuleSurfaceModifier: ViewModifier {
    let prominent: Bool
    let tint: Color?

    func body(content: Content) -> some View {
        content
            .background { backgroundSurface }
            .overlay {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(FrostedChromeTokens.separatorColor.opacity(prominent ? 0.85 : 1), lineWidth: 1)
            }
    }

    private var backgroundSurface: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(FrostedChromeTokens.tintedGlass(prominent: prominent, tint: tint))
    }
}

struct FrostedRoundedSurfaceModifier: ViewModifier {
    let cornerRadius: CGFloat
    let prominent: Bool
    let tint: Color?

    func body(content: Content) -> some View {
        content
            .background { backgroundSurface }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(FrostedChromeTokens.separatorColor.opacity(prominent ? 0.85 : 1), lineWidth: 1)
            }
    }

    private var backgroundSurface: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(FrostedChromeTokens.tintedGlass(prominent: prominent, tint: tint))
    }
}

struct FrostedRoundedInputModifier: ViewModifier {
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frostedRoundedSurface(cornerRadius: cornerRadius)
    }
}

struct GlassSelectableCardModifier: ViewModifier {
    let selected: Bool
    let cornerRadius: CGFloat
    let tint: Color

    func body(content: Content) -> some View {
        content
            .cardSurface(
                cornerRadius: cornerRadius,
                tint: selected ? tint.opacity(0.16) : nil
            )
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        selected
                            ? tint.opacity(0.44)
                            : FrostedChromeTokens.separatorColor.opacity(0.7),
                        lineWidth: 1
                    )
            }
    }
}
