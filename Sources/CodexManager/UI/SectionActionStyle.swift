import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

extension View {
    func cardSurface(cornerRadius: CGFloat = LayoutRules.cardRadius, tint: Color? = nil) -> some View {
        modifier(CardSurfaceModifier(cornerRadius: cornerRadius, tint: tint))
    }

    func frostedCapsuleSurface(
        prominent: Bool = false,
        tint: Color? = nil
    ) -> some View {
        modifier(FrostedCapsuleSurfaceModifier(prominent: prominent, tint: tint))
    }

    func frostedRoundedSurface(
        cornerRadius: CGFloat = 12,
        prominent: Bool = false,
        tint: Color? = nil
    ) -> some View {
        modifier(FrostedRoundedSurfaceModifier(cornerRadius: cornerRadius, prominent: prominent, tint: tint))
    }

    func frostedRoundedInput(cornerRadius: CGFloat = 12) -> some View {
        modifier(FrostedRoundedInputModifier(cornerRadius: cornerRadius))
    }

    func glassSelectableCard(
        selected: Bool,
        cornerRadius: CGFloat = 12,
        tint: Color = .accentColor
    ) -> some View {
        modifier(
            GlassSelectableCardModifier(
                selected: selected,
                cornerRadius: cornerRadius,
                tint: tint
            )
        )
    }

    @ViewBuilder
    func codexManagerActionButtonStyle(
        prominent: Bool = false,
        tint: Color? = nil,
        density: FrostedCapsuleButtonStyle.Density = .regular,
        iOSStyle: CodexManagerActionButtonIOSStyle = .system
    ) -> some View {
        #if os(iOS)
        if iOSStyle == .liquidGlass {
            self.buttonStyle(.frostedCapsule(prominent: prominent, tint: tint, density: density))
        } else if prominent {
            if let tint {
                self
                    .buttonStyle(.borderedProminent)
                    .tint(tint)
                    .controlSize(density == .compact ? .small : .regular)
            } else {
                self
                    .buttonStyle(.borderedProminent)
                    .controlSize(density == .compact ? .small : .regular)
            }
        } else {
            if let tint {
                self
                    .buttonStyle(.bordered)
                    .tint(tint)
                    .controlSize(density == .compact ? .small : .regular)
            } else {
                self
                    .buttonStyle(.bordered)
                    .controlSize(density == .compact ? .small : .regular)
            }
        }
        #else
        self.buttonStyle(.frostedCapsule(prominent: prominent, tint: tint, density: density))
        #endif
    }

    func liquidGlassActionButtonStyle(
        prominent: Bool = false,
        tint: Color? = nil,
        density: FrostedCapsuleButtonStyle.Density = .regular
    ) -> some View {
        codexManagerActionButtonStyle(
            prominent: prominent,
            tint: tint,
            density: density,
            iOSStyle: .liquidGlass
        )
    }

    func frostedCapsuleInput() -> some View {
        modifier(FrostedCapsuleInputModifier())
    }
}

enum CodexManagerActionButtonIOSStyle {
    case system
    case liquidGlass
}

struct FrostedCapsuleButtonStyle: ButtonStyle {
    enum Density {
        case regular
        case compact
    }

    let prominent: Bool
    let tint: Color?
    let density: Density

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let isEffectivelyPressed = isEnabled && configuration.isPressed

        configuration.label
            .font(font)
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .frame(minHeight: minimumHeight)
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .background(buttonBackground)
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(separatorColor, lineWidth: 1)
            }
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(isEffectivelyPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.12), value: isEffectivelyPressed)
    }

    private var buttonBackground: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(prominent ? effectiveTint : AppTheme.controlBackground)
    }

    private var font: Font {
        switch density {
        case .regular:
            return .subheadline.weight(prominent ? .semibold : .medium)
        case .compact:
            return .callout.weight(prominent ? .semibold : .medium)
        }
    }

    private var horizontalPadding: CGFloat {
        density == .compact ? 10 : 12
    }

    private var verticalPadding: CGFloat {
        density == .compact ? 5 : 7
    }

    private var minimumHeight: CGFloat {
        density == .compact ? 28 : 34
    }

    private var cornerRadius: CGFloat {
        density == .compact ? 6 : 7
    }

    private var separatorColor: Color {
        prominent ? Color.clear : AppTheme.separator
    }

    private var effectiveTint: Color {
        tint ?? AppTheme.accent
    }

    private var foregroundColor: Color {
        if prominent {
            return .white
        }
        return tint ?? AppTheme.primaryText
    }
}

extension ButtonStyle where Self == FrostedCapsuleButtonStyle {
    static func frostedCapsule(
        prominent: Bool = false,
        tint: Color? = nil,
        density: FrostedCapsuleButtonStyle.Density = .regular
    ) -> Self {
        FrostedCapsuleButtonStyle(prominent: prominent, tint: tint, density: density)
    }
}

private struct FrostedCapsuleInputModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frostedCapsuleSurface()
    }
}
