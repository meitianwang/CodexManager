import SwiftUI

struct LiquidProgressBar: View {
    let progress: Double
    let tint: Color
    var height: CGFloat = LayoutRules.liquidProgressHeight

    private var clampedProgress: Double {
        max(0, min(1, progress))
    }

    var body: some View {
        GeometryReader { geometry in
            let metrics = LiquidProgressMetrics(
                progress: clampedProgress,
                totalWidth: geometry.size.width,
                totalHeight: height
            )

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(AppTheme.progressTrack)

                if metrics.visibleFillWidth > 0 {
                    Capsule()
                        .fill(tint)
                        .frame(width: metrics.visibleFillWidth, height: metrics.grooveHeight)
                        .padding(.horizontal, metrics.horizontalInset)
                        .padding(.vertical, metrics.verticalInset)
                }
            }
            .overlay {
                Capsule()
                    .strokeBorder(AppTheme.separator.opacity(0.55), lineWidth: 1)
            }
        }
        .frame(height: height)
        .animation(.spring(response: 0.32, dampingFraction: 0.88), value: clampedProgress)
    }
}

struct LiquidProgressRing: View {
    let progress: Double
    let tint: Color
    let lineWidth: CGFloat

    private var clampedProgress: Double {
        max(0, min(1, progress))
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(AppTheme.progressTrack, lineWidth: lineWidth)

            Circle()
                .trim(from: 0, to: clampedProgress)
                .stroke(
                    tint,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
                )
                .rotationEffect(.degrees(-90))
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.88), value: clampedProgress)
    }
}

struct LiquidProgressMetrics {
    let progress: Double
    let totalWidth: CGFloat
    let totalHeight: CGFloat

    init(
        progress: Double,
        totalWidth: CGFloat,
        totalHeight: CGFloat = LayoutRules.liquidProgressHeight
    ) {
        self.progress = progress
        self.totalWidth = totalWidth
        self.totalHeight = totalHeight
    }

    private var clampedProgress: Double {
        max(0, min(1, progress))
    }

    var horizontalInset: CGFloat {
        0
    }

    var verticalInset: CGFloat {
        0
    }

    var grooveHeight: CGFloat {
        max(4, totalHeight - verticalInset * 2)
    }

    var rawFillWidth: CGFloat {
        let availableWidth = max(0, totalWidth - horizontalInset * 2)
        return availableWidth * clampedProgress
    }

    var minimumVisibleFillWidth: CGFloat {
        grooveHeight
    }

    var visibleFillWidth: CGFloat {
        guard rawFillWidth > 0 else { return 0 }
        return max(rawFillWidth, minimumVisibleFillWidth)
    }
}
