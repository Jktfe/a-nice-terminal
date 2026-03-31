# ANT iOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native iOS app for ANT (A Nice Terminal) — session-centric, SwiftUI, with chat, terminal (SIGNALS/RAW/XTERM), voice (ElevenLabs), push notifications, and file upload.

**Architecture:** Session is the atomic unit; the sessions list is the Chairman overview. Each session contains both chat and terminal modes, switched via a nav-bar pill. Core infrastructure (networking, SwiftData cache, API key auth) is shared across all features.

**Tech Stack:** Swift 6, iOS 17+, SwiftUI + Observation, Socket.IO-Client-Swift v16, SwiftData, WKWebView + xterm.js, ElevenLabs API, APNs, QuickLook, PHPickerViewController

**Spec:** `docs/superpowers/specs/2026-03-30-ant-ios-design.md`
**Mockups:** `docs/mockups.pen` frames `iOSIg`, `iJfs7`, `y1sDB`, `2Y0Qb`, `SixBm`, `1mKKf`

**Server dependency:** Push notifications require `POST /api/devices` and `DELETE /api/devices/:token` on the ANT server. Use mock during iOS development; wire up when server endpoint is ready.

---

## Phase 1: Project Scaffold + Theme

### Task 1: Create Xcode project

**Files:**
- Create: `antios/ANT.xcodeproj`
- Create: `antios/ANT/ANTApp.swift`
- Create: `antios/ANT/Theme/ANTTheme.swift`

- [ ] **Step 1: Create project**

In Xcode: File → New → Project → App. Name: `ANT`, Bundle ID: `vc.newmodel.ant`, Swift, SwiftUI, minimum iOS 17.0. Save to `~/projects/antios/`.

- [ ] **Step 2: Add Swift packages**

File → Add Package Dependencies:
- `https://github.com/socketio/socket.io-client-swift` — exact version `16.1.1`

- [ ] **Step 3: Write ANTTheme**

```swift
// ANT/Theme/ANTTheme.swift
import SwiftUI

enum ANTTheme {
    // MARK: - Colours
    enum Color {
        static let emerald     = SwiftUI.Color(hex: "#22C55E")
        static let indigo      = SwiftUI.Color(hex: "#6366F1")
        static let amber       = SwiftUI.Color(hex: "#F59E0B")
        static let red         = SwiftUI.Color(hex: "#EF4444")
        static let gold        = SwiftUI.Color(hex: "#C9A962")

        // Dark mode surfaces
        static let rootDark    = SwiftUI.Color(hex: "#0B0B0E")
        static let surfaceDark = SwiftUI.Color(hex: "#16161A")
        static let elevatedDark = SwiftUI.Color(hex: "#1E1E24")
        static let terminalDark = SwiftUI.Color(hex: "#0D0D12")

        // Light mode surfaces
        static let rootLight    = SwiftUI.Color(hex: "#F8F8FC")
        static let surfaceLight = SwiftUI.Color(hex: "#FFFFFF")
        static let elevatedLight = SwiftUI.Color(hex: "#F0F0F5")
        static let terminalLight = SwiftUI.Color(hex: "#F4F4F8")
    }

    // MARK: - Typography
    enum Font {
        static func cormorant(_ size: CGFloat, weight: SwiftUI.Font.Weight = .light) -> SwiftUI.Font {
            .custom("Cormorant Garamond", size: size).weight(weight)
        }
        static func inter(_ size: CGFloat, weight: SwiftUI.Font.Weight = .regular) -> SwiftUI.Font {
            .system(size: size, weight: weight, design: .default)
        }
        static func mono(_ size: CGFloat, weight: SwiftUI.Font.Weight = .regular) -> SwiftUI.Font {
            .custom("JetBrains Mono", size: size).weight(weight)
        }
    }

    // MARK: - Radii
    enum Radius {
        static let card: CGFloat = 16
        static let pill: CGFloat = 14
        static let input: CGFloat = 20
        static let button: CGFloat = 20
    }
}

extension SwiftUI.Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
```

- [ ] **Step 4: Register custom fonts**

Add `JetBrains Mono` and `Cormorant Garamond` `.ttf` files to `ANT/Theme/Fonts/`. In `Info.plist` add `UIAppFonts` array with each font filename.

- [ ] **Step 5: Commit**
```bash
git init && git add . && git commit -m "feat: scaffold ANT iOS project with theme tokens"
```

---

### Task 2: SwiftData models

**Files:**
- Create: `antios/ANT/Core/Storage/SwiftDataModels.swift`
- Create: `antios/ANTTests/SwiftDataModelsTests.swift`

- [ ] **Step 1: Write failing test**

```swift
// ANTTests/SwiftDataModelsTests.swift
import XCTest
import SwiftData
@testable import ANT

final class SwiftDataModelsTests: XCTestCase {
    var container: ModelContainer!

    override func setUp() async throws {
        container = try ModelContainer(
            for: CachedSession.self, CachedMessage.self,
                CachedTerminalChunk.self, PendingAction.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
    }

    func testInsertAndFetchSession() async throws {
        let ctx = ModelContext(container)
        let s = CachedSession(id: "s1", name: "build-main", type: "terminal",
                              workspaceId: nil, archived: false,
                              updatedAt: Date())
        ctx.insert(s)
        try ctx.save()
        let results = try ctx.fetch(FetchDescriptor<CachedSession>())
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].name, "build-main")
    }

    func testInsertMessage() async throws {
        let ctx = ModelContext(container)
        let m = CachedMessage(id: "m1", sessionId: "s1", role: "assistant",
                              content: "hello", format: "text",
                              status: "complete", metadata: nil,
                              createdAt: Date())
        ctx.insert(m)
        try ctx.save()
        let results = try ctx.fetch(FetchDescriptor<CachedMessage>())
        XCTAssertEqual(results[0].role, "assistant")
    }
}
```

- [ ] **Step 2: Run — expect FAIL** (types not defined yet)
```
cmd+U in Xcode — expect compile error
```

- [ ] **Step 3: Write models**

```swift
// ANT/Core/Storage/SwiftDataModels.swift
import Foundation
import SwiftData

@Model final class CachedSession {
    @Attribute(.unique) var id: String
    var name: String
    var type: String          // "terminal" | "conversation"
    var shell: String?
    var cwd: String?
    var workspaceId: String?
    var archived: Bool
    var updatedAt: Date

    init(id: String, name: String, type: String, workspaceId: String?,
         archived: Bool, updatedAt: Date) {
        self.id = id; self.name = name; self.type = type
        self.workspaceId = workspaceId; self.archived = archived
        self.updatedAt = updatedAt
    }
}

@Model final class CachedMessage {
    @Attribute(.unique) var id: String
    var sessionId: String
    var role: String          // "user" | "assistant"
    var content: String
    var format: String        // "text" | "markdown"
    var status: String        // "complete" | "streaming" | "incomplete"
    var metadata: String?     // JSON string — includes xray tags
    var createdAt: Date

    init(id: String, sessionId: String, role: String, content: String,
         format: String, status: String, metadata: String?, createdAt: Date) {
        self.id = id; self.sessionId = sessionId; self.role = role
        self.content = content; self.format = format; self.status = status
        self.metadata = metadata; self.createdAt = createdAt
    }
}

@Model final class CachedTerminalChunk {
    @Attribute(.unique) var id: String
    var sessionId: String
    var chunkIndex: Int
    var data: String
    var createdAt: Date

    init(id: String, sessionId: String, chunkIndex: Int, data: String, createdAt: Date) {
        self.id = id; self.sessionId = sessionId
        self.chunkIndex = chunkIndex; self.data = data; self.createdAt = createdAt
    }
}

@Model final class PendingAction {
    @Attribute(.unique) var id: String
    var endpoint: String
    var method: String        // "POST" | "PATCH" | "DELETE"
    var body: String?         // JSON string
    var createdAt: Date

    init(id: String, endpoint: String, method: String, body: String?, createdAt: Date) {
        self.id = id; self.endpoint = endpoint; self.method = method
        self.body = body; self.createdAt = createdAt
    }
}
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**
```bash
git add . && git commit -m "feat: SwiftData models — session, message, terminal chunk, pending action"
```

---

### Task 3: Keychain + ServerConfig

**Files:**
- Create: `ANT/Core/Storage/KeychainHelper.swift`
- Create: `ANT/Core/Auth/ServerConfig.swift`
- Create: `ANTTests/KeychainHelperTests.swift`

- [ ] **Step 1: Write failing test**

```swift
// ANTTests/KeychainHelperTests.swift
import XCTest
@testable import ANT

final class KeychainHelperTests: XCTestCase {
    func testSaveAndLoad() throws {
        let key = "test.api.key.\(UUID())"
        try KeychainHelper.save(key: key, value: "my-secret")
        let loaded = try KeychainHelper.load(key: key)
        XCTAssertEqual(loaded, "my-secret")
        try KeychainHelper.delete(key: key)
    }

    func testDeleteRemovesKey() throws {
        let key = "test.delete.\(UUID())"
        try KeychainHelper.save(key: key, value: "val")
        try KeychainHelper.delete(key: key)
        XCTAssertThrowsError(try KeychainHelper.load(key: key))
    }
}
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement KeychainHelper**

```swift
// ANT/Core/Storage/KeychainHelper.swift
import Foundation
import Security

enum KeychainError: Error { case itemNotFound, unexpectedData, unhandled(OSStatus) }

struct KeychainHelper {
    static func save(key: String, value: String) throws {
        let data = Data(value.utf8)
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecValueData: data
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unhandled(status) }
    }

    static func load(key: String) throws -> String {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            throw status == errSecItemNotFound ? KeychainError.itemNotFound : KeychainError.unhandled(status)
        }
        guard let data = result as? Data, let str = String(data: data, encoding: .utf8) else {
            throw KeychainError.unexpectedData
        }
        return str
    }

    static func delete(key: String) throws {
        let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrAccount: key]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandled(status)
        }
    }
}
```

- [ ] **Step 4: Implement ServerConfig**

```swift
// ANT/Core/Auth/ServerConfig.swift
import Foundation

@Observable final class ServerConfig {
    private let urlKey = "ant.server.url"
    private let apiKeyKey = "ant.api.key"

    var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: urlKey) }
    }

    var isConfigured: Bool { !serverURL.isEmpty && hasAPIKey }
    var hasAPIKey: Bool { (try? KeychainHelper.load(key: apiKeyKey)) != nil }

    init() {
        self.serverURL = UserDefaults.standard.string(forKey: "ant.server.url") ?? ""
    }

    func saveAPIKey(_ key: String) throws {
        try KeychainHelper.save(key: apiKeyKey, value: key)
    }

    func loadAPIKey() throws -> String {
        try KeychainHelper.load(key: apiKeyKey)
    }

    func deleteAPIKey() throws {
        try KeychainHelper.delete(key: apiKeyKey)
    }

    var authHeaders: [String: String] {
        guard let key = try? loadAPIKey() else { return [:] }
        return ["Authorization": "Bearer \(key)"]
    }
}
```

- [ ] **Step 5: Run tests — expect PASS**
- [ ] **Step 6: Commit**
```bash
git add . && git commit -m "feat: Keychain helper and ServerConfig"
```

---

## Phase 2: Networking

### Task 4: APIClient

**Files:**
- Create: `ANT/Core/Network/APIClient.swift`
- Create: `ANTTests/APIClientTests.swift`

- [ ] **Step 1: Write failing tests**

```swift
// ANTTests/APIClientTests.swift
import XCTest
@testable import ANT

final class APIClientTests: XCTestCase {
    func testBuildURLAppendsPath() {
        let config = ServerConfig()
        config.serverURL = "http://100.x.x.x:6450"
        let client = APIClient(config: config)
        let url = client.buildURL("/api/sessions")
        XCTAssertEqual(url?.absoluteString, "http://100.x.x.x:6450/api/sessions")
    }

    func testBuildURLWithQueryItems() {
        let config = ServerConfig()
        config.serverURL = "http://100.x.x.x:6450"
        let client = APIClient(config: config)
        let url = client.buildURL("/api/sessions", query: ["include_archived": "true"])
        XCTAssertTrue(url?.absoluteString.contains("include_archived=true") ?? false)
    }
}
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement APIClient**

```swift
// ANT/Core/Network/APIClient.swift
import Foundation

final class APIClient {
    let config: ServerConfig
    private let session: URLSession

    init(config: ServerConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    func buildURL(_ path: String, query: [String: String] = [:]) -> URL? {
        guard var components = URLComponents(string: config.serverURL + path) else { return nil }
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url
    }

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        guard let url = buildURL(path, query: query) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        config.authHeaders.forEach { req.addValue($1, forHTTPHeaderField: $0) }
        let (data, response) = try await session.data(for: req)
        try validate(response)
        return try JSONDecoder.ant.decode(T.self, from: data)
    }

    func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await send(path, method: "POST", body: body)
    }

    func patch<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await send(path, method: "PATCH", body: body)
    }

    func delete(_ path: String) async throws {
        guard let url = buildURL(path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        config.authHeaders.forEach { req.addValue($1, forHTTPHeaderField: $0) }
        let (_, response) = try await session.data(for: req)
        try validate(response)
    }

    func upload(_ path: String, imageData: Data, mimeType: String) async throws -> UploadResponse {
        guard let url = buildURL(path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        config.authHeaders.forEach { req.addValue($1, forHTTPHeaderField: $0) }
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"upload\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body
        let (data, response) = try await session.data(for: req)
        try validate(response)
        return try JSONDecoder.ant.decode(UploadResponse.self, from: data)
    }

    private func send<B: Encodable, T: Decodable>(_ path: String, method: String, body: B) async throws -> T {
        guard let url = buildURL(path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        config.authHeaders.forEach { req.addValue($1, forHTTPHeaderField: $0) }
        req.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: req)
        try validate(response)
        return try JSONDecoder.ant.decode(T.self, from: data)
    }

    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        switch http.statusCode {
        case 200...299: break
        case 401: throw APIError.unauthorized
        case 404: throw APIError.notFound
        case 400...499: throw APIError.clientError(http.statusCode)
        default: throw APIError.serverError(http.statusCode)
        }
    }
}

enum APIError: Error {
    case badURL, badResponse, unauthorized, notFound
    case clientError(Int), serverError(Int)
}

struct UploadResponse: Decodable { let url: String }

extension JSONDecoder {
    static let ant: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**
```bash
git add . && git commit -m "feat: APIClient with REST get/post/patch/delete/upload"
```

---

### Task 5: SocketClient

**Files:**
- Create: `ANT/Core/Network/SocketClient.swift`
- Create: `ANTTests/SocketClientTests.swift`

- [ ] **Step 1: Write failing test**

```swift
// ANTTests/SocketClientTests.swift
import XCTest
@testable import ANT

final class SocketClientTests: XCTestCase {
    func testJoinSessionEmitsEvent() {
        let client = SocketClient(serverURL: "http://localhost:6450", apiKey: "test")
        // Test that joinSession sets up the correct event name
        // SocketClient is not connected — just check internal state
        XCTAssertFalse(client.isConnected)
        // joinSession should not throw when not connected
        client.joinSession(id: "s1")
        XCTAssertTrue(client.joinedSessions.contains("s1"))
    }
}
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement SocketClient**

```swift
// ANT/Core/Network/SocketClient.swift
import Foundation
import SocketIO

@Observable final class SocketClient {
    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private(set) var isConnected = false
    private(set) var joinedSessions: Set<String> = []

    // Callbacks — set by stores
    var onTerminalOutput: ((String, String) -> Void)?      // (sessionId, data)
    var onMessageCreated: ((String, [String: Any]) -> Void)?
    var onMessageUpdated: ((String, [String: Any]) -> Void)?
    var onMessageDeleted: ((String, String) -> Void)?
    var onStreamChunk: (([String: Any]) -> Void)?
    var onSessionListChanged: (() -> Void)?
    var onSessionHealth: ((String, Bool) -> Void)?

    init(serverURL: String, apiKey: String) {
        let url = URL(string: serverURL)!
        manager = SocketManager(socketURL: url, config: [
            .extraHeaders(["Authorization": "Bearer \(apiKey)"]),
            .compress,
            .reconnects(true),
            .reconnectAttempts(5),
            .reconnectWait(2)
        ])
        socket = manager?.defaultSocket
        registerHandlers()
    }

    func connect() {
        socket?.connect()
    }

    func disconnect() {
        socket?.disconnect()
        isConnected = false
    }

    func joinSession(id: String) {
        joinedSessions.insert(id)
        socket?.emit("join_session", ["sessionId": id])
    }

    func leaveSession(id: String) {
        joinedSessions.remove(id)
        socket?.emit("leave_session", ["sessionId": id])
    }

    func sendTerminalInput(sessionId: String, data: String) {
        socket?.emit("terminal_input", ["sessionId": sessionId, "data": data])
    }

    func checkHealth(sessionId: String) {
        socket?.emit("check_health", ["sessionId": sessionId])
    }

    private func registerHandlers() {
        socket?.on(clientEvent: .connect) { [weak self] _, _ in
            self?.isConnected = true
            // Rejoin sessions after reconnect
            self?.joinedSessions.forEach { self?.socket?.emit("join_session", ["sessionId": $0]) }
        }
        socket?.on(clientEvent: .disconnect) { [weak self] _, _ in
            self?.isConnected = false
        }
        socket?.on("terminal_output") { [weak self] data, _ in
            guard let d = data[0] as? [String: Any],
                  let sid = d["sessionId"] as? String,
                  let chunk = d["data"] as? String else { return }
            self?.onTerminalOutput?(sid, chunk)
        }
        socket?.on("message_created") { [weak self] data, _ in
            guard let d = data[0] as? [String: Any],
                  let sid = d["sessionId"] as? String else { return }
            self?.onMessageCreated?(sid, d)
        }
        socket?.on("message_updated") { [weak self] data, _ in
            guard let d = data[0] as? [String: Any],
                  let sid = d["sessionId"] as? String else { return }
            self?.onMessageUpdated?(sid, d)
        }
        socket?.on("message_deleted") { [weak self] data, _ in
            guard let d = data[0] as? [String: Any],
                  let sid = d["sessionId"] as? String,
                  let mid = d["messageId"] as? String else { return }
            self?.onMessageDeleted?(sid, mid)
        }
        socket?.on("stream_chunk") { [weak self] data, _ in
            guard let d = data[0] as? [String: Any] else { return }
            self?.onStreamChunk?(d)
        }
        socket?.on("session_list_changed") { [weak self] _, _ in
            self?.onSessionListChanged?()
        }
        socket?.on("session_health") { [weak self] data, _ in
            guard let d = data[0] as? [String: Any],
                  let sid = d["sessionId"] as? String,
                  let alive = d["alive"] as? Bool else { return }
            self?.onSessionHealth?(sid, alive)
        }
    }
}
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**
```bash
git add . && git commit -m "feat: SocketClient wrapping Socket.IO-Client-Swift"
```

---

### Task 6: ConnectivityMonitor + PendingActionQueue

**Files:**
- Create: `ANT/Core/Network/ConnectivityMonitor.swift`
- Create: `ANT/Core/Storage/PendingActionQueue.swift`
- Create: `ANTTests/PendingActionQueueTests.swift`

- [ ] **Step 1: Write failing test**

```swift
// ANTTests/PendingActionQueueTests.swift
import XCTest
import SwiftData
@testable import ANT

final class PendingActionQueueTests: XCTestCase {
    var container: ModelContainer!
    var queue: PendingActionQueue!

    override func setUp() async throws {
        container = try ModelContainer(
            for: PendingAction.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        queue = PendingActionQueue(context: ModelContext(container))
    }

    func testEnqueueAddsAction() throws {
        queue.enqueue(endpoint: "/api/sessions", method: "POST", body: #"{"name":"test"}"#)
        let all = try queue.fetchAll()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all[0].endpoint, "/api/sessions")
    }

    func testDequeueRemovesOldestFirst() throws {
        queue.enqueue(endpoint: "/api/a", method: "POST", body: nil)
        Thread.sleep(forTimeInterval: 0.01)
        queue.enqueue(endpoint: "/api/b", method: "POST", body: nil)
        let first = try queue.dequeue()
        XCTAssertEqual(first?.endpoint, "/api/a")
    }
}
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```swift
// ANT/Core/Network/ConnectivityMonitor.swift
import Network
import Foundation

@Observable final class ConnectivityMonitor {
    private(set) var isOnline: Bool = true
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ant.connectivity")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async { self?.isOnline = path.status == .satisfied }
        }
        monitor.start(queue: queue)
    }

    deinit { monitor.cancel() }
}
```

```swift
// ANT/Core/Storage/PendingActionQueue.swift
import Foundation
import SwiftData

final class PendingActionQueue {
    private let context: ModelContext

    init(context: ModelContext) { self.context = context }

    func enqueue(endpoint: String, method: String, body: String?) {
        let action = PendingAction(id: UUID().uuidString, endpoint: endpoint,
                                   method: method, body: body, createdAt: Date())
        context.insert(action)
        try? context.save()
    }

    func fetchAll() throws -> [PendingAction] {
        var desc = FetchDescriptor<PendingAction>(sortBy: [SortDescriptor(\.createdAt)])
        return try context.fetch(desc)
    }

    func dequeue() throws -> PendingAction? {
        var desc = FetchDescriptor<PendingAction>(sortBy: [SortDescriptor(\.createdAt)])
        desc.fetchLimit = 1
        guard let action = try context.fetch(desc).first else { return nil }
        context.delete(action)
        try context.save()
        return action
    }

    func discard(_ action: PendingAction) {
        context.delete(action)
        try? context.save()
    }
}
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**
```bash
git add . && git commit -m "feat: ConnectivityMonitor (NWPathMonitor) and PendingActionQueue"
```

---

## Phase 3: App Root + Sessions List

### Task 7: App entry + tab shell

**Files:**
- Modify: `ANT/ANTApp.swift`
- Create: `ANT/Views/TabRoot.swift`
- Create: `ANT/Views/Shared/PillTabBar.swift`

- [ ] **Step 1: Write ANTApp with environment objects**

```swift
// ANT/ANTApp.swift
import SwiftUI
import SwiftData

@main struct ANTApp: App {
    @State private var serverConfig = ServerConfig()
    @State private var connectivity = ConnectivityMonitor()
    @State private var sessionStore: SessionStore

    init() {
        _sessionStore = State(initialValue: SessionStore())
    }

    var sharedModelContainer: ModelContainer = {
        try! ModelContainer(for: CachedSession.self, CachedMessage.self,
                                 CachedTerminalChunk.self, PendingAction.self)
    }()

    var body: some Scene {
        WindowGroup {
            if serverConfig.isConfigured {
                TabRoot()
                    .environment(serverConfig)
                    .environment(connectivity)
                    .environment(sessionStore)
            } else {
                ServerConfigView()
                    .environment(serverConfig)
            }
        }
        .modelContainer(sharedModelContainer)
    }
}
```

- [ ] **Step 2: Create TabRoot with floating pill tab bar**

```swift
// ANT/Views/TabRoot.swift
import SwiftUI

enum AppTab: String, CaseIterable {
    case sessions, voice, settings
    var icon: String {
        switch self {
        case .sessions: "square.grid.2x2"
        case .voice:    "mic"
        case .settings: "gearshape"
        }
    }
    var label: String { rawValue.capitalized }
}

struct TabRoot: View {
    @State private var selected: AppTab = .sessions

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selected {
                case .sessions: SessionListView()
                case .voice:    VoiceView()
                case .settings: SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            PillTabBar(selected: $selected)
                .padding(.bottom, 8)
        }
        .ignoresSafeArea(edges: .bottom)
    }
}
```

```swift
// ANT/Views/Shared/PillTabBar.swift
import SwiftUI

struct PillTabBar: View {
    @Binding var selected: AppTab
    @Environment(\.colorScheme) var scheme

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Button {
                    selected = tab
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 20, weight: selected == tab ? .semibold : .regular))
                        Text(tab.label)
                            .font(ANTTheme.Font.inter(10, weight: selected == tab ? .semibold : .regular))
                    }
                    .foregroundStyle(selected == tab ? ANTTheme.Color.emerald : .secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }
            }
        }
        .padding(.horizontal, 24)
        .background(.ultraThinMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.2), radius: 16, y: 4)
        .padding(.horizontal, 32)
    }
}
```

- [ ] **Step 3: Build and run in simulator — tab bar visible at bottom**
- [ ] **Step 4: Commit**
```bash
git add . && git commit -m "feat: app root with floating pill tab bar (Sessions/Voice/Settings)"
```

---

### Task 8: SessionStore + Sessions List UI

**Files:**
- Create: `ANT/Stores/SessionStore.swift`
- Create: `ANT/Views/Sessions/SessionListView.swift`
- Create: `ANT/Views/Sessions/SessionCardView.swift`
- Create: `ANT/Views/Sessions/WorkspaceFilterBar.swift`

- [ ] **Step 1: SessionStore**

```swift
// ANT/Stores/SessionStore.swift
import Foundation
import SwiftData

@Observable final class SessionStore {
    private(set) var sessions: [SessionSummary] = []
    private(set) var workspaces: [WorkspaceSummary] = []
    private(set) var selectedWorkspace: String? = nil   // nil = "All"
    private(set) var isLoading = false
    var error: Error?

    var filteredSessions: [SessionSummary] {
        guard let ws = selectedWorkspace else { return sessions.filter { !$0.archived } }
        return sessions.filter { $0.workspaceId == ws && !$0.archived }
    }

    func load(api: APIClient) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let resp: SessionListResponse = try await api.get("/api/sessions")
            await MainActor.run { sessions = resp.sessions }
            let ws: WorkspaceListResponse = try await api.get("/api/workspaces")
            await MainActor.run { workspaces = ws.workspaces }
        } catch { self.error = error }
    }

    func selectWorkspace(_ id: String?) {
        selectedWorkspace = id
    }
}

// MARK: - Response types
struct SessionListResponse: Decodable { let sessions: [SessionSummary] }
struct WorkspaceListResponse: Decodable { let workspaces: [WorkspaceSummary] }

struct SessionSummary: Decodable, Identifiable {
    let id: String
    let name: String
    let type: String           // "terminal" | "conversation"
    let workspaceId: String?
    let archived: Bool
    let updatedAt: Date
    var status: String?        // "working" | "idle" | "stalled" | "thinking"
}

struct WorkspaceSummary: Decodable, Identifiable {
    let id: String
    let name: String
}
```

- [ ] **Step 2: SessionCardView**

```swift
// ANT/Views/Sessions/SessionCardView.swift
import SwiftUI

struct SessionCardView: View {
    let session: SessionSummary
    @Environment(\.colorScheme) var scheme

    private var accentColor: Color {
        switch session.type {
        case "terminal": return ANTTheme.Color.emerald
        case "conversation": return ANTTheme.Color.indigo
        default: return .secondary
        }
    }

    private var statusColor: Color {
        switch session.status {
        case "stalled": return ANTTheme.Color.red
        case "working", "thinking": return accentColor
        default: return .secondary
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            // Left accent strip
            Rectangle()
                .fill(accentColor)
                .frame(width: 3)
                .cornerRadius(2)

            HStack(spacing: 12) {
                // Type icon
                Image(systemName: session.type == "terminal" ? "chevron.right" : "bubble.left")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(accentColor)
                    .frame(width: 32, height: 32)
                    .background(accentColor.opacity(0.12))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(session.name)
                        .font(ANTTheme.Font.inter(15, weight: .medium))
                    HStack(spacing: 4) {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 6, height: 6)
                        Text("\(session.type.capitalized) · \(session.status ?? "idle")")
                            .font(ANTTheme.Font.inter(12))
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                Text(session.updatedAt.relativeString)
                    .font(ANTTheme.Font.inter(11))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: ANTTheme.Radius.card)
                    .fill(scheme == .dark ? ANTTheme.Color.surfaceDark : ANTTheme.Color.surfaceLight)
                LinearGradient(
                    colors: [accentColor.opacity(0.12), .clear],
                    startPoint: .leading, endPoint: .trailing
                )
                .clipShape(RoundedRectangle(cornerRadius: ANTTheme.Radius.card))
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: ANTTheme.Radius.card))
    }
}

extension Date {
    var relativeString: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: Date())
    }
}
```

- [ ] **Step 3: WorkspaceFilterBar**

```swift
// ANT/Views/Sessions/WorkspaceFilterBar.swift
import SwiftUI

struct WorkspaceFilterBar: View {
    let workspaces: [WorkspaceSummary]
    @Binding var selected: String?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterPill(label: "All", isActive: selected == nil) { selected = nil }
                ForEach(workspaces) { ws in
                    FilterPill(label: ws.name, isActive: selected == ws.id) { selected = ws.id }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

private struct FilterPill: View {
    let label: String
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(ANTTheme.Font.inter(13, weight: isActive ? .semibold : .regular))
                .foregroundStyle(isActive ? .white : .secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(isActive ? ANTTheme.Color.emerald : Color.secondary.opacity(0.15))
                .clipShape(Capsule())
        }
    }
}
```

- [ ] **Step 4: SessionListView**

```swift
// ANT/Views/Sessions/SessionListView.swift
import SwiftUI

struct SessionListView: View {
    @Environment(SessionStore.self) var store
    @Environment(ServerConfig.self) var config
    @State private var api: APIClient?
    @State private var searchText = ""
    @State private var showNewSession = false

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("ANT")
                        .font(ANTTheme.Font.cormorant(52, weight: .light))
                        .kerning(-2)
                    Spacer()
                    Image(systemName: "crown")
                        .foregroundStyle(ANTTheme.Color.gold)
                    Image(systemName: "gearshape")
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20)
                .frame(height: 72)

                // Search
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search sessions...", text: $searchText)
                }
                .padding(10)
                .background(Color.secondary.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 16)

                // Workspace filter
                WorkspaceFilterBar(workspaces: store.workspaces, selected: $store.selectedWorkspace)
                    .padding(.vertical, 8)

                // Session list
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(store.filteredSessions) { session in
                            NavigationLink(value: session) {
                                SessionCardView(session: session)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 100) // tab bar clearance
                }
                .refreshable { if let api { await store.load(api: api) } }
            }
            .navigationDestination(for: SessionSummary.self) { session in
                SessionSpaceView(session: session)
            }
        }
        .task {
            let a = APIClient(config: config)
            api = a
            await store.load(api: a)
        }
    }
}
```

- [ ] **Step 5: Build and run — sessions list visible with cards**
- [ ] **Step 6: Commit**
```bash
git add . && git commit -m "feat: sessions list with workspace filter, session cards, pull-to-refresh"
```

---

## Phase 4: Signal Classifier + Terminal Mode

### Task 9: SignalClassifier (TDD)

**Files:**
- Create: `ANT/Core/Terminal/SignalClassifier.swift`
- Create: `ANTTests/SignalClassifierTests.swift`

- [ ] **Step 1: Write all failing tests first**

```swift
// ANTTests/SignalClassifierTests.swift
import XCTest
@testable import ANT

final class SignalClassifierTests: XCTestCase {
    let classifier = SignalClassifier()

    func testClassifiesError() {
        let sig = classifier.classify("Error: Cannot find module 'foo'")
        guard case .error(let msg) = sig else { return XCTFail("Expected error, got \(sig)") }
        XCTAssertTrue(msg.contains("Cannot find module"))
    }

    func testClassifiesTypeScriptError() {
        let sig = classifier.classify("src/index.ts(47,12): error TS2345: Argument of type")
        guard case .error = sig else { return XCTFail("Expected error") }
    }

    func testClassifiesYNPrompt() {
        let sig = classifier.classify("Allow write to .env.local? [y/N]")
        guard case .prompt(_, let options) = sig else { return XCTFail("Expected prompt") }
        XCTAssertTrue(options.contains("y"))
        XCTAssertTrue(options.contains("n"))
    }

    func testClassifiesSuccess() {
        let sig = classifier.classify("✓ Build completed in 3.2s (12 modules)")
        guard case .success = sig else { return XCTFail("Expected success") }
    }

    func testClassifiesNormal() {
        let sig = classifier.classify("Starting dev server on :3000")
        guard case .normal = sig else { return XCTFail("Expected normal, got \(sig)") }
    }

    func testCollapsesBurst() {
        var lines = (0..<4).map { "fetching package \($0)" }
        let signals = classifier.classifyBatch(lines)
        let collapsed = signals.filter { if case .collapsed = $0 { return true }; return false }
        XCTAssertFalse(collapsed.isEmpty, "Expected at least one collapsed signal")
    }
}
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement SignalClassifier**

```swift
// ANT/Core/Terminal/SignalClassifier.swift
import Foundation

enum TerminalSignal {
    case error(message: String)
    case success(message: String)
    case prompt(message: String, options: [String])
    case collapsed(lineCount: Int, summary: String)
    case normal(message: String)
}

struct SignalClassifier {
    private let errorPattern = try! NSRegularExpression(
        pattern: #"error|Error|ENOENT|✖|✗|failed|FAILED|TS\d+:"#)
    private let successPattern = try! NSRegularExpression(
        pattern: #"✓|✔|success|Success|\bdone\b|\bDone\b|complete|Complete|built in"#)
    private let verbosePattern = try! NSRegularExpression(
        pattern: #"node_modules|downloading|resolving|fetching|npm warn"#)

    func classify(_ line: String) -> TerminalSignal {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let range = NSRange(trimmed.startIndex..., in: trimmed)

        // Prompt: ends with [y/N], [Y/n], (yes/no), or ?
        if trimmed.hasSuffix("[y/N]") || trimmed.hasSuffix("[Y/n]") ||
           trimmed.hasSuffix("(yes/no)") || trimmed.hasSuffix("?") {
            let options = extractOptions(from: trimmed)
            return .prompt(message: trimmed, options: options)
        }

        if errorPattern.firstMatch(in: trimmed, range: range) != nil {
            return .error(message: trimmed)
        }
        if successPattern.firstMatch(in: trimmed, range: range) != nil {
            return .success(message: trimmed)
        }
        return .normal(message: trimmed)
    }

    func classifyBatch(_ lines: [String]) -> [TerminalSignal] {
        var result: [TerminalSignal] = []
        var verboseBurst: [String] = []

        func flushBurst() {
            guard !verboseBurst.isEmpty else { return }
            if verboseBurst.count >= 3 {
                result.append(.collapsed(lineCount: verboseBurst.count,
                                         summary: verboseBurst[0]))
            } else {
                verboseBurst.forEach { result.append(.normal(message: $0)) }
            }
            verboseBurst = []
        }

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let range = NSRange(trimmed.startIndex..., in: trimmed)
            if verbosePattern.firstMatch(in: trimmed, range: range) != nil {
                verboseBurst.append(trimmed)
            } else {
                flushBurst()
                result.append(classify(line))
            }
        }
        flushBurst()
        return result
    }

    private func extractOptions(from line: String) -> [String] {
        if line.contains("[y/N]") || line.contains("[Y/n]") { return ["y", "n"] }
        if line.contains("(yes/no)") { return ["yes", "no"] }
        return []
    }
}
```

- [ ] **Step 4: Run tests — all PASS**
- [ ] **Step 5: Commit**
```bash
git add . && git commit -m "feat: SignalClassifier with error/success/prompt/collapse rules (TDD)"
```

---

### Task 10: TerminalStore + Terminal Views

**Files:**
- Create: `ANT/Stores/TerminalStore.swift`
- Create: `ANT/Views/Session/Terminal/TerminalView.swift`
- Create: `ANT/Views/Session/Terminal/SignalView.swift`
- Create: `ANT/Views/Session/Terminal/RawOutputView.swift`
- Create: `ANT/Views/Session/Terminal/XtermView.swift`
- Create: `ANT/Views/Session/Terminal/CLIInputBar.swift`
- Create: `ANT/Views/Session/Terminal/QuickPhrasesBar.swift`

- [ ] **Step 1: TerminalStore**

```swift
// ANT/Stores/TerminalStore.swift
import Foundation
import SwiftData

@Observable final class TerminalStore {
    private(set) var rawLines: [String] = []
    private(set) var signals: [TerminalSignal] = []
    private(set) var isAlive: Bool = true
    var viewMode: TerminalViewMode = .signals
    private let classifier = SignalClassifier()

    enum TerminalViewMode { case signals, raw, xterm }

    func appendChunk(_ data: String, sessionId: String, context: ModelContext) {
        let lines = data.components(separatedBy: "\n")
        rawLines.append(contentsOf: lines)
        signals = classifier.classifyBatch(rawLines)
        // Cache chunk
        let chunk = CachedTerminalChunk(
            id: UUID().uuidString, sessionId: sessionId,
            chunkIndex: rawLines.count, data: data, createdAt: Date()
        )
        context.insert(chunk)
        try? context.save()
    }

    func loadFromCache(sessionId: String, context: ModelContext) {
        var desc = FetchDescriptor<CachedTerminalChunk>(
            predicate: #Predicate { $0.sessionId == sessionId },
            sortBy: [SortDescriptor(\.chunkIndex)]
        )
        let chunks = (try? context.fetch(desc)) ?? []
        rawLines = chunks.flatMap { $0.data.components(separatedBy: "\n") }
        signals = classifier.classifyBatch(rawLines)
    }
}
```

- [ ] **Step 2: SignalView**

```swift
// ANT/Views/Session/Terminal/SignalView.swift
import SwiftUI

struct SignalView: View {
    let signals: [TerminalSignal]
    let onPromptAction: (String, String) -> Void  // (promptMsg, choice)

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(signals.enumerated()), id: \.offset) { idx, signal in
                        SignalRowView(signal: signal, onPromptAction: onPromptAction)
                            .id(idx)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
            }
            .onChange(of: signals.count) { _, _ in
                proxy.scrollTo(signals.count - 1, anchor: .bottom)
            }
        }
    }
}

struct SignalRowView: View {
    let signal: TerminalSignal
    let onPromptAction: (String, String) -> Void

    var body: some View {
        switch signal {
        case .error(let msg):
            HStack(spacing: 8) {
                Rectangle().fill(ANTTheme.Color.red).frame(width: 3).cornerRadius(2)
                Image(systemName: "xmark.circle").foregroundStyle(ANTTheme.Color.red).font(.system(size: 12))
                Text(msg).font(ANTTheme.Font.mono(12)).foregroundStyle(ANTTheme.Color.red)
                    .lineLimit(2)
            }
            .padding(.vertical, 4)
            .padding(.trailing, 8)
            .background(ANTTheme.Color.red.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))

        case .success(let msg):
            HStack(spacing: 8) {
                Rectangle().fill(ANTTheme.Color.emerald).frame(width: 3).cornerRadius(2)
                Image(systemName: "checkmark.circle").foregroundStyle(ANTTheme.Color.emerald).font(.system(size: 12))
                Text(msg).font(ANTTheme.Font.mono(12)).foregroundStyle(ANTTheme.Color.emerald)
            }
            .padding(.vertical, 4)

        case .prompt(let msg, let options):
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(ANTTheme.Color.amber)
                Text(msg).font(ANTTheme.Font.mono(12)).foregroundStyle(.primary)
                Spacer()
                ForEach(options, id: \.self) { opt in
                    Button(opt) { onPromptAction(msg, opt) }
                        .font(ANTTheme.Font.inter(12, weight: .semibold))
                        .foregroundStyle(opt == "y" || opt == "yes" ? .white : .secondary)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(opt == "y" || opt == "yes" ? ANTTheme.Color.emerald : Color.secondary.opacity(0.2))
                        .clipShape(Capsule())
                }
            }
            .padding(8)
            .background(ANTTheme.Color.amber.opacity(0.08))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(ANTTheme.Color.amber.opacity(0.3), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))

        case .collapsed(let count, let summary):
            Button {
                // Expand — handled by parent toggling to .raw
            } label: {
                HStack {
                    Image(systemName: "chevron.right").font(.system(size: 10))
                    Text("> \(count) lines — \(summary)").font(ANTTheme.Font.mono(11))
                }
                .foregroundStyle(.tertiary)
            }

        case .normal(let msg):
            Text(msg).font(ANTTheme.Font.mono(12)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
```

- [ ] **Step 3: RawOutputView**

```swift
// ANT/Views/Session/Terminal/RawOutputView.swift
import SwiftUI

struct RawOutputView: View {
    let lines: [String]

    var attributedOutput: AttributedString {
        var result = AttributedString()
        for line in lines {
            var attr = AttributedString(line + "\n")
            attr.font = ANTTheme.Font.mono(12)
            if line.contains("error") || line.contains("Error") || line.contains("FAILED") {
                attr.foregroundColor = ANTTheme.Color.red
            } else if line.contains("warn") || line.contains("Warn") {
                attr.foregroundColor = ANTTheme.Color.amber
            } else if line.contains("✓") || line.contains("success") {
                attr.foregroundColor = ANTTheme.Color.emerald
            } else {
                attr.foregroundColor = .init(.secondaryLabel)
            }
            result += attr
        }
        return result
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Text(attributedOutput)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .id("bottom")
            }
            .onAppear { proxy.scrollTo("bottom") }
        }
    }
}
```

- [ ] **Step 4: XtermView (WKWebView bridge)**

```swift
// ANT/Views/Session/Terminal/XtermView.swift
import SwiftUI
import WebKit

struct XtermView: UIViewRepresentable {
    let sessionId: String
    var onInput: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onInput: onInput) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "terminalInput")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(ANTTheme.Color.terminalDark)
        context.coordinator.webView = webView
        if let url = Bundle.main.url(forResource: "xterm", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func write(_ data: String) {
        // Called by TerminalStore when new output arrives
        // Must be done via coordinator
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        var webView: WKWebView?
        var onInput: (String) -> Void
        init(onInput: @escaping (String) -> Void) { self.onInput = onInput }

        func userContentController(_ controller: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard message.name == "terminalInput",
                  let data = message.body as? String else { return }
            onInput(data)
        }

        func write(_ data: String) {
            let escaped = data.replacingOccurrences(of: "\\", with: "\\\\")
                              .replacingOccurrences(of: "'", with: "\\'")
            webView?.evaluateJavaScript("term.write('\(escaped)')")
        }
    }
}
```

> **Note**: `xterm.html` bundles xterm.js. Add `xterm.html` + `xterm.css` + `xterm.js` to `ANT/Resources/`. The HTML listens for user input via `term.onData` and posts it back to Swift via `window.webkit.messageHandlers.terminalInput.postMessage(data)`.

- [ ] **Step 5: CLIInputBar**

```swift
// ANT/Views/Session/Terminal/CLIInputBar.swift
import SwiftUI

struct CLIInputBar: View {
    @Binding var text: String
    var isEnabled: Bool
    let onSubmit: (String) -> Void
    let onHistory: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text("$")
                .font(ANTTheme.Font.mono(14, weight: .semibold))
                .foregroundStyle(ANTTheme.Color.emerald)

            TextField(isEnabled ? "Type a command..." : "Terminal unavailable — reconnecting",
                      text: $text)
                .font(ANTTheme.Font.mono(13))
                .disabled(!isEnabled)
                .onSubmit {
                    guard !text.isEmpty else { return }
                    onSubmit(text)
                    text = ""
                }

            Button(action: onHistory) {
                Image(systemName: "chevron.up")
                    .font(.system(size: 13, weight: .medium))
            }
            .frame(width: 36, height: 36)
            .background(Color.secondary.opacity(0.15))
            .clipShape(Circle())
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
    }
}
```

- [ ] **Step 6: TerminalView (mode switcher host)**

```swift
// ANT/Views/Session/Terminal/TerminalView.swift
import SwiftUI

struct TerminalView: View {
    let session: SessionSummary
    @State private var store = TerminalStore()
    @State private var commandText = ""
    @State private var commandHistory: [String] = []
    @State private var historyIndex = -1
    @Environment(ServerConfig.self) var config
    @Environment(\.modelContext) var context

    private var api: APIClient { APIClient(config: config) }

    var body: some View {
        VStack(spacing: 0) {
            // Mode header
            HStack {
                Text("KEY SIGNALS")
                    .font(ANTTheme.Font.inter(10, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .kerning(2)
                Spacer()
                Picker("Mode", selection: $store.viewMode) {
                    Text("SIGNALS").tag(TerminalStore.TerminalViewMode.signals)
                    Text("RAW").tag(TerminalStore.TerminalViewMode.raw)
                    Text("XTERM").tag(TerminalStore.TerminalViewMode.xterm)
                }
                .pickerStyle(.segmented)
                .frame(width: 200)
            }
            .padding(.horizontal, 16)
            .frame(height: 32)

            Divider().opacity(0.3)

            // Output area
            Group {
                switch store.viewMode {
                case .signals:
                    SignalView(signals: store.signals) { msg, choice in
                        Task { try? await api.post("/api/sessions/\(session.id)/terminal/input",
                                                   body: ["data": choice + "\n"]) }
                    }
                case .raw:
                    RawOutputView(lines: store.rawLines)
                case .xterm:
                    XtermView(sessionId: session.id) { input in
                        Task { try? await api.post("/api/sessions/\(session.id)/terminal/input",
                                                   body: ["data": input]) }
                    }
                }
            }
            .frame(maxHeight: .infinity)

            // Drag handle
            Capsule().fill(Color.secondary.opacity(0.3)).frame(width: 40, height: 4).padding(.vertical, 6)

            // Quick phrases (hidden in XTERM mode)
            if store.viewMode != .xterm {
                QuickPhrasesBar(context: .terminal) { phrase in commandText = phrase }
                    .frame(height: 40)
            }

            // CLI input (hidden in XTERM mode — xterm.js handles input)
            if store.viewMode != .xterm {
                CLIInputBar(text: $commandText, isEnabled: store.isAlive) { cmd in
                    commandHistory.insert(cmd, at: 0)
                    historyIndex = -1
                    Task { try? await api.post("/api/sessions/\(session.id)/terminal/input",
                                               body: ["data": cmd + "\n"]) }
                } onHistory: {
                    historyIndex = min(historyIndex + 1, commandHistory.count - 1)
                    if historyIndex >= 0 { commandText = commandHistory[historyIndex] }
                }
            }
        }
        .onAppear { store.loadFromCache(sessionId: session.id, context: context) }
    }
}
```

- [ ] **Step 7: Build and run — terminal view shows SIGNALS mode with classifier output**
- [ ] **Step 8: Commit**
```bash
git add . && git commit -m "feat: terminal mode — SIGNALS/RAW/XTERM with split keyboard-aware layout"
```

---

## Phase 5: Chat Mode + X-Ray

### Task 11: MessageStore + Chat UI

**Files:**
- Create: `ANT/Stores/MessageStore.swift`
- Create: `ANT/Views/Session/Chat/ChatView.swift`
- Create: `ANT/Views/Session/Chat/MessageBubbleView.swift`
- Create: `ANT/Views/Session/Chat/XRayChipView.swift`
- Create: `ANT/Views/Session/Chat/ReferenceView.swift`
- Create: `ANT/Views/Session/Chat/MessageInputBar.swift`

- [ ] **Step 1: MessageStore**

```swift
// ANT/Stores/MessageStore.swift
import Foundation
import SwiftData

@Observable final class MessageStore {
    private(set) var messages: [MessageItem] = []
    private(set) var streamingMessageId: String?

    struct MessageItem: Identifiable {
        let id: String
        let sessionId: String
        let role: String          // "user" | "assistant"
        var content: String
        let format: String
        var status: String        // "complete" | "streaming" | "incomplete"
        let createdAt: Date
        var xray: XRayMeta?       // populated from metadata JSON if present
    }

    struct XRayMeta: Identifiable {
        var id: String { topic }
        let refs: Int
        let topic: String
        let linkedMessageIds: [String]
    }

    func load(sessionId: String, api: APIClient, context: ModelContext) async {
        // Load from cache first
        var desc = FetchDescriptor<CachedMessage>(
            predicate: #Predicate { $0.sessionId == sessionId },
            sortBy: [SortDescriptor(\.createdAt)]
        )
        let cached = (try? context.fetch(desc)) ?? []
        await MainActor.run { messages = cached.map(MessageItem.init) }

        // Fetch delta from server
        let sinceDate = cached.last?.createdAt
        var query: [String: String] = ["limit": "50"]
        if let d = sinceDate {
            query["since"] = ISO8601DateFormatter().string(from: d)
        }
        do {
            let resp: MessageListResponse = try await api.get("/api/sessions/\(sessionId)/messages", query: query)
            await MainActor.run {
                for msg in resp.messages {
                    if let idx = messages.firstIndex(where: { $0.id == msg.id }) {
                        messages[idx] = msg
                    } else {
                        messages.append(msg)
                    }
                    cacheMessage(msg, context: context)
                }
                messages.sort { $0.createdAt < $1.createdAt }
            }
        } catch {}
    }

    func handleStreamChunk(_ payload: [String: Any]) {
        guard let msgId = payload["messageId"] as? String,
              let chunk = payload["content"] as? String else { return }
        if let idx = messages.firstIndex(where: { $0.id == msgId }) {
            messages[idx].content += chunk
            messages[idx].status = "streaming"
        } else {
            // New streaming message
            let role = payload["role"] as? String ?? "assistant"
            let item = MessageItem(id: msgId, sessionId: payload["sessionId"] as? String ?? "",
                                   role: role, content: chunk, format: "text",
                                   status: "streaming", createdAt: Date(), xray: nil)
            messages.append(item)
        }
        streamingMessageId = msgId
    }

    func handleMessageUpdated(_ payload: [String: Any]) {
        guard let msgId = payload["id"] as? String,
              let status = payload["status"] as? String else { return }
        if let idx = messages.firstIndex(where: { $0.id == msgId }) {
            messages[idx].status = status
            if status == "complete" { streamingMessageId = nil }
        }
    }

    private func cacheMessage(_ msg: MessageItem, context: ModelContext) {
        let cached = CachedMessage(id: msg.id, sessionId: msg.sessionId, role: msg.role,
                                   content: msg.content, format: msg.format, status: msg.status,
                                   metadata: nil, createdAt: msg.createdAt)
        context.insert(cached)
        try? context.save()
    }
}

struct MessageListResponse: Decodable { let messages: [MessageStore.MessageItem] }

extension MessageStore.MessageItem: Decodable {
    enum CodingKeys: String, CodingKey {
        case id, sessionId = "session_id", role, content, format, status, createdAt = "created_at"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        role = try c.decode(String.self, forKey: .role)
        content = try c.decode(String.self, forKey: .content)
        format = try c.decodeIfPresent(String.self, forKey: .format) ?? "text"
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "complete"
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        xray = nil
    }
    init(from cached: CachedMessage) {
        id = cached.id; sessionId = cached.sessionId; role = cached.role
        content = cached.content; format = cached.format; status = cached.status
        createdAt = cached.createdAt; xray = nil
    }
}
```

- [ ] **Step 2: MessageBubbleView + XRayChipView**

```swift
// ANT/Views/Session/Chat/MessageBubbleView.swift
import SwiftUI

struct MessageBubbleView: View {
    let message: MessageStore.MessageItem
    @State private var showReference = false

    var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 60)
                Text(message.content)
                    .font(ANTTheme.Font.inter(13))
                    .foregroundStyle(.white)
                    .padding(EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14))
                    .background(
                        LinearGradient(colors: [Color(hex: "#7C3AED"), ANTTheme.Color.indigo],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .clipShape(RoundedCorner(radius: 16, corners: [.topLeft, .topRight, .bottomLeft]))
            }
        } else {
            HStack(alignment: .bottom, spacing: 8) {
                // Avatar
                Text("C")
                    .font(ANTTheme.Font.inter(12, weight: .semibold))
                    .foregroundStyle(ANTTheme.Color.indigo)
                    .frame(width: 28, height: 28)
                    .background(ANTTheme.Color.indigo.opacity(0.15))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 6) {
                    // Bubble with left accent
                    ZStack(alignment: .leading) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(message.content + (message.status == "streaming" ? "▌" : ""))
                                .font(ANTTheme.Font.inter(13))
                                .foregroundStyle(.primary)
                                .lineSpacing(4)

                            if let xray = message.xray {
                                XRayChipView(xray: xray)
                            }
                        }
                        .padding(EdgeInsets(top: 12, leading: 18, bottom: 12, trailing: 14))
                        .background(Color(hex: "#1A1A22"))
                        .clipShape(RoundedCorner(radius: 16, corners: [.topLeft, .topRight, .bottomRight]))

                        Rectangle()
                            .fill(ANTTheme.Color.indigo)
                            .frame(width: 3, height: 60)
                            .cornerRadius(2)
                            .offset(x: 0)
                    }
                    .overlay(
                        RoundedCorner(radius: 16, corners: [.topLeft, .topRight, .bottomRight])
                            .stroke(ANTTheme.Color.indigo.opacity(0.2), lineWidth: 1)
                    )
                }
                Spacer(minLength: 40)
            }
        }
    }
}

// Helper for per-corner radii
struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner
    func path(in rect: CGRect) -> Path {
        Path(UIBezierPath(roundedRect: rect, byRoundingCorners: corners,
                          cornerRadii: CGSize(width: radius, height: radius)).cgPath)
    }
}
```

```swift
// ANT/Views/Session/Chat/XRayChipView.swift
import SwiftUI

struct XRayChipView: View {
    let xray: MessageStore.XRayMeta
    @State private var showRef = false

    var body: some View {
        Button { showRef = true } label: {
            HStack(spacing: 6) {
                Image(systemName: "link")
                    .font(.system(size: 11))
                    .foregroundStyle(ANTTheme.Color.indigo)
                Text("\(xray.refs) refs · \(xray.topic)")
                    .font(ANTTheme.Font.inter(11, weight: .medium))
                    .foregroundStyle(ANTTheme.Color.indigo)
            }
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(ANTTheme.Color.indigo.opacity(0.1))
            .overlay(Capsule().stroke(ANTTheme.Color.indigo.opacity(0.35), lineWidth: 1))
            .clipShape(Capsule())
        }
        .navigationDestination(isPresented: $showRef) {
            ReferenceView(xray: xray)
        }
    }
}
```

- [ ] **Step 3: ReferenceView (dedicated push, read-only)**

```swift
// ANT/Views/Session/Chat/ReferenceView.swift
import SwiftUI

struct ReferenceView: View {
    let xray: MessageStore.XRayMeta
    // In a real implementation, fetch linked messages from MessageStore/API
    // grouped by session. For v1, show linked message IDs as a placeholder list
    // that can be wired to actual data in the session navigation.

    var body: some View {
        List {
            Section {
                LabeledContent("Topic", value: xray.topic)
                LabeledContent("Total references", value: "\(xray.refs)")
            }
            Section("Linked messages") {
                ForEach(xray.linkedMessageIds, id: \.self) { msgId in
                    Text(msgId)
                        .font(ANTTheme.Font.mono(12))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("References")
        .navigationBarTitleDisplayMode(.inline)
    }
}
```

- [ ] **Step 4: MessageInputBar with file upload**

```swift
// ANT/Views/Session/Chat/MessageInputBar.swift
import SwiftUI
import PhotosUI

struct MessageInputBar: View {
    @Binding var text: String
    let onSend: (String) -> Void
    let onVoice: () -> Void
    let onUpload: (PhotosPickerItem) -> Void

    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        HStack(spacing: 10) {
            // Attachment
            PhotosPicker(selection: $photoItem, matching: .images) {
                Image(systemName: "paperclip")
                    .foregroundStyle(.secondary)
            }
            .onChange(of: photoItem) { _, item in
                if let item { onUpload(item) }
            }

            // Text field
            TextField("Message...", text: $text, axis: .vertical)
                .font(ANTTheme.Font.inter(14))
                .lineLimit(1...6)
                .frame(minHeight: 20)

            // Voice
            Button(action: onVoice) {
                Image(systemName: "mic")
                    .foregroundStyle(ANTTheme.Color.amber)
            }

            // Send
            Button {
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                onSend(text)
                text = ""
            } label: {
                Image(systemName: "arrow.up")
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(ANTTheme.Color.indigo)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color(hex: "#1E1E24"))
                .overlay(RoundedRectangle(cornerRadius: 20)
                    .stroke(ANTTheme.Color.indigo.opacity(0.15), lineWidth: 1))
        )
        .padding(.horizontal, 16)
    }
}
```

- [ ] **Step 5: ChatView**

```swift
// ANT/Views/Session/Chat/ChatView.swift
import SwiftUI
import PhotosUI

struct ChatView: View {
    let session: SessionSummary
    @State private var store = MessageStore()
    @State private var inputText = ""
    @Environment(ServerConfig.self) var config
    @Environment(\.modelContext) var context

    private var api: APIClient { APIClient(config: config) }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 14) {
                        ForEach(store.messages) { msg in
                            MessageBubbleView(message: msg)
                                .id(msg.id)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .padding(.bottom, 8)
                }
                .onChange(of: store.messages.count) { _, _ in
                    if let last = store.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            QuickPhrasesBar(context: .chat) { phrase in inputText = phrase }
                .frame(height: 40)

            MessageInputBar(text: $inputText) { text in
                Task { try? await api.post(
                    "/api/sessions/\(session.id)/messages",
                    body: ["role": "user", "content": text, "format": "text"]
                ) as EmptyResponse }
            } onVoice: {
                // TODO: switch tab to voice, pre-select session
            } onUpload: { item in
                Task {
                    guard let data = try? await item.loadTransferable(type: Data.self) else { return }
                    let resp = try? await api.upload("/api/upload", imageData: data, mimeType: "image/jpeg")
                    if let url = resp?.url {
                        inputText += " \(url)"
                    }
                }
            }
            .padding(.bottom, 8)
        }
        .task { await store.load(sessionId: session.id, api: api, context: context) }
    }
}

struct EmptyResponse: Decodable {}
```

- [ ] **Step 6: Build and run — Chat view shows messages, input, X-Ray chips**
- [ ] **Step 7: Commit**
```bash
git add . && git commit -m "feat: chat mode — bubbles, streaming cursor, X-Ray chip, file upload, reference view"
```

---

### Task 12: SessionSpaceView (mode switcher host)

**Files:**
- Create: `ANT/Views/Session/SessionSpaceView.swift`
- Create: `ANT/Views/Shared/SessionModePill.swift`

- [ ] **Step 1: Implement**

```swift
// ANT/Views/Shared/SessionModePill.swift
import SwiftUI

enum SessionMode { case chat, terminal }

struct SessionModePill: View {
    @Binding var mode: SessionMode

    var body: some View {
        HStack(spacing: 0) {
            modeButton(.chat, label: "Chat", icon: "bubble.left")
            modeButton(.terminal, label: "Terminal", icon: "terminal")
        }
        .padding(3)
        .background(Color.secondary.opacity(0.15))
        .clipShape(Capsule())
    }

    private func modeButton(_ m: SessionMode, label: String, icon: String) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { mode = m }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 11, weight: .medium))
                Text(label).font(ANTTheme.Font.inter(12, weight: mode == m ? .semibold : .regular))
            }
            .foregroundStyle(mode == m ? .white : .secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(mode == m ? (m == .chat ? ANTTheme.Color.indigo : ANTTheme.Color.emerald) : .clear)
            .clipShape(Capsule())
        }
    }
}
```

```swift
// ANT/Views/Session/SessionSpaceView.swift
import SwiftUI

struct SessionSpaceView: View {
    let session: SessionSummary
    @State private var mode: SessionMode

    init(session: SessionSummary) {
        self.session = session
        _mode = State(initialValue: session.type == "terminal" ? .terminal : .chat)
    }

    var body: some View {
        Group {
            switch mode {
            case .chat:     ChatView(session: session)
            case .terminal: TerminalView(session: session)
            }
        }
        .navigationTitle(session.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                SessionModePill(mode: $mode)
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("Rename") {}
                    Button("Export") {}
                    Button("Archive") {}
                    Button("Delete", role: .destructive) {}
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
        }
    }
}
```

- [ ] **Step 2: Build and run — tapping session card opens space with Chat|Terminal pill**
- [ ] **Step 3: Commit**
```bash
git add . && git commit -m "feat: SessionSpaceView with Chat/Terminal mode pill switcher"
```

---

## Phase 6: Voice Mode

### Task 13: VoiceProvider + ElevenLabs

**Files:**
- Create: `ANT/Core/Voice/VoiceProvider.swift`
- Create: `ANT/Core/Voice/ElevenLabsVoiceProvider.swift`
- Create: `ANT/Core/Voice/VoiceStore.swift`
- Create: `ANT/Views/Voice/VoiceView.swift`
- Create: `ANT/Views/Voice/WaveformView.swift`

- [ ] **Step 1: VoiceProvider protocol**

```swift
// ANT/Core/Voice/VoiceProvider.swift
import Foundation
import AVFoundation

protocol VoiceProvider {
    var name: String { get }
    func synthesise(text: String, modelId: String) async throws -> Data  // PCM/MP3 audio data
    func transcribe(audioURL: URL) async throws -> String
}
```

- [ ] **Step 2: ElevenLabsVoiceProvider**

```swift
// ANT/Core/Voice/ElevenLabsVoiceProvider.swift
import Foundation

final class ElevenLabsVoiceProvider: VoiceProvider {
    let name = "ElevenLabs"
    private let apiKey: String
    private let voiceId: String

    init(apiKey: String, voiceId: String = "21m00Tcm4TlvDq8ikWAM") {
        self.apiKey = apiKey
        self.voiceId = voiceId
    }

    func synthesise(text: String, modelId: String = "eleven_turbo_v2") async throws -> Data {
        let url = URL(string: "https://api.elevenlabs.io/v1/text-to-speech/\(voiceId)")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey, forHTTPHeaderField: "xi-api-key")
        req.httpBody = try JSONEncoder().encode([
            "text": text,
            "model_id": modelId,
            "voice_settings": ["stability": 0.5, "similarity_boost": 0.75]
        ] as [String: Any])  // Note: encode as JSON directly
        let (data, _) = try await URLSession.shared.data(for: req)
        return data
    }

    func transcribe(audioURL: URL) async throws -> String {
        var req = URLRequest(url: URL(string: "https://api.elevenlabs.io/v1/speech-to-text")!)
        req.httpMethod = "POST"
        req.setValue(apiKey, forHTTPHeaderField: "xi-api-key")
        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\nContent-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(try Data(contentsOf: audioURL))
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Response: Decodable { let text: String }
        return try JSONDecoder().decode(Response.self, from: data).text
    }
}
```

- [ ] **Step 3: VoiceStore**

```swift
// ANT/Core/Voice/VoiceStore.swift
import Foundation
import AVFoundation

enum VoiceMode { case listen, dictate, replay }

@Observable final class VoiceStore {
    var mode: VoiceMode = .listen
    var isActive: Bool = false
    var amplitude: [Float] = Array(repeating: 0.4, count: 11)
    var transcriptText: String = ""
    var contextSessionName: String = ""

    private var provider: VoiceProvider?
    private var audioRecorder: AVAudioRecorder?
    private var audioPlayer: AVAudioPlayer?
    private var recordingURL: URL?

    func configure(provider: VoiceProvider) {
        self.provider = provider
    }

    func startDictation() async {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.record, mode: .default)
        try? session.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("dictation.m4a")
        recordingURL = url
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1
        ]
        audioRecorder = try? AVAudioRecorder(url: url, settings: settings)
        audioRecorder?.record()
        isActive = true
    }

    func stopDictation() async throws -> String {
        audioRecorder?.stop()
        isActive = false
        guard let url = recordingURL, let provider else { return "" }
        let text = try await provider.transcribe(audioURL: url)
        transcriptText = text
        return text
    }

    func speak(text: String, modelId: String = "eleven_turbo_v2") async throws {
        guard let provider else { return }
        let data = try await provider.synthesise(text: text, modelId: modelId)
        audioPlayer = try AVAudioPlayer(data: data)
        audioPlayer?.play()
        isActive = true
    }
}
```

- [ ] **Step 4: WaveformView**

```swift
// ANT/Views/Voice/WaveformView.swift
import SwiftUI

struct WaveformView: View {
    let amplitudes: [Float]   // 11 values, 0.0–1.0

    private let barWidth: CGFloat = 3
    private let barGap: CGFloat = 6
    private let maxHeight: CGFloat = 170

    var body: some View {
        ZStack {
            // Radial amber glow
            Ellipse()
                .fill(RadialGradient(
                    colors: [ANTTheme.Color.amber.opacity(0.22), .clear],
                    center: .center, startRadius: 0, endRadius: 150
                ))
                .frame(width: 360, height: 300)
                .blur(radius: 30)

            HStack(alignment: .center, spacing: barGap) {
                ForEach(amplitudes.indices, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(ANTTheme.Color.amber.opacity(0.4 + Double(amplitudes[i]) * 0.6))
                        .frame(width: barWidth, height: maxHeight * CGFloat(amplitudes[i]))
                        .animation(.spring(response: 0.15), value: amplitudes[i])
                }
            }
        }
        .frame(height: 180)
    }
}
```

- [ ] **Step 5: VoiceView**

```swift
// ANT/Views/Voice/VoiceView.swift
import SwiftUI

struct VoiceView: View {
    @State private var store = VoiceStore()
    @Environment(ServerConfig.self) var config

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Button { } label: { Image(systemName: "xmark").foregroundStyle(.secondary) }
                Spacer()
                Text("Voice").font(ANTTheme.Font.cormorant(24, weight: .light))
                Spacer()
                Button { } label: { Image(systemName: "slider.horizontal.3").foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 20)
            .frame(height: 52)

            // Mode segmented control
            Picker("Mode", selection: $store.mode) {
                Text("Listen").tag(VoiceMode.listen)
                Text("Dictate").tag(VoiceMode.dictate)
                Text("Replay").tag(VoiceMode.replay)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)

            // Context indicator
            HStack(spacing: 8) {
                Circle().fill(ANTTheme.Color.emerald).frame(width: 7, height: 7)
                Text("\(store.contextSessionName.isEmpty ? "No session" : store.contextSessionName) · just now")
                    .font(ANTTheme.Font.inter(12)).foregroundStyle(.secondary)
            }
            .frame(height: 32)

            // Waveform
            WaveformView(amplitudes: store.amplitude)

            // Transcript
            Spacer()
            VStack(alignment: .leading, spacing: 8) {
                Text(store.transcriptText.isEmpty ? "Listening..." : store.transcriptText)
                    .font(ANTTheme.Font.cormorant(26, weight: .light))
                    .lineSpacing(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 28)
                Text("Claude · \(store.contextSessionName)")
                    .font(ANTTheme.Font.inter(12)).foregroundStyle(.secondary)
                    .padding(.horizontal, 28)
            }
            Spacer()

            // Action row
            HStack(spacing: 16) {
                actionButton(icon: "backward.end", size: 52, bg: Color(hex: "#1E1E24")) {}
                Button {
                    Task {
                        if store.isActive {
                            let text = try? await store.stopDictation()
                            // Send text to active session
                        } else {
                            await store.startDictation()
                        }
                    }
                } label: {
                    Image(systemName: store.isActive ? "stop.fill" : "mic.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(.black)
                        .frame(width: 64, height: 64)
                        .background(ANTTheme.Color.amber)
                        .clipShape(Circle())
                }
                actionButton(icon: "stop.fill", size: 52, bg: Color(hex: "#1E1E24")) {
                    store.isActive = false
                }
            }
            .padding(.bottom, 20)
        }
        .padding(.bottom, 90) // tab bar clearance
    }

    private func actionButton(icon: String, size: CGFloat, bg: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(.secondary)
                .frame(width: size, height: size)
                .background(bg)
                .clipShape(Circle())
        }
    }
}
```

- [ ] **Step 6: Build and run — Voice tab shows waveform, mode switcher, transcript area**
- [ ] **Step 7: Commit**
```bash
git add . && git commit -m "feat: voice mode — ElevenLabs provider, Listen/Dictate/Replay, waveform"
```

---

## Phase 7: Push Notifications

### Task 14: APNs registration

**Files:**
- Modify: `ANT/ANTApp.swift`
- Create: `ANT/Core/Notifications/NotificationManager.swift`

> **Server dependency**: Requires `POST /api/devices` and `DELETE /api/devices/:token` on the ANT server. During development, stub these endpoints or use a mock server.

- [ ] **Step 1: Enable Push Notifications capability**

In Xcode → Signing & Capabilities → add "Push Notifications" and "Background Modes" (Remote notifications).

- [ ] **Step 2: NotificationManager**

```swift
// ANT/Core/Notifications/NotificationManager.swift
import UserNotifications
import UIKit

@Observable final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    private(set) var deviceToken: String?
    private(set) var isAuthorised = false

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func requestAuthorisation() async {
        let centre = UNUserNotificationCenter.current()
        let granted = (try? await centre.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await MainActor.run { isAuthorised = granted }
        if granted {
            await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func register(token: Data, api: APIClient) async {
        let tokenString = token.map { String(format: "%02.2hhx", $0) }.joined()
        deviceToken = tokenString
        try? await api.post("/api/devices", body: ["token": tokenString, "platform": "ios"]) as EmptyResponse
    }

    func unregister(api: APIClient) async {
        guard let token = deviceToken else { return }
        try? await api.delete("/api/devices/\(token)")
    }

    func userNotificationCenter(_ centre: UNUserNotificationCenter,
                                 willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
```

- [ ] **Step 3: Wire into ANTApp**

Add to `ANTApp`:
```swift
@State private var notificationManager = NotificationManager()

// In WindowGroup body, add:
.onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
    Task { await notificationManager.requestAuthorisation() }
}
// In AppDelegate or via onAppear in TabRoot:
// UIApplication.shared.registerForRemoteNotifications() is called inside requestAuthorisation
```

Add `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` via `AppDelegate` or SwiftUI `UNUserNotificationCenter` registration in `ANTApp`.

- [ ] **Step 4: Commit**
```bash
git add . && git commit -m "feat: APNs device registration and notification permissions"
```

---

## Phase 8: Settings + iPad Layout

### Task 15: Settings screen

**Files:**
- Create: `ANT/Views/Settings/SettingsView.swift`
- Create: `ANT/Views/Settings/ServerConfigView.swift`
- Create: `ANT/Views/Settings/VoiceSettingsView.swift`

- [ ] **Step 1: ServerConfigView (first-run + settings)**

```swift
// ANT/Views/Settings/ServerConfigView.swift
import SwiftUI

struct ServerConfigView: View {
    @Environment(ServerConfig.self) var config
    @State private var urlText = ""
    @State private var apiKeyText = ""
    @State private var testStatus: TestStatus = .idle
    @State private var api: APIClient?

    enum TestStatus { case idle, testing, ok, failed(String) }

    var body: some View {
        @Bindable var config = config
        Form {
            Section("Server") {
                TextField("Tailscale IP (e.g. http://100.x.x.x:6450)", text: $config.serverURL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                SecureField("API Key", text: $apiKeyText)
                Button("Test connection") {
                    Task { await testConnection() }
                }
                switch testStatus {
                case .ok: Label("Connected", systemImage: "checkmark.circle").foregroundStyle(.green)
                case .failed(let e): Label(e, systemImage: "xmark.circle").foregroundStyle(.red)
                default: EmptyView()
                }
            }
        }
        .navigationTitle("Server")
        .onAppear {
            apiKeyText = (try? config.loadAPIKey()) ?? ""
        }
        .onChange(of: apiKeyText) { _, val in try? config.saveAPIKey(val) }
    }

    private func testConnection() async {
        testStatus = .testing
        let client = APIClient(config: config)
        do {
            let _: [String: String] = try await client.get("/api/health")
            testStatus = .ok
        } catch {
            testStatus = .failed(error.localizedDescription)
        }
    }
}
```

```swift
// ANT/Views/Settings/SettingsView.swift
import SwiftUI

struct SettingsView: View {
    @AppStorage("terminalFontSize") var fontSize: Double = 13
    @AppStorage("defaultTerminalMode") var defaultMode: String = "signals"

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    NavigationLink("Server & API Key") { ServerConfigView() }
                }
                Section("Voice") {
                    NavigationLink("Voice Settings") { VoiceSettingsView() }
                }
                Section("Appearance") {
                    LabeledContent("Terminal font size") {
                        Slider(value: $fontSize, in: 10...20, step: 1)
                    }
                    Picker("Default terminal view", selection: $defaultMode) {
                        Text("Signals").tag("signals")
                        Text("Raw").tag("raw")
                        Text("Xterm").tag("xterm")
                    }
                }
                Section("Cache") {
                    Button("Clear offline data", role: .destructive) {}
                }
                Section("Troubleshooting") {
                    Button("Kill all terminals", role: .destructive) {}
                }
                Section("About") {
                    LabeledContent("Version", value: "1.0.0")
                }
            }
            .navigationTitle("Settings")
        }
    }
}
```

```swift
// ANT/Views/Settings/VoiceSettingsView.swift
import SwiftUI

struct VoiceSettingsView: View {
    @State private var elevenLabsKey = ""
    @State private var modelId = "eleven_turbo_v2"

    var body: some View {
        Form {
            Section("ElevenLabs") {
                SecureField("API Key", text: $elevenLabsKey)
                TextField("Model ID", text: $modelId)
                    .autocorrectionDisabled()
            }
        }
        .navigationTitle("Voice Settings")
        .onAppear {
            elevenLabsKey = (try? KeychainHelper.load(key: "ant.elevenlabs.key")) ?? ""
        }
        .onChange(of: elevenLabsKey) { _, val in
            try? KeychainHelper.save(key: "ant.elevenlabs.key", value: val)
        }
    }
}
```

- [ ] **Step 2: Build and run — Settings tab shows all sections, Server config navigates correctly**
- [ ] **Step 3: Commit**
```bash
git add . && git commit -m "feat: settings screen — server config, voice settings, appearance"
```

---

### Task 16: QuickPhrasesBar (shared, context-aware)

**Files:**
- Create: `ANT/Views/Shared/QuickPhrasesBar.swift`

- [ ] **Step 1: Implement**

```swift
// ANT/Views/Shared/QuickPhrasesBar.swift
import SwiftUI

enum PhraseContext { case chat, terminal }

struct QuickPhrasesBar: View {
    let context: PhraseContext
    let onSelect: (String) -> Void

    private var phrases: [String] {
        switch context {
        case .chat:     return ["summarise this", "continue", "explain that", "simplify"]
        case .terminal: return ["git status", "bun run dev", "ctrl+c", "ls -la"]
        }
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(phrases, id: \.self) { phrase in
                    Button { onSelect(phrase) } label: {
                        Text(phrase)
                            .font(context == .terminal
                                  ? ANTTheme.Font.mono(11)
                                  : ANTTheme.Font.inter(12))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 12)
                            .frame(height: 28)
                            .background(Color.secondary.opacity(0.1))
                            .clipShape(Capsule())
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}
```

- [ ] **Step 2: Commit**
```bash
git add . && git commit -m "feat: context-aware quick phrases bar (chat + CLI modes)"
```

---

### Task 17: iPad adaptive layout

**Files:**
- Modify: `ANT/Views/TabRoot.swift`
- Create: `ANT/Views/iPadSplitView.swift`

- [ ] **Step 1: Detect iPad and render split view**

```swift
// ANT/Views/iPadSplitView.swift
import SwiftUI

struct iPadSplitView: View {
    @Environment(SessionStore.self) var store
    @State private var selectedSession: SessionSummary?

    var body: some View {
        NavigationSplitView {
            SessionListView()
        } detail: {
            if let session = selectedSession {
                SessionSpaceView(session: session)
            } else {
                ContentUnavailableView("Select a session", systemImage: "sidebar.left")
            }
        }
    }
}
```

Modify `TabRoot.swift` body:
```swift
var body: some View {
    if UIDevice.current.userInterfaceIdiom == .pad {
        iPadSplitView()
    } else {
        ZStack(alignment: .bottom) {
            // ... existing iPhone layout
        }
    }
}
```

- [ ] **Step 2: Build on iPad simulator — sidebar shows sessions, detail shows session space**
- [ ] **Step 3: Commit**
```bash
git add . && git commit -m "feat: iPad adaptive split view layout"
```

---

### Task 18: URL auto-conversion + file preview

**Files:**
- Create: `ANT/Core/URLConverter.swift`
- Create: `ANT/Views/Shared/FilePreviewView.swift`

- [ ] **Step 1: URLConverter**

```swift
// ANT/Core/URLConverter.swift
import Foundation

struct URLConverter {
    private let mapping: [String: String]  // "localhost:3000" → "100.x.x.x:3000"

    init(mappings: [String: String] = [:]) { self.mapping = mappings }

    func convert(_ text: String) -> String {
        var result = text
        for (local, tailscale) in mapping {
            result = result.replacingOccurrences(of: "localhost:\(local.split(separator: ":").last ?? "")",
                                                  with: tailscale)
            result = result.replacingOccurrences(of: "127.0.0.1:\(local.split(separator: ":").last ?? "")",
                                                  with: tailscale)
        }
        return result
    }
}
```

- [ ] **Step 2: Commit**
```bash
git add . && git commit -m "feat: URL auto-conversion (localhost → Tailscale) and file preview"
```

---

## Phase 9: Socket wiring + offline queue flush

### Task 19: Wire SocketClient to stores

**Files:**
- Modify: `ANT/ANTApp.swift`
- Create: `ANT/Core/AppOrchestrator.swift`

- [ ] **Step 1: AppOrchestrator**

```swift
// ANT/Core/AppOrchestrator.swift
import Foundation
import SwiftData

/// Wires SocketClient callbacks to the appropriate stores.
@Observable final class AppOrchestrator {
    let socketClient: SocketClient
    let pendingQueue: PendingActionQueue
    let connectivity: ConnectivityMonitor
    private let api: APIClient
    private var messageStores: [String: MessageStore] = [:]
    private var terminalStores: [String: TerminalStore] = [:]
    private var context: ModelContext

    init(config: ServerConfig, connectivity: ConnectivityMonitor, context: ModelContext) {
        self.connectivity = connectivity
        self.context = context
        let apiKey = (try? config.loadAPIKey()) ?? ""
        self.api = APIClient(config: config)
        self.socketClient = SocketClient(serverURL: config.serverURL, apiKey: apiKey)
        self.pendingQueue = PendingActionQueue(context: context)
        setupCallbacks()
    }

    func start() { socketClient.connect() }
    func stop()  { socketClient.disconnect() }

    func register(messageStore: MessageStore, for sessionId: String) {
        messageStores[sessionId] = messageStore
    }

    func register(terminalStore: TerminalStore, for sessionId: String) {
        terminalStores[sessionId] = terminalStore
        socketClient.joinSession(id: sessionId)
    }

    private func setupCallbacks() {
        socketClient.onStreamChunk = { [weak self] payload in
            guard let sid = payload["sessionId"] as? String else { return }
            self?.messageStores[sid]?.handleStreamChunk(payload)
        }
        socketClient.onMessageUpdated = { [weak self] sid, payload in
            self?.messageStores[sid]?.handleMessageUpdated(payload)
        }
        socketClient.onTerminalOutput = { [weak self] sid, data in
            guard let self, let store = self.terminalStores[sid] else { return }
            store.appendChunk(data, sessionId: sid, context: self.context)
        }
        // Flush pending queue on reconnect
        socketClient.onTerminalOutput = { [weak self] _, _ in
            Task { await self?.flushPendingQueue() }
        }
    }

    private func flushPendingQueue() async {
        while let action = try? pendingQueue.dequeue() {
            do {
                let _: EmptyResponse = try await api.post(action.endpoint,
                                                          body: RawJSON(action.body ?? "{}"))
            } catch APIError.notFound {
                pendingQueue.discard(action)  // Session gone — discard
            } catch {
                // Re-enqueue at front? For simplicity, discard after one retry failure
                break
            }
        }
    }
}

struct RawJSON: Encodable {
    private let raw: String
    init(_ raw: String) { self.raw = raw }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        guard let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) else {
            try c.encode(raw); return
        }
        try c.encode(AnyEncodable(obj))
    }
}

struct AnyEncodable: Encodable {
    private let value: Any
    init(_ value: Any) { self.value = value }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let s as String: try c.encode(s)
        case let i as Int:    try c.encode(i)
        case let d as Double: try c.encode(d)
        case let b as Bool:   try c.encode(b)
        default: try c.encode("\(value)")
        }
    }
}
```

- [ ] **Step 2: Add orchestrator to ANTApp environment and start on appear**
- [ ] **Step 3: Commit**
```bash
git add . && git commit -m "feat: AppOrchestrator wires socket callbacks to stores, flushes pending queue on reconnect"
```

---

### Task 20: Integration test + manual verification

- [ ] **Step 1: Run all unit tests**
```
cmd+U — expect all tests PASS
```
Expected test targets:
- `SwiftDataModelsTests` — 2 tests PASS
- `KeychainHelperTests` — 2 tests PASS
- `APIClientTests` — 2 tests PASS
- `SocketClientTests` — 1 test PASS
- `PendingActionQueueTests` — 2 tests PASS
- `SignalClassifierTests` — 5 tests PASS

- [ ] **Step 2: Manual end-to-end on device over Tailscale**

Checklist:
- [ ] App launches, shows first-run `ServerConfigView`
- [ ] Enter Tailscale IP + API key, test connection → green tick
- [ ] Sessions list loads with correct cards and workspace filter
- [ ] Tap terminal session → Terminal mode with KEY SIGNALS
- [ ] Real output appears in signal view, classified correctly
- [ ] RAW mode shows full output, XTERM mode shows xterm.js
- [ ] CLI input sends commands, responses appear
- [ ] Tap conversation session → Chat mode with bubbles
- [ ] Send a message → appears as user bubble, response streams as agent bubble
- [ ] Voice tab → waveform visible, Dictate records + transcribes
- [ ] Settings → server URL + API key editable

- [ ] **Step 3: Final commit**
```bash
git add . && git commit -m "chore: all unit tests passing, manual QA checklist complete"
git tag v1.0.0-alpha
```

---

## Appendix: Server changes required

The following ANT server endpoints must be added for full v1 support:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/devices` | POST | Register APNs device token |
| `/api/devices/:token` | DELETE | Unregister device on sign-out |

Both are small additions to the existing Express router. APNs dispatch can be triggered by the existing session event system (new message, terminal match, resume command capture).

---

## Appendix: xterm.html bundle

Place in `ANT/Resources/xterm.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="xterm.css"/>
  <script src="xterm.js"></script>
  <style>body { margin:0; background:#0D0D12; } #terminal { height:100vh; }</style>
</head>
<body>
  <div id="terminal"></div>
  <script>
    const term = new Terminal({
      theme: { background:'#0D0D12', foreground:'#E0E0E0', cursor:'#22C55E' },
      fontFamily: 'JetBrains Mono, monospace', fontSize: 13, cursorBlink: true
    });
    term.open(document.getElementById('terminal'));
    term.onData(data => window.webkit.messageHandlers.terminalInput.postMessage(data));
  </script>
</body>
</html>
```

Download `xterm.js` and `xterm.css` from [xterm.js releases](https://github.com/xtermjs/xterm.js/releases) and add to `ANT/Resources/`.
