import ExpoModulesCore
import UIKit

/// Hands iOS's "your background downloads finished" wake-up to Downloads.
public final class HarmoniAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    // Expo waits for every subscriber to call back, so answer for other sessions too.
    guard identifier == "com.ceccun.harmoni.downloads" else { completionHandler(); return }
    DispatchQueue.main.async {
      Downloads.shared.handleBackgroundEvents(completionHandler)
    }
  }
}
