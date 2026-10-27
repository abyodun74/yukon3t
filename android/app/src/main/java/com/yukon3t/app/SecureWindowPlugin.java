package com.yukon3t.app;

import android.app.Activity;
import android.view.WindowManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Turns Android's FLAG_SECURE on and off for the app window, from the web
 * layer (src/lib/secure-window.ts). While it is on, screenshots and screen
 * recordings of the app come out black and the Recents thumbnail is blank.
 *
 * FLAG_SECURE covers the whole window, so it is never left on app-wide (that
 * would block every screenshot and break nothing-to-do-with-it features):
 * the web layer turns it on only while someone else's profile picture is
 * shown enlarged (the protected Lightbox), and off again when that closes.
 *
 * Belt and braces against it getting stuck on: every page load in the
 * WebView (a reload, a stale-build reload, a crash recovery) clears it, since
 * the JS that would have turned it off is gone at that point.
 */
@CapacitorPlugin(name = "SecureWindow")
public class SecureWindowPlugin extends Plugin {

    @Override
    public void load() {
        try {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageStarted(WebView webView) {
                    applySecure(false);
                }
            });
        } catch (Throwable t) {
            // Best-effort: the JS side still clears it on close.
        }
    }

    @PluginMethod
    public void enable(PluginCall call) {
        setSecureOnUiThread(true);
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        setSecureOnUiThread(false);
        call.resolve();
    }

    private void setSecureOnUiThread(boolean secure) {
        Activity activity = getActivity();
        if (activity == null) return;
        // Window flags may only be changed on the UI thread; plugin methods run on the bridge's own thread.
        activity.runOnUiThread(() -> applySecure(secure));
    }

    private void applySecure(boolean secure) {
        try {
            Activity activity = getActivity();
            if (activity == null || activity.getWindow() == null) return;
            if (secure) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
        } catch (Throwable t) {
            // Best-effort: never crash the app over a screenshot deterrent.
        }
    }
}
