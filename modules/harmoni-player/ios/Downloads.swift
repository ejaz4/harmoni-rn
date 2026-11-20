import Foundation

/// Songs saved for offline listening: what Downloads.kt does on Android, on a background
/// URLSession (downloads go on with the app suspended, and finish even if it's closed).
///
/// Each song is a file in Application Support/downloads, named by song id. The line is kept
/// here, as on Android: every waiting song has a place (`seq`), asking for songs puts them at
/// the front in the order asked, and only the first few are handed to URLSession at a time,
/// so whatever is on screen saves top to bottom. The records live in one JSON index.
///
/// Main thread only (URLSession calls back on main too).
final class Downloads: NSObject, URLSessionDownloadDelegate {
  static let shared = Downloads()

  private static let parallel = 3
  private static let maxRetries = 5
  private static let sessionId = "com.ceccun.harmoni.downloads"

  /// Events for JS ("onDownload" bodies).
  var emit: (([String: Any?]) -> Void)?

  final class Record: Codable {
    var id: String
    /// queued | downloading | done | failed | stopped
    var state: String
    var bytes: Double = 0
    var total: Double = 0
    var updatedAt: Double
    var seq: Double
    var retries = 0
    /// The file's extension, from the Content-Type the server sent.
    var ext: String?
    /// The song as JSON, as JS sent it.
    var song: String

    init(id: String, song: String, seq: Double) {
      self.id = id
      self.song = song
      self.seq = seq
      state = "queued"
      updatedAt = Date().timeIntervalSince1970 * 1000
    }

    var percent: Double { total > 0 ? min(100, bytes * 100 / total) : (state == "done" ? 100 : 0) }
  }

  private var records: [String: Record] = [:]
  /// Running tasks by song id.
  private var tasks: [String: URLSessionDownloadTask] = [:]
  private var front: Double = -1
  private var saveScheduled = false
  private var pumpScheduled = false

  private lazy var session: URLSession = {
    let c = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
    c.sessionSendsLaunchEvents = true
    c.isDiscretionary = false
    c.httpMaximumConnectionsPerHost = Self.parallel
    c.timeoutIntervalForRequest = 60
    return URLSession(configuration: c, delegate: self, delegateQueue: .main)
  }()

  private static var dir: URL {
    let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("downloads", isDirectory: true)
    if !FileManager.default.fileExists(atPath: d.path) {
      try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
      var v = d
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? v.setResourceValues(values)
    }
    return d
  }

  private static var indexFile: URL { dir.appendingPathComponent("index.json") }

  private func fileURL(_ r: Record) -> URL {
    Self.dir.appendingPathComponent("\(r.id).\(r.ext ?? "m4a")")
  }

  private override init() {
    super.init()
    if let data = try? Data(contentsOf: Self.indexFile),
       let list = try? JSONDecoder().decode([Record].self, from: data) {
      for r in list { records[r.id] = r }
    }
    front = (records.values.map(\.seq).min() ?? 0) - 1
  }

  /// Picks up downloads URLSession kept going while the app was away, then lines up the rest.
  func start() {
    session.getAllTasks { [weak self] all in
      DispatchQueue.main.async {
        guard let self else { return }
        for t in all {
          // Tasks for songs removed (or already saved) while the app was away.
          guard let dt = t as? URLSessionDownloadTask, let id = dt.taskDescription,
                let r = self.records[id], r.state != "done" else {
            t.cancel()
            continue
          }
          self.tasks[id] = dt
          r.state = "downloading"
        }
        // Marked downloading, but URLSession has nothing for them: back in line.
        for r in self.records.values where r.state == "downloading" && self.tasks[r.id] == nil {
          r.state = "queued"
        }
        self.pump()
      }
    }
  }

  // MARK: - for the player

  /// The saved file for a song, if it's downloaded.
  func localURL(_ id: String) -> URL? {
    guard let r = records[id], r.state == "done" else { return nil }
    let url = fileURL(r)
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }

  var isDownloading: Bool { !tasks.isEmpty }

  /// Progress of the songs downloading now, for onTick.
  func active() -> [[String: Any]] {
    tasks.keys.compactMap { records[$0] }.map { r -> [String: Any] in
      ["id": r.id, "percent": r.percent, "state": r.state]
    }
  }

  // MARK: - from JS

  /// Adds songs and puts them (and any of them already waiting) at the front of the line in
  /// the order given. Failed and stopped ones start again.
  func add(_ json: String) {
    guard let list = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [[String: Any]] else { return }
    var ids: [String] = []
    for o in list {
      guard let e = Entry(o) else { continue }
      if let r = records[e.id] {
        switch r.state {
        case "queued":
          ids.append(e.id)
        case "failed", "stopped":
          r.state = "queued"
          r.retries = 0
          r.bytes = 0
          r.song = e.raw
          ids.append(e.id)
          send(r, withSong: false)
        default:
          break // downloading or saved already
        }
        continue
      }
      let r = Record(id: e.id, song: e.raw, seq: 0)
      records[e.id] = r
      ids.append(e.id)
      send(r, withSong: true)
    }
    toFront(ids)
    scheduleSave()
    pump()
  }

  /// Moves these songs, if they're waiting, to the front of the line in this order.
  func prioritize(_ json: String) {
    let ids = ((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String]) ?? []
    let waiting = ids.filter { records[$0]?.state == "queued" }
    guard !waiting.isEmpty else { return }
    toFront(waiting)
    scheduleSave()
    pump()
  }

  func remove(_ ids: [String]) {
    for id in ids {
      tasks.removeValue(forKey: id)?.cancel()
      guard let r = records.removeValue(forKey: id) else { continue }
      try? FileManager.default.removeItem(at: fileURL(r))
      emit?(["id": id, "state": "removed"])
    }
    scheduleSave()
    pump()
  }

  func removeAll() {
    remove(Array(records.keys))
    front = -1
  }

  /// Everything, for the Downloads page (getDownloads).
  func allJson() -> String {
    let list: [[String: Any]] = records.values.map { describe($0, withSong: true) }
    guard let data = try? JSONSerialization.data(withJSONObject: list) else { return "[]" }
    return String(data: data, encoding: .utf8) ?? "[]"
  }

  /// Bytes on disk.
  func size() -> Double {
    records.values.filter { $0.state == "done" }.reduce(0) { sum, r in
      let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL(r).path)
      return sum + ((attrs?[.size] as? NSNumber)?.doubleValue ?? r.bytes)
    }
  }

  // MARK: - the line

  private func toFront(_ ids: [String]) {
    var seen = Set<String>()
    let unique = ids.filter { seen.insert($0).inserted }
    var s = front - Double(unique.count) + 1
    front -= Double(unique.count)
    for id in unique {
      records[id]?.seq = s
      s += 1
    }
  }

  /// Starts the next songs in line while there's room. Settles, so calling it often is fine.
  private func pump() {
    guard !pumpScheduled else { return }
    pumpScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.04) { [weak self] in
      guard let self else { return }
      self.pumpScheduled = false
      let slots = Self.parallel - self.tasks.count
      guard slots > 0 else { return }
      let next = self.records.values.filter { $0.state == "queued" }.sorted { $0.seq < $1.seq }.prefix(slots)
      for r in next { self.begin(r) }
    }
  }

  private func begin(_ r: Record) {
    guard let url = Core.playURL(r.id) else { return }
    var req = URLRequest(url: url)
    req.setValue(Core.userAgent, forHTTPHeaderField: "User-Agent")
    // Download on Wi-Fi only (the default): no mobile data or hotspots.
    req.allowsExpensiveNetworkAccess = !Prefs.wifiOnlyDownloads
    if let token = AuthStore.shared.peekToken() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    let task = session.downloadTask(with: req)
    task.taskDescription = r.id
    tasks[r.id] = task
    r.state = "downloading"
    r.bytes = 0
    r.updatedAt = Date().timeIntervalSince1970 * 1000
    send(r, withSong: false)
    task.resume()
  }

  /// A try that didn't work: again (a few times), or failed for good.
  private func retryOrFail(_ r: Record, refreshToken: Bool) {
    tasks.removeValue(forKey: r.id)
    r.retries += 1
    if r.retries > Self.maxRetries {
      r.state = "failed"
      send(r, withSong: false)
      scheduleSave()
      pump()
      return
    }
    r.state = "queued"
    send(r, withSong: false)
    let delay = Double(min(30, 1 << r.retries))
    let failedToken = AuthStore.shared.peekToken()
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay) { [weak self] in
      if refreshToken { _ = AuthStore.shared.refreshAfter(failedToken) }
      DispatchQueue.main.async { self?.pump() }
    }
  }

  // MARK: - URLSession

  /// Set when iOS woke the app for finished downloads (HarmoniAppDelegate); called once they're handled.
  var backgroundCompletion: (() -> Void)?

  /// iOS woke the app because downloads finished while it was away. Making the session picks up their events.
  func handleBackgroundEvents(_ completion: @escaping () -> Void) {
    backgroundCompletion = completion
    _ = session
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async { [weak self] in
      self?.backgroundCompletion?()
      self?.backgroundCompletion = nil
    }
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                  totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    guard let id = downloadTask.taskDescription, let r = records[id] else { return }
    r.bytes = Double(totalBytesWritten)
    if totalBytesExpectedToWrite > 0 { r.total = Double(totalBytesExpectedToWrite) }
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    // The file at `location` is gone once this returns: move it now.
    guard let id = downloadTask.taskDescription, let r = records[id] else { return }
    let http = downloadTask.response as? HTTPURLResponse
    guard let http, (200..<300).contains(http.statusCode) else {
      tasks.removeValue(forKey: id)
      retryOrFail(r, refreshToken: http?.statusCode == 401)
      return
    }
    r.ext = Self.ext(for: http.value(forHTTPHeaderField: "Content-Type"))
    let dest = fileURL(r)
    do {
      try? FileManager.default.removeItem(at: dest)
      try FileManager.default.moveItem(at: location, to: dest)
    } catch {
      NSLog("HarmoniDownloads: couldn't keep \(id): \(error)")
      retryOrFail(r, refreshToken: false)
      return
    }
    tasks.removeValue(forKey: id)
    let size = ((try? FileManager.default.attributesOfItem(atPath: dest.path))?[.size] as? NSNumber)?.doubleValue ?? r.bytes
    r.bytes = size
    r.total = size
    r.state = "done"
    r.retries = 0
    r.updatedAt = Date().timeIntervalSince1970 * 1000
    send(r, withSong: true)
    scheduleSave()
    pump()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let error, let id = task.taskDescription else { return }
    // Removed (cancelled) by us: nothing more to do.
    if (error as NSError).code == NSURLErrorCancelled && records[id] == nil { return }
    guard let r = records[id], tasks[id] === task else { return }
    NSLog("HarmoniDownloads: \(id) failed: \(error.localizedDescription)")
    retryOrFail(r, refreshToken: false)
  }

  // MARK: - helpers

  private func describe(_ r: Record, withSong: Bool) -> [String: Any] {
    var o: [String: Any] = [
      "id": r.id, "state": r.state, "percent": r.percent, "bytes": r.bytes, "updatedAt": r.updatedAt,
    ]
    if withSong {
      o["song"] = (try? JSONSerialization.jsonObject(with: Data(r.song.utf8))) ?? NSNull()
    }
    return o
  }

  /// onDownload: like Android, the song goes along as a JSON string.
  private func send(_ r: Record, withSong: Bool) {
    var body: [String: Any?] = ["id": r.id, "state": r.state, "percent": r.percent, "bytes": r.bytes, "updatedAt": r.updatedAt]
    if withSong { body["song"] = r.song }
    emit?(body)
  }

  private func scheduleSave() {
    guard !saveScheduled else { return }
    saveScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      guard let self else { return }
      self.saveScheduled = false
      let list = Array(self.records.values)
      guard let data = try? JSONEncoder().encode(list) else { return }
      DispatchQueue.global(qos: .utility).async {
        try? data.write(to: Self.indexFile, options: .atomic)
      }
    }
  }

  private static func ext(for contentType: String?) -> String {
    let t = (contentType ?? "").lowercased()
    if t.contains("webm") { return "webm" }
    if t.contains("mpeg") || t.contains("mp3") { return "mp3" }
    if t.contains("ogg") { return "ogg" }
    if t.contains("aac") { return "aac" }
    return "m4a"
  }
}
