import XCTest
@testable import CodexManager

final class WeeklyQuotaWarmupServiceTests: XCTestCase {
    func testWarmupUsesSupportedCodexChatGPTRequestShape() async throws {
        let upstream = RecordingWarmupUpstreamClient()
        let service = DefaultWeeklyQuotaWarmupService(
            configPath: FileManager.default.temporaryDirectory.appendingPathComponent("codex-config.toml"),
            upstreamClient: upstream,
            endpointPreferenceStore: EndpointPreferenceStore()
        )

        try await service.warmUp(accessToken: "access-token", accountID: "workspace-id")

        let requests = await upstream.requests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.url.path, "/backend-api/codex/responses")
        XCTAssertEqual(request.accessToken, "access-token")
        XCTAssertEqual(request.accountID, "workspace-id")
        XCTAssertTrue(request.isStream)

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.body) as? [String: Any])
        XCTAssertEqual(body["model"] as? String, "gpt-5.4-mini")
        XCTAssertEqual(body["stream"] as? Bool, true)
        XCTAssertEqual(body["store"] as? Bool, false)
        XCTAssertEqual(body["tool_choice"] as? String, "none")
        XCTAssertEqual(body["parallel_tool_calls"] as? Bool, false)
        XCTAssertEqual((body["tools"] as? [Any])?.count, 0)
        XCTAssertEqual((body["include"] as? [Any])?.count, 0)

        let reasoning = try XCTUnwrap(body["reasoning"] as? [String: Any])
        XCTAssertEqual(reasoning["effort"] as? String, "low")
        XCTAssertNil(reasoning["summary"])
    }
}

private actor RecordingWarmupUpstreamClient: CodexUpstreamClientProtocol {
    private var recordedRequests: [CodexUpstreamRequest] = []

    func execute(request: CodexUpstreamRequest) async throws -> CodexUpstreamResult {
        recordedRequests.append(request)
        return .stream(
            statusCode: 200,
            lines: AsyncStream { continuation in
                continuation.yield(Data(#"data: {"type":"response.completed"}"#.utf8))
                continuation.finish()
            },
            headers: [:]
        )
    }

    func requests() -> [CodexUpstreamRequest] {
        recordedRequests
    }
}
