import SwiftUI

struct ProxyPageView: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        ScrollView {
            VStack(spacing: LayoutRules.sectionSpacing) {
                ApiProxySectionView(model: model)
            }
            .padding(LayoutRules.pagePadding)
        }
        .scrollIndicators(.hidden)
        .task {
            await model.loadIfNeeded()
        }
    }
}
