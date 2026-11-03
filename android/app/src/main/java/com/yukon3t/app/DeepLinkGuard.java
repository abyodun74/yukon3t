package com.yukon3t.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Android half of DeepLinkPolicy (see its doc comment for the attack this
 * closes, security audit L5).
 *
 * The secret is random per install, kept in this app's private
 * SharedPreferences (android:allowBackup="false", so it isn't copied off the
 * device by backup), and travels only inside this app's own PendingIntents,
 * which other apps can't read. It's persisted rather than per-process because
 * a ringing or missed-call notification outlives the process that posted it.
 */
final class DeepLinkGuard {

    private DeepLinkGuard() {}

    static final String EXTRA_TOKEN = "com.yukon3t.app.extra.DEEP_LINK_TOKEN";
    private static final String PREFS = "deep_link_guard";
    private static final String KEY_TOKEN = "token";

    /**
     * Intent extras Capacitor's bundled Cordova layer reads as preferences
     * (Bridge.Builder.create passes the launch intent's extras to
     * CordovaPreferences, which falls back to them for anything config.xml
     * doesn't set): "KeepRunning" decides whether the WebView keeps running
     * in the background, which ongoing calls rely on. Any app launching the
     * exported MainActivity could otherwise set it. Lower-case because that's
     * how CordovaPreferences looks them up.
     */
    private static final String[] CORDOVA_PREFERENCE_EXTRAS = {"keeprunning", "disabledeploy"};

    private static String cachedToken;

    /**
     * The per-install secret, created on first use. commit(), not apply(): a
     * notification signed with a new token must never outlive the token's
     * write (the process can die right after posting it).
     */
    @SuppressLint("ApplySharedPref")
    static synchronized String token(Context context) {
        if (cachedToken != null) return cachedToken;
        SharedPreferences prefs = context.getApplicationContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String token = prefs.getString(KEY_TOKEN, null);
        if (token == null || token.isEmpty()) {
            byte[] bytes = new byte[32];
            new SecureRandom().nextBytes(bytes);
            token = Base64.encodeToString(bytes, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
            prefs.edit().putString(KEY_TOKEN, token).commit();
        }
        cachedToken = token;
        return token;
    }

    /** Marks an intent this app builds for its own notification as trusted. */
    static Intent sign(Context context, Intent intent) {
        intent.putExtra(EXTRA_TOKEN, token(context));
        return intent;
    }

    /**
     * Runs on every intent MainActivity receives, before Capacitor sees it
     * (onCreate before super.onCreate, onNewIntent before super.onNewIntent).
     * Drops the intent's data unless it is a signed, allow-listed yukon3t://
     * link; strips the token and the Cordova preference extras either way.
     * The type is kept, because a share intent's declared MIME type is its
     * fallback (Intent.setData alone would clear it).
     */
    static void sanitize(Context context, Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        String presented = null;
        try {
            presented = intent.getStringExtra(EXTRA_TOKEN);
            intent.removeExtra(EXTRA_TOKEN);
            for (String key : CORDOVA_PREFERENCE_EXTRAS) intent.removeExtra(key);
        } catch (Exception ignored) {
            // A malformed extras bundle from another app: treat as unsigned.
            presented = null;
        }
        if (data == null) return;

        boolean trusted = DeepLinkPolicy.tokensMatch(token(context), presented) && isAllowed(data);
        if (!trusted) intent.setDataAndType(null, intent.getType());
    }

    private static boolean isAllowed(Uri uri) {
        try {
            if (!uri.isHierarchical()) return false;
            Map<String, List<String>> params = new HashMap<>();
            for (String name : uri.getQueryParameterNames()) {
                params.put(name, new ArrayList<>(uri.getQueryParameters(name)));
            }
            boolean extras = uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null;
            return DeepLinkPolicy.isAllowedLink(uri.getScheme(), uri.getHost(), uri.getPath(), extras, params);
        } catch (Exception e) {
            return false;
        }
    }
}
