struct ProxyRemoteSnapshotPresentationState: Equatable {
    var proxyStatus: ApiProxyStatus
    var preferredPortText: String
    var autoStartProxy: Bool
    var cloudflaredStatus: CloudflaredStatus
    var cloudflaredTunnelMode: CloudflaredTunnelMode
    var cloudflaredNamedHostname: String
    var cloudflaredUseHTTP2: Bool
    var publicAccessEnabled: Bool
    var remoteServers: [RemoteServerConfig]
    var remoteStatuses: [String: RemoteProxyStatus]
    var remoteDiscoveries: [String: [DiscoveredRemoteProxyInstance]]
    var remoteLogs: [String: String]

    init(
        proxyStatus: ApiProxyStatus,
        preferredPortText: String,
        autoStartProxy: Bool,
        cloudflaredStatus: CloudflaredStatus,
        cloudflaredTunnelMode: CloudflaredTunnelMode,
        cloudflaredNamedHostname: String,
        cloudflaredUseHTTP2: Bool,
        publicAccessEnabled: Bool,
        remoteServers: [RemoteServerConfig],
        remoteStatuses: [String: RemoteProxyStatus],
        remoteDiscoveries: [String: [DiscoveredRemoteProxyInstance]],
        remoteLogs: [String: String]
    ) {
        self.proxyStatus = proxyStatus
        self.preferredPortText = preferredPortText
        self.autoStartProxy = autoStartProxy
        self.cloudflaredStatus = cloudflaredStatus
        self.cloudflaredTunnelMode = cloudflaredTunnelMode
        self.cloudflaredNamedHostname = cloudflaredNamedHostname
        self.cloudflaredUseHTTP2 = cloudflaredUseHTTP2
        self.publicAccessEnabled = publicAccessEnabled
        self.remoteServers = remoteServers
        self.remoteStatuses = remoteStatuses
        self.remoteDiscoveries = remoteDiscoveries
        self.remoteLogs = ProxySyncPolicy.RemoteLogs.normalize(remoteLogs)
    }

    init(snapshot: ProxyControlSnapshot) {
        let normalizedSnapshot = ProxySyncPolicy.RemoteLogs.normalize(snapshot)
        proxyStatus = normalizedSnapshot.proxyStatus
        preferredPortText = ProxyConfiguration.normalizePreferredPortText(
            normalizedSnapshot.preferredProxyPortText
                ?? normalizedSnapshot.preferredProxyPort.map(String.init)
                ?? normalizedSnapshot.proxyStatus.port.map(String.init)
                ?? String(RemoteServerConfiguration.defaultProxyPort)
        )
        autoStartProxy = normalizedSnapshot.autoStartProxy
        cloudflaredStatus = normalizedSnapshot.cloudflaredStatus
        cloudflaredTunnelMode = normalizedSnapshot.cloudflaredTunnelMode
        cloudflaredNamedHostname = normalizedSnapshot.cloudflaredNamedInput.hostname
        cloudflaredUseHTTP2 = normalizedSnapshot.cloudflaredUseHTTP2
        publicAccessEnabled = normalizedSnapshot.publicAccessEnabled
        remoteServers = normalizedSnapshot.remoteServers
        remoteStatuses = normalizedSnapshot.remoteStatuses
        remoteDiscoveries = normalizedSnapshot.remoteDiscoveries
        remoteLogs = normalizedSnapshot.remoteLogs
    }
}
