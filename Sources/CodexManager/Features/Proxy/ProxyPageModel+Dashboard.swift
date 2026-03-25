import Foundation

// MARK: - Model List & Claude Code Config
// Adapted from kiro-gateway-swift/KiroGateway/DashboardView.swift

extension ProxyPageModel {

    // MARK: - Fetch Models

    func fetchModels() {
        guard proxyStatus.running,
              let baseURL = proxyStatus.baseURL,
              let apiKey = proxyStatus.apiKey,
              let url = URL(string: "\(baseURL)/v1/models") else { return }

        isLoadingModels = true
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.isLoadingModels = false

                if error != nil { return }

                if let http = response as? HTTPURLResponse, http.statusCode != 200 { return }

                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let dataArray = json["data"] as? [[String: Any]] else { return }

                self.availableModels = dataArray
                    .compactMap { $0["id"] as? String }
                    .sorted()
            }
        }.resume()
    }

    // MARK: - cURL Example

    var curlExample: String {
        let model = selectedCurlModel ?? availableModels.first ?? "gpt-5"
        let baseURL = proxyStatus.baseURL ?? "http://127.0.0.1:\(preferredPortText)"
        let apiKey = proxyStatus.apiKey ?? "<your-api-key>"
        return """
        curl \(baseURL)/v1/chat/completions \\
          -H "Authorization: Bearer \(apiKey)" \\
          -H "Content-Type: application/json" \\
          -d '{"model": "\(model)", "messages": [{"role": "user", "content": "Hello!"}]}'
        """
    }

    func copyToClipboard(_ value: String, field: String) {
        PlatformClipboard.copy(value)
        copiedField = field
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1500))
            if self?.copiedField == field { self?.copiedField = nil }
        }
    }

    // MARK: - Claude Code Settings IO
    // Adapted from kiro-gateway-swift DashboardView claudeConfig methods

    static var claudeSettingsURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude")
            .appendingPathComponent("settings.json")
    }

    static var envBackupURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".codexmanager")
            .appendingPathComponent("settings.env.backup.json")
    }

    var hasEnvBackup: Bool {
        FileManager.default.fileExists(atPath: Self.envBackupURL.path)
    }

    func loadClaudeConfig() {
        let url = Self.claudeSettingsURL
        guard FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let env = json["env"] as? [String: Any] else { return }
        claudeOpusModel = env["ANTHROPIC_DEFAULT_OPUS_MODEL"] as? String ?? ""
        claudeSonnetModel = env["ANTHROPIC_DEFAULT_SONNET_MODEL"] as? String ?? ""
        claudeHaikuModel = env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] as? String ?? ""
    }

    func saveClaudeConfig() {
        claudeConfigSaving = true
        let url = Self.claudeSettingsURL
        let dir = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var settings: [String: Any] = [:]
        if let data = try? Data(contentsOf: url),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            settings = existing
        }

        // Backup original env to file before first write
        if !hasEnvBackup {
            let backupDir = Self.envBackupURL.deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: backupDir, withIntermediateDirectories: true)
            let wrapper: [String: Any] = ["env": settings["env"] as Any]
            if let backupData = try? JSONSerialization.data(withJSONObject: wrapper, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) {
                try? backupData.write(to: Self.envBackupURL)
            }
        }

        // Claude Code uses ANTHROPIC_BASE_URL + "/v1/messages", so give it the root URL
        let fullBaseURL = proxyStatus.baseURL ?? "http://127.0.0.1:\(preferredPortText)/v1"
        let anthropicBaseURL = fullBaseURL.hasSuffix("/v1")
            ? String(fullBaseURL.dropLast(3))
            : fullBaseURL
        let apiKey = proxyStatus.apiKey ?? ""

        var envDict: [String: String] = [
            "ANTHROPIC_AUTH_TOKEN": apiKey,
            "ANTHROPIC_BASE_URL": anthropicBaseURL,
            "API_TIMEOUT_MS": "3000000",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        ]
        if !claudeOpusModel.isEmpty {
            envDict["ANTHROPIC_DEFAULT_OPUS_MODEL"] = claudeOpusModel
        }
        if !claudeSonnetModel.isEmpty {
            envDict["ANTHROPIC_DEFAULT_SONNET_MODEL"] = claudeSonnetModel
        }
        if !claudeHaikuModel.isEmpty {
            envDict["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = claudeHaikuModel
        }
        settings["env"] = envDict

        if let data = try? JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) {
            try? data.write(to: url)
        }

        claudeConfigSaving = false
        claudeConfigSaved = true
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2))
            self?.claudeConfigSaved = false
        }
    }

    func resetClaudeConfig() {
        claudeConfigResetting = true
        let url = Self.claudeSettingsURL
        let backupURL = Self.envBackupURL

        guard hasEnvBackup else {
            claudeConfigResetting = false
            return
        }

        var settings: [String: Any] = [:]
        if let data = try? Data(contentsOf: url),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            settings = existing
        }

        // Restore original env from backup file
        if let backupData = try? Data(contentsOf: backupURL),
           let wrapper = try? JSONSerialization.jsonObject(with: backupData) as? [String: Any] {
            if let originalEnv = wrapper["env"] {
                settings["env"] = originalEnv
            } else {
                settings.removeValue(forKey: "env")
            }
        } else {
            settings.removeValue(forKey: "env")
        }

        if let data = try? JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) {
            try? data.write(to: url)
        }

        // Remove backup file
        try? FileManager.default.removeItem(at: backupURL)

        // Reload UI state from restored config
        loadClaudeConfig()

        claudeConfigResetting = false
        claudeConfigReset = true
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2))
            self?.claudeConfigReset = false
        }
    }
}
