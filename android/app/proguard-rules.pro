# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# --- yukon3t-specific keep rules ---
#
# These exist because this app's native Java layer has classes the Android
# OS or Capacitor's own JS bridge reaches via reflection or a manifest
# declaration, not via any Java call R8's static reachability analysis can
# trace — without an explicit rule, R8 could strip or rename them with no
# compile-time error, silently breaking calling/push notifications or every
# custom plugin method call from JS. Confirmed by inspecting AGP's own
# bundled default rules directly (proguard-common.txt inside the Android
# Gradle Plugin jar): they keep WebView @JavascriptInterface methods, View
# setters/getters, Activity onClick(View) methods, enum values()/valueOf(),
# and Parcelable CREATOR fields — nothing broader for arbitrary Service
# subclasses, so these need to be explicit rather than assumed covered.

# Instantiated purely from their <service> declaration in
# AndroidManifest.xml (CallMessagingService additionally via Firebase's own
# MESSAGING_EVENT intent-filter) — no app code holds a live reference to
# either class that R8's reachability analysis can trace.
-keep class com.yukon3t.app.CallForegroundService { *; }
-keep class com.yukon3t.app.CallMessagingService { *; }

# Capacitor's JS bridge invokes @PluginMethod-annotated methods on these
# classes by name via reflection whenever JS calls Plugins.X.method() — R8
# renaming them breaks every native call from JS with no compile-time
# error. Kept in full (not just the annotated methods) since the bridge
# also reflects into a couple of supporting members at times.
-keep class com.yukon3t.app.CallForegroundPlugin { *; }
-keep class com.yukon3t.app.ScreenCaptureGuardPlugin { *; }
-keep class com.yukon3t.app.VolumeButtonPlugin { *; }
