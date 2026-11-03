package com.yukon3t.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure rules (plain JVM unit tests: DeepLinkPolicyTest) for the yukon3t://
 * links MainActivity accepts. Security audit L5: the old BROWSABLE
 * yukon3t://call filter let any web page or app fire
 * yukon3t://call?callId=X&action=accept, which answered a ringing call
 * (incoming-call-listener.tsx), stopped the ring and drew the app over the
 * lock screen. MainActivity is exported (it's the launcher), so even without
 * that filter any installed app can still send it an explicit VIEW intent
 * with any data. Now:
 *
 *  - the manifest no longer declares a yukon3t:// filter at all (every link
 *    this app opens is an explicit PendingIntent from its own notifications);
 *  - each of those PendingIntents carries a per-install secret
 *    (DeepLinkGuard.EXTRA_TOKEN) that other apps can't read;
 *  - MainActivity drops the intent's data (so neither App.getLaunchUrl nor
 *    appUrlOpen ever sees it, and the lock-screen/stop-ring code doesn't run)
 *    unless the token matches AND the link is one of the two shapes below.
 */
final class DeepLinkPolicy {

    private DeepLinkPolicy() {}

    static final String SCHEME = "yukon3t";
    static final String HOST_CALL = "call";
    static final String HOST_OPEN = "open";

    /** Call ids are cuids; this is generous but excludes anything URL-like. */
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private static final int MAX_OPEN_PATH = 500;

    // Not Set.of: that's API 30+, and minSdk is 24.
    private static final Set<String> CALL_PARAMS = new HashSet<>(Arrays.asList("callId", "action"));
    private static final Set<String> OPEN_PARAMS = new HashSet<>(Arrays.asList("path", "n"));

    /**
     * True only for the exact links this app's own notifications build:
     *  - yukon3t://call?callId=<id>[&action=accept|decline]
     *    (CallForegroundService ringing notification body / full-screen
     *    intent, and its Accept/Decline actions);
     *  - yukon3t://open?path=<in-app path>[&n=<id>]
     *    (CallForegroundService.showMissedCallNotification).
     * No other host, no unknown or repeated parameter, no user/port/fragment
     * or path on the link itself.
     *
     * @param params each query parameter name with all of its values
     */
    static boolean isAllowedLink(
        String scheme,
        String host,
        String linkPath,
        boolean hasUserInfoPortOrFragment,
        Map<String, List<String>> params
    ) {
        if (scheme == null || !scheme.toLowerCase(Locale.ROOT).equals(SCHEME)) return false;
        if (host == null || hasUserInfoPortOrFragment) return false;
        if (linkPath != null && !linkPath.isEmpty() && !linkPath.equals("/")) return false;
        Map<String, List<String>> p = params != null ? params : Collections.emptyMap();

        if (host.equals(HOST_CALL)) {
            if (!CALL_PARAMS.containsAll(p.keySet())) return false;
            String callId = single(p, "callId");
            if (callId == null || !ID.matcher(callId).matches()) return false;
            if (p.containsKey("action")) {
                String action = single(p, "action");
                return "accept".equals(action) || "decline".equals(action);
            }
            return true;
        }
        if (host.equals(HOST_OPEN)) {
            if (!OPEN_PARAMS.containsAll(p.keySet())) return false;
            String path = single(p, "path");
            if (!isSafeInAppPath(path)) return false;
            if (p.containsKey("n")) {
                String n = single(p, "n");
                return n != null && ID.matcher(n).matches();
            }
            return true;
        }
        return false;
    }

    /**
     * Same rule CallForegroundService applies before building the link, and
     * the web side's notificationDeepLinkPath/safeInAppPath applies again:
     * a same-site absolute path, never "//host" or a backslash form a
     * browser could read as another origin, no control characters.
     */
    static boolean isSafeInAppPath(String path) {
        if (path == null || path.isEmpty() || path.length() > MAX_OPEN_PATH) return false;
        if (!path.startsWith("/") || path.startsWith("//")) return false;
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c == '\\' || c < 0x20 || c == 0x7F) return false;
        }
        return true;
    }

    /** Constant-time comparison of the expected and presented secret; null/empty never matches. */
    static boolean tokensMatch(String expected, String presented) {
        if (expected == null || presented == null || expected.isEmpty() || presented.isEmpty()) return false;
        return MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8),
            presented.getBytes(StandardCharsets.UTF_8)
        );
    }

    private static String single(Map<String, List<String>> params, String name) {
        List<String> values = params.get(name);
        if (values == null || values.size() != 1) return null;
        return values.get(0);
    }
}
