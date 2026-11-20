import AVFoundation
import MediaToolbox

/// How hard the bass is hitting, for the Now Playing backdrop: BassMeter.kt, on an audio tap.
///
/// Each song's audio goes through an MTAudioProcessingTap on its way to the speaker. Every
/// buffer is measured once as it goes by (a 150 Hz Butterworth low-pass, RMS every 1/60 s,
/// scaled by the loudest it's been lately) and kept with its time in the song, so the backdrop
/// follows the playhead rather than what was decoded ahead of it. Taps work on files and plain
/// HTTP audio (not HLS), which is all Harmoni plays.
final class BassMeter {
  private static let size = 1024
  private static let cutoff = 150.0

  private let lock = NSLock()
  private var times = [Double](repeating: 0, count: size) // seconds into the song
  private var values = [Float](repeating: 0, count: size)
  private var head = 0
  private var count = 0

  // Only touched on the tap's thread.
  private var rate = 44100.0
  private var channels = 2
  private var isFloat = true
  private var interleaved = false
  private var b0 = 0.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
  private var z1 = 0.0, z2 = 0.0
  private var acc = 0.0
  private var accN = 0
  private var hop = 735
  private var peak = 0.02
  private var lastEnd = -1.0

  /// Puts a meter on `item`'s audio once its track has loaded. Main thread.
  static func attach(to item: AVPlayerItem, then: @escaping (BassMeter) -> Void) {
    item.asset.loadTracks(withMediaType: .audio) { tracks, _ in
      guard let track = tracks?.first else { return }
      DispatchQueue.main.async {
        let meter = BassMeter()
        guard let tap = meter.makeTap() else { return }
        let params = AVMutableAudioMixInputParameters(track: track)
        params.audioTapProcessor = tap
        let mix = AVMutableAudioMix()
        mix.inputParameters = [params]
        item.audioMix = mix
        then(meter)
      }
    }
  }

  private func makeTap() -> MTAudioProcessingTap? {
    var callbacks = MTAudioProcessingTapCallbacks(
      version: kMTAudioProcessingTapCallbacksVersion_0,
      clientInfo: Unmanaged.passRetained(self).toOpaque(),
      init: { _, clientInfo, storageOut in
        storageOut.pointee = clientInfo
      },
      finalize: { tap in
        Unmanaged<BassMeter>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
      },
      prepare: { tap, _, format in
        Unmanaged<BassMeter>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().prepare(format.pointee)
      },
      unprepare: nil,
      process: { tap, frames, _, bufferList, framesOut, flagsOut in
        var range = CMTimeRange()
        let status = MTAudioProcessingTapGetSourceAudio(tap, frames, bufferList, flagsOut, &range, framesOut)
        guard status == noErr else { return }
        let meter = Unmanaged<BassMeter>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
        meter.measure(UnsafeMutableAudioBufferListPointer(bufferList), frames: Int(framesOut.pointee), start: range.start)
      }
    )
    var tap: MTAudioProcessingTap?
    let err = MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap)
    if err != noErr {
      Unmanaged<BassMeter>.fromOpaque(callbacks.clientInfo!).release()
      return nil
    }
    return tap
  }

  private func prepare(_ f: AudioStreamBasicDescription) {
    if f.mSampleRate > 0 { rate = f.mSampleRate }
    channels = max(1, Int(f.mChannelsPerFrame))
    isFloat = f.mFormatFlags & kAudioFormatFlagIsFloat != 0 && f.mBitsPerChannel == 32
    interleaved = f.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
    hop = max(64, Int(rate / 60))
    let w0 = 2 * Double.pi * Self.cutoff / rate
    let alpha = sin(w0) / (2 * 0.7071)
    let c = cos(w0)
    let a0 = 1 + alpha
    b0 = (1 - c) / 2 / a0
    b1 = (1 - c) / a0
    b2 = (1 - c) / 2 / a0
    a1 = -2 * c / a0
    a2 = (1 - alpha) / a0
    reset()
  }

  private func reset() {
    z1 = 0; z2 = 0; acc = 0; accN = 0; lastEnd = -1
    lock.lock()
    head = 0
    count = 0
    lock.unlock()
  }

  private func measure(_ buffers: UnsafeMutableAudioBufferListPointer, frames: Int, start: CMTime) {
    guard isFloat, frames > 0, start.isNumeric else { return }
    let t0 = start.seconds
    // A jump (a seek): start over, like the Android sink's flush.
    if lastEnd >= 0 && abs(t0 - lastEnd) > 0.05 { reset() }
    lastEnd = t0 + Double(frames) / rate
    var frameInWindow = 0
    for i in 0..<frames {
      var x = 0.0
      if interleaved {
        guard let p = buffers.first?.mData?.assumingMemoryBound(to: Float.self) else { return }
        for ch in 0..<channels { x += Double(p[i * channels + ch]) }
        x /= Double(channels)
      } else {
        var n = 0
        for b in buffers {
          guard let p = b.mData?.assumingMemoryBound(to: Float.self) else { continue }
          x += Double(p[i])
          n += 1
        }
        if n > 0 { x /= Double(n) }
      }
      let y = b0 * x + z1
      z1 = b1 * x - a1 * y + z2
      z2 = b2 * x - a2 * y
      acc += y * y
      accN += 1
      frameInWindow += 1
      if accN >= hop {
        let rms = (acc / Double(accN)).squareRoot()
        peak = max(rms, max(0.02, peak * 0.9985))
        let t = t0 + Double(frameInWindow - accN) / rate
        push(t, Float(min(1, rms / peak)))
        acc = 0
        accN = 0
      }
    }
  }

  private func push(_ t: Double, _ v: Float) {
    lock.lock()
    times[head] = t
    values[head] = v
    head = (head + 1) % Self.size
    if count < Self.size { count += 1 }
    lock.unlock()
  }

  /// The bass for the next `n` steps of `step` seconds from `now` (seconds into the song):
  /// -1 past what's been measured yet.
  func window(from now: Double, n: Int, step: Double) -> [Double] {
    var out = [Double](repeating: 0, count: n)
    lock.lock()
    defer { lock.unlock() }
    guard count > 0 else { return out }
    var idx = (head - count + Self.size) % Self.size
    var j = 0
    for k in 0..<n {
      let t = now + Double(k) * step
      while j + 1 < count && times[(idx + 1) % Self.size] <= t {
        idx = (idx + 1) % Self.size
        j += 1
      }
      if times[idx] > t {
        out[k] = 0
      } else if t - times[idx] < 0.12 {
        out[k] = Double(values[idx])
      } else {
        out[k] = j == count - 1 ? -1 : 0
      }
    }
    return out
  }
}
