import Foundation
import Security

/// The signed-in session, kept natively (as on Android) so playback and downloads can get a
/// fresh token without JS. Stored in the Keychain; refreshes are serialised and the rotated
/// refresh token is saved before it's handed out. Mirrors AuthStore.kt.
final class AuthStore {
  static let shared = AuthStore()

  struct Session: Codable {
    var server: String
    var issuer: String
    var apiBase: String
    var tokenEndpoint: String
    var revocationEndpoint: String
    var clientId: String
    var accessToken: String
    var refreshToken: String
    /// Milliseconds since 1970, like Android.
    var expiresAt: Double

    static func from(json: String) throws -> Session {
      guard let o = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
        throw NSError(domain: "HarmoniAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: "bad session"])
      }
      func str(_ k: String) throws -> String {
        guard let v = o[k] as? String else {
          throw NSError(domain: "HarmoniAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: "missing \(k)"])
        }
        return v
      }
      var apiBase = try str("apiBase")
      while apiBase.hasSuffix("/") { apiBase.removeLast() }
      return Session(
        server: try str("server"),
        issuer: try str("issuer"),
        apiBase: apiBase,
        tokenEndpoint: try str("tokenEndpoint"),
        revocationEndpoint: (o["revocationEndpoint"] as? String) ?? "",
        clientId: try str("clientId"),
        accessToken: try str("accessToken"),
        refreshToken: try str("refreshToken"),
        expiresAt: (o["expiresAt"] as? NSNumber)?.doubleValue ?? 0
      )
    }
  }

  private static let service = "com.ceccun.harmoni.session"
  private static let account = "session"

  /// Serialises loads and refreshes (refreshes block on the network, so never call on main).
  private let lock = NSLock()
  private var session: Session? {
    didSet {
      peekLock.lock()
      peeked = session.map { ($0.accessToken, $0.expiresAt) }
      peekLock.unlock()
    }
  }
  private var loaded = false

  /// A copy of the token behind its own lock, so the main thread can read it while a
  /// refresh holds [lock] on the network.
  private let peekLock = NSLock()
  private var peeked: (token: String, expiresAt: Double)?

  /// The current access token without waiting (it may be about to run out). Nil before the
  /// session has been loaded once.
  func peekToken() -> String? {
    peekLock.lock(); defer { peekLock.unlock() }
    return peeked?.token
  }

  /// Whether the token runs out within `ms` (true when there's none in memory yet).
  func expiresWithin(_ ms: Double) -> Bool {
    peekLock.lock(); defer { peekLock.unlock() }
    guard let p = peeked else { return true }
    return p.expiresAt - Self.nowMs() < ms
  }

  /// Called when the server says the sign-in is over.
  var onSignedOut: (() -> Void)?

  private static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

  func get() -> Session? {
    lock.lock(); defer { lock.unlock() }
    return loadedSession()
  }

  private func loadedSession() -> Session? {
    if !loaded {
      session = read()
      loaded = true
    }
    return session
  }

  func set(_ s: Session) {
    lock.lock(); defer { lock.unlock() }
    write(s)
    session = s
    loaded = true
  }

  func clear() {
    lock.lock(); defer { lock.unlock() }
    delete()
    session = nil
    loaded = true
  }

  /// A token good for at least another `minValidMs` (a minute), refreshing if needed. Blocking.
  func freshToken(minValidMs: Double = 60_000) -> String? {
    lock.lock(); defer { lock.unlock() }
    guard let s = loadedSession() else { return nil }
    if s.expiresAt - Self.nowMs() > minValidMs { return s.accessToken }
    return refreshLocked(s)
  }

  /// After a 401: refresh unless someone already replaced the token that failed. Blocking.
  func refreshAfter(_ failed: String?) -> String? {
    lock.lock(); defer { lock.unlock() }
    guard let s = loadedSession() else { return nil }
    if let failed, s.accessToken != failed { return s.accessToken }
    return refreshLocked(s)
  }

  /// Revokes the sign-in (best effort) and forgets it. Blocking.
  func revoke() {
    lock.lock()
    let s = loadedSession()
    delete()
    session = nil
    loaded = true
    lock.unlock()
    guard let s, !s.revocationEndpoint.isEmpty else { return }
    _ = post(s.revocationEndpoint, ["token": s.refreshToken, "client_id": s.clientId])
  }

  private func refreshLocked(_ s: Session) -> String? {
    guard let (code, data) = post(s.tokenEndpoint, [
      "grant_type": "refresh_token", "refresh_token": s.refreshToken, "client_id": s.clientId,
    ]) else {
      return s.accessToken // offline: keep what we have
    }
    let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    if code == 200, let access = json?["access_token"] as? String {
      var next = s
      next.accessToken = access
      next.refreshToken = (json?["refresh_token"] as? String) ?? s.refreshToken
      next.expiresAt = Self.nowMs() + ((json?["expires_in"] as? NSNumber)?.doubleValue ?? 3600) * 1000
      write(next) // the rotated refresh token is saved before anything else
      session = next
      return next.accessToken
    }
    let error = json?["error"] as? String
    if code == 400 && (error == "invalid_grant" || error == "invalid_client") {
      NSLog("HarmoniAuth: refresh refused (\(error ?? "")): signed out")
      delete()
      session = nil
      let cb = onSignedOut
      DispatchQueue.main.async { cb?() }
      return nil
    }
    NSLog("HarmoniAuth: refresh failed: \(code)")
    return s.accessToken // server trouble: keep what we have
  }

  /// A blocking form POST. Nil when the request didn't get an answer.
  private func post(_ url: String, _ form: [String: String]) -> (Int, Data)? {
    guard let u = URL(string: url) else { return nil }
    var req = URLRequest(url: u, timeoutInterval: 20)
    req.httpMethod = "POST"
    req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    req.httpBody = form
      .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
      .joined(separator: "&")
      .data(using: .utf8)

    let done = DispatchSemaphore(value: 0)
    var result: (Int, Data)?
    URLSession.shared.dataTask(with: req) { data, response, _ in
      if let http = response as? HTTPURLResponse { result = (http.statusCode, data ?? Data()) }
      done.signal()
    }.resume()
    done.wait()
    return result
  }

  // --- Keychain ---

  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.service,
      kSecAttrAccount as String: Self.account,
    ]
  }

  private func write(_ s: Session) {
    guard let data = try? JSONEncoder().encode(s) else { return }
    let attrs: [String: Any] = [
      kSecValueData as String: data,
      // Background playback and downloads need it while the phone is locked.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
    if status == errSecItemNotFound {
      let add = query.merging(attrs) { $1 }
      SecItemAdd(add as CFDictionary, nil)
    }
  }

  private func read() -> Session? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: AnyObject?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return try? JSONDecoder().decode(Session.self, from: data)
  }

  private func delete() {
    SecItemDelete(query as CFDictionary)
  }
}
