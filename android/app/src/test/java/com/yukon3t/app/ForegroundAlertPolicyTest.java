package com.yukon3t.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ForegroundAlertPolicyTest {

    @Test
    public void channelDefaultsToAlerts() {
        assertEquals("yk_alerts", ForegroundAlertPolicy.channelFor(null));
        assertEquals("yk_alerts", ForegroundAlertPolicy.channelFor("yk_alerts"));
        assertEquals("yk_alerts", ForegroundAlertPolicy.channelFor("fcm_fallback_notification_channel"));
        assertEquals("yk_alerts", ForegroundAlertPolicy.channelFor("incoming_calls"));
        assertEquals("quiet_reminders", ForegroundAlertPolicy.channelFor("quiet_reminders"));
    }

    @Test
    public void tagUsesServerReplacementKey() {
        assertEquals("msg:abc", ForegroundAlertPolicy.tagFor("msg:abc", "1"));
        assertEquals("FCM-Notification:42", ForegroundAlertPolicy.tagFor(null, "42"));
        assertEquals("FCM-Notification:42", ForegroundAlertPolicy.tagFor("", "42"));
        StringBuilder tooLong = new StringBuilder();
        for (int i = 0; i < 65; i++) tooLong.append('a');
        assertEquals("FCM-Notification:7", ForegroundAlertPolicy.tagFor(tooLong.toString(), "7"));
    }

    @Test
    public void sameScreenOnlyForTheExactPage() {
        assertTrue(ForegroundAlertPolicy.isSameScreen("https://yukon3t.com/messages/c1", "/messages/c1"));
        assertTrue(ForegroundAlertPolicy.isSameScreen("https://yukon3t.com/messages/c1/", "/messages/c1"));
        assertTrue(ForegroundAlertPolicy.isSameScreen("https://www.yukon3t.com/p/x?story=1", "/p/x?story=1"));
        assertTrue(ForegroundAlertPolicy.isSameScreen("https://yukon3t.com/messages/c1#bottom", "/messages/c1"));

        assertFalse(ForegroundAlertPolicy.isSameScreen("https://yukon3t.com/messages/c2", "/messages/c1"));
        assertFalse(ForegroundAlertPolicy.isSameScreen("https://yukon3t.com/messages", "/messages/c1"));
        assertFalse(ForegroundAlertPolicy.isSameScreen("https://yukon3t.com/p/x", "/p/x?story=1"));
        assertFalse(ForegroundAlertPolicy.isSameScreen("https://evil.example/messages/c1", "/messages/c1"));
        assertFalse(ForegroundAlertPolicy.isSameScreen("http://yukon3t.com/messages/c1", "/messages/c1"));
        assertFalse(ForegroundAlertPolicy.isSameScreen(null, "/messages/c1"));
        assertFalse(ForegroundAlertPolicy.isSameScreen("https://yukon3t.com/home", null));
        assertFalse(ForegroundAlertPolicy.isSameScreen("https://yukon3t.com/home", "//evil.example/home"));
        assertFalse(ForegroundAlertPolicy.isSameScreen("not a url %%", "/home"));
    }
}
