import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

struct ProxyPageView: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        ProxyPageContent(model: model)
    }
}

#if os(macOS)
private struct ProxyPageContent: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        MacPageScrollContainer {
            ProxyControlSection(model: model)
            ProxyEndpointsSection(model: model)
            ProxyUsageSection(model: model)
        }
    }
}

private struct ProxyControlSection: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        SectionCard(title: L10n.tr("proxy.section.control")) {
            VStack(alignment: .leading, spacing: 16) {
                // Status indicator
                HStack(spacing: 8) {
                    Circle()
                        .fill(model.isRunning ? Color.green : Color.secondary.opacity(0.4))
                        .frame(width: 8, height: 8)
                    Text(model.isRunning
                         ? L10n.tr("proxy.status.running")
                         : L10n.tr("proxy.status.stopped"))
                        .font(.body)
                    Spacer()
                }

                // Port configuration
                HStack(spacing: 12) {
                    Text(L10n.tr("proxy.port"))
                        .font(.body)
                    TextField("18317", text: $model.port)
                        .frostedRoundedInput(cornerRadius: 8)
                        .frame(maxWidth: 100)
                        .disabled(model.isRunning)
                    Spacer()
                }

                // Start/Stop button
                HStack(spacing: 12) {
                    Button {
                        model.toggleProxy()
                    } label: {
                        Text(model.isRunning
                             ? L10n.tr("common.stop")
                             : L10n.tr("common.start"))
                    }
                    .buttonStyle(.frostedCapsule(
                        prominent: true,
                        tint: model.isRunning ? .red : .green
                    ))

                    if model.isRunning {
                        Button {
                            model.copyProxyURL()
                        } label: {
                            Text(L10n.tr("proxy.copy_url"))
                        }
                        .buttonStyle(.frostedCapsule(prominent: false))
                    }

                    Spacer()
                }
            }
        }
    }
}

private struct ProxyEndpointsSection: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        SectionCard(title: L10n.tr("proxy.section.endpoints")) {
            VStack(alignment: .leading, spacing: 10) {
                ProxyEndpointRow(
                    method: "GET",
                    path: "/health",
                    description: L10n.tr("proxy.endpoint.health")
                )
                ProxyEndpointRow(
                    method: "GET",
                    path: "/v1/models",
                    description: L10n.tr("proxy.endpoint.models")
                )
                ProxyEndpointRow(
                    method: "POST",
                    path: "/v1/chat/completions",
                    description: L10n.tr("proxy.endpoint.chat_completions")
                )
                ProxyEndpointRow(
                    method: "POST",
                    path: "/v1/responses",
                    description: L10n.tr("proxy.endpoint.responses")
                )
            }
        }
    }
}

private struct ProxyEndpointRow: View {
    let method: String
    let path: String
    let description: String

    var body: some View {
        HStack(spacing: 8) {
            Text(method)
                .font(.system(.caption, design: .monospaced, weight: .bold))
                .foregroundStyle(method == "GET" ? Color.blue : Color.orange)
                .frame(width: 40, alignment: .leading)
            Text(path)
                .font(.system(.body, design: .monospaced))
            Spacer()
            Text(description)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct ProxyUsageSection: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        SectionCard(title: L10n.tr("proxy.section.usage")) {
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.tr("proxy.usage.curl_example"))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                let apiKeyDisplay = model.isRunning ? model.apiKey : "sk-local-..."
                let curlText = """
                curl \(model.proxyURL)/v1/chat/completions \\
                  -H "Content-Type: application/json" \\
                  -H "Authorization: Bearer \(apiKeyDisplay)" \\
                  -d '{"model":"gpt-5","messages":[{"role":"user","content":"Hello"}]}'
                """

                Text(curlText)
                    .font(.system(.caption2, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frostedRoundedSurface(cornerRadius: 8)

                Text(L10n.tr("proxy.usage.config_hint"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)

                let configText = """
                OPENAI_BASE_URL=\(model.proxyURL)/v1
                OPENAI_API_KEY=\(apiKeyDisplay)
                """

                Text(configText)
                    .font(.system(.caption2, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frostedRoundedSurface(cornerRadius: 8)
            }
        }
    }
}
#else
private struct ProxyPageContent: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        // Proxy is macOS only
        VStack {
            Text(L10n.tr("proxy.unavailable_ios"))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#endif
