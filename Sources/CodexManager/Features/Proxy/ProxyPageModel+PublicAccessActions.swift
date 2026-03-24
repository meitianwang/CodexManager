import Foundation

extension ProxyPageModel {
    func installCloudflared() async {
        if usesRemoteMacControl {
            await performRemoteCommand(
                kind: .installCloudflared,
                successNotice: L10n.tr("proxy.notice.cloudflared_installed")
            )
            return
        }
        loading = true
        defer { loading = false }

        do {
            let snapshot = try await performLocalCommand(kind: .installCloudflared)
            applyRemoteSnapshot(snapshot)
            notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.cloudflared_installed"))
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func startCloudflared() async {
        if usesRemoteMacControl {
            do {
                let input = try buildCloudflaredStartInput()
                await performRemoteCommand(
                    kind: .startCloudflared,
                    cloudflaredInput: input,
                    proxyConfiguration: currentProxyConfiguration,
                    successNotice: L10n.tr("proxy.notice.cloudflared_started")
                )
            } catch {
                notice = NoticeMessage(style: .error, text: error.localizedDescription)
            }
            return
        }
        loading = true
        defer { loading = false }

        do {
            let input = try buildCloudflaredStartInput()
            let snapshot = try await performLocalCommand(
                kind: .startCloudflared,
                cloudflaredInput: input,
                proxyConfiguration: currentProxyConfiguration
            )
            applyRemoteSnapshot(snapshot)
            notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.cloudflared_started"))
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func stopCloudflared() async {
        if usesRemoteMacControl {
            await performRemoteCommand(
                kind: .stopCloudflared,
                successNotice: L10n.tr("proxy.notice.cloudflared_stopped")
            )
            return
        }
        loading = true
        defer { loading = false }

        do {
            let snapshot = try await performLocalCommand(kind: .stopCloudflared)
            applyRemoteSnapshot(snapshot)
            notice = NoticeMessage(style: .info, text: L10n.tr("proxy.notice.cloudflared_stopped"))
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func refreshCloudflared() async {
        if usesRemoteMacControl {
            await requestRemoteSnapshotRefresh(showErrors: true, showLoading: true)
            return
        }
        do {
            let snapshot = try await performLocalCommand(kind: .refreshCloudflared)
            applyRemoteSnapshot(snapshot)
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func applyCloudflaredStatus(_ status: CloudflaredStatus) {
        cloudflaredStatus = status
        if status.running {
            cloudflaredUseHTTP2 = status.useHTTP2
            if let mode = status.tunnelMode {
                cloudflaredTunnelMode = mode
            }
            if let hostname = status.customHostname?.trimmingCharacters(in: .whitespacesAndNewlines),
               !hostname.isEmpty {
                cloudflaredNamedInput.hostname = CloudflaredConfiguration.normalizeHostnameDraft(hostname)
            }
            lastSyncedProxyConfiguration = currentProxyConfiguration
            cloudflaredSectionExpanded = true
        }
    }

    private func buildCloudflaredStartInput() throws -> StartCloudflaredTunnelInput {
        guard let port = proxyStatus.port else {
            throw AppError.invalidData(L10n.tr("proxy.notice.start_api_proxy_first"))
        }

        let named: NamedCloudflaredTunnelInput?
        if cloudflaredTunnelMode == .named {
            named = try normalizedNamedInput()
        } else {
            named = nil
        }

        return StartCloudflaredTunnelInput(
            apiProxyPort: port,
            useHTTP2: cloudflaredUseHTTP2,
            mode: cloudflaredTunnelMode,
            named: named
        )
    }

    private func normalizedNamedInput() throws -> NamedCloudflaredTunnelInput {
        let apiToken = cloudflaredNamedInput.apiToken.trimmingCharacters(in: .whitespacesAndNewlines)
        let accountID = cloudflaredNamedInput.accountID.trimmingCharacters(in: .whitespacesAndNewlines)
        let zoneID = cloudflaredNamedInput.zoneID.trimmingCharacters(in: .whitespacesAndNewlines)
        let hostname = CloudflaredConfiguration.normalizeHostnameDraft(cloudflaredNamedInput.hostname)

        guard !apiToken.isEmpty, !accountID.isEmpty, !zoneID.isEmpty, !hostname.isEmpty else {
            throw AppError.invalidData(L10n.tr("error.cloudflared.named_required_fields"))
        }
        guard hostname.contains(".") else {
            throw AppError.invalidData(L10n.tr("error.cloudflared.named_invalid_hostname"))
        }

        return NamedCloudflaredTunnelInput(
            apiToken: apiToken,
            accountID: accountID,
            zoneID: zoneID,
            hostname: hostname
        )
    }
}
