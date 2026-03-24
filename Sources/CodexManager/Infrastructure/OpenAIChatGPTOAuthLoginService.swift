import Foundation
import CryptoKit

#if os(macOS)
import AppKit
#endif
#if os(iOS)
import AuthenticationServices
import UIKit
#endif

final class OpenAIChatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol, @unchecked Sendable {
    private enum Configuration {
        static let issuer = URL(string: "https://auth.openai.com")!
        static let clientID = "app_EMoamEEZ73f0CkXaXp7hrann"
        static let originator = "codex_cli_rs"
        static let callbackPath = "/auth/callback"
        static let preferredCallbackPort: UInt16 = 1455
        static let maxPortScanOffset: UInt16 = 12
        static let scopes = "openid profile email offline_access api.connectors.read api.connectors.invoke"
    }

    private let configPath: URL
    private let session: URLSession
    #if os(iOS)
    @MainActor private static let authenticationSessionDriver = IOSWebAuthenticationSessionDriver()
    #endif

    init(configPath: URL, session: URLSession = .shared) {
        self.configPath = configPath
        self.session = session
    }

    func signInWithChatGPT(timeoutSeconds: TimeInterval) async throws -> ChatGPTOAuthTokens {
        let callback = OAuthCallbackBox<ChatGPTOAuthTokens>()
        let pkce = PKCECodes.make()
        let state = OpenAIChatGPTOAuthSupport.randomBase64URL(byteCount: 32)
        let forcedWorkspaceID = resolveForcedWorkspaceID()

        let (server, port) = try makeCallbackServer(
            callback: callback,
            pkce: pkce,
            state: state,
            forcedWorkspaceID: forcedWorkspaceID
        )
        let redirectURI = Self.redirectURI(for: port)
        let authorizeURL = try makeAuthorizeURL(
            redirectURI: redirectURI,
            pkce: pkce,
            state: state,
            forcedWorkspaceID: forcedWorkspaceID
        )

        server.start()
        defer { server.stop() }

        try await beginAuthorizationSession(url: authorizeURL, callback: callback)

        do {
            let tokens = try await callback.wait(timeoutSeconds: timeoutSeconds) {
                AppError.io(L10n.tr("error.accounts.add_account_timeout"))
            }
            await endAuthorizationSession()
            return tokens
        } catch {
            await endAuthorizationSession()
            throw error
        }
    }

    private func beginAuthorizationSession(
        url: URL,
        callback: OAuthCallbackBox<ChatGPTOAuthTokens>
    ) async throws {
        #if os(macOS)
        guard NSWorkspace.shared.open(url) else {
            throw AppError.io(L10n.tr("error.oauth.browser_open_failed"))
        }
        #else
        try await Self.authenticationSessionDriver.start(url: url) { error in
            callback.fail(error)
        }
        #endif
    }

    private func endAuthorizationSession() async {
        #if os(iOS)
        await Self.authenticationSessionDriver.finishIfNeeded()
        #endif
    }

    private func makeCallbackServer(
        callback: OAuthCallbackBox<ChatGPTOAuthTokens>,
        pkce: PKCECodes,
        state: String,
        forcedWorkspaceID: String?
    ) throws -> (SimpleHTTPServer, UInt16) {
        var candidatePort = Configuration.preferredCallbackPort
        let maxPort = Configuration.preferredCallbackPort + Configuration.maxPortScanOffset
        var lastError: Error?

        while candidatePort <= maxPort {
            do {
                let redirectURI = Self.redirectURI(for: candidatePort)
                let server = try SimpleHTTPServer(port: candidatePort) { [session] request in
                    await Self.handleCallback(
                        request: request,
                        session: session,
                        redirectURI: redirectURI,
                        pkce: pkce,
                        state: state,
                        forcedWorkspaceID: forcedWorkspaceID,
                        callback: callback
                    )
                }
                return (server, candidatePort)
            } catch {
                lastError = error
                candidatePort += 1
            }
        }

        throw lastError ?? AppError.io(L10n.tr("error.oauth.callback_server_start_failed"))
    }

    private static func handleCallback(
        request: HTTPRequest,
        session: URLSession,
        redirectURI: String,
        pkce: PKCECodes,
        state: String,
        forcedWorkspaceID: String?,
        callback: OAuthCallbackBox<ChatGPTOAuthTokens>
    ) async -> HTTPResponse {
        guard request.method == "GET" else {
            return .text(statusCode: 405, text: "Method Not Allowed")
        }

        switch request.path {
        case Configuration.callbackPath:
            let params = [String: String](uniqueKeysWithValues: request.queryItems.compactMap { item in
                guard let value = item.value else { return nil }
                return (item.name, value)
            })

            guard params["state"] == state else {
                let error = AppError.unauthorized(L10n.tr("error.oauth.callback_state_mismatch"))
                callback.fail(error)
                return .html(
                    statusCode: 400,
                    body: OpenAIChatGPTOAuthSupport.errorPageHTML(message: error.localizedDescription)
                )
            }

            if let code = params["code"], !code.isEmpty {
                do {
                    let tokens = try await exchangeCodeForTokens(
                        session: session,
                        redirectURI: redirectURI,
                        pkce: pkce,
                        code: code,
                        forcedWorkspaceID: forcedWorkspaceID
                    )
                    callback.succeed(tokens)
                    return .html(statusCode: 200, body: OpenAIChatGPTOAuthSupport.successPageHTML())
                } catch {
                    callback.fail(error)
                    return .html(statusCode: 500, body: OpenAIChatGPTOAuthSupport.errorPageHTML(message: error.localizedDescription))
                }
            }

            if let errorCode = params["error"] {
                let description = params["error_description"]?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                let message = description?.isEmpty == false
                    ? L10n.tr("error.oauth.callback_failed_format", description!)
                    : L10n.tr("error.oauth.callback_failed_format", errorCode)
                let authError = AppError.unauthorized(message)
                callback.fail(authError)
                return .html(statusCode: 401, body: OpenAIChatGPTOAuthSupport.errorPageHTML(message: message))
            }

            let error = AppError.invalidData(L10n.tr("error.oauth.callback_missing_code"))
            callback.fail(error)
            return .html(statusCode: 400, body: OpenAIChatGPTOAuthSupport.errorPageHTML(message: error.localizedDescription))
        case "/cancel":
            let error = AppError.io(L10n.tr("error.oauth.request_cancelled"))
            callback.fail(error)
            return .html(statusCode: 200, body: OpenAIChatGPTOAuthSupport.errorPageHTML(message: error.localizedDescription))
        default:
            return .text(statusCode: 404, text: "Not Found")
        }
    }

    private static func exchangeCodeForTokens(
        session: URLSession,
        redirectURI: String,
        pkce: PKCECodes,
        code: String,
        forcedWorkspaceID: String?
    ) async throws -> ChatGPTOAuthTokens {
        var request = URLRequest(url: endpointURL("/oauth/token"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = OpenAIChatGPTOAuthSupport.formEncodedBody([
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirectURI),
            ("client_id", Configuration.clientID),
            ("code_verifier", pkce.codeVerifier)
        ])

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AppError.network(L10n.tr("error.oauth.token_exchange_failed_format", L10n.tr("error.usage.invalid_response")))
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            let detail = body.trimmingCharacters(in: .whitespacesAndNewlines)
            let message = detail.isEmpty ? "HTTP \(httpResponse.statusCode)" : String(detail.prefix(200))
            throw AppError.network(L10n.tr("error.oauth.token_exchange_failed_format", message))
        }

        let tokenResponse = try JSONDecoder().decode(TokenExchangeResponse.self, from: data)
        if let forcedWorkspaceID {
            let accountID = try OpenAIChatGPTOAuthSupport.extractAccountID(fromIDToken: tokenResponse.idToken)
            guard accountID == forcedWorkspaceID else {
                throw AppError.unauthorized(L10n.tr("error.oauth.workspace_mismatch_format", forcedWorkspaceID))
            }
        }

        let apiKey = try? await exchangeIDTokenForAPIKey(session: session, idToken: tokenResponse.idToken)
        return ChatGPTOAuthTokens(
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken,
            idToken: tokenResponse.idToken,
            apiKey: apiKey
        )
    }

    private static func exchangeIDTokenForAPIKey(session: URLSession, idToken: String) async throws -> String {
        var request = URLRequest(url: endpointURL("/oauth/token"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = OpenAIChatGPTOAuthSupport.formEncodedBody([
            ("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange"),
            ("client_id", Configuration.clientID),
            ("requested_token", "openai-api-key"),
            ("subject_token", idToken),
            ("subject_token_type", "urn:ietf:params:oauth:token-type:id_token")
        ])

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw AppError.network(L10n.tr("error.oauth.api_key_exchange_failed"))
        }

        let payload = try JSONDecoder().decode(APIKeyExchangeResponse.self, from: data)
        return payload.accessToken
    }

    private func makeAuthorizeURL(
        redirectURI: String,
        pkce: PKCECodes,
        state: String,
        forcedWorkspaceID: String?
    ) throws -> URL {
        var components = URLComponents(url: Self.endpointURL("/oauth/authorize"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: Configuration.clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: Configuration.scopes),
            URLQueryItem(name: "code_challenge", value: pkce.codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "id_token_add_organizations", value: "true"),
            URLQueryItem(name: "codex_cli_simplified_flow", value: "true"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "originator", value: Configuration.originator)
        ]

        if let forcedWorkspaceID, !forcedWorkspaceID.isEmpty {
            components?.queryItems?.append(URLQueryItem(name: "allowed_workspace_id", value: forcedWorkspaceID))
        }

        guard let url = components?.url else {
            throw AppError.invalidData(L10n.tr("error.oauth.authorize_url_invalid"))
        }
        return url
    }

    private func resolveForcedWorkspaceID() -> String? {
        guard let raw = try? String(contentsOf: configPath, encoding: .utf8), !raw.isEmpty else {
            return nil
        }

        for line in raw.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("forced_chatgpt_workspace_id") else { continue }
            guard let equalIndex = trimmed.firstIndex(of: "=") else { continue }
            let value = trimmed[trimmed.index(after: equalIndex)...]
                .trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            if !value.isEmpty {
                return value
            }
        }

        return nil
    }

    private static func endpointURL(_ path: String) -> URL {
        guard let url = URL(string: path, relativeTo: Configuration.issuer)?.absoluteURL else {
            return Configuration.issuer
        }
        return url
    }

    private static func redirectURI(for port: UInt16) -> String {
        "http://localhost:\(port)\(Configuration.callbackPath)"
    }
}

#if os(iOS)
@MainActor
private final class IOSWebAuthenticationSessionDriver: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var completionHandler: ((Error) -> Void)?

    func start(url: URL, completionHandler: @escaping (Error) -> Void) throws {
        finishIfNeeded()

        self.completionHandler = completionHandler
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: nil
        ) { [weak self] _, error in
            guard let self else { return }
            Task { @MainActor in
                let completionHandler = self.completionHandler
                self.completionHandler = nil
                self.session = nil

                guard let error else { return }
                completionHandler?(Self.normalize(error))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false

        guard session.start() else {
            self.completionHandler = nil
            throw AppError.io(L10n.tr("error.oauth.browser_open_failed"))
        }

        self.session = session
    }

    func finishIfNeeded() {
        completionHandler = nil
        session?.cancel()
        session = nil
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let windowScenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let foregroundScenes = windowScenes.filter {
            $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive
        }
        let windows = foregroundScenes.flatMap(\.windows)

        if let keyWindow = windows.first(where: \.isKeyWindow) {
            return keyWindow
        }
        if let fallbackWindow = windows.first {
            return fallbackWindow
        }
        guard let fallbackScene = foregroundScenes.first ?? windowScenes.first else {
            preconditionFailure("ASWebAuthenticationSession requires a foreground window scene.")
        }
        return ASPresentationAnchor(windowScene: fallbackScene)
    }

    private static func normalize(_ error: Error) -> Error {
        let nsError = error as NSError
        if nsError.domain == ASWebAuthenticationSessionErrorDomain,
           nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
            return AppError.io(L10n.tr("error.oauth.request_cancelled"))
        }
        return error
    }
}
#endif
