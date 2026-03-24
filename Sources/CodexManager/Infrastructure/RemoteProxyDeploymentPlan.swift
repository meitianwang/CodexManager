import Foundation

enum RemoteProxyDeploymentPlan {
    static let discoveryRecordMarker = "__CodexManager_DISCOVERY__"

    static func serviceName(for serverID: String) -> String {
        "codex-tools-proxyd-\(safeFragment(serverID)).service"
    }

    static func stageDirectory(serverID: String, unixTime: Int) -> String {
        "/tmp/codex-tools-remote-\(safeFragment(serverID))-\(unixTime)"
    }

    static func renderSystemdUnit(server: RemoteServerConfig, serviceName: String) -> String {
        """
        [Unit]
        Description=Codex Tools Remote API Proxy (\(serviceName))
        After=network-online.target
        Wants=network-online.target

        [Service]
        Type=simple
        WorkingDirectory=\(server.remoteDir)
        \(systemdEnvironment("CODEXMANAGER_SERVER_ID", value: server.id))
        \(systemdEnvironment("CODEXMANAGER_SERVER_LABEL", value: server.label))
        ExecStart=\(server.remoteDir)/codex-tools-proxyd serve --data-dir \(server.remoteDir) --host 0.0.0.0 --port \(server.listenPort) --no-sync-current-auth
        Restart=always
        RestartSec=3
        Environment=RUST_LOG=info

        [Install]
        WantedBy=multi-user.target
        """
    }

    static func renderStatusCommand(
        serviceName: String,
        remoteDir: String,
        shellQuote: (String) -> String
    ) -> String {
        """
        DIR=\(shellQuote(remoteDir)); BIN="$DIR/codex-tools-proxyd"; KEYFILE="$DIR/api-proxy.key"; UNIT=\(shellQuote(serviceName)); \
        INSTALLED=0; SERVICE_INSTALLED=0; RUNNING=0; ENABLED=0; PID=""; API_KEY=""; \
        if [ -x "$BIN" ]; then INSTALLED=1; fi; \
        if command -v systemctl >/dev/null 2>&1; then \
          if [ -f "/etc/systemd/system/$UNIT" ] || [ -f "/lib/systemd/system/$UNIT" ]; then SERVICE_INSTALLED=1; fi; \
          ENABLED_STATE=$(systemctl is-enabled "$UNIT" 2>/dev/null || true); \
          if [ "$ENABLED_STATE" = "enabled" ]; then ENABLED=1; fi; \
          ACTIVE_STATE=$(systemctl is-active "$UNIT" 2>/dev/null || true); \
          if [ "$ACTIVE_STATE" = "active" ]; then RUNNING=1; fi; \
          PID=$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null || true); \
          if [ "$PID" = "0" ]; then PID=""; fi; \
        fi; \
        if [ -f "$KEYFILE" ]; then API_KEY=$(cat "$KEYFILE" 2>/dev/null || true); fi; \
        printf 'installed=%s\\nservice_installed=%s\\nrunning=%s\\nenabled=%s\\npid=%s\\napi_key=%s\\n' "$INSTALLED" "$SERVICE_INSTALLED" "$RUNNING" "$ENABLED" "$PID" "$API_KEY"
        """
    }

    static func renderInstallCommand(
        server: RemoteServerConfig,
        serviceName: String,
        stageDir: String,
        shellQuote: (String) -> String
    ) -> String {
        let cleanupCommand = renderConflictCleanupCommand(
            server: server,
            preservingServiceName: serviceName,
            shellQuote: shellQuote
        )

        return """
        mkdir -p \(shellQuote(server.remoteDir)); \
        \(cleanupCommand) \
        mv \(shellQuote("\(stageDir)/codex-tools-proxyd")) \(shellQuote("\(server.remoteDir)/codex-tools-proxyd")); chmod 700 \(shellQuote("\(server.remoteDir)/codex-tools-proxyd")); \
        mv \(shellQuote("\(stageDir)/accounts.json")) \(shellQuote("\(server.remoteDir)/accounts.json")); chmod 600 \(shellQuote("\(server.remoteDir)/accounts.json")); \
        mv \(shellQuote("\(stageDir)/\(serviceName)")) \(shellQuote("/etc/systemd/system/\(serviceName)")); chmod 644 \(shellQuote("/etc/systemd/system/\(serviceName)")); \
        rm -rf \(shellQuote(stageDir)); \
        systemctl daemon-reload; \
        systemctl enable \(shellQuote(serviceName)) >/dev/null 2>&1 || true; \
        if systemctl is-active --quiet \(shellQuote(serviceName)); then systemctl restart \(shellQuote(serviceName)); else systemctl start \(shellQuote(serviceName)); fi
        """
    }

    static func renderSyncAccountsCommand(
        remoteDir: String,
        serviceName: String,
        stageDir: String,
        shouldRestartService: Bool,
        shellQuote: (String) -> String
    ) -> String {
        let restartCommand = shouldRestartService
            ? "if [ -f \"/etc/systemd/system/$UNIT\" ] || [ -f \"/lib/systemd/system/$UNIT\" ]; then systemctl restart \"$UNIT\"; fi;"
            : "true"

        return """
        DIR=\(shellQuote(remoteDir)); UNIT=\(shellQuote(serviceName)); mkdir -p "$DIR"; \
        mv \(shellQuote("\(stageDir)/accounts.json")) "$DIR/accounts.json"; chmod 600 "$DIR/accounts.json"; \
        rm -rf \(shellQuote(stageDir)); \
        \(restartCommand)
        """
    }

    static func renderDiscoverCommand(shellQuote: (String) -> String) -> String {
        let marker = discoveryRecordMarker
        return """
        MARKER=\(shellQuote(marker)); SEEN_UNITS=""; \
        for UNIT_PATH in /etc/systemd/system/codex-tools-proxyd-*.service /lib/systemd/system/codex-tools-proxyd-*.service; do \
          [ -f "$UNIT_PATH" ] || continue; \
          UNIT_NAME=$(basename "$UNIT_PATH"); \
          case " $SEEN_UNITS " in *" $UNIT_NAME "*) continue ;; esac; \
          SEEN_UNITS="$SEEN_UNITS $UNIT_NAME"; \
          WORK_DIR=$(sed -n 's/^WorkingDirectory=//p' "$UNIT_PATH" | head -n 1); \
          SERVER_ID=$(sed -n 's/^Environment=\"CODEXMANAGER_SERVER_ID=//p' "$UNIT_PATH" | head -n 1 | sed 's/\"$//'); \
          LABEL=$(sed -n 's/^Environment=\"CODEXMANAGER_SERVER_LABEL=//p' "$UNIT_PATH" | head -n 1 | sed 's/\"$//'); \
          PORT=$(sed -n 's/^ExecStart=.* --port \\([0-9][0-9]*\\).*$/\\1/p' "$UNIT_PATH" | head -n 1); \
          [ -n "$WORK_DIR" ] || continue; \
          [ -n "$PORT" ] || continue; \
          INSTALLED=0; RUNNING=0; ENABLED=0; PID=""; API_KEY_PRESENT=0; \
          [ -x "$WORK_DIR/codex-tools-proxyd" ] && INSTALLED=1; \
          if command -v systemctl >/dev/null 2>&1; then \
            ENABLED_STATE=$(systemctl is-enabled "$UNIT_NAME" 2>/dev/null || true); \
            [ "$ENABLED_STATE" = "enabled" ] && ENABLED=1; \
            ACTIVE_STATE=$(systemctl is-active "$UNIT_NAME" 2>/dev/null || true); \
            [ "$ACTIVE_STATE" = "active" ] && RUNNING=1; \
            PID=$(systemctl show -p MainPID --value "$UNIT_NAME" 2>/dev/null || true); \
            [ "$PID" = "0" ] && PID=""; \
          fi; \
          [ -s "$WORK_DIR/api-proxy.key" ] && API_KEY_PRESENT=1; \
          printf '%s\\nservice_name=%s\\nserver_id=%s\\nlabel=%s\\nremote_dir=%s\\nlisten_port=%s\\ninstalled=%s\\nservice_installed=1\\nrunning=%s\\nenabled=%s\\npid=%s\\napi_key_present=%s\\n' "$MARKER" "$UNIT_NAME" "$SERVER_ID" "$LABEL" "$WORK_DIR" "$PORT" "$INSTALLED" "$RUNNING" "$ENABLED" "$PID" "$API_KEY_PRESENT"; \
        done
        """
    }

    static func renderUninstallCommand(
        remoteDir: String,
        serviceName: String,
        removeRemoteDirectory: Bool,
        shellQuote: (String) -> String
    ) -> String {
        let removeDirCommand = removeRemoteDirectory
            ? "rm -rf \(shellQuote(remoteDir));"
            : "rm -f \(shellQuote("\(remoteDir)/codex-tools-proxyd")) \(shellQuote("\(remoteDir)/accounts.json"));"

        return """
        UNIT=\(shellQuote(serviceName)); \
        systemctl stop "$UNIT" >/dev/null 2>&1 || true; \
        systemctl disable "$UNIT" >/dev/null 2>&1 || true; \
        rm -f "/etc/systemd/system/$UNIT" "/lib/systemd/system/$UNIT"; \
        systemctl daemon-reload; \
        \(removeDirCommand)
        """
    }

    private static func renderConflictCleanupCommand(
        server: RemoteServerConfig,
        preservingServiceName: String,
        shellQuote: (String) -> String
    ) -> String {
        """
        TARGET_DIR=\(shellQuote(server.remoteDir)); TARGET_PORT=\(shellQuote(String(server.listenPort))); TARGET_UNIT=\(shellQuote(preservingServiceName)); \
        for UNIT_PATH in /etc/systemd/system/codex-tools-proxyd-*.service /lib/systemd/system/codex-tools-proxyd-*.service; do \
          [ -f "$UNIT_PATH" ] || continue; \
          UNIT_NAME=$(basename "$UNIT_PATH"); \
          [ "$UNIT_NAME" = "$TARGET_UNIT" ] && continue; \
          WORK_DIR=$(sed -n 's/^WorkingDirectory=//p' "$UNIT_PATH" | head -n 1); \
          PORT=$(sed -n 's/^ExecStart=.* --port \\([0-9][0-9]*\\).*$/\\1/p' "$UNIT_PATH" | head -n 1); \
          if [ "$WORK_DIR" = "$TARGET_DIR" ] || [ "$PORT" = "$TARGET_PORT" ]; then \
            systemctl stop "$UNIT_NAME" >/dev/null 2>&1 || true; \
            systemctl disable "$UNIT_NAME" >/dev/null 2>&1 || true; \
            rm -f "/etc/systemd/system/$UNIT_NAME" "/lib/systemd/system/$UNIT_NAME"; \
          fi; \
        done;
        """
    }

    private static func safeFragment(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let chars = value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
        let sanitized = String(chars)
        return sanitized.isEmpty ? "default" : sanitized
    }

    private static func systemdEnvironment(_ key: String, value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "Environment=\"\(key)=\(escaped)\""
    }
}
