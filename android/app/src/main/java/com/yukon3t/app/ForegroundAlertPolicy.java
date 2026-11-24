package com.yukon3t.app;

import java.net.URI;

/**
 * Pure rules (plain JVM unit tests: ForegroundAlertPolicyTest) for showing an
 * ordinary FCM notification while the app is open. See AlertNotifications.
 */
final class ForegroundAlertPolicy {

    private ForegroundAlertPolicy() {}

    /** src/lib/alert-push.ts ALERT_NOTIFICATION_CHANNEL_ID: IMPORTANCE_HIGH, banner + sound. */
    static final String ALERT_CHANNEL_ID = "yk_alerts";
    /** src/lib/quiet-push.ts QUIET_NOTIFICATION_CHANNEL_ID: IMPORTANCE_LOW, no sound, never peeks. */
    static final String QUIET_CHANNEL_ID = "quiet_reminders";

    /** The tag FCM itself uses for a notification that names none (com.google.firebase.messaging.DisplayNotification). */
    static final String FCM_DEFAULT_TAG_PREFIX = "FCM-Notification:";

    /** src/lib/push-replace.ts PUSH_REPLACE_KEY_MAX_BYTES. */
    private static final int MAX_TAG_LENGTH = 64;

    /**
     * The channel the notification is posted to: the one the server named if
     * it is one of ours, otherwise the alert channel (a payload without a
     * channel is an ordinary notification, alert-push.ts is the default).
     */
    static String channelFor(String requestedChannelId) {
        if (QUIET_CHANNEL_ID.equals(requestedChannelId)) return QUIET_CHANNEL_ID;
        return ALERT_CHANNEL_ID;
    }

    /**
     * The tag the notification is posted under (always with id 0, like FCM's
     * own display): the server's replacement key (android.notification.tag,
     * push-replace.ts) so a later push with the same key replaces it in the
     * drawer whether the app is open or not, otherwise a tag of its own.
     */
    static String tagFor(String serverTag, String fallbackSuffix) {
        if (serverTag != null && !serverTag.isEmpty() && serverTag.length() <= MAX_TAG_LENGTH) return serverTag;
        return FCM_DEFAULT_TAG_PREFIX + fallbackSuffix;
    }

    /**
     * True when the page on screen is the notification's own target (the chat
     * the message is in, the post that was liked), so a banner would only
     * repeat what the person is already looking at. Compares path and query
     * of the WebView's current URL (only on yukon3t.com) with the push's
     * `url`, an in-app path. Anything unparsable is "not the same screen", so
     * the notification is shown.
     */
    static boolean isSameScreen(String currentUrl, String targetPath) {
        if (currentUrl == null || targetPath == null) return false;
        if (!targetPath.startsWith("/") || targetPath.startsWith("//")) return false;
        try {
            URI current = new URI(currentUrl);
            String host = current.getHost();
            if (!"https".equalsIgnoreCase(current.getScheme()) || host == null) return false;
            if (!host.equalsIgnoreCase("yukon3t.com") && !host.equalsIgnoreCase("www.yukon3t.com")) return false;
            URI target = new URI("https://yukon3t.com" + targetPath);
            return normalisePath(current.getRawPath()).equals(normalisePath(target.getRawPath()))
                && nullToEmpty(current.getRawQuery()).equals(nullToEmpty(target.getRawQuery()));
        } catch (Exception e) {
            return false;
        }
    }

    private static String normalisePath(String path) {
        if (path == null || path.isEmpty()) return "/";
        if (path.length() > 1 && path.endsWith("/")) return path.substring(0, path.length() - 1);
        return path;
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
