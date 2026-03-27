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
            ProxyModelsSection(model: model)
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

                // API Key configuration
                HStack(spacing: 12) {
                    Text("API Key")
                        .font(.body)
                    TextField("sk-local-...", text: $model.apiKey)
                        .frostedRoundedInput(cornerRadius: 8)
                        .frame(maxWidth: 380)
                        .disabled(model.isRunning)
                    Button {
                        model.regenerateApiKey()
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.body)
                    }
                    .buttonStyle(.frostedCapsule(prominent: false))
                    .disabled(model.isRunning)
                    .help(L10n.tr("proxy.api_key.regenerate"))
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
            VStack(alignment: .leading, spacing: 4) {
                ForEach(ProxyEndpoint.allCases) { endpoint in
                    ProxyEndpointRow(
                        endpoint: endpoint,
                        isSelected: model.selectedEndpoint == endpoint
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { model.selectedEndpoint = endpoint }
                }
            }
        }
    }
}

private struct ProxyEndpointRow: View {
    let endpoint: ProxyEndpoint
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 8) {
            Text(endpoint.method)
                .font(.system(.caption, design: .monospaced, weight: .bold))
                .foregroundStyle(endpoint.method == "GET" ? Color.blue : Color.orange)
                .frame(width: 40, alignment: .leading)
            Text(endpoint.rawValue)
                .font(.system(.body, design: .monospaced))
            Spacer()
            Text(L10n.tr(endpoint.descriptionKey))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isSelected ? Color.accentColor.opacity(0.12) : Color.clear)
        )
    }
}

private struct ProxyModelsSection: View {
    @ObservedObject var model: ProxyPageModel

    var body: some View {
        SectionCard(title: L10n.tr("proxy.section.models")) {
            FlowLayout(spacing: 8) {
                ForEach(model.availableModels, id: \.self) { modelName in
                    Text(modelName)
                        .font(.system(.caption, design: .monospaced))
                        .padding(.vertical, 5)
                        .padding(.horizontal, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 6)
                                .fill(model.selectedModel == modelName
                                      ? Color.accentColor.opacity(0.12)
                                      : Color.secondary.opacity(0.08))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .strokeBorder(model.selectedModel == modelName
                                              ? Color.accentColor.opacity(0.4)
                                              : Color.clear, lineWidth: 1)
                        )
                        .contentShape(Rectangle())
                        .onTapGesture { model.selectedModel = modelName }
                }
            }
        }
    }
}


private struct ProxyUsageSection: View {
    @ObservedObject var model: ProxyPageModel

    private var apiKeyDisplay: String {
        model.isRunning ? model.apiKey : "sk-local-..."
    }

    private var curlText: String {
        let base = model.proxyURL
        let key = apiKeyDisplay
        let selectedModel = model.selectedModel

        switch model.selectedEndpoint {
        case .chatCompletions:
            return """
            curl \(base)/v1/chat/completions \\
              -H "Content-Type: application/json" \\
              -H "Authorization: Bearer \(key)" \\
              -d '{"model":"\(selectedModel)","messages":[{"role":"user","content":"Hello"}]}'
            """
        case .responses:
            return """
            curl \(base)/v1/responses \\
              -H "Content-Type: application/json" \\
              -H "Authorization: Bearer \(key)" \\
              -d '{"model":"\(selectedModel)","instructions":"You are a helpful assistant.","input":"Hello"}'
            """
        case .messages:
            return """
            curl \(base)/v1/messages \\
              -H "Content-Type: application/json" \\
              -H "x-api-key: \(key)" \\
              -H "anthropic-version: 2023-06-01" \\
              -d '{"model":"\(selectedModel)","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
            """
        }
    }

    private var configText: String {
        let key = apiKeyDisplay
        switch model.selectedEndpoint {
        case .chatCompletions, .responses:
            return """
            OPENAI_BASE_URL=\(model.proxyURL)/v1
            OPENAI_API_KEY=\(key)
            """
        case .messages:
            return """
            ANTHROPIC_BASE_URL=\(model.proxyURL)
            ANTHROPIC_API_KEY=\(key)
            """
        }
    }

    var body: some View {
        SectionCard(title: L10n.tr("proxy.section.usage")) {
            VStack(alignment: .leading, spacing: 8) {
                ProxyCopyableCodeBlock(
                    label: L10n.tr("proxy.usage.curl_example"),
                    text: curlText
                )

                ProxyCopyableCodeBlock(
                    label: L10n.tr("proxy.usage.config_hint"),
                    text: configText
                )
            }
        }
    }
}

private struct ProxyCopyableCodeBlock: View {
    let label: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                #if canImport(AppKit)
                Button {
                    let pasteboard = NSPasteboard.general
                    pasteboard.clearContents()
                    pasteboard.setString(text, forType: .string)
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                #endif
            }

            Text(text)
                .font(.system(.caption2, design: .monospaced))
                .textSelection(.enabled)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frostedRoundedSurface(cornerRadius: 8)
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
