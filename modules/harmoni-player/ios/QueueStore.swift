import Foundation

/// Remembers the queue on disk so the app resumes where it was after being closed. Mirrors QueueStore.kt.
enum QueueStore {
  struct Saved {
    let queueJson: String
    let index: Int
    let positionMs: Double
    let repeatMode: String
  }

  private static let writer = DispatchQueue(label: "harmoni.queuestore")

  private static var file: URL {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("queue.json")
  }

  /// Snapshot on the caller's thread, write in the background.
  static func save(_ entries: [Entry], index: Int, positionMs: Double, repeatMode: String) {
    let body = "{\"queue\":\(Entry.json(entries)),\"index\":\(index),\"positionMs\":\(Int64(positionMs)),\"repeat\":\"\(repeatMode)\"}"
    writer.async {
      try? body.data(using: .utf8)?.write(to: file, options: .atomic)
    }
  }

  static func load() -> Saved? {
    guard let data = try? Data(contentsOf: file),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let q = o["queue"] as? [Any], !q.isEmpty,
          let qData = try? JSONSerialization.data(withJSONObject: q),
          let qJson = String(data: qData, encoding: .utf8) else { return nil }
    let index = min(max(0, (o["index"] as? NSNumber)?.intValue ?? 0), q.count - 1)
    return Saved(
      queueJson: qJson,
      index: index,
      positionMs: (o["positionMs"] as? NSNumber)?.doubleValue ?? 0,
      repeatMode: (o["repeat"] as? String) ?? "off"
    )
  }

  static func clear() {
    writer.async { try? FileManager.default.removeItem(at: file) }
  }
}
