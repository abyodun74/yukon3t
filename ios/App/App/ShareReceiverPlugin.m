#import <Capacitor/Capacitor.h>

// Auto-registers ShareReceiverPlugin.swift with Capacitor's plugin bridge —
// same mechanism ScreenCaptureGuardPlugin.m/NativeCallKitPlugin.m use. Also
// needs "ShareReceiverPlugin" added to capacitor.config.json's
// packageClassList — see scripts/fix-ios-package-class-list.mjs and
// CLAUDE.md's "Native iOS plugins (Capacitor) — packageClassList gotcha".
CAP_PLUGIN(ShareReceiverPlugin, "ShareReceiver",
  CAP_PLUGIN_METHOD(getPendingShare, CAPPluginReturnPromise);
)
