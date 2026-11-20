import Foundation

/// Settings picked in the app that the player and downloads need natively: Prefs.kt, with the
/// same keys and defaults.
///
/// On iOS: `wifiOnlyDownloads` keeps downloads off mobile data and hotspots, `playAlongside`
/// mixes with other apps' audio, `mediaHeart` shows the like button on the lock screen.
/// `skipSilence` and `stopOnSwipe` are kept but do nothing here (AVPlayer can't skip silence;
/// iOS always stops an app's music when it's swiped away), and Settings hides them.
enum Prefs {
  static let defaults: [String: Bool] = [
    "wifiOnlyDownloads": true,
    "skipSilence": false,
    "playAlongside": false,
    "stopOnSwipe": false,
    "mediaHeart": true,
  ]

  private static let store = UserDefaults(suiteName: "harmoni.settings") ?? .standard

  static func get(_ key: String) -> Bool {
    (store.object(forKey: key) as? Bool) ?? defaults[key] ?? false
  }

  static func set(_ key: String, _ on: Bool) {
    store.set(on, forKey: key)
  }

  static var wifiOnlyDownloads: Bool { Prefs.get("wifiOnlyDownloads") }
  static var playAlongside: Bool { Prefs.get("playAlongside") }
  static var mediaHeart: Bool { Prefs.get("mediaHeart") }
}
