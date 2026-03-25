import SwiftUI

struct ProxyPageView: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        MacPageScrollContainer {
            ApiProxySectionView(model: model)

            ProxyClaudeConfigSection(model: model)

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: LayoutRules.sectionSpacing) {
                    ProxyModelListSection(model: model)
                    ProxyCurlExampleSection(model: model)
                }

                VStack(spacing: LayoutRules.sectionSpacing) {
                    ProxyModelListSection(model: model)
                    ProxyCurlExampleSection(model: model)
                }
            }
        }
        .task {
            await model.loadIfNeeded()
        }
    }
}
