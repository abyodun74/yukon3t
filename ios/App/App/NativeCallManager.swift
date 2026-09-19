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

    // Set once by NativeCallKitPlugin.load(). Used for best-effort live
    // delivery (a listener already attached when an event fires); the
    // authoritative delivery path is the drainPending*() pull below, not
    // this reference's mere presence — see the comment on emitToken().
    var plugin: NativeCallKitPlugin?
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

    // Capacitor's own notifyListeners(..., retainUntilConsumed: true) is
    // supposed to buffer an event fired before any JS listener has attached
    // and replay it the moment one does — confirmed live, repeatedly, on a
    // real device that this does NOT work reliably in this Capacitor
    // version for this plugin (a direct notifyListeners call to an
    // *already-attached* listener delivers fine; the exact same call fired
    // *before* attachment is silently lost even once a listener attaches
    // afterward). Rather than depend on that, every emit below ALSO buffers
    // into plain Swift state here, and JS explicitly pulls it once via
    // getPendingToken()/getPendingCallEvents() right after attaching its
    // listeners (native-callkit.ts) — a plain method-call response, the one
    // delivery path proven to work regardless of attach timing.
    private func emitToken(_ token: String) {
        print("[voip-native] emitToken called, plugin attached: \(plugin != nil)")
        pendingToken = token
        plugin?.notifyListeners("voipTokenReceived", data: ["token": token])
    }

    private func emitAnswered(_ callId: String) {
        pendingAnswered.append(callId)
        plugin?.notifyListeners("callAnswered", data: ["callId": callId])
    }

    private func emitDeclined(_ callId: String) {
        pendingDeclined.append(callId)
        plugin?.notifyListeners("callDeclined", data: ["callId": callId])
    }

    /// Consumed once by NativeCallKitPlugin.getPendingToken() right after
    /// its JS side attaches a listener — covers a token that arrived before
    /// that attachment happened (the common case: PushKit fires within
    /// milliseconds of launch, well before the web page finishes loading).
    func drainPendingToken() -> String? {
        let token = pendingToken
        pendingToken = nil
        return token
    }

    /// Same idea as drainPendingToken(), for a call answered/declined via
    /// CallKit's system UI before the web page ever attached a listener —
    /// a fully realistic case, since CallKit can show and be acted on while
    /// the app is still cold-starting.
    func drainPendingCallEvents() -> (answered: [String], declined: [String]) {
        let result = (pendingAnswered, pendingDeclined)
        pendingAnswered.removeAll()
        pendingDeclined.removeAll()
        return result
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
