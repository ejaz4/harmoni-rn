import Foundation

/// A song in the queue: the JSON JS sent, plus what the player and lock screen need from it.
struct Entry {
  let id: String
  /// The song as JSON, handed back to JS in events and saved with the queue.
  let raw: String
  let title: String
  let artist: String
  let album: String?
  let artworkUrl: String?
  let durationMs: Double?

  init?(_ o: [String: Any]) {
    guard let id = o["id"] as? String, !id.isEmpty,
          let data = try? JSONSerialization.data(withJSONObject: o),
          let raw = String(data: data, encoding: .utf8) else { return nil }
    self.id = id
    self.raw = raw
    title = (o["title"] as? String) ?? ""
    artist = ((o["artists"] as? [[String: Any]]) ?? [])
      .compactMap { $0["name"] as? String }
      .filter { !$0.isEmpty }
      .joined(separator: ", ")
    album = (o["album"] as? [String: Any])?["title"] as? String
    let art = o["artworkUrl"] as? String
    artworkUrl = (art?.isEmpty ?? true) ? nil : art
    durationMs = (o["durationMs"] as? NSNumber)?.doubleValue
  }

  /// Songs from a JSON array; entries that aren't songs (no id) are skipped, as on Android.
  static func list(_ json: String) -> [Entry] {
    guard let a = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [Any] else { return [] }
    return a.compactMap { ($0 as? [String: Any]).flatMap(Entry.init) }
  }

  static func json(_ entries: [Entry]) -> String {
    "[" + entries.map(\.raw).joined(separator: ",") + "]"
  }
}

/// Process-wide pieces shared by the module and the player. Mirrors Core.kt.
enum Core {
  static let userAgent = "Harmoni-iOS/1.0"

  static func apiBase() -> String? { AuthStore.shared.get()?.apiBase }

  static func playURL(_ songId: String) -> URL? {
    guard let base = apiBase() else { return nil }
    return URL(string: "\(base)/play/\(songId)")
  }

  /// YouTube Music artwork URLs carry their size; ask for a bigger one.
  static func sizedArtwork(_ url: String, _ px: Int) -> String {
    guard let r = url.range(of: "=w(\\d+)-h(\\d+)", options: .regularExpression) else { return url }
    let m = String(url[r])
    let w = Int(m.dropFirst(2).prefix { $0.isNumber }) ?? 0
    return w < px ? url.replacingCharacters(in: r, with: "=w\(px)-h\(px)") : url
  }

  // --- likes, for the lock screen's heart ---

  private static let likedLock = NSLock()
  private static var likedIds = Set<String>()
  /// Called on the main queue when a like changes from outside the app.
  static var onLikedChanged: ((String, Bool) -> Void)?

  static func setLiked(_ ids: [String]) {
    likedLock.lock(); likedIds = Set(ids); likedLock.unlock()
  }

  static func setLiked(_ id: String, _ liked: Bool) {
    likedLock.lock()
    if liked { likedIds.insert(id) } else { likedIds.remove(id) }
    likedLock.unlock()
  }

  static func isLiked(_ id: String) -> Bool {
    likedLock.lock(); defer { likedLock.unlock() }
    return likedIds.contains(id)
  }

  /// Like or unlike from the lock screen. Calls the server itself and undoes it if that fails.
  static func toggleLikeRemotely(_ songId: String) {
    let nowLiked = !isLiked(songId)
    setLiked(songId, nowLiked)
    onLikedChanged?(songId, nowLiked)
    DispatchQueue.global(qos: .userInitiated).async {
      let code = api(nowLiked ? "PUT" : "DELETE", "/likes/\(songId)").0
      if !(200..<300).contains(code) {
        NSLog("HarmoniCore: like failed: \(code)")
        setLiked(songId, !nowLiked)
        DispatchQueue.main.async { onLikedChanged?(songId, !nowLiked) }
      }
    }
  }

  /// A small blocking JSON API call with auth and one retry after a 401. Never on main.
  static func api(_ method: String, _ path: String, body: Data? = nil) -> (Int, Data) {
    guard let base = apiBase(), let url = URL(string: base + path) else { return (0, Data()) }
    guard var token = AuthStore.shared.freshToken() else { return (401, Data()) }
    for attempt in 0..<2 {
      var req = URLRequest(url: url, timeoutInterval: 30)
      req.httpMethod = method
      req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
      if let body {
        req.httpBody = body
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      }
      let (code, data) = send(req)
      if code == 401 && attempt == 0 {
        guard let next = AuthStore.shared.refreshAfter(token) else { return (401, Data()) }
        token = next
        continue
      }
      return (code, data)
    }
    return (401, Data())
  }

  /// Asks the server to fetch and cache a song ahead of time (one byte back).
  static func warm(_ songId: String) {
    DispatchQueue.global(qos: .utility).async {
      guard let url = playURL(songId), let token = AuthStore.shared.freshToken() else { return }
      var req = URLRequest(url: url, timeoutInterval: 30)
      req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
      req.setValue("bytes=0-0", forHTTPHeaderField: "Range")
      _ = send(req)
    }
  }

  /// Blocking request. (0, empty) when there was no answer.
  static func send(_ req: URLRequest) -> (Int, Data) {
    let done = DispatchSemaphore(value: 0)
    var result: (Int, Data) = (0, Data())
    URLSession.shared.dataTask(with: req) { data, response, _ in
      if let http = response as? HTTPURLResponse { result = (http.statusCode, data ?? Data()) }
      done.signal()
    }.resume()
    done.wait()
    return result
  }
}
