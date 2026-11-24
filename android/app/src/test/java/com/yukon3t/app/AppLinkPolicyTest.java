package com.yukon3t.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AppLinkPolicyTest {

    @Test
    public void acceptsOnlyPlainHttpsApexLinks() {
        assertTrue(AppLinkPolicy.isAppLink("https", "yukon3t.com", -1, null, "/p/abc"));
        assertTrue(AppLinkPolicy.isAppLink("HTTPS", "YuKon3t.com", -1, null, ""));
        assertTrue(AppLinkPolicy.isAppLink("https", "yukon3t.com", -1, null, null));

        assertFalse(AppLinkPolicy.isAppLink("http", "yukon3t.com", -1, null, "/p/abc"));
        assertFalse(AppLinkPolicy.isAppLink("https", "www.yukon3t.com", -1, null, "/p/abc"));
        assertFalse(AppLinkPolicy.isAppLink("https", "evil.yukon3t.com.example", -1, null, "/"));
        assertFalse(AppLinkPolicy.isAppLink("https", "yukon3t.com", 8443, null, "/"));
        assertFalse(AppLinkPolicy.isAppLink("https", "yukon3t.com", -1, "user:pw", "/"));
        assertFalse(AppLinkPolicy.isAppLink("https", "yukon3t.com", -1, null, "//evil.example"));
        assertFalse(AppLinkPolicy.isAppLink("https", "yukon3t.com", -1, null, "/a\\b"));
        assertFalse(AppLinkPolicy.isAppLink("yukon3t", "open", -1, null, "/"));
        assertFalse(AppLinkPolicy.isAppLink(null, null, -1, null, null));
    }

    @Test
    public void pagesOpenInTheApp() {
        assertTrue(AppLinkPolicy.opensInApp("/"));
        assertTrue(AppLinkPolicy.opensInApp(""));
        assertTrue(AppLinkPolicy.opensInApp("/home"));
        assertTrue(AppLinkPolicy.opensInApp("/reset-password"));
        assertTrue(AppLinkPolicy.opensInApp("/api/auth/callback/resend"));
        assertTrue(AppLinkPolicy.opensInApp("/advertiser"));
        assertTrue(AppLinkPolicy.opensInApp("/apis"));
        assertTrue(AppLinkPolicy.opensInApp("/api"));
        assertTrue(AppLinkPolicy.opensInApp("/icons"));
    }

    @Test
    public void excludedPathsGoToTheBrowser() {
        assertFalse(AppLinkPolicy.opensInApp("/api/"));
        assertFalse(AppLinkPolicy.opensInApp("/api/health"));
        assertFalse(AppLinkPolicy.opensInApp("/api/auth/signin"));
        assertFalse(AppLinkPolicy.opensInApp("/_next/static/x.js"));
        assertFalse(AppLinkPolicy.opensInApp("/.well-known/assetlinks.json"));
        assertFalse(AppLinkPolicy.opensInApp("/sw.js"));
        assertFalse(AppLinkPolicy.opensInApp("/offline.html"));
        assertFalse(AppLinkPolicy.opensInApp("/manifest.webmanifest"));
        assertFalse(AppLinkPolicy.opensInApp("/robots.txt"));
        assertFalse(AppLinkPolicy.opensInApp("/sitemap.xml"));
        assertFalse(AppLinkPolicy.opensInApp("/favicon.ico"));
        assertFalse(AppLinkPolicy.opensInApp("/icons/icon-192.png"));
        assertFalse(AppLinkPolicy.opensInApp("/gifts/rose.png"));
        assertFalse(AppLinkPolicy.opensInApp("/advertise"));
        assertFalse(AppLinkPolicy.opensInApp("/advertise/success"));
        assertFalse(AppLinkPolicy.opensInApp("//evil.example"));
    }
}
