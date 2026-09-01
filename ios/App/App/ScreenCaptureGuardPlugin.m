#import <Capacitor/Capacitor.h>

// Auto-registers ScreenCaptureGuardPlugin.swift with Capacitor's plugin
// bridge via the Objective-C runtime — same mechanism every other Capacitor
// plugin in node_modules uses, just declared locally since this one has no
// npm package of its own.
CAP_PLUGIN(ScreenCaptureGuardPlugin, "ScreenCaptureGuard",
  CAP_PLUGIN_METHOD(startWatching, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stopWatching, CAPPluginReturnPromise);
)
