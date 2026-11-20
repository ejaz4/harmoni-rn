import AVFoundation
import MediaPlayer
import UIKit

/// The app's audio session: playback that goes on with the screen off and the silent switch on.
enum AudioSession {
  private static var configured = false
  /// An interruption (a call, Siri) paused us; play again when it ends if iOS says so.
  private static var resumeAfterInterruption = false

  static func configure() {
    guard !configured else { return }
    configured = true
    let s = AVAudioSession.sharedInstance()
    applyCategory()
    let nc = NotificationCenter.default
    nc.addObserver(forName: AVAudioSession.interruptionNotification, object: s, queue: .main) { note in
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
      let p = Player.shared
      switch type {
      case .began:
        resumeAfterInterruption = p.playWhenReady
        if p.playWhenReady { p.pauseNow() }
      case .ended:
        let raw = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
        let opts = AVAudioSession.InterruptionOptions(rawValue: raw)
        if resumeAfterInterruption && opts.contains(.shouldResume) { p.play() }
        resumeAfterInterruption = false
      @unknown default:
        break
      }
    }
    // Headphones out (or Bluetooth gone): pause, like Android's "audio becoming noisy".
    nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: s, queue: .main) { note in
      guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
      if Player.shared.playWhenReady { Player.shared.pauseNow() }
    }
  }

  /// Music, or (Play alongside other apps) music that mixes with other apps' sound instead of
  /// stopping it. iOS doesn't give a mixing app the lock screen's controls.
  static func applyCategory() {
    let s = AVAudioSession.sharedInstance()
    do {
      if Prefs.playAlongside {
        try s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      } else {
        try s.setCategory(.playback, mode: .default, policy: .longFormAudio)
      }
    } catch {
      NSLog("HarmoniPlayer: audio session category failed: \(error)")
    }
  }

  static func activate() {
    configure()
    do {
      try AVAudioSession.sharedInstance().setActive(true)
    } catch {
      NSLog("HarmoniPlayer: audio session activation failed: \(error)")
    }
  }
}

/// The lock screen, Control Center, headphones and car: what's playing and the buttons for it.
final class NowPlaying {
  static let shared = NowPlaying()

  private var artworkUrl: String?
  private var artwork: MPMediaItemArtwork?
  private var started = false

  /// Registers the remote commands. Main thread.
  func start() {
    guard !started else { return }
    started = true
    let c = MPRemoteCommandCenter.shared()
    let p = Player.shared
    // While another device plays (Harmoni Link), the buttons become Link commands for JS.
    c.playCommand.addTarget { [weak self] _ in
      if let self, self.remote != nil { self.remoteToggle(to: true) } else { p.play() }
      return .success
    }
    c.pauseCommand.addTarget { [weak self] _ in
      if let self, self.remote != nil { self.remoteToggle(to: false) } else { p.pause() }
      return .success
    }
    c.togglePlayPauseCommand.addTarget { [weak self] _ in
      if let self, let r = self.remote {
        self.remoteToggle(to: !r.playing)
      } else if p.playWhenReady {
        p.pause()
      } else {
        p.play()
      }
      return .success
    }
    c.nextTrackCommand.addTarget { [weak self] _ in
      if let self, self.remote != nil { self.send(["type": "next"]) } else { p.next() }
      return .success
    }
    c.previousTrackCommand.addTarget { [weak self] _ in
      if let self, self.remote != nil { self.send(["type": "prev"]) } else { p.prev(restartAfterMs: 3000) }
      return .success
    }
    c.changePlaybackPositionCommand.addTarget { [weak self] e in
      guard let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      let ms = max(0, e.positionTime * 1000)
      if let self, self.remote != nil {
        self.remote?.positionMs = ms
        self.remote?.at = CACurrentMediaTime()
        self.send(["type": "seek", "positionMs": ms])
        self.update()
      } else {
        p.seek(to: ms)
      }
      return .success
    }
    c.likeCommand.localizedTitle = "Like"
    c.likeCommand.addTarget { [weak self] _ in
      guard let id = self?.shown?.id else { return .noActionableNowPlayingItem }
      Core.toggleLikeRemotely(id)
      return .success
    }
    c.skipForwardCommand.isEnabled = false
    c.skipBackwardCommand.isEnabled = false
    c.dislikeCommand.isEnabled = false
    c.bookmarkCommand.isEnabled = false
    update()
  }

  // MARK: - Harmoni Link: another device playing

  /// What another device on the account is playing (RemotePlayer.kt's state).
  struct Remote {
    var deviceId: String
    var deviceName: String
    var queue: [Entry]
    var index: Int
    var playing: Bool
    var positionMs: Double
    var durationMs: Double
    /// When positionMs was true (it runs on while playing).
    var at: CFTimeInterval

    var current: Entry? { queue.indices.contains(index) ? queue[index] : nil }
    var positionNow: Double { playing ? positionMs + (CACurrentMediaTime() - at) * 1000 : positionMs }
  }

  private(set) var remote: Remote?
  /// Link commands for JS (onRemoteCommand).
  var onRemoteCommand: (([String: Any?]) -> Void)?

  /// The song the lock screen shows: the other device's, or this phone's.
  var shown: Entry? { remote?.current ?? Player.shared.current }

  /// Another device is playing (JSON from src/player/remoteSession.ts), or not (nil). Main thread.
  func setRemote(_ json: String?) {
    guard let json, let o = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else {
      if remote != nil {
        remote = nil
        update()
      }
      return
    }
    // The queue only comes when it changed; otherwise keep the last one.
    let queue: [Entry]
    if let q = o["queue"] as? [Any] {
      queue = q.compactMap { ($0 as? [String: Any]).flatMap(Entry.init) }
    } else {
      queue = remote?.queue ?? []
    }
    let num = { (k: String) in (o[k] as? NSNumber)?.doubleValue ?? 0 }
    let wasRemote = remote != nil
    remote = Remote(
      deviceId: (o["deviceId"] as? String) ?? "",
      deviceName: (o["deviceName"] as? String) ?? "another device",
      queue: queue,
      index: min(max(0, Int(num("index"))), max(0, queue.count - 1)),
      playing: (o["playing"] as? Bool) ?? false,
      positionMs: max(0, num("positionMs")),
      durationMs: num("durationMs"),
      at: CACurrentMediaTime()
    )
    // As on Android: this phone stops playing while the other device has the music.
    if !wasRemote && Player.shared.playWhenReady { Player.shared.pause() }
    update()
  }

  /// Optimistic: show it straight away; the next Link state confirms or corrects it.
  private func remoteToggle(to playing: Bool) {
    guard var r = remote, r.playing != playing else { return }
    r.positionMs = r.positionNow
    r.at = CACurrentMediaTime()
    r.playing = playing
    remote = r
    send(["type": "toggle"])
    update()
  }

  private func send(_ command: [String: Any?]) {
    onRemoteCommand?(command)
  }

  /// Shows the current song (this phone's or the other device's) and where it is. Main thread;
  /// cheap enough to call on every change.
  func update() {
    let p = Player.shared
    let center = MPNowPlayingInfoCenter.default()
    let c = MPRemoteCommandCenter.shared()
    guard let e = shown else {
      center.nowPlayingInfo = nil
      center.playbackState = .stopped
      return
    }
    let playing: Bool
    let positionMs: Double
    let durationMs: Double?
    let artist: String
    if let r = remote {
      playing = r.playing
      positionMs = r.positionNow
      durationMs = r.durationMs > 0 ? r.durationMs : e.durationMs
      artist = e.artist.isEmpty ? "On \(r.deviceName)" : "\(e.artist) · on \(r.deviceName)"
      c.nextTrackCommand.isEnabled = true
    } else {
      playing = p.isPlaying
      positionMs = p.positionMs
      durationMs = p.durationMs
      artist = e.artist
      c.nextTrackCommand.isEnabled = p.hasNext || p.queue.count > 1
    }
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: e.title,
      MPMediaItemPropertyArtist: artist,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: positionMs / 1000,
      MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if remote == nil {
      info[MPNowPlayingInfoPropertyPlaybackQueueIndex] = max(0, p.index)
      info[MPNowPlayingInfoPropertyPlaybackQueueCount] = p.queue.count
    }
    if let album = e.album { info[MPMediaItemPropertyAlbumTitle] = album }
    if let d = durationMs { info[MPMediaItemPropertyPlaybackDuration] = d / 1000 }
    if e.artworkUrl == artworkUrl, let artwork { info[MPMediaItemPropertyArtwork] = artwork }
    center.nowPlayingInfo = info
    center.playbackState = playing ? .playing : .paused
    c.likeCommand.isEnabled = Prefs.mediaHeart
    c.likeCommand.isActive = Core.isLiked(e.id)
    if e.artworkUrl != artworkUrl { loadArtwork(e.artworkUrl) }
  }

  private func loadArtwork(_ url: String?) {
    artworkUrl = url
    artwork = nil
    guard let url, let u = URL(string: Core.sizedArtwork(url, 600)) else { return }
    URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
      guard let data, let image = UIImage(data: data) else { return }
      DispatchQueue.main.async {
        guard let self, self.artworkUrl == url else { return }
        self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        self.update()
      }
    }.resume()
  }
}

/// The tick that drives the playhead, play reports and the JS side's timers (src/lib/heartbeat.ts):
/// every 0.5 s while playing, 1 s with the app open, 5 s otherwise. iOS suspends the app in the
/// background unless audio is playing, so in practice it ticks while playing or open.
final class Heartbeat {
  static let shared = Heartbeat()

  /// The module sends these on to JS.
  var onTick: (() -> Void)?
  private var timer: Timer?
  private var foreground = true
  private var refreshing = false

  init() {
    let nc = NotificationCenter.default
    nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.foreground = true
      self?.reschedule()
    }
    nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.foreground = false
      self?.reschedule()
    }
  }

  /// Main thread.
  func reschedule() {
    timer?.invalidate()
    let interval: TimeInterval = Player.shared.isPlaying ? 0.5 : ((foreground || Downloads.shared.isDownloading) ? 1 : 5)
    timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
      self?.fire()
    }
  }

  private func fire() {
    Player.shared.tickWhilePlaying()
    onTick?()
    keepTokenFresh()
    reschedule()
  }

  /// Songs are requested with the token the player has at hand (it can't wait for a refresh on
  /// main), so refresh it in the background well before it runs out.
  private func keepTokenFresh() {
    // Only the peeked copy here: get() could wait behind a refresh holding the lock.
    guard !refreshing, AuthStore.shared.expiresWithin(5 * 60_000) else { return }
    refreshing = true
    DispatchQueue.global(qos: .utility).async { [weak self] in
      _ = AuthStore.shared.freshToken(minValidMs: 5 * 60_000)
      DispatchQueue.main.async { self?.refreshing = false }
    }
  }
}
