import Foundation
import Capacitor

/**
 * Thin Capacitor wrapper around NativeCallManager (PushKit + CallKit) —
 * exposes no callable methods of its own, since everything here is
 * push/system-UI-driven, not JS-initiated. JS side: src/lib/native-callkit.ts.
 * See NativeCallManager.swift for why the actual PushKit registration
 * happens at app launch (AppDelegate.swift), not here in load().
 */
@objc(NativeCallKitPlugin)
public class NativeCallKitPlugin: CAPPlugin {
    public override func load() {
        print("[voip-native] NativeCallKitPlugin.load() called")
        NativeCallManager.shared.plugin = self
    }

    // Capacitor's registration mechanism doesn't reliably load a plugin
    // that exposes zero callable methods — confirmed live: "NativeCallKit
    // plugin is not implemented on ios" from the JS side, even though this
    // class compiles and is wired into the Xcode project correctly, with a
    // plugin that (deliberately) only ever emits events otherwise. Same
    // placeholder Capacitor's own `npm init @capacitor/plugin` scaffold
    // ships by default — not called by anything, just needs to exist.
    @objc func echo(_ call: CAPPluginCall) {
        // TEMPORARY: also fires a test event with no retention involved at
        // all, to isolate whether notifyListeners works for this plugin at
        // the most basic level (a listener that's definitely already
        // attached) versus something specific to the retain-before-attach
        // path NativeCallManager actually relies on. Remove once resolved.
        print("[voip-native] echo called, firing test notifyListeners")
        notifyListeners("voipTokenReceived", data: ["token": "test-echo-token"])
        call.resolve()
    }
}
