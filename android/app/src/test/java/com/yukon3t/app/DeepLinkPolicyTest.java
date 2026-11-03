package com.yukon3t.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

public class DeepLinkPolicyTest {

    private static Map<String, List<String>> params(String... pairs) {
        Map<String, List<String>> out = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            out.computeIfAbsent(pairs[i], k -> new ArrayList<>()).add(pairs[i + 1]);
        }
        return out;
    }

    private static boolean allowed(String host, Map<String, List<String>> p) {
        return DeepLinkPolicy.isAllowedLink("yukon3t", host, "", false, p);
    }

    @Test
    public void notificationCallLinksAreAllowed() {
        assertTrue(allowed("call", params("callId", "cmh1abc2d0000xyz")));
        assertTrue(allowed("call", params("callId", "cmh1abc2d0000xyz", "action", "accept")));
        assertTrue(allowed("call", params("callId", "cmh1abc2d0000xyz", "action", "decline")));
    }

    @Test
    public void malformedCallLinksAreRefused() {
        assertFalse(allowed("call", params()));
        assertFalse(allowed("call", params("callId", "")));
        assertFalse(allowed("call", params("callId", "a/b")));
        assertFalse(allowed("call", params("callId", "https://evil.example")));
        assertFalse(allowed("call", params("callId", "c1", "action", "join")));
        assertFalse(allowed("call", params("callId", "c1", "action", "accept", "action", "decline")));
        assertFalse(allowed("call", params("callId", "c1", "callId", "c2")));
        assertFalse(allowed("call", params("callId", "c1", "url", "https://evil.example")));
        StringBuilder tooLong = new StringBuilder();
        for (int i = 0; i < 65; i++) tooLong.append('a');
        assertFalse(allowed("call", params("callId", tooLong.toString())));
    }

    @Test
    public void missedCallOpenLinksAreAllowed() {
        assertTrue(allowed("open", params("path", "/u/caller", "n", "call1")));
        assertTrue(allowed("open", params("path", "/messages/c1?x=1")));
    }

    @Test
    public void openLinksCannotLeaveTheApp() {
        assertFalse(allowed("open", params("path", "//evil.example/x")));
        assertFalse(allowed("open", params("path", "/\\evil.example")));
        assertFalse(allowed("open", params("path", "https://evil.example")));
        assertFalse(allowed("open", params("path", "javascript:alert(1)")));
        assertFalse(allowed("open", params("path", "")));
        assertFalse(allowed("open", params("path", "/a\nb")));
        assertFalse(allowed("open", params()));
        assertFalse(allowed("open", params("path", "/u/a", "n", "x y")));
        assertFalse(allowed("open", params("path", "/u/a", "redirect", "https://evil.example")));
        StringBuilder longPath = new StringBuilder("/");
        for (int i = 0; i < 500; i++) longPath.append('a');
        assertFalse(allowed("open", params("path", longPath.toString())));
    }

    @Test
    public void otherShapesAreRefused() {
        assertFalse(allowed("share", params()));
        assertFalse(allowed("other", params("path", "/u/x")));
        assertFalse(allowed(null, params("callId", "c1")));
        assertFalse(DeepLinkPolicy.isAllowedLink("https", "call", "", false, params("callId", "c1")));
        assertFalse(DeepLinkPolicy.isAllowedLink(null, "call", "", false, params("callId", "c1")));
        assertFalse(DeepLinkPolicy.isAllowedLink("yukon3t", "call", "/x", false, params("callId", "c1")));
        assertFalse(DeepLinkPolicy.isAllowedLink("yukon3t", "call", "", true, params("callId", "c1")));
        assertTrue(DeepLinkPolicy.isAllowedLink("YUKON3T", "call", null, false, params("callId", "c1")));
        assertTrue(DeepLinkPolicy.isAllowedLink("yukon3t", "call", "/", false, params("callId", "c1")));
        assertFalse(DeepLinkPolicy.isAllowedLink("yukon3t", "call", "", false, null));
    }

    @Test
    public void tokenComparison() {
        assertTrue(DeepLinkPolicy.tokensMatch("abc", "abc"));
        assertFalse(DeepLinkPolicy.tokensMatch("abc", "abd"));
        assertFalse(DeepLinkPolicy.tokensMatch("abc", "ab"));
        assertFalse(DeepLinkPolicy.tokensMatch("abc", null));
        assertFalse(DeepLinkPolicy.tokensMatch(null, null));
        assertFalse(DeepLinkPolicy.tokensMatch("", ""));
        assertFalse(DeepLinkPolicy.tokensMatch("abc", ""));
    }

    @Test
    public void safeInAppPath() {
        assertTrue(DeepLinkPolicy.isSafeInAppPath("/"));
        assertTrue(DeepLinkPolicy.isSafeInAppPath("/post/abc#c1"));
        assertFalse(DeepLinkPolicy.isSafeInAppPath(null));
        assertFalse(DeepLinkPolicy.isSafeInAppPath("u/x"));
        assertFalse(DeepLinkPolicy.isSafeInAppPath("//x"));
        assertFalse(DeepLinkPolicy.isSafeInAppPath("/a\tb"));
    }
}
