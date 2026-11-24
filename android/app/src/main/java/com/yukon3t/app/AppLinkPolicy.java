package com.yukon3t.app;

import java.util.Locale;

/**
 * Pure rules (plain JVM unit tests: AppLinkPolicyTest) for https://yukon3t.com
 * links Android hands to the app (App Links: AppLinkActivity's autoVerify
 * filter, verified against public/.well-known/assetlinks.json).
 *
 * An intent filter can't exclude paths before Android 15, so the filter claims
 * the whole host and this class mirrors the exclusions the iOS association
 * file makes (src/lib/app-links.ts: the /api/auth/callback/* include, the
 * /api/* exclude, then APP_LINK_EXCLUDED_PATTERNS). An excluded link is handed
 * to the browser instead. src/lib/app-links-android-sync.test.ts fails if the
 * two lists drift apart.
 */
final class AppLinkPolicy {

    private AppLinkPolicy() {}

    static final String HOST = "yukon3t.com";
    private static final int MAX_PATH = 2000;

    /** Emailed sign-in links: kept in the app although they're under /api/. */
    static final String AUTH_CALLBACK_PREFIX = "/api/auth/callback/";

    /**
     * Same entries, same order as APP_LINK_EXCLUDED_PATTERNS plus the "/api/*"
     * rule before them. A trailing "/*" matches the folder with a trailing
     * slash and anything below it (Apple's "*" matches zero or more
     * characters); anything else is an exact path.
     */
    static final String[] EXCLUDED_PATTERNS = {
        "/api/*",
        "/_next/*",
        "/.well-known/*",
        "/sw.js",
        "/offline.html",
        "/manifest.webmanifest",
        "/robots.txt",
        "/sitemap.xml",
        "/favicon.ico",
        "/icons/*",
        "/gifts/*",
        "/advertise",
        "/advertise/*",
    };

    /** An https://yukon3t.com link with no user, port or odd characters in its path. */
    static boolean isAppLink(String scheme, String host, int port, String userInfo, String path) {
        if (scheme == null || !scheme.toLowerCase(Locale.ROOT).equals("https")) return false;
        if (host == null || !host.toLowerCase(Locale.ROOT).equals(HOST)) return false;
        if (port != -1 || userInfo != null) return false;
        return isSafePath(path == null || path.isEmpty() ? "/" : path);
    }

    /** Whether an app link's path should open in the app (true) or in the browser (false). */
    static boolean opensInApp(String path) {
        String p = path == null || path.isEmpty() ? "/" : path;
        if (!isSafePath(p)) return false;
        if (p.startsWith(AUTH_CALLBACK_PREFIX)) return true;
        for (String pattern : EXCLUDED_PATTERNS) {
            if (matches(pattern, p)) return false;
        }
        return true;
    }

    static boolean matches(String pattern, String path) {
        if (pattern.endsWith("/*")) {
            String folder = pattern.substring(0, pattern.length() - 1); // keeps the trailing "/"
            return path.startsWith(folder);
        }
        return path.equals(pattern);
    }

    private static boolean isSafePath(String path) {
        if (path.length() > MAX_PATH) return false;
        if (!path.startsWith("/") || path.startsWith("//")) return false;
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c == '\\' || c < 0x20 || c == 0x7F) return false;
        }
        return true;
    }
}
