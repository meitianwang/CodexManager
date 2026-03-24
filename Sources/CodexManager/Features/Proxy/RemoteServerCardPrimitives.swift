import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

struct RemoteServerHeader: View {
    let presentation: RemoteServerHeaderPresentation
    let isExpanded: Bool
    let onToggle: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(presentation.title)
                    .font(.headline)
                if let subtitle = presentation.subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            CollapseChevronButton(isExpanded: isExpanded, action: onToggle)
            Text(presentation.statusLabel)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .frostedCapsuleSurface(
                    prominent: presentation.isRunning,
                    tint: presentation.isRunning ? .green : .gray
                )
        }
    }
}

struct RemoteServerFieldGrid: View {
    @Binding var draft: RemoteServerConfig

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: LayoutRules.proxyRemoteFieldMinWidth), spacing: 8)],
            spacing: 8
        ) {
            ProxyFieldGroup(title: "Name", style: .uppercaseCaption) {
                TextField("tokyo-01", text: $draft.label)
                    .frostedRoundedInput()
            }
            ProxyFieldGroup(title: "Host", style: .uppercaseCaption) {
                TextField("1.2.3.4", text: $draft.host)
                    .frostedRoundedInput()
            }
            ProxyFieldGroup(title: "SSH Port", style: .uppercaseCaption) {
                TextField("22", value: $draft.sshPort, format: .number.grouping(.never))
                    .frostedRoundedInput()
            }
            ProxyFieldGroup(title: "SSH User", style: .uppercaseCaption) {
                TextField(RemoteServerConfiguration.defaultSSHUser, text: $draft.sshUser)
                    .frostedRoundedInput()
            }
            ProxyFieldGroup(title: "Deploy Dir", style: .uppercaseCaption) {
                TextField(RemoteServerConfiguration.defaultRemoteDir, text: $draft.remoteDir)
                    .frostedRoundedInput()
            }
            ProxyFieldGroup(title: "Proxy Port", style: .uppercaseCaption) {
                TextField(
                    String(RemoteServerConfiguration.defaultProxyPort),
                    value: $draft.listenPort,
                    format: .number.grouping(.never)
                )
                .frostedRoundedInput()
            }
        }
    }
}

struct RemoteServerAuthSection: View {
    @Binding var draft: RemoteServerConfig
    let onChooseIdentityFile: () -> String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("SSH Auth", selection: $draft.authMode) {
                Text("Path").tag("keyPath")
                Text("Private key").tag("keyContent")
                Text("Password").tag("password")
            }
            .pickerStyle(.menu)
            .frame(maxWidth: 220, alignment: .leading)

            switch draft.authMode {
            case "keyContent":
                TextEditor(text: Binding(
                    get: { draft.privateKey ?? "" },
                    set: { draft.privateKey = $0 }
                ))
                .font(.caption.monospaced())
                .scrollContentBackground(.hidden)
                .frame(minHeight: 120)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frostedRoundedSurface(cornerRadius: 8)
            case "password":
                SecureField("SSH password", text: Binding(
                    get: { draft.password ?? "" },
                    set: { draft.password = $0 }
                ))
                .frostedRoundedInput()
            default:
                HStack(spacing: 8) {
                    TextField("~/.ssh/id_ed25519", text: Binding(
                        get: { draft.identityFile ?? "" },
                        set: { draft.identityFile = $0 }
                    ))
                    .frostedRoundedInput()
                    #if canImport(AppKit)
                    Button {
                        if let path = onChooseIdentityFile() {
                            draft.identityFile = path
                        }
                    } label: {
                        Image(systemName: "folder")
                    }
                    .liquidGlassActionButtonStyle()
                    .help("Choose key file")
                    #endif
                }
            }
        }
    }
}

struct RemoteServerStatusGrid: View {
    let descriptors: [RemoteServerMetricDescriptor]

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: LayoutRules.proxyRemoteMetricMinWidth), spacing: 8)],
            spacing: 8
        ) {
            ForEach(descriptors) { descriptor in
                RemoteServerMetricCard(
                    title: descriptor.title,
                    value: descriptor.value
                )
            }
        }
    }
}

private struct RemoteServerMetricCard: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            Text(value)
                .font(.headline)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: LayoutRules.proxyRemoteMetricHeight, alignment: .topLeading)
        .padding(8)
        .cardSurface(cornerRadius: 10)
    }
}

struct RemoteServerDetailGrid: View {
    let descriptors: [RemoteServerDetailDescriptor]

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: LayoutRules.proxyRemoteDetailMinWidth), spacing: 8)],
            spacing: 8
        ) {
            ForEach(descriptors) { descriptor in
                ProxyCopyableValueCard(
                    title: descriptor.title,
                    value: descriptor.value,
                    canCopy: descriptor.canCopy,
                    titleDisplayMode: .uppercased,
                    cornerRadius: 10,
                    padding: 10
                )
            }
        }
    }
}

struct RemoteServerLogsSection: View {
    let presentation: RemoteServerLogsPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Remote logs")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button("common.copy") {
                    PlatformClipboard.copy(presentation.canCopy ? presentation.content : nil)
                }
                .liquidGlassActionButtonStyle()
                .disabled(!presentation.canCopy)
            }

            ScrollView(.vertical) {
                Text(presentation.content)
                    .font(.caption.monospaced())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(8)
            }
            .frame(height: LayoutRules.proxyRemoteLogsHeight)
            .cardSurface(cornerRadius: 8)
            .scrollIndicators(.visible)
        }
    }
}

struct RemoteServerErrorSection: View {
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Remote error")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            Text(message)
                .font(.caption)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .cardSurface(cornerRadius: 8)
        }
    }
}

struct RemoteServerDiscoverySection: View {
    let presentation: RemoteServerDiscoveryPresentation
    let onUseInstance: (DiscoveredRemoteProxyInstance) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(presentation.title)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)

            LazyVStack(spacing: 8) {
                ForEach(presentation.items) { item in
                    RemoteServerDiscoveryCard(
                        item: item,
                        onUse: {
                            onUseInstance(item.instance)
                        }
                    )
                }
            }
        }
    }
}

private struct RemoteServerDiscoveryCard: View {
    let item: RemoteServerDiscoveryItemPresentation
    let onUse: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.label)
                        .font(.subheadline.weight(.semibold))
                    if item.label != item.serviceName {
                        Text(item.serviceName)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    Text(item.statusSummary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button("proxy.remote.discovery.use_instance", action: onUse)
                    .liquidGlassActionButtonStyle(prominent: true)
            }

            discoveryValueRow(
                title: L10n.tr("proxy.remote.discovery.remote_dir"),
                value: item.remoteDir
            )
            discoveryValueRow(
                title: L10n.tr("proxy.remote.discovery.listen_port"),
                value: item.listenPort
            )
            discoveryValueRow(
                title: L10n.tr("proxy.remote.discovery.base_url"),
                value: item.baseURL
            )
            discoveryValueRow(
                title: L10n.tr("proxy.remote.discovery.api_key"),
                value: item.apiKeyLabel
            )
        }
        .padding(10)
        .cardSurface(cornerRadius: 10)
    }

    private func discoveryValueRow(title: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }
}

struct RemoteServerActionHelpSection: View {
    let descriptors: [RemoteServerActionHelpDescriptor]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("proxy.remote.help.title")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)

            ForEach(descriptors) { descriptor in
                HStack(alignment: .top, spacing: 8) {
                    Text(LocalizedStringKey(descriptor.titleKey))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(LocalizedStringKey(descriptor.messageKey))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }
        }
    }
}
