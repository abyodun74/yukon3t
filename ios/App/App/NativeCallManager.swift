import Foundation
import PushKit
import CallKit

/**
 * Owns PushKit registration and the CXProvider for the whole app lifetime —
 * started from AppDelegate.didFinishLaunchingWithOptions, not lazily by
 * NativeCallKitPlugin. This matters: a VoIP push arriving while the app is
 * fully terminated relies on PKPushRegistry's delegate already being set
 * *before* iOS finishes (re)launching the process to deliver it, which is
 * well before Capacitor's bridge/webview — and so NativeCallKitPlugin's own
 * load() — exists yet.
 *
 * Server side: src/lib/apns-voip.ts sends the VoIP push directly to APNs
 * (Firebase's send API has no way to set the "voip" push type PushKit
 * requires); src/app/actions/calls.ts's startCall triggers it, alongside
 * the existing web-push/FCM paths.
 */
final class NativeCallManager: NSObject {
    static let shared = NativeCallManager()

    private var pushRegistry: PKPushRegistry?
    private let provider: CXProvider

    // Capacitor loads/instantiates plugins lazily on first JS use — by the
    // time NativeCallKitPlugin.load() runs and sets this, a token or call
    // action may already have fired. Buffered and replayed the moment the
    // plugin actually attaches, the same "retain and replay" pattern
    // @capacitor-firebase/messaging already uses for a notification tap
    // that happens before its JS listener attaches (see capacitor-bridge.tsx).
    //
    // Deliberately a STRONG reference, not weak — Capacitor's own bridge is
    // supposed to keep this instance alive for the app's lifetime once
    // loaded (CapacitorBridge.swift stores it in its own `plugins`
    // dictionary), but confirmed live that the token still wasn't reaching
    // JS even after load() printed successfully; ruling out this instance
    // being deallocated between load() and Capacitor actually registering
    // the JS-side listener on it is a cheap, safe thing to eliminate first.
    var plugin: NativeCallKitPlugin? {
        didSet { flushPending() }
    }
    private var pendingToken: String?
    private var pendingAnswered: [String] = []
    private var pendingDeclined: [String] = []

    // CallKit only gives delegate callbacks a CallKit-generated UUID back —
    // this is what maps one back to this app's own callId.
    private var activeCalls: [UUID: String] = [:]

    private override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallsPerCallGroup = 1
        config.maximumCallGroups = 1
        config.supportedHandleTypes = [.generic]
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    /** Idempotent — safe to call every launch. */
    func start() {
        print("[voip-native] start() called")
        guard pushRegistry == nil else {
            print("[voip-native] start() skipped — already started")
            return
        }
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        pushRegistry = registry
        print("[voip-native] PKPushRegistry created, desiredPushTypes set to voIP")
    }

    // retainUntilConsumed: true on every notifyListeners call below is load
    // bearing, not optional — Capacitor lazily creates the plugin instance
    // (running load(), which sets `plugin` here via the didSet above) as
    // *part of* handling the JS side's very first addListener() call, before
    // that call has finished registering its own callback with the bridge.
    // Without retention, a notifyListeners() fired synchronously from
    // load()'s flushPending() has no listener attached yet and is silently
    // dropped — confirmed live: the token reached PushKit and was buffered
    // here, but registerVoipToken() on the JS side never ran, because this
    // very case is exactly what happened without the flag.
    private func flushPending() {
        print("[voip-native] flushPending called, plugin: \(plugin != nil), pendingToken: \(pendingToken != nil)")
        guard let plugin = plugin else { return }
        if let token = pendingToken {
            print("[voip-native] flushPending calling notifyListeners with token")
            plugin.notifyListeners("voipTokenReceived", data: ["token": token], retainUntilConsumed: true)
            pendingToken = nil
        }
        pendingAnswered.forEach { plugin.notifyListeners("callAnswered", data: ["callId": $0], retainUntilConsumed: true) }
        pendingDeclined.forEach { plugin.notifyListeners("callDeclined", data: ["callId": $0], retainUntilConsumed: true) }
        pendingAnswered.removeAll()
        pendingDeclined.removeAll()
    }

    private func emitToken(_ token: String) {
        print("[voip-native] emitToken called, plugin attached: \(plugin != nil)")
        if let plugin = plugin {
            plugin.notifyListeners("voipTokenReceived", data: ["token": token], retainUntilConsumed: true)
        } else {
            pendingToken = token
        }
    }

    private func emitAnswered(_ callId: String) {
        if let plugin = plugin {
            plugin.notifyListeners("callAnswered", data: ["callId": callId], retainUntilConsumed: true)
        } else {
            pendingAnswered.append(callId)
        }
    }

    private func emitDeclined(_ callId: String) {
        if let plugin = plugin {
            plugin.notifyListeners("callDeclined", data: ["callId": callId], retainUntilConsumed: true)
        } else {
            pendingDeclined.append(callId)
        }
    }

    /// Dismisses a still-ringing CallKit UI — sent when the caller hangs up
    /// (or the call otherwise stops ringing) before this device answers.
    /// See sendVoipCallCancelToUser in src/lib/apns-voip.ts.
    private func endReportedCall(callId: String) {
        guard let uuid = activeCalls.first(where: { $0.value == callId })?.key else { return }
        provider.reportCall(with: uuid, endedAt: Date(), reason: .unanswered)
        activeCalls.removeValue(forKey: uuid)
    }
}

extension NativeCallManager: PKPushRegistryDelegate {
    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        print("[voip-native] didUpdate pushCredentials called, type: \(type.rawValue)")
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        print("[voip-native] got token, length: \(token.count)")
        emitToken(token)
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        print("[voip-native] didInvalidatePushTokenFor called, type: \(type.rawValue)")
        // Nothing actionable client-side — the server prunes a dead token
        // itself the next time a send to it fails (see apns-voip.ts).
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }
        let dict = payload.dictionaryPayload
        guard let callId = dict["callId"] as? String else {
            completion()
            return
        }
        let messageType = dict["type"] as? String ?? "incoming_call"

        if messageType == "call_cancelled" {
            endReportedCall(callId: callId)
            completion()
            return
        }

        let callerName = dict["callerName"] as? String ?? "Someone"
        let callType = dict["callType"] as? String ?? "AUDIO"

        // Apple requires reportNewIncomingCall to be called once, for every
        // VoIP push received, before this completion handler runs — skip
        // it (or take too long) and repeated offenses get this app's VoIP
        // entitlement revoked.
        let uuid = UUID()
        activeCalls[uuid] = callId
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.hasVideo = callType == "VIDEO"
        update.localizedCallerName = callerName
        provider.reportNewIncomingCall(with: uuid, update: update) { _ in
            completion()
        }
    }
}

extension NativeCallManager: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        activeCalls.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        // Answering brings the app to the foreground as standard CallKit
        // behavior — nothing extra to do here beyond routing the outcome
        // into the same respondToCall flow the in-app Accept button uses
        // (see incoming-call-listener.tsx's "callAnswered" listener). The
        // actual call itself plays out entirely inside the web app's Daily
        // iframe/WebRTC once it foregrounds — this doesn't keep a
        // persistent native in-call CallKit screen (no green-bar/Dynamic-
        // Island "return to call"); the existing in-app hang-up button
        // covers ending it.
        if let callId = activeCalls[action.uuid] {
            emitAnswered(callId)
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        // Only reachable pre-answer (declining the system ringing screen) —
        // see the note above on why there's no ongoing CallKit session to
        // end once a call is answered.
        if let callId = activeCalls[action.uuid] {
            emitDeclined(callId)
        }
        activeCalls.removeValue(forKey: action.uuid)
        action.fulfill()
    }
}
