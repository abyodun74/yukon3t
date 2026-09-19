#import <Capacitor/Capacitor.h>

// Auto-registers NativeCallKitPlugin.swift with Capacitor's plugin bridge —
// same mechanism ScreenCaptureGuardPlugin.m already uses. getPendingToken/
// getPendingCallEvents are the real delivery path (see NativeCallManager.swift
// for why); echo exists purely because Capacitor doesn't reliably register
// a plugin exposing zero callable methods.
CAP_PLUGIN(NativeCallKitPlugin, "NativeCallKit",
  CAP_PLUGIN_METHOD(echo, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getPendingToken, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getPendingCallEvents, CAPPluginReturnPromise);
)
