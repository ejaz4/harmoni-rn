import ExpoModulesCore
import Network

/// The iOS side of modules/harmoni-player. Same name, functions and events as the Android
/// module (HarmoniPlayerModule.kt), so JS runs unchanged.
///
/// - AuthStore: the session (Keychain, refresh).
/// - Player: the queue, gapless, repeat, crossfade, the sleep timer's pause at the end of a
///   song, listen reports, and the bass meter (BassMeter, an audio tap).
/// - NowPlaying: the lock screen and remote controls, including Harmoni Link (another device's
///   song, controlled from here); also the audio session and the tick JS's timers run on.
/// - Downloads: a background URLSession, files played from disk.
/// - Artwork: colours from covers.
/// Android-only things (the self-updater, link settings, equalizer, widget pinning, the output
/// switcher) answer "not here" for good.
public final class HarmoniPlayerModule: Module {
  private let pathMonitor = NWPathMonitor()
  private var expensive = false

  public func definition() -> ModuleDefinition {
    Name("HarmoniPlayer")

    Events(
      "onState", "onTick", "onTransition", "onTimeline", "onListen", "onPlayed",
      "onError", "onRemoteLike", "onDownload", "onSignedOut", "onRemoteCommand", "onSystemTransfer", "onUpdate"
    )

    OnCreate {
      AuthStore.shared.onSignedOut = { [weak self] in
        self?.sendEvent("onSignedOut", [:])
      }
      self.pathMonitor.pathUpdateHandler = { [weak self] path in
        self?.expensive = path.isExpensive || path.isConstrained
      }
      self.pathMonitor.start(queue: DispatchQueue.global(qos: .utility))

      DispatchQueue.main.async { [weak self] in
        let player = Player.shared
        player.emit = { name, body in self?.sendEvent(name, body) }
        player.onChange = { NowPlaying.shared.update() }
        Core.onLikedChanged = { id, liked in
          NowPlaying.shared.update()
          self?.sendEvent("onRemoteLike", ["songId": id, "liked": liked])
        }
        Heartbeat.shared.onTick = { Player.shared.emitTick() }
        Downloads.shared.emit = { body in self?.sendEvent("onDownload", body) }
        NowPlaying.shared.onRemoteCommand = { body in self?.sendEvent("onRemoteCommand", body) }
        Downloads.shared.start()
        AudioSession.configure()
        NowPlaying.shared.start()
        Heartbeat.shared.reschedule()
        player.emitState()
      }
    }

    OnDestroy {
      self.pathMonitor.cancel()
      DispatchQueue.main.async {
        Player.shared.emit = nil
        Heartbeat.shared.onTick = nil
        Downloads.shared.emit = nil
        Core.onLikedChanged = nil
      }
    }

    // --- session ---

    Function("getSession") { () -> [String: String]? in
      guard let s = AuthStore.shared.get() else { return nil }
      return ["server": s.server, "issuer": s.issuer, "apiBase": s.apiBase, "clientId": s.clientId]
    }

    AsyncFunction("setSession") { (json: String) in
      AuthStore.shared.set(try AuthStore.Session.from(json: json))
    }

    AsyncFunction("getAccessToken") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(AuthStore.shared.freshToken())
      }
    }

    AsyncFunction("refreshAccessToken") { (failed: String?, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(AuthStore.shared.refreshAfter(failed))
      }
    }

    AsyncFunction("signOut") { (promise: Promise) in
      Player.shared.stop()
      QueueStore.clear()
      Core.setLiked([])
      Downloads.shared.removeAll()
      DispatchQueue.global(qos: .userInitiated).async {
        AuthStore.shared.revoke()
        promise.resolve(nil)
      }
    }.runOnQueue(.main)

    // --- playback ---

    Function("getState") { () -> [String: Any] in Player.shared.snapshot }

    AsyncFunction("getQueue") { () -> [String: Any]? in
      let p = Player.shared
      if !p.queue.isEmpty {
        return ["queue": Entry.json(p.queue), "index": p.index, "positionMs": p.positionMs, "live": true]
      }
      guard let saved = QueueStore.load() else { return nil }
      return ["queue": saved.queueJson, "index": saved.index, "positionMs": saved.positionMs, "live": false]
    }.runOnQueue(.main)

    AsyncFunction("setQueue") { (json: String, index: Int, positionMs: Double, play: Bool) in
      Player.shared.setQueue(json, index: index, positionMs: positionMs, play: play)
    }.runOnQueue(.main)

    AsyncFunction("replaceAround") { (json: String, index: Int) in
      Player.shared.replaceAround(json, index: index)
    }.runOnQueue(.main)

    AsyncFunction("insert") { (index: Int, json: String) in
      Player.shared.insert(at: index, json)
    }.runOnQueue(.main)

    AsyncFunction("removeAt") { (index: Int) in
      Player.shared.removeRange(index, index + 1)
    }.runOnQueue(.main)

    AsyncFunction("removeRange") { (from: Int, to: Int) in
      Player.shared.removeRange(from, to)
    }.runOnQueue(.main)

    AsyncFunction("move") { (from: Int, to: Int) in
      Player.shared.move(from, to)
    }.runOnQueue(.main)

    AsyncFunction("play") { Player.shared.play() }.runOnQueue(.main)
    AsyncFunction("pause") { Player.shared.pause() }.runOnQueue(.main)
    AsyncFunction("seekTo") { (ms: Double) in Player.shared.seek(to: ms) }.runOnQueue(.main)
    AsyncFunction("skipTo") { (index: Int, positionMs: Double) in
      Player.shared.skip(to: index, positionMs: positionMs)
    }.runOnQueue(.main)
    AsyncFunction("next") { Player.shared.next() }.runOnQueue(.main)
    AsyncFunction("prev") { (restartAfterMs: Double) in
      Player.shared.prev(restartAfterMs: restartAfterMs)
    }.runOnQueue(.main)
    AsyncFunction("setRepeat") { (mode: String) in Player.shared.setRepeat(mode) }.runOnQueue(.main)
    AsyncFunction("setVolume") { (volume: Double) in Player.shared.setVolume(volume) }.runOnQueue(.main)
    AsyncFunction("stop") { Player.shared.stop() }.runOnQueue(.main)
    AsyncFunction("retry") { Player.shared.retry() }.runOnQueue(.main)
    AsyncFunction("pauseAtEndOfSong") { (on: Bool) in Player.shared.pauseAtEnd = on }.runOnQueue(.main)

    Function("setSmooth") { (on: Bool) in
      DispatchQueue.main.async { Player.shared.smooth = on }
    }

    // Settings the player and downloads need natively (Prefs): read, and set (applied at once).
    Function("getPref") { (key: String) -> Bool in Prefs.get(key) }

    Function("setPref") { (key: String, on: Bool) in
      Prefs.set(key, on)
      DispatchQueue.main.async {
        switch key {
        case "playAlongside": AudioSession.applyCategory()
        case "mediaHeart": NowPlaying.shared.update()
        default: break // wifiOnlyDownloads: read when each download starts
        }
      }
    }

    Function("setCrossfade") { (seconds: Double) in
      let ms = min(max(0, seconds), 12) * 1000
      DispatchQueue.main.async { Player.shared.crossfadeMs = ms }
    }

    // 0..1, how hard the bass is hitting in what's coming out of the speaker now.
    Function("bass") { () -> Double in max(0, Player.shared.bassWindow(1)[0]) }

    // The next `n` frames of bass (1/60 s apart) from now, for the UI thread to play out.
    Function("bassWindow") { (n: Int) -> [Double] in Player.shared.bassWindow(n) }

    // --- Harmoni Link in the system controls ---

    /// Another device is playing (JSON) or not (null): what the lock screen shows and controls.
    AsyncFunction("setRemote") { (json: String?) in NowPlaying.shared.setRemote(json) }.runOnQueue(.main)

    // Android lists Link devices in its output switcher; iOS has no way for an app to add
    // devices to the AirPlay picker, so there's nothing to do with them here.
    Function("setLinkDevices") { (_: String, _: String?, _: Double) in }

    // --- likes (the lock screen's heart) ---

    Function("setLikedIds") { (json: String) in
      let ids = ((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String]) ?? []
      Core.setLiked(ids)
      DispatchQueue.main.async { NowPlaying.shared.update() }
    }

    Function("setLiked") { (id: String, liked: Bool) in
      Core.setLiked(id, liked)
      DispatchQueue.main.async { NowPlaying.shared.update() }
    }

    // --- downloads ---

    AsyncFunction("download") { (json: String) in Downloads.shared.add(json) }.runOnQueue(.main)
    AsyncFunction("prioritizeDownloads") { (json: String) in Downloads.shared.prioritize(json) }.runOnQueue(.main)
    AsyncFunction("removeDownload") { (id: String) in Downloads.shared.remove([id]) }.runOnQueue(.main)
    AsyncFunction("removeDownloads") { (json: String) in
      Downloads.shared.remove(((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String]) ?? [])
    }.runOnQueue(.main)
    AsyncFunction("removeAllDownloads") { Downloads.shared.removeAll() }.runOnQueue(.main)
    AsyncFunction("getDownloads") { () -> String in Downloads.shared.allJson() }.runOnQueue(.main)
    AsyncFunction("getDownloadSize") { () -> Double in Downloads.shared.size() }.runOnQueue(.main)

    AsyncFunction("getArtworkColors") { (url: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(Artwork.colors(url))
      }
    }

    // --- Android-only: never on iOS ---

    Function("linksEnabled") { () -> Bool in true } // Universal Links need no switch
    Function("openLinkSettings") { () -> Bool in false }
    Function("updateState") { () -> [String: Any] in ["state": "idle"] }
    Function("updateReady") { (_: String) -> String? in nil }
    Function("downloadUpdate") { (_: String, _: String, _: String?, _: Double) in }
    Function("cancelUpdate") {}
    Function("canInstallUpdates") { () -> Bool in false }
    Function("openInstallPermission") { () -> Bool in false }
    AsyncFunction("installUpdate") { (_: String, _: String) -> String in "failed" }
    Function("takeUpdated") { () -> String? in nil }
    Function("installer") { () -> String? in nil }
    Function("networkMetered") { () -> Bool in self.expensive }
    Function("hasEqualizer") { () -> Bool in false }
    AsyncFunction("openEqualizer") { () -> Bool in false }
    Function("canPinWidget") { () -> Bool in false }
    Function("hasWidget") { () -> Bool in false }
    AsyncFunction("pinWidget") { () -> Bool in false }
  }
}
