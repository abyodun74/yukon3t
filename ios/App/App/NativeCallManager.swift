import Foundation
import PushKit
import CallKit
import AVFoundation
import UIKit
import WebKit

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
    // Main queue, like the provider delegate and PushKit: every piece of
    // state below is only touched there.
    private let callController = CXCallController()

    // Set once by NativeCallKitPlugin.load(). Used for best-effort live
    // delivery (a listener already attached when an event fires); the
    // authoritative delivery path is the drainPending*() pull below, not
    // this reference's mere presence — see the comment on emitToken().
    var plugin: NativeCallKitPlugin?
    private var pendingToken: String?
    // The current PushKit token, kept (unlike pendingToken, which JS drains) so a native hang-up report can name this
    // iPhone to the server: endCall then sends it no cancel push for a call its CallKit already ended.
    private var voipToken: String?
    private var pendingAnswered: [String] = []
    private var pendingDeclined: [String] = []
    private var pendingHungUp: [String] = []

    // CallKit only gives delegate callbacks a CallKit-generated UUID back —
    // this is what maps one back to this app's own callId.
    private var activeCalls: [UUID: String] = [:]
    // Calls this device answered, through CallKit's Accept or the in-app one
    // (answerFromApp): no longer ringing.
    private var answeredCalls: Set<UUID> = []
    // Answer/end actions requested by answerFromApp/endRingingFromApp on
    // behalf of the in-app buttons. The web page already acted on those, so
    // they aren't reported back to it as callAnswered/callDeclined.
    private var appRequestedActions: Set<UUID> = []
    // Calls reported with video: their audio session is left on the speaker (configureAudioSession).
    private var videoCalls: Set<UUID> = []

    // By callId, what this device knows about calls beyond CallKit's own
    // list, so a VoIP push that arrives late or out of order never rings:
    // calls answered here (CallKit's Accept or the in-app one, whether or not
    // CallKit was ringing), until they end here; and 1:1 calls whose ring is
    // over here, newest last. A ring into a call already going (an invite,
    // payload "invite") can legitimately come again for the same callId after
    // a decline or leave, so only answeredHere applies to those.
    private var answeredHere: [String: Date] = [:]
    private var endedHere: [String] = []
    private static let endedHereLimit = 64
    // CALL_ROOM_LIFETIME_SECONDS (src/lib/call-resilience.ts): no call lasts
    // longer, so an entry whose end was never seen here can't block anything.
    private static let answeredHereLifetime: TimeInterval = 12 * 60 * 60

    /// Why a ringing call stops, from the web page (endRingingCall).
    /// `declined` is this device's own in-app Decline; the rest happened
    /// somewhere else and map onto CallKit's own end reasons.
    enum RingEndReason: String {
        case declined
        case answeredElsewhere
        case declinedElsewhere
        case remoteEnded
        case unanswered
    }

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
        voipToken = token
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

    /// CallKit's own End (side button, lock screen, system call UI) on a call
    /// answered on this device: the web page hangs up.
    private func emitHungUp(_ callId: String) {
        pendingHungUp.append(callId)
        plugin?.notifyListeners("callEnded", data: ["callId": callId])
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
    func drainPendingCallEvents() -> (answered: [String], declined: [String], hungUp: [String]) {
        let result = (pendingAnswered, pendingDeclined, pendingHungUp)
        pendingAnswered.removeAll()
        pendingDeclined.removeAll()
        pendingHungUp.removeAll()
        return result
    }

    /// A call_cancelled VoIP push (src/lib/apns-voip.ts): the ring stopped
    /// (the caller hung up, it timed out, or it was answered or declined on
    /// another device, `reason`), or a call answered here is over.
    ///
    /// iOS 13+ terminates an app that returns from a VoIP push without
    /// reporting an incoming call, and stops delivering VoIP pushes to one
    /// that keeps doing it. Ending a call CallKit is showing covers that;
    /// with no such call (never rung here, or already ended here) a
    /// throwaway call is reported and ended at once instead.
    private func handleCancelPush(callId: String, reason: String?, completion: @escaping () -> Void) {
        let elsewhere = reason.flatMap(RingEndReason.init(rawValue:)).flatMap(NativeCallManager.elsewhereReason)
        let uuid = activeCalls.first(where: { $0.value == callId })?.key
        let answeredOnThisDevice = uuid.map { answeredCalls.contains($0) } ?? isAnsweredHere(callId)
        if answeredOnThisDevice, let elsewhere = elsewhere {
            // Another device can't have answered or declined a call this one
            // answered (the server only lets one answer win, and never sends
            // the answering device this cancel): keep the call.
            reportAndEndAtOnce(callerName: nil, hasVideo: false, reason: elsewhere, completion: completion)
            return
        }
        noteEnded(callId)
        if let uuid = uuid {
            // .unanswered on a call that was answered would log it as missed.
            let ringReason = elsewhere ?? .unanswered
            reportEnded(uuid, reason: answeredCalls.contains(uuid) ? .remoteEnded : ringReason)
            completion()
            return
        }
        reportAndEndAtOnce(callerName: nil, hasVideo: false, reason: elsewhere ?? .remoteEnded, completion: completion)
    }

    private static func elsewhereReason(_ reason: RingEndReason) -> CXCallEndedReason? {
        switch reason {
        case .answeredElsewhere:
            return .answeredElsewhere
        case .declinedElsewhere:
            return .declinedElsewhere
        case .declined, .remoteEnded, .unanswered:
            return nil
        }
    }

    /// Reports an incoming call under a fresh UUID that nothing else knows
    /// and ends it straight away: how a VoIP push with no call to ring still
    /// meets iOS's rule (see handleCancelPush). The UUID is never added to
    /// activeCalls, so a tap on it in the instant it exists does nothing.
    private func reportAndEndAtOnce(
        callerName: String?,
        hasVideo: Bool,
        reason: CXCallEndedReason,
        completion: @escaping () -> Void
    ) {
        let uuid = UUID()
        let name = callerName ?? "YuKon3t"
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: name)
        update.localizedCallerName = name
        update.hasVideo = hasVideo
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error == nil {
                self?.provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
            }
            completion()
        }
    }

    /// Why an incoming-call push must not ring, or nil if it should: the call
    /// was answered here (its push came after the in-app Accept), CallKit
    /// already has it, or (1:1 only) its ring is already over here.
    private func staleRingReason(callId: String, isInvite: Bool) -> CXCallEndedReason? {
        if isAnsweredHere(callId) { return .answeredElsewhere }
        if activeCalls.values.contains(callId) { return .remoteEnded }
        if !isInvite && endedHere.contains(callId) { return .remoteEnded }
        return nil
    }

    private func isAnsweredHere(_ callId: String) -> Bool {
        guard let answeredAt = answeredHere[callId] else { return false }
        if Date().timeIntervalSince(answeredAt) > Self.answeredHereLifetime {
            answeredHere.removeValue(forKey: callId)
            return false
        }
        return true
    }

    /// The call is over on this device.
    private func noteEnded(_ callId: String) {
        answeredHere.removeValue(forKey: callId)
        endedHere.removeAll { $0 == callId }
        endedHere.append(callId)
        if endedHere.count > Self.endedHereLimit {
            endedHere.removeFirst(endedHere.count - Self.endedHereLimit)
        }
    }

    private func reportEnded(_ uuid: UUID, reason: CXCallEndedReason) {
        guard activeCalls[uuid] != nil else { return }
        provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
        forget(uuid)
    }

    private func forget(_ uuid: UUID) {
        activeCalls.removeValue(forKey: uuid)
        answeredCalls.remove(uuid)
        appRequestedActions.remove(uuid)
        videoCalls.remove(uuid)
    }

    /// The web page left a call answered on this device (its own Hang up, or it found the call over): ends CallKit's
    /// call for it now, as a user action through CXCallController, so the green call indicator and the audio session
    /// go away with the call and a later side-button press or End never lands on a call the page already left. Not
    /// echoed back as callEnded (the page already hung up). No-op if CallKit has no answered call for it.
    func endAnsweredFromApp(callId: String) {
        guard let uuid = activeCalls.first(where: { $0.value == callId && answeredCalls.contains($0.key) })?.key,
              !appRequestedActions.contains(uuid) else { return }
        appRequestedActions.insert(uuid)
        callController.request(CXTransaction(action: CXEndCallAction(call: uuid))) { [weak self] error in
            guard let error else { return }
            DispatchQueue.main.async {
                guard let self else { return }
                print("[voip-native] end answered call request failed: \(error.localizedDescription)")
                self.appRequestedActions.remove(uuid)
                self.noteEnded(callId)
                self.reportEnded(uuid, reason: .remoteEnded)
            }
        }
    }

    /// The server origin the web view loads (capacitor.config.json's server.url, bundled with the app).
    private static let serverOrigin: URL = {
        if let url = Bundle.main.url(forResource: "capacitor.config", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let server = json["server"] as? [String: Any],
           let raw = server["url"] as? String,
           let origin = URL(string: raw) {
            return origin
        }
        return URL(string: "https://yukon3t.com")!
    }()

    /// CallKit's End on a call answered here, reported straight to the server (POST /api/calls/native, see
    /// src/lib/native-call-request.ts) with the web view's own session cookie. The web page hears about it too
    /// (callEnded), but pressing End or the side button locks the phone / backgrounds the app, CallKit deactivates the
    /// audio session, and WebKit suspends the page, so its hang-up used to wait until the app was next opened while
    /// the other person stayed in the call. endCall is guarded, so the page's own later hang-up is a no-op. Runs in a
    /// background task: with the call over, nothing else keeps the app running long enough to send it.
    private func reportHangUpToServer(callId: String, attempt: Int = 1) {
        let app = UIApplication.shared
        var task = UIBackgroundTaskIdentifier.invalid
        let finish = {
            if task != .invalid {
                app.endBackgroundTask(task)
                task = .invalid
            }
        }
        task = app.beginBackgroundTask(withName: "callkit-hangup") { finish() }
        guard let url = URL(string: "/api/calls/native", relativeTo: Self.serverOrigin)?.absoluteURL,
              let host = url.host else {
            finish()
            return
        }
        var body: [String: Any] = ["action": "end", "callId": callId]
        if let voipToken { body["voipToken"] = voipToken }
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            let matching = cookies.filter { cookie in
                let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
                return host == domain || host.hasSuffix("." + domain)
            }
            var request = URLRequest(url: url, timeoutInterval: 15)
            request.httpMethod = "POST"
            request.httpShouldHandleCookies = false
            for (name, value) in HTTPCookie.requestHeaderFields(with: matching) {
                request.setValue(value, forHTTPHeaderField: name)
            }
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("1", forHTTPHeaderField: "X-YuKon3t-Native-Call")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
            URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                print("[voip-native] hang-up report attempt \(attempt): status \(status) error \(error?.localizedDescription ?? "none")")
                DispatchQueue.main.async {
                    // A network failure or server error is retried once; 4xx (signed out, bad request) is final.
                    if (error != nil || status >= 500) && attempt < 2 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            self?.reportHangUpToServer(callId: callId, attempt: attempt + 1)
                            finish()
                        }
                        return
                    }
                    finish()
                }
            }.resume()
        }
    }

    /// Apple's CallKit pattern: the audio session is configured when the call is answered, before the action is
    /// fulfilled, and CallKit then activates it. An audio call uses the voice-chat mode (the earpiece, like any phone
    /// call), which is also what makes the side button end the call: iOS only ends a call on the side button while its
    /// audio is on the earpiece, on the speaker it just locks the phone. A video call stays on the speaker.
    private func configureAudioSession(video: Bool) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: video ? .videoChat : .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP]
            )
        } catch {
            print("[voip-native] audio session configure failed: \(error.localizedDescription)")
        }
    }

    private static func describeRoute() -> String {
        let route = AVAudioSession.sharedInstance().currentRoute
        return route.outputs.map { $0.portType.rawValue }.joined(separator: ",")
    }

    private func ringingUUID(for callId: String) -> UUID? {
        activeCalls.first(where: { $0.value == callId && !answeredCalls.contains($0.key) })?.key
    }

    /// Calls CallKit is ringing: reported, not answered here, not ended, and
    /// with no answer or end this app requested still on its way.
    func ringingCallIds() -> [String] {
        activeCalls
            .filter { !answeredCalls.contains($0.key) && !appRequestedActions.contains($0.key) }
            .map { $0.value }
    }

    /// The call was answered with the in-app Accept. Requests the same
    /// CXAnswerCallAction CallKit's own Accept performs, so CallKit moves the
    /// call from ringing to active exactly as it does for that path (no
    /// second system call UI, the usual audio-session activation), and the
    /// existing call_cancelled push ends it at hang-up. Ending it instead
    /// (reportCall endedAt) would leave the app in a call CallKit no longer
    /// knows about. Either way the call is answered here: a VoIP push for it
    /// arriving later must not ring (staleRingReason).
    func answerFromApp(callId: String) {
        answeredHere[callId] = Date()
        guard let uuid = ringingUUID(for: callId) else { return }
        appRequestedActions.insert(uuid)
        callController.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { [weak self] error in
            guard let error else { return }
            DispatchQueue.main.async {
                guard let self, !self.answeredCalls.contains(uuid) else { return }
                print("[voip-native] answer request failed: \(error.localizedDescription)")
                self.appRequestedActions.remove(uuid)
                // The call goes on in the web view regardless; at least stop
                // the ring.
                self.reportEnded(uuid, reason: .answeredElsewhere)
            }
        }
    }

    /// Stops CallKit ringing a call the web page has seen end, or a stale
    /// ring for the call the page is in (answeredElsewhere, from its ring
    /// check during a call). No-op if CallKit isn't ringing it (unknown,
    /// answered here or already ended).
    func endRingingFromApp(callId: String, reason: RingEndReason) {
        guard let uuid = ringingUUID(for: callId) else { return }
        // Only the ring ends for a call answered here: it goes on in the page.
        if !isAnsweredHere(callId) {
            noteEnded(callId)
        }
        switch reason {
        case .declined:
            // This device's own Decline, like CallKit's: a user action, so
            // it goes through CXCallController.
            appRequestedActions.insert(uuid)
            callController.request(CXTransaction(action: CXEndCallAction(call: uuid))) { [weak self] error in
                guard let error else { return }
                DispatchQueue.main.async {
                    guard let self else { return }
                    print("[voip-native] end request failed: \(error.localizedDescription)")
                    self.appRequestedActions.remove(uuid)
                    self.reportEnded(uuid, reason: .declinedElsewhere)
                }
            }
        case .answeredElsewhere:
            reportEnded(uuid, reason: .answeredElsewhere)
        case .declinedElsewhere:
            reportEnded(uuid, reason: .declinedElsewhere)
        case .remoteEnded:
            reportEnded(uuid, reason: .remoteEnded)
        case .unanswered:
            reportEnded(uuid, reason: .unanswered)
        }
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
            handleCancelPush(callId: callId, reason: dict["reason"] as? String, completion: completion)
            return
        }

        let callerName = dict["callerName"] as? String ?? "Someone"
        let callType = dict["callType"] as? String ?? "AUDIO"
        let isInvite = dict["invite"] as? Bool ?? false

        if let reason = staleRingReason(callId: callId, isInvite: isInvite) {
            reportAndEndAtOnce(
                callerName: callerName,
                hasVideo: callType == "VIDEO",
                reason: reason,
                completion: completion
            )
            return
        }

        // Apple requires reportNewIncomingCall to be called once, for every
        // VoIP push received, before this completion handler runs — skip
        // it (or take too long) and repeated offenses get this app's VoIP
        // entitlement revoked.
        let uuid = UUID()
        activeCalls[uuid] = callId
        if callType == "VIDEO" { videoCalls.insert(uuid) }
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.hasVideo = callType == "VIDEO"
        update.localizedCallerName = callerName
        // The page has no hold, grouping or keypad: don't let CallKit offer them (an unhandled hold action would fail).
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        provider.reportNewIncomingCall(with: uuid, update: update) { _ in
            completion()
        }
    }
}

extension NativeCallManager: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        activeCalls.removeAll()
        answeredCalls.removeAll()
        appRequestedActions.removeAll()
        videoCalls.removeAll()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        print("[voip-native] audio session activated, route: \(Self.describeRoute())")
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        print("[voip-native] audio session deactivated")
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        // Answering brings the app to the foreground as standard CallKit
        // behavior — nothing extra to do here beyond routing the outcome
        // into the same respondToCall flow the in-app Accept button uses
        // (see incoming-call-listener.tsx's "callAnswered" listener). The
        // actual call itself plays out entirely inside the web app's Daily
        // iframe/WebRTC once it foregrounds. CallKit's End on it (side
        // button, lock screen) is the hang-up, see the CXEndCallAction below.
        guard let callId = activeCalls[action.uuid] else {
            // Not a call this app is ringing (the throwaway call
            // reportAndEndAtOnce reports, tapped in the instant it exists).
            action.fail()
            return
        }
        answeredCalls.insert(action.uuid)
        answeredHere[callId] = Date()
        let requestedByApp = appRequestedActions.remove(action.uuid) != nil
        if !requestedByApp {
            emitAnswered(callId)
        }
        configureAudioSession(video: videoCalls.contains(action.uuid))
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        // Declining the system ringing screen, or the system End on a call
        // answered here: the web page hangs up (callEnded, see
        // incoming-call-listener.tsx). An end the app requested itself
        // (endRingingFromApp) was already handled by the web page. Fulfilling
        // the action is what has CallKit end the call and deactivate the
        // audio session it activated on answer; the page leaves the room.
        let requestedByApp = appRequestedActions.remove(action.uuid) != nil
        print("[voip-native] CXEndCallAction: known=\(activeCalls[action.uuid] != nil) answered=\(answeredCalls.contains(action.uuid)) byApp=\(requestedByApp) route=\(Self.describeRoute())")
        if let callId = activeCalls[action.uuid] {
            if !requestedByApp {
                if answeredCalls.contains(action.uuid) {
                    emitHungUp(callId)
                    reportHangUpToServer(callId: callId)
                } else {
                    emitDeclined(callId)
                }
            }
            noteEnded(callId)
        }
        forget(action.uuid)
        action.fulfill()
    }
}
