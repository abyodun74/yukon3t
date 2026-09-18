#import <Capacitor/Capacitor.h>

// Auto-registers NativeCallKitPlugin.swift with Capacitor's plugin bridge —
// same mechanism ScreenCaptureGuardPlugin.m already uses. No callable
// methods: this plugin only ever emits events (voipTokenReceived,
// callAnswered, callDeclined), see NativeCallManager.swift.
CAP_PLUGIN(NativeCallKitPlugin, "NativeCallKit",
)
