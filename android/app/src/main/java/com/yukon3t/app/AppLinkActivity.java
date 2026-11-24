package com.yukon3t.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

/**
 * Receives https://yukon3t.com links tapped in other apps (texts, WhatsApp,
 * email, including emailed sign-in and password-reset links) once Android has
 * verified the app for the domain (autoVerify filter in AndroidManifest.xml,
 * public/.well-known/assetlinks.json). Shows nothing and finishes at once:
 *
 *  - a page that opens in the app (AppLinkPolicy.opensInApp) goes to
 *    MainActivity as a VIEW intent signed with DeepLinkGuard's per-install
 *    token, so MainActivity keeps its rule that only this app's own signed
 *    intents keep their data. Capacitor then reports it as the launch URL /
 *    appUrlOpen and capacitor-bridge.tsx (openedUrlTarget) re-checks it and
 *    navigates;
 *  - an excluded path (/api/* other than sign-in callbacks, /advertise, the
 *    static files...) opens in the default browser, like on iOS;
 *  - anything else just opens the app.
 *
 * A separate activity because MainActivity is the launcher and must not have
 * its data trusted from any other app: this one forwards only a link that
 * passed AppLinkPolicy, never the caller's extras.
 */
public class AppLinkActivity extends Activity {

    private static final String TAG = "YuKon3tAppLink";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            route(getIntent());
        } catch (Throwable t) {
            Log.e(TAG, "routing a link failed", t);
            openApp(null);
        } finally {
            finish();
        }
    }

    private void route(Intent intent) {
        Uri data = intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) ? intent.getData() : null;
        if (data == null || !data.isHierarchical()
            || !AppLinkPolicy.isAppLink(data.getScheme(), data.getHost(), data.getPort(), data.getUserInfo(), data.getPath())) {
            openApp(null);
            return;
        }
        if (AppLinkPolicy.opensInApp(data.getPath())) {
            openApp(data);
        } else if (!openInBrowser(data)) {
            openApp(null);
        }
    }

    private void openApp(Uri link) {
        Intent open = link != null
            ? DeepLinkGuard.sign(this, new Intent(Intent.ACTION_VIEW, link, this, MainActivity.class))
            : new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(open);
    }

    /** The default browser, never this app again (the selector picks a browser, not a VIEW handler). */
    private boolean openInBrowser(Uri link) {
        Intent view = new Intent(Intent.ACTION_VIEW, link);
        view.addCategory(Intent.CATEGORY_BROWSABLE);
        view.setSelector(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER));
        view.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(view);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }
}
