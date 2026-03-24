import Foundation

final class AuthFileRepository: AuthRepository, @unchecked Sendable {
    private let paths: FileSystemPaths
    private let fileManager: FileManager

    init(paths: FileSystemPaths, fileManager: FileManager = .default) {
        self.paths = paths
        self.fileManager = fileManager
    }

    func readCurrentAuth() throws -> JSONValue {
        guard fileManager.fileExists(atPath: paths.codexAuthPath.path) else {
            throw AppError.fileNotFound(L10n.tr("error.auth.auth_file_not_found"))
        }
        return try readJSONValue(from: paths.codexAuthPath)
    }

    func readCurrentAuthOptional() throws -> JSONValue? {
        guard fileManager.fileExists(atPath: paths.codexAuthPath.path) else {
            return nil
        }
        return try readJSONValue(from: paths.codexAuthPath)
    }

    func readAuth(from url: URL) throws -> JSONValue {
        try readJSONValue(from: url)
    }

    func writeCurrentAuth(_ auth: JSONValue) throws {
        let normalizedAuth = try CodexCurrentAuthNormalizer.normalize(
            auth,
            fallbackLastRefresh: Self.makeLastRefreshTimestamp
        )
        let parentDirectory = paths.codexAuthPath.deletingLastPathComponent()
        try fileManager.createDirectory(at: parentDirectory, withIntermediateDirectories: true)

        let object = normalizedAuth.toAny()
        guard JSONSerialization.isValidJSONObject(object) else {
            throw AppError.invalidData(L10n.tr("error.auth.auth_json_invalid_structure"))
        }

        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: paths.codexAuthPath, options: .atomic)
        #if canImport(Darwin)
        _ = chmod(paths.codexAuthPath.path, S_IRUSR | S_IWUSR)
        #endif
    }

    func removeCurrentAuth() throws {
        guard fileManager.fileExists(atPath: paths.codexAuthPath.path) else {
            return
        }
        try fileManager.removeItem(at: paths.codexAuthPath)
    }

    func makeChatGPTAuth(from tokens: ChatGPTOAuthTokens) throws -> JSONValue {
        let claims = try AuthJWTDecoder.decodePayload(tokens.idToken)
        let accountID = claims["https://api.openai.com/auth"]?["chatgpt_account_id"]?.stringValue
        let principalID = AuthPrincipalIDResolver.resolve(
            from: .object([:]),
            claims: claims,
            email: claims["email"]?.stringValue,
            accountID: accountID
        )

        var tokenObject: [String: JSONValue] = [
            "access_token": .string(tokens.accessToken),
            "refresh_token": .string(tokens.refreshToken),
            "id_token": .string(tokens.idToken)
        ]

        if let accountID, !accountID.isEmpty {
            tokenObject["account_id"] = .string(accountID)
        }
        if let principalID, !principalID.isEmpty {
            tokenObject["principal_id"] = .string(principalID)
        }

        var root: [String: JSONValue] = [
            "auth_mode": .string("chatgpt"),
            "last_refresh": .string(Self.makeLastRefreshTimestamp()),
            "tokens": .object(tokenObject)
        ]

        if let apiKey = tokens.apiKey, !apiKey.isEmpty {
            root["OPENAI_API_KEY"] = .string(apiKey)
        }

        return .object(root)
    }

    func extractAuth(from auth: JSONValue) throws -> ExtractedAuth {
        let mode = auth["auth_mode"]?.stringValue?.lowercased() ?? ""
        guard let tokens = authTokenObject(from: auth) else {
            if !mode.isEmpty && mode != "chatgpt" && mode != "chatgpt_auth_tokens" {
                throw AppError.unauthorized(L10n.tr("error.auth.not_chatgpt_mode"))
            }
            throw AppError.unauthorized(L10n.tr("error.auth.no_chatgpt_token"))
        }

        guard let accessToken = tokens["access_token"]?.stringValue else {
            throw AppError.invalidData(L10n.tr("error.auth.missing_access_token"))
        }
        guard let idToken = tokens["id_token"]?.stringValue else {
            throw AppError.invalidData(L10n.tr("error.auth.missing_id_token"))
        }

        var accountID = tokens["account_id"]?.stringValue
        var principalID = tokens["principal_id"]?.stringValue
        var email: String?
        var planType: String?
        var teamName: String?
        let claims = try? AuthJWTDecoder.decodePayload(idToken)

        if let claims {
            email = claims["email"]?.stringValue
            if accountID == nil {
                accountID = claims["https://api.openai.com/auth"]?["chatgpt_account_id"]?.stringValue
            }
            principalID = principalID ?? AuthPrincipalIDResolver.resolve(
                from: auth,
                claims: claims,
                email: email,
                accountID: accountID
            )
            planType = claims["https://api.openai.com/auth"]?["chatgpt_plan_type"]?.stringValue
            teamName = AuthWorkspaceMetadataExtractor.extractTeamName(
                from: auth,
                claims: claims,
                accountIDHint: accountID
            )
        } else {
            teamName = AuthWorkspaceMetadataExtractor.extractTeamName(
                from: auth,
                claims: nil,
                accountIDHint: accountID
            )
        }

        guard let finalAccountID = accountID, !finalAccountID.isEmpty else {
            throw AppError.invalidData(L10n.tr("error.auth.missing_chatgpt_account_id"))
        }

        let finalPrincipalID = AuthPrincipalIDResolver.resolve(
            from: auth,
            claims: claims,
            email: email,
            accountID: finalAccountID,
            fallbackPrincipalID: principalID
        )

        return ExtractedAuth(
            accountID: finalAccountID,
            accessToken: accessToken,
            email: email,
            planType: planType,
            teamName: teamName,
            principalID: finalPrincipalID
        )
    }

    private func readJSONValue(from path: URL) throws -> JSONValue {
        let data: Data
        do {
            data = try Data(contentsOf: path)
        } catch {
            throw AppError.io(L10n.tr("error.auth.read_auth_json_failed_format", error.localizedDescription))
        }

        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw AppError.invalidData(L10n.tr("error.auth.auth_json_invalid"))
        }

        return try JSONValue.from(any: object)
    }

    private func authTokenObject(from auth: JSONValue) -> [String: JSONValue]? {
        AuthJWTDecoder.tokenObject(from: auth)
    }

    private static func makeLastRefreshTimestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
}

private enum CodexCurrentAuthNormalizer {
    private static let topLevelTokenKeys = [
        "access_token",
        "refresh_token",
        "id_token",
        "account_id"
    ]

    static func normalize(
        _ auth: JSONValue,
        fallbackLastRefresh: () -> String
    ) throws -> JSONValue {
        guard var root = auth.objectValue else {
            throw AppError.invalidData(L10n.tr("error.auth.auth_json_invalid_structure"))
        }

        let tokens = try normalizedTokens(from: root)
        root["auth_mode"] = .string(normalizedAuthMode(root["auth_mode"]))
        root["tokens"] = .object(tokens)

        for key in topLevelTokenKeys {
            root.removeValue(forKey: key)
        }

        root["last_refresh"] = .string(
            normalizedLastRefresh(root["last_refresh"], fallback: fallbackLastRefresh)
        )
        return .object(root)
    }

    private static func normalizedTokens(from root: [String: JSONValue]) throws -> [String: JSONValue] {
        var tokens = root["tokens"]?.objectValue ?? [:]

        if tokens.isEmpty {
            for key in topLevelTokenKeys {
                if let value = root[key] {
                    tokens[key] = value
                }
            }
        } else {
            for key in topLevelTokenKeys where tokens[key] == nil {
                if let value = root[key] {
                    tokens[key] = value
                }
            }
        }

        guard tokens["access_token"]?.stringValue != nil else {
            throw AppError.invalidData(L10n.tr("error.auth.missing_access_token"))
        }
        guard tokens["id_token"]?.stringValue != nil else {
            throw AppError.invalidData(L10n.tr("error.auth.missing_id_token"))
        }
        return tokens
    }

    private static func normalizedAuthMode(_ value: JSONValue?) -> String {
        let trimmed = value?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "chatgpt" : trimmed
    }

    private static func normalizedLastRefresh(_ value: JSONValue?, fallback: () -> String) -> String {
        guard let rawValue = value?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawValue.isEmpty else {
            return fallback()
        }

        if let parsed = parseTimestamp(rawValue) {
            return makeTimestamp(from: parsed)
        }
        return fallback()
    }

    private static func parseTimestamp(_ value: String) -> Date? {
        for candidate in timestampCandidates(for: value) {
            if let parsed = parseRFC3339(candidate) {
                return parsed
            }
        }
        return nil
    }

    private static func timestampCandidates(for value: String) -> [String] {
        var candidates = [value]
        if !hasExplicitTimezone(value) {
            candidates.append("\(value)Z")
        }
        return candidates
    }

    private static func hasExplicitTimezone(_ value: String) -> Bool {
        value.range(
            of: #"(Z|[+-]\d{2}:\d{2})$"#,
            options: .regularExpression
        ) != nil
    }

    private static func parseRFC3339(_ value: String) -> Date? {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = fractionalFormatter.date(from: value) {
            return parsed
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    private static func makeTimestamp(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
