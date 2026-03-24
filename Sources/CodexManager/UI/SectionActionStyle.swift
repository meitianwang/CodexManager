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
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .frame(minHeight: minimumHeight)
            .contentShape(Capsule())
            .background(buttonBackground)
            .overlay {
                Capsule()
                    .strokeBorder(separatorColor, lineWidth: 1)
            }
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(isEffectivelyPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: isEffectivelyPressed)
    }

    @ViewBuilder
    private var buttonBackground: some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            if prominent {
                Capsule()
                    .fill(.clear)
                    .glassEffect(
                        .regular
                            .tint(effectiveTint.opacity(0.22))
                            .interactive(),
                        in: .capsule
                    )
            } else {
                Capsule()
                    .fill(.clear)
                    .glassEffect(
                        .regular
                            .tint(Color.white.opacity(0.03))
                            .interactive(),
                        in: .capsule
                    )
            }
        } else {
            ZStack {
                Capsule()
                    .fill(prominent ? AnyShapeStyle(.regularMaterial) : AnyShapeStyle(.ultraThinMaterial))
                if prominent {
                    Capsule()
                        .fill(effectiveTint.opacity(0.14))
                }
            }
        }
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
        density == .compact ? 30 : 34
    }

    private var separatorColor: Color {
        #if canImport(AppKit)
        let base = Color(nsColor: .separatorColor)
        #else
        let base = Color.secondary.opacity(0.2)
        #endif
        return prominent ? base.opacity(0.85) : base
    }

    private var effectiveTint: Color {
        tint ?? .accentColor
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
