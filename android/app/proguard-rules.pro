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

# Capacitor reads @CapacitorPlugin (and its nested @Permission entries) via
# reflection at runtime — Plugin.checkPermissions()/getPermissionStates()
# calls PluginHandle.getPluginAnnotation(), backed by
# pluginClass.getAnnotation(CapacitorPlugin.class). Capacitor's own bundled
# consumer proguard-rules.pro keeps the ANNOTATED CLASSES and their methods,
# but keeping a class doesn't keep its annotation metadata — that's a
# separate, JVM-classfile-level attribute R8 strips by default unless told
# otherwise. Without this, getAnnotation() silently returns null on a
# release (minified) build, and every plugin's checkPermissions/
# requestPermissions crashes the whole app with a NullPointerException the
# instant it's called — confirmed via a live, 100%-reproducible crash loop
# on a Samsung Galaxy S23+ and S25+ (Android 16): @capacitor-firebase/
# messaging's FirebaseMessagingPlugin.checkPermissions(), called from
# capacitor-bridge.tsx on every app launch, crashed every single time on
# the release build but never reproduced on an unminified debug build
# running the identical code — isolating this to R8 attribute stripping,
# not app logic.
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations, AnnotationDefault

# The above alone did NOT fix it (verified live, same crash reproduced with
# it in place) — R8's optimization pass itself (inlining/restructuring
# "kept" code, not just renaming) is the more likely culprit for reflection-
# heavy frameworks like Capacitor's Plugin/Bridge/PluginHandle, which get
# invoked through java.lang.reflect.Method.invoke rather than normal static
# call sites the optimizer can safely reason about. Disabling optimization
# only (shrinking + renaming stay on, so this doesn't give up the app-size/
# obfuscation gains) is the standard fix for this class of R8 bug.
-dontoptimize
