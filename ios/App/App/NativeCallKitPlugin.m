#import <Capacitor/Capacitor.h>

// Auto-registers NativeCallKitPlugin.swift with Capacitor's plugin bridge —
// same mechanism ScreenCaptureGuardPlugin.m already uses. This plugin only
// ever emits events (voipTokenReceived, callAnswered, callDeclined), see
// NativeCallManager.swift — echo exists purely because Capacitor doesn't
// reliably register a plugin exposing zero callable methods.
CAP_PLUGIN(NativeCallKitPlugin, "NativeCallKit",
  CAP_PLUGIN_METHOD(echo, CAPPluginReturnPromise);
)
