import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

// MARK: - Model List Section
// Adapted from kiro-gateway-swift/KiroGateway/DashboardView.swift modelList

struct ProxyModelListSection: View {
    @ObservedObject var model: ProxyPageModel

    private let teal = Color(red: 0.16, green: 0.71, blue: 0.55)
    @State private var hoveredModel: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if model.availableModels.isEmpty && !model.isLoadingModels {
                emptyState
            } else {
                modelRows
            }
        }
        .padding(16)
        .cardSurface(cornerRadius: LayoutRules.cardRadius)
    }

    private var header: some View {
        HStack {
            HStack(spacing: 6) {
                Image(systemName: "cpu")
                    .font(.caption)
                    .foregroundStyle(teal)
                Text(L10n.tr("proxy.dashboard.available_models"))
                    .font(.callout.weight(.medium))
            }
            Spacer()
            if model.isLoadingModels {
                ProgressView().controlSize(.mini)
            } else {
                Text("\(model.availableModels.count)")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(teal.opacity(0.1), in: Capsule())
                    .foregroundStyle(teal)
                Button {
                    model.fetchModels()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.title3)
                .foregroundStyle(.quaternary)
            Text(L10n.tr("proxy.dashboard.no_models"))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private var modelRows: some View {
        VStack(spacing: 2) {
            ForEach(model.availableModels, id: \.self) { modelName in
                HStack(spacing: 8) {
                    Circle()
                        .fill(teal.opacity(0.6))
                        .frame(width: 5, height: 5)
                    Text(modelName)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                    Spacer()
                    copyButton(modelName, field: modelName)
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 10)
                .background(
                    hoveredModel == modelName
                        ? teal.opacity(0.06)
                        : (model.selectedCurlModel == modelName ? teal.opacity(0.04) : Color.clear),
                    in: RoundedRectangle(cornerRadius: 6)
                )
                .contentShape(Rectangle())
                .onTapGesture { model.selectedCurlModel = modelName }
                .onHover { h in hoveredModel = h ? modelName : nil }
            }
        }
    }

    private func copyButton(_ value: String, field: String) -> some View {
        Button {
            model.copyToClipboard(value, field: field)
        } label: {
            Image(systemName: model.copiedField == field ? "checkmark" : "doc.on.doc")
                .font(.caption2)
                .foregroundStyle(model.copiedField == field ? teal : Color.secondary)
        }
        .buttonStyle(.borderless)
        .help(L10n.tr("common.copy"))
    }
}

// MARK: - cURL Example Section
// Adapted from kiro-gateway-swift/KiroGateway/DashboardView.swift curlSection

struct ProxyCurlExampleSection: View {
    @ObservedObject var model: ProxyPageModel

    private let teal = Color(red: 0.16, green: 0.71, blue: 0.55)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.left.forwardslash.chevron.right")
                        .font(.caption)
                        .foregroundStyle(teal)
                    Text(L10n.tr("proxy.dashboard.curl_example"))
                        .font(.callout.weight(.medium))
                }
                Spacer()
            }

            // Dark code block
            let cmd = model.curlExample
            ZStack(alignment: .topTrailing) {
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    curlHighlighted(cmd)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 120)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(red: 0.11, green: 0.12, blue: 0.14))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                )

                // Copy button on dark bg
                Button {
                    model.copyToClipboard(cmd, field: "curl")
                } label: {
                    Image(systemName: model.copiedField == "curl" ? "checkmark" : "doc.on.doc")
                        .font(.caption2)
                        .foregroundStyle(model.copiedField == "curl" ? .green : Color.white.opacity(0.4))
                        .padding(6)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 5))
                }
                .buttonStyle(.plain)
                .padding(10)
            }
        }
        .padding(16)
        .cardSurface(cornerRadius: LayoutRules.cardRadius)
    }

    // Syntax-highlighted cURL — adapted from kiro-gateway-swift
    private func curlHighlighted(_ code: String) -> some View {
        let lines = code.components(separatedBy: "\n")
        return VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(lines.enumerated()), id: \.offset) { idx, line in
                HStack(alignment: .top, spacing: 0) {
                    Text("\(idx + 1)")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.2))
                        .frame(width: 20, alignment: .trailing)
                        .padding(.trailing, 12)

                    highlightedLine(line)
                }
            }
        }
    }

    private func highlightedLine(_ line: String) -> Text {
        var result = Text("")
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let leadingSpaces = String(line.prefix(while: { $0 == " " }))

        if !leadingSpaces.isEmpty {
            result = result + Text(leadingSpaces).font(.system(.caption, design: .monospaced)).foregroundColor(Color.white.opacity(0.7))
        }

        let tokens = trimmed.components(separatedBy: " ")
        for (i, token) in tokens.enumerated() {
            if i > 0 {
                result = result + Text(" ").font(.system(.caption, design: .monospaced)).foregroundColor(Color.white.opacity(0.7))
            }

            if token == "curl" {
                result = result + Text(token).font(.system(.caption, design: .monospaced).weight(.semibold)).foregroundColor(Color(red: 0.55, green: 0.82, blue: 0.96))
            } else if token == "-H" || token == "-d" {
                result = result + Text(token).font(.system(.caption, design: .monospaced).weight(.medium)).foregroundColor(Color(red: 0.78, green: 0.58, blue: 0.96))
            } else if token == "\\" {
                result = result + Text(token).font(.system(.caption, design: .monospaced)).foregroundColor(Color.white.opacity(0.3))
            } else if token.hasPrefix("\"") || token.hasPrefix("'") {
                result = result + Text(token).font(.system(.caption, design: .monospaced)).foregroundColor(Color(red: 0.81, green: 0.89, blue: 0.53))
            } else if token.contains("://") {
                result = result + Text(token).font(.system(.caption, design: .monospaced)).foregroundColor(Color(red: 0.38, green: 0.79, blue: 0.69))
            } else {
                result = result + Text(token).font(.system(.caption, design: .monospaced)).foregroundColor(Color.white.opacity(0.7))
            }
        }

        return result
    }
}

// MARK: - Claude Code Config Section
// Adapted from kiro-gateway-swift/KiroGateway/DashboardView.swift claudeConfigSection

struct ProxyClaudeConfigSection: View {
    @ObservedObject var model: ProxyPageModel

    private let teal = Color(red: 0.16, green: 0.71, blue: 0.55)

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "terminal")
                    .font(.caption)
                    .foregroundStyle(teal)
                Text("Claude Code")
                    .font(.callout.weight(.medium))
                Text("~/.claude/settings.json")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color(nsColor: .controlBackgroundColor).opacity(0.6), in: Capsule())
                Spacer()
            }

            HStack(spacing: 16) {
                modelPicker("Opus", selection: Binding(
                    get: { model.claudeOpusModel },
                    set: { model.claudeOpusModel = $0 }
                ))
                modelPicker("Sonnet", selection: Binding(
                    get: { model.claudeSonnetModel },
                    set: { model.claudeSonnetModel = $0 }
                ))
                modelPicker("Haiku", selection: Binding(
                    get: { model.claudeHaikuModel },
                    set: { model.claudeHaikuModel = $0 }
                ))

                Spacer()

                Button {
                    model.resetClaudeConfig()
                } label: {
                    if model.claudeConfigResetting {
                        ProgressView().controlSize(.mini)
                    } else if model.claudeConfigReset {
                        Label(L10n.tr("proxy.claude.restored"), systemImage: "checkmark")
                            .font(.caption)
                    } else {
                        Label(L10n.tr("proxy.claude.restore"), systemImage: "arrow.counterclockwise")
                            .font(.caption)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(model.claudeConfigResetting || !model.hasEnvBackup)

                Button {
                    model.saveClaudeConfig()
                } label: {
                    if model.claudeConfigSaving {
                        ProgressView().controlSize(.mini)
                    } else if model.claudeConfigSaved {
                        Label(L10n.tr("proxy.claude.saved"), systemImage: "checkmark")
                            .font(.caption)
                    } else {
                        Label(L10n.tr("proxy.claude.write"), systemImage: "square.and.arrow.down")
                            .font(.caption)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(teal)
                .controlSize(.small)
                .disabled(model.claudeConfigSaving)
            }
        }
        .padding(16)
        .cardSurface(cornerRadius: LayoutRules.cardRadius)
        .onAppear { model.loadClaudeConfig() }
    }

    private func modelPicker(_ label: String, selection: Binding<String>) -> some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize()
            Picker("", selection: selection) {
                Text("(\(L10n.tr("proxy.claude.empty")))").tag("")
                ForEach(model.availableModels, id: \.self) { m in
                    Text(m).tag(m)
                }
            }
            .labelsHidden()
            .frame(minWidth: 160)
        }
    }
}
