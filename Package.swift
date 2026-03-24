// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CodexManager",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "CodexManager", targets: ["CodexManager"])
    ],
    targets: [
        .executableTarget(
            name: "CodexManager",
            path: "Sources/CodexManager",
            exclude: [
                "CodexManager.icon"
            ],
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "CodexManagerTests",
            dependencies: ["CodexManager"],
            path: "Tests/CodexManagerTests"
        )
    ]
)
