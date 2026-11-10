import Foundation
import Capacitor

/**
 * Thin Capacitor wrapper around NativeCallManager (PushKit + CallKit).
 * JS side: src/lib/native-callkit.ts. See NativeCallManager.swift for why
 * the actual PushKit registration happens at app launch
 * (AppDelegate.swift), not here in load() — and for why notifyListeners is
 * only best-effort here, not the real delivery path: real-device testing
 * found notifyListeners(..., retainUntilConsumed: true) does not reliably
 * replay an event to a listener that attaches after it fired, so
 * getPendingToken()/getPendingCallEvents() below are what JS actually
 * depends on, called once right after attaching listeners.
 */
@objc(NativeCallKitPlugin)
public class NativeCallKitPlugin: CAPPlugin {
    public override func load() {
        NativeCallManager.shared.plugin = self
    }

    // Capacitor's registration mechanism doesn't reliably load a plugin
    // that exposes zero callable methods — confirmed live: "NativeCallKit
    // plugin is not implemented on ios" from the JS side, even though this
    // class compiles and is wired into the Xcode project correctly. Same
    // placeholder Capacitor's own `npm init @capacitor/plugin` scaffold
    // ships by default — not called by anything, just needs to exist.
    @objc func echo(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func getPendingToken(_ call: CAPPluginCall) {
        let token = NativeCallManager.shared.drainPendingToken()
        call.resolve(["token": token as Any])
    }

    @objc func getPendingCallEvents(_ call: CAPPluginCall) {
        let events = NativeCallManager.shared.drainPendingCallEvents()
        call.resolve(["answered": events.answered, "declined": events.declined, "ended": events.hungUp])
    }

    // The three below keep CallKit's ring in step with answers and declines
    // that didn't come from CallKit itself — see src/lib/callkit-ring-sync.ts.
    // NativeCallManager's state lives on the main queue; plugin calls don't.
    @objc func reportCallAnswered(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("callId is required")
            return
        }
        DispatchQueue.main.async {
            NativeCallManager.shared.answerFromApp(callId: callId)
            call.resolve()
        }
    }

    @objc func endRingingCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId"),
              let reason = call.getString("reason").flatMap(NativeCallManager.RingEndReason.init(rawValue:)) else {
            call.reject("callId and a known reason are required")
            return
        }
        DispatchQueue.main.async {
            NativeCallManager.shared.endRingingFromApp(callId: callId, reason: reason)
            call.resolve()
        }
    }

    /// The page left a call answered on this device: CallKit's active call for it ends too.
    @objc func endAnsweredCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("callId is required")
            return
        }
        DispatchQueue.main.async {
            NativeCallManager.shared.endAnsweredFromApp(callId: callId)
            call.resolve()
        }
    }

    @objc func getRingingCalls(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["callIds": NativeCallManager.shared.ringingCallIds()])
        }
    }
}
