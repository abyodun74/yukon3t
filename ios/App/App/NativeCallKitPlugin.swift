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
}
