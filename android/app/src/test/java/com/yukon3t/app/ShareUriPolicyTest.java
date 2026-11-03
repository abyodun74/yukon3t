package com.yukon3t.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class ShareUriPolicyTest {

    private static final String PKG = "com.yukon3t.app";
    private static final List<String> ROOTS = Arrays.asList(
        "/data/user/0/com.yukon3t.app",
        "/data/data/com.yukon3t.app",
        "/data/user/0/com.yukon3t.app/cache",
        "/data/user_de/0/com.yukon3t.app"
    );
    private static final List<String> SHARE_OUT = Arrays.asList(
        "/data/user/0/com.yukon3t.app/cache/share-out",
        "/data/user/0/com.yukon3t.app/cache/clipboard-images"
    );

    private static ShareUriPolicy.OpenedFileDecision foreign(String fdPath) {
        return ShareUriPolicy.decideOpenedFile(fdPath, false, PKG, ROOTS, SHARE_OUT);
    }

    private static ShareUriPolicy.OpenedFileDecision own(String fdPath) {
        return ShareUriPolicy.decideOpenedFile(fdPath, true, PKG, ROOTS, SHARE_OUT);
    }

    @Test
    public void onlyContentSchemeIsAccepted() {
        assertTrue(ShareUriPolicy.isAcceptedScheme("content"));
        assertTrue(ShareUriPolicy.isAcceptedScheme("CONTENT"));
        assertFalse(ShareUriPolicy.isAcceptedScheme("file"));
        assertFalse(ShareUriPolicy.isAcceptedScheme("FILE"));
        assertFalse(ShareUriPolicy.isAcceptedScheme("android.resource"));
        assertFalse(ShareUriPolicy.isAcceptedScheme("https"));
        assertFalse(ShareUriPolicy.isAcceptedScheme(""));
        assertFalse(ShareUriPolicy.isAcceptedScheme(null));
    }

    @Test
    public void userIdPrefixIsStrippedForOwnershipChecks() {
        assertEquals("com.yukon3t.app.fileprovider", ShareUriPolicy.authorityWithoutUserId("0@com.yukon3t.app.fileprovider"));
        assertEquals("com.yukon3t.app.fileprovider", ShareUriPolicy.authorityWithoutUserId("10@com.yukon3t.app.fileprovider"));
        assertEquals("media", ShareUriPolicy.authorityWithoutUserId("media"));
        assertTrue(ShareUriPolicy.hasUserIdPrefix("0@media"));
        assertFalse(ShareUriPolicy.hasUserIdPrefix("media"));
        assertEquals("com.yukon3t.app.fileprovider", ShareUriPolicy.ownFileProviderAuthority(PKG));
    }

    @Test
    public void normalizesPathsLexically() {
        assertEquals("/data/data/com.yukon3t.app/app_webview/Default/Cookies",
            ShareUriPolicy.normalizePath("/storage/emulated/0/../../../data/data/com.yukon3t.app/./app_webview//Default/Cookies"));
        assertEquals("/", ShareUriPolicy.normalizePath("/../.."));
        assertEquals("/a/b", ShareUriPolicy.normalizePath("/a/b (deleted)"));
        assertNull(ShareUriPolicy.normalizePath("pipe:[12345]"));
        assertNull(ShareUriPolicy.normalizePath("relative/path"));
        assertNull(ShareUriPolicy.normalizePath(null));
        assertNull(ShareUriPolicy.normalizePath("/a\u0000b"));
    }

    @Test
    public void insideRespectsPathBoundaries() {
        assertTrue(ShareUriPolicy.isInside("/data/data/com.yukon3t.app/x", "/data/data/com.yukon3t.app"));
        assertTrue(ShareUriPolicy.isInside("/data/data/com.yukon3t.app", "/data/data/com.yukon3t.app/"));
        assertFalse(ShareUriPolicy.isInside("/data/data/com.yukon3t.appx/x", "/data/data/com.yukon3t.app"));
        assertFalse(ShareUriPolicy.isInside("/data/data/com.yukon3t.app/../other/x", "/data/data/com.yukon3t.app"));
    }

    @Test
    public void privatePathsAreRecognisedInEveryAliasForm() {
        String[] privatePaths = {
            "/data/data/com.yukon3t.app/app_webview/Default/Cookies",
            "/data/user/0/com.yukon3t.app/shared_prefs/CapacitorStorage.xml",
            "/data/user/10/com.yukon3t.app/databases/x.db",
            "/data/user_de/0/com.yukon3t.app/files/x",
            "/mnt/expand/1234-abcd/user/0/com.yukon3t.app/files/x",
            "/storage/emulated/0/Android/data/com.yukon3t.app/files/x",
            "/mnt/user/0/emulated/0/Android/data/com.yukon3t.app/cache/x",
            "/data/media/0/Android/obb/com.yukon3t.app/main.obb",
            "/storage/emulated/0/DCIM/../../../../data/data/com.yukon3t.app/files/token",
        };
        for (String p : privatePaths) {
            assertTrue(p, ShareUriPolicy.isPrivatePath(p, PKG, ROOTS));
            assertEquals(p, ShareUriPolicy.OpenedFileDecision.REJECT, foreign(p));
        }
    }

    @Test
    public void sharedStorageFromOtherAppsIsAllowed() {
        String[] shared = {
            "/storage/emulated/0/DCIM/Camera/PXL_20261101.jpg",
            "/storage/emulated/0/Pictures/YuKon3t/yukon3t-1.jpg",
            "/mnt/user/0/emulated/0/Movies/clip.mp4",
            "/data/user/0/com.google.android.apps.photos/cache/share/abc.jpg",
            "/storage/emulated/0/Android/data/com.yukon3t.appendix/files/x.jpg",
        };
        for (String p : shared) {
            assertFalse(p, ShareUriPolicy.isPrivatePath(p, PKG, ROOTS));
            assertEquals(p, ShareUriPolicy.OpenedFileDecision.ALLOW, foreign(p));
        }
    }

    @Test
    public void streamedDescriptorsFromOtherAppsAreAllowedButUnknownIsRejected() {
        assertEquals(ShareUriPolicy.OpenedFileDecision.ALLOW, foreign("pipe:[98765]"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.ALLOW, foreign("socket:[1]"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.ALLOW, foreign("anon_inode:[memfd]"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT, foreign(null));
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT, foreign("weird"));
    }

    @Test
    public void ownFileProviderIsOnlyAcceptedFromShareOutDirs() {
        assertEquals(ShareUriPolicy.OpenedFileDecision.ALLOW,
            own("/data/user/0/com.yukon3t.app/cache/share-out/post-abc-0.jpg"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.ALLOW,
            own("/data/user/0/com.yukon3t.app/cache/clipboard-images/yukon3t-photo-1.png"));
        // Cache root, WebView cache, other private files, traversal out of the share dir.
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT, own("/data/user/0/com.yukon3t.app/cache/x.jpg"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT,
            own("/data/user/0/com.yukon3t.app/cache/WebView/Default/HTTP Cache/abc"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT,
            own("/data/user/0/com.yukon3t.app/cache/share-out/../../app_webview/Default/Cookies"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT,
            own("/data/user/0/com.yukon3t.app/cache/share-outx/a.jpg"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT, own("/data/user/0/com.yukon3t.app/cache/share-out"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT, own("pipe:[1]"));
        assertEquals(ShareUriPolicy.OpenedFileDecision.REJECT, own(null));
    }

    @Test
    public void allowedMimeTypes() {
        assertTrue(ShareUriPolicy.isAllowedMime("image/jpeg", false));
        assertTrue(ShareUriPolicy.isAllowedMime("IMAGE/HEIC", true));
        assertTrue(ShareUriPolicy.isAllowedMime("video/mp4; codecs=avc1", true));
        assertTrue(ShareUriPolicy.isAllowedMime("audio/mpeg", false));
        assertFalse(ShareUriPolicy.isAllowedMime("audio/mpeg", true));
        assertFalse(ShareUriPolicy.isAllowedMime("image/*", false));
        assertFalse(ShareUriPolicy.isAllowedMime("image/svg+xml", false));
        assertFalse(ShareUriPolicy.isAllowedMime("text/plain", false));
        assertFalse(ShareUriPolicy.isAllowedMime("application/octet-stream", false));
        assertFalse(ShareUriPolicy.isAllowedMime("application/x-sqlite3", false));
        assertFalse(ShareUriPolicy.isAllowedMime("image/", false));
        assertFalse(ShareUriPolicy.isAllowedMime(null, false));
    }

    @Test
    public void resolveMimePrefersProviderThenIntentThenExtension() {
        assertEquals("image/png", ShareUriPolicy.resolveMime("image/png", "image/*", "a.jpg", false));
        assertEquals("image/jpeg", ShareUriPolicy.resolveMime("application/octet-stream", "image/*", "a.JPG", false));
        assertEquals("video/mp4", ShareUriPolicy.resolveMime(null, "video/mp4", "clip", false));
        assertEquals("video/quicktime", ShareUriPolicy.resolveMime("image/*", "image/*", "IMG_1.MOV", true));
        // A concrete non-media provider type is believed, whatever the name or intent says.
        assertNull(ShareUriPolicy.resolveMime("application/x-sqlite3", "image/jpeg", "Cookies.jpg", false));
        assertNull(ShareUriPolicy.resolveMime("text/xml", "image/jpeg", "prefs.jpg", false));
        assertNull(ShareUriPolicy.resolveMime(null, "*/*", "Cookies", false));
        assertNull(ShareUriPolicy.resolveMime(null, null, null, false));
    }

    @Test
    public void sizeCapsPerType() {
        assertEquals(ShareUriPolicy.MAX_IMAGE_BYTES, ShareUriPolicy.maxBytesFor("image/jpeg"));
        assertEquals(ShareUriPolicy.MAX_VIDEO_BYTES, ShareUriPolicy.maxBytesFor("video/mp4"));
        assertEquals(ShareUriPolicy.MAX_AUDIO_BYTES, ShareUriPolicy.maxBytesFor("audio/mpeg"));
        assertEquals(0, ShareUriPolicy.maxBytesFor("text/plain"));
        assertEquals(0, ShareUriPolicy.maxBytesFor(null));
    }

    private static boolean sniff(String s) {
        byte[] b = s.getBytes(StandardCharsets.ISO_8859_1);
        return ShareUriPolicy.looksLikePrivateData(b, b.length);
    }

    @Test
    public void privateDataSignaturesAreRefusedWhateverTheLabel() {
        assertTrue(sniff("SQLite format 3\u0000\u0010\u0000rest"));
        assertTrue(sniff("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>"));
        assertTrue(sniff("\n  <map>\n<string name=\"token\">x</string>"));
        assertTrue(sniff("ï»¿<?xml"));
        assertTrue(sniff("<!DOCTYPE html>"));
        assertTrue(sniff("<svg xmlns"));
        assertFalse(sniff("ÿØÿà\u0000\u0010JFIF"));
        assertFalse(sniff("\u0089PNG\r\n\u001a\n"));
        assertFalse(sniff("\u0000\u0000\u0000\u0018ftypmp42"));
        assertFalse(sniff("GIF89a"));
        assertFalse(ShareUriPolicy.looksLikePrivateData(new byte[0], 0));
        assertFalse(ShareUriPolicy.looksLikePrivateData(null, 0));
    }

    @Test
    public void extensionsNeverCarryPathSeparators() {
        assertEquals(".jpg", ShareUriPolicy.safeExtension("image/jpeg", "photo.JPG"));
        assertEquals(".heic", ShareUriPolicy.safeExtension("image/heic", "IMG.heic"));
        assertEquals(".mp4", ShareUriPolicy.safeExtension("video/mp4", "a../../shared_prefs/x"));
        assertEquals(".jpg", ShareUriPolicy.safeExtension("image/jpeg", "x./../../files/token"));
        assertEquals(".png", ShareUriPolicy.safeExtension("image/png", "noext"));
        assertEquals(".mov", ShareUriPolicy.safeExtension("video/quicktime", "clip.toolongextension"));
        assertEquals("", ShareUriPolicy.safeExtension(null, null));
    }

    @Test
    public void displayNamesAreReducedToALastComponent() {
        assertEquals("Cookies", ShareUriPolicy.safeDisplayName("/data/data/com.yukon3t.app/app_webview/Default/Cookies"));
        assertEquals("b.jpg", ShareUriPolicy.safeDisplayName("a\\b.jpg"));
        assertEquals("shared-file", ShareUriPolicy.safeDisplayName(".."));
        assertEquals("shared-file", ShareUriPolicy.safeDisplayName(null));
        assertEquals("ab.jpg", ShareUriPolicy.safeDisplayName("a\u0000\nb.jpg"));
        StringBuilder longName = new StringBuilder();
        for (int i = 0; i < 300; i++) longName.append('x');
        assertEquals(120, ShareUriPolicy.safeDisplayName(longName.toString()).length());
    }

    @Test
    public void textIsCapped() {
        assertNull(ShareUriPolicy.capText(null));
        assertEquals("https://example.com", ShareUriPolicy.capText("https://example.com"));
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < ShareUriPolicy.MAX_TEXT_CHARS + 50; i++) big.append('a');
        assertEquals(ShareUriPolicy.MAX_TEXT_CHARS, ShareUriPolicy.capText(big.toString()).length());
    }
}
