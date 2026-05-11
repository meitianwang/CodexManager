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
            VStack(alignment: .leading, spacing: 12) {
                ProxyStatusPill(isRunning: model.isRunning)

                ProxyFormRow(title: L10n.tr("proxy.port")) {
                    TextField("18317", text: $model.port)
                        .frostedRoundedInput(cornerRadius: 8)
                        .frame(width: 108)
                        .disabled(model.isRunning)
                }

                ProxyFormRow(title: "API Key") {
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
                }

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
                        tint: model.isRunning ? AppTheme.destructive : AppTheme.success
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
                .padding(.top, 2)
            }
        }
    }
}

private struct ProxyStatusPill: View {
    let isRunning: Bool

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(isRunning ? AppTheme.success : Color.secondary.opacity(0.45))
                .frame(width: 8, height: 8)
            Text(isRunning ? L10n.tr("proxy.status.running") : L10n.tr("proxy.status.stopped"))
                .font(.system(size: 13, weight: .semibold))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(AppTheme.mutedBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct ProxyFormRow<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 68, alignment: .leading)
            content
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(AppTheme.mutedBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
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
                .foregroundStyle(AppTheme.accent)
                .frame(width: 40, alignment: .leading)
            Text(endpoint.rawValue)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
            Spacer()
            Text(L10n.tr(endpoint.descriptionKey))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isSelected ? AppTheme.accentSoft : Color.clear)
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
                            RoundedRectangle(cornerRadius: 7)
                                .fill(model.selectedModel == modelName
                                      ? AppTheme.accentSoft
                                      : AppTheme.mutedBackground)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 7)
                                .strokeBorder(model.selectedModel == modelName
                                              ? AppTheme.accent.opacity(0.42)
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
                .foregroundStyle(AppTheme.accent)
                #endif
            }

            Text(text)
                .font(.system(.caption2, design: .monospaced))
                .textSelection(.enabled)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppTheme.mutedBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(AppTheme.separator.opacity(0.55), lineWidth: 1)
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
