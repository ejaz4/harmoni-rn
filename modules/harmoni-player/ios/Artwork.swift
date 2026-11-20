import CoreGraphics
import Foundation
import ImageIO

/// Colours from a cover, for the Now Playing backdrop and the coloured cards: what
/// getArtworkColors does with Palette on Android.
///
/// `color`, `deep` and `light` are the web's colour (a saturation-weighted mean of a 24×24
/// thumbnail), computed the same way. Of Palette's swatches only `dominant` and `vibrant`
/// are filled in (the most common colour, and the most common lively one); the app doesn't
/// read the others.
enum Artwork {
  /// Blocking; never on main.
  static func colors(_ urlString: String) -> [String: Any]? {
    guard let url = URL(string: urlString) else { return nil }
    var req = URLRequest(url: url, timeoutInterval: 15)
    req.setValue(Core.userAgent, forHTTPHeaderField: "User-Agent")
    let (code, data) = Core.send(req)
    guard (200..<300).contains(code),
          let src = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }

    // The web's colour.
    guard let small = pixels(image, 24) else { return nil }
    var rs = 0.0, gs = 0.0, bs = 0.0, ws = 0.0
    for p in small {
      let mx = max(p.r, p.g, p.b), mn = min(p.r, p.g, p.b)
      let sat = mx == 0 ? 0 : Double(mx - mn) / Double(mx)
      let w = 0.15 + sat * sat
      rs += Double(p.r) * w; gs += Double(p.g) * w; bs += Double(p.b) * w; ws += w
    }
    let mr = Int((rs / ws).rounded()), mg = Int((gs / ws).rounded()), mb = Int((bs / ws).rounded())
    func lin(_ v: Int) -> Double {
      let c = Double(v) / 255
      return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }
    let lum = 0.2126 * lin(mr) + 0.7152 * lin(mg) + 0.0722 * lin(mb)

    // Swatches: a 4-bit-per-channel histogram of a 64×64 thumbnail.
    var dominant: String? = nil
    var vibrant: String? = nil
    if let px = pixels(image, 64) {
      var counts: [Int: (n: Int, r: Int, g: Int, b: Int)] = [:]
      for p in px {
        let key = (Int(p.r) >> 4) << 8 | (Int(p.g) >> 4) << 4 | (Int(p.b) >> 4)
        let c = counts[key] ?? (0, 0, 0, 0)
        counts[key] = (c.n + 1, c.r + Int(p.r), c.g + Int(p.g), c.b + Int(p.b))
      }
      func mean(_ c: (n: Int, r: Int, g: Int, b: Int)) -> (Int, Int, Int) { (c.r / c.n, c.g / c.n, c.b / c.n) }
      if let top = counts.values.max(by: { $0.n < $1.n }) {
        let (r, g, b) = mean(top)
        dominant = hex(r, g, b)
      }
      // Lively: saturated, not too dark or too light, and not a speck.
      let floor = max(1, px.count / 200)
      let lively = counts.values.filter { c in
        let (r, g, b) = mean(c)
        let mx = max(r, g, b), mn = min(r, g, b)
        let sat = mx == 0 ? 0 : Double(mx - mn) / Double(mx)
        return c.n >= floor && sat > 0.35 && mx > 80 && mx < 245
      }
      if let best = lively.max(by: { score($0) < score($1) }) {
        let (r, g, b) = mean(best)
        vibrant = hex(r, g, b)
      }
    }

    return [
      "color": hex(mr, mg, mb),
      "deep": hex(Int(Double(mr) * 0.38 + 14), Int(Double(mg) * 0.38 + 14), Int(Double(mb) * 0.38 + 14)),
      "light": lum > 0.4,
      "dominant": dominant ?? NSNull(),
      "vibrant": vibrant ?? NSNull(),
      "darkVibrant": NSNull(),
      "lightVibrant": NSNull(),
      "muted": NSNull(),
      "darkMuted": NSNull(),
      "lightMuted": NSNull(),
    ]
  }

  private static func score(_ c: (n: Int, r: Int, g: Int, b: Int)) -> Double {
    let r = c.r / c.n, g = c.g / c.n, b = c.b / c.n
    let mx = max(r, g, b), mn = min(r, g, b)
    let sat = mx == 0 ? 0 : Double(mx - mn) / Double(mx)
    return Double(c.n) * sat * sat
  }

  private struct Pixel { let r: UInt8; let g: UInt8; let b: UInt8 }

  /// The image scaled to size×size, as RGB pixels.
  private static func pixels(_ image: CGImage, _ size: Int) -> [Pixel]? {
    var buf = [UInt8](repeating: 0, count: size * size * 4)
    let ok: Bool = buf.withUnsafeMutableBytes { raw in
      guard let ctx = CGContext(
        data: raw.baseAddress, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
      ) else { return false }
      ctx.interpolationQuality = .medium
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
      return true
    }
    guard ok else { return nil }
    return stride(from: 0, to: buf.count, by: 4).map { Pixel(r: buf[$0], g: buf[$0 + 1], b: buf[$0 + 2]) }
  }

  private static func hex(_ r: Int, _ g: Int, _ b: Int) -> String {
    String(format: "#%02X%02X%02X", min(255, max(0, r)), min(255, max(0, g)), min(255, max(0, b)))
  }
}
