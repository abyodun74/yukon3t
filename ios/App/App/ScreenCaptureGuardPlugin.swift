import Foundation
import Capacitor
import UIKit

/**
 * Fires a JS "captureDetected" event when the user takes a screenshot
 * (UIApplication.userDidTakeScreenshotNotification) or starts screen
 * recording/mirroring (UIScreen.capturedDidChangeNotification, checked
 * against UIScreen.main.isCaptured) while a call is active. Started/stopped
 * around active calls only (src/lib/screen-capture-guard.ts) via
 * startWatching/stopWatching, not for the app's whole lifetime.
 *
 * Android has no equivalent for "recording" — there's no public API there
 * for detecting screen recording by another app, only a screenshot callback
 * (API 34+, see ScreenCaptureGuardPlugin.java) — so "recording" is an
 * iOS-only capture kind.
 */
@objc(ScreenCaptureGuardPlugin)
public class ScreenCaptureGuardPlugin: CAPPlugin {
    private var watching = false

    @objc func startWatching(_ call: CAPPluginCall) {
        if !watching {
            watching = true
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleScreenshot),
                name: UIApplication.userDidTakeScreenshotNotification,
                object: nil
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleScreenCaptureChanged),
                name: UIScreen.capturedDidChangeNotification,
                object: nil
            )
        }
        call.resolve()
    }

    @objc func stopWatching(_ call: CAPPluginCall) {
        if watching {
            watching = false
            NotificationCenter.default.removeObserver(self, name: UIApplication.userDidTakeScreenshotNotification, object: nil)
            NotificationCenter.default.removeObserver(self, name: UIScreen.capturedDidChangeNotification, object: nil)
        }
        call.resolve()
    }

    @objc private func handleScreenshot() {
        notifyListeners("captureDetected", data: ["kind": "screenshot"])
    }

    @objc private func handleScreenCaptureChanged() {
        // capturedDidChangeNotification fires on both the start AND end of
        // recording/mirroring — only the transition into isCaptured==true is
        // worth alerting on, the other direction is just "it stopped".
        if UIScreen.main.isCaptured {
            notifyListeners("captureDetected", data: ["kind": "recording"])
        }
    }
}
