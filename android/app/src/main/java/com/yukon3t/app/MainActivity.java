package com.yukon3t.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.WindowManager;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    // How long this Activity stays able to draw over a locked screen after
    // handling an incoming call — bounded rather than left on indefinitely,
    // so a phone that locks again later (long after any call activity, e.g.
    // mid-chat) doesn't keep bypassing the keyguard for whatever this
    // Activity happens to be showing by then. Generous enough to cover a
    // secure lock screen's own authentication challenge (still shown on top
    // of this — see showOverLockScreenBriefly) plus the JS side joining.
    private static final long SHOW_OVER_LOCK_SCREEN_MS = 30_000;
    private final Handler lockScreenHandler = new Handler(Looper.getMainLooper());
    private final Runnable clearShowOverLockScreen = () -> setShowOverLockScreen(false);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate() — that's where BridgeActivity
        // actually builds the Bridge from the plugin list accumulated so far.
        registerPlugin(CallForegroundPlugin.class);
        registerPlugin(ScreenCaptureGuardPlugin.class);
        registerPlugin(VolumeButtonPlugin.class);
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
        handleCallDeepLink(getIntent());
        handleShareIntent(getIntent());
    }

    /**
     * Forwards volume-up to VolumeButtonPlugin without consuming it — always
     * calls super so Android's own volume change/UI happens exactly as it
     * would with no listener at all. This is the only way to observe a
     * hardware key press at all (there's no web API for it); onKeyDown
     * rather than a dedicated key-event API since Capacitor plugins don't
     * receive key events on their own.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            PluginHandle handle = getBridge().getPlugin("VolumeButton");
            if (handle != null && handle.getInstance() instanceof VolumeButtonPlugin) {
                ((VolumeButtonPlugin) handle.getInstance()).notifyVolumeUp();
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    // singleTask launch mode (see AndroidManifest.xml) redelivers an
    // already-running Activity's new launch intent here instead of a fresh
    // onCreate — this is the path a notification tap takes while the app is
    // already alive. Capacitor's own BridgeActivity.onNewIntent is what
    // fires the "appUrlOpen" event incoming-call-listener.tsx listens for;
    // calling super first preserves that unchanged.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleCallDeepLink(intent);
        handleShareIntent(intent);
    }

    /**
     * Stashes an incoming ACTION_SEND/SEND_MULTIPLE intent (another app's
     * Share sheet targeting "YuKon3t") in ShareReceiverPlugin's static
     * holder for the JS side to read once it's ready — see that plugin's
     * own doc comment for why this is a plain field rather than notifying
     * listeners immediately (the Bridge/JS may not be listening yet this
     * early in onCreate, and share-receiver.ts polls for it on launch
     * instead of needing an event).
     */
    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        ShareReceiverPlugin.setPendingShareIntent(intent);
    }

    /**
     * Stops the native ring (service + sound) and dismisses its notification
     * the instant the incoming-call notification's Accept/Decline action
     * opens this Activity — previously done by CallActionReceiver, a
     * BroadcastReceiver that called context.startActivity() itself. That
     * indirection turned out to be unreliable on-device (Samsung/Android
     * 16): a background-activity-launch exemption not reliably carrying
     * through the extra broadcast hop, so the tap sometimes silently did
     * nothing. The notification's Accept/Decline PendingIntents now launch
     * this Activity directly (CallForegroundService.actionIntent), the same
     * always-allowed path a plain notification-body tap already used, and
     * this replicates the rest of what the receiver used to do.
     */
    private void handleCallDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();
        if (!"yukon3t".equals(uri.getScheme()) || !"call".equals(uri.getHost())) return;

        String callId = uri.getQueryParameter("callId");
        if (callId == null) return;

        // Covers both the automatic full-screen presentation (bare callId,
        // no action — fires the instant a call rings while the phone is
        // locked/asleep, see CallForegroundService.showRingingNotification's
        // contentIntent) and an explicit Accept/Decline notification-action
        // tap below — either way, a locked/asleep phone is exactly the case
        // this exists to handle. Without this, the tap/launch lands behind
        // the keyguard instead of actually surfacing the call.
        showOverLockScreenBriefly();

        String action = uri.getQueryParameter("action");
        if (action == null) return;
        if (!"accept".equals(action) && !"decline".equals(action)) return;

        NotificationManagerCompat.from(this).cancel(CallForegroundService.notificationId(callId));
        CallForegroundService.stopRinging(this, callId);
    }

    /**
     * Lets this Activity draw over a locked screen and turns the display on.
     * A *secure* lock screen (PIN/pattern/biometric) still challenges for
     * authentication on top of this, exactly like a real incoming call —
     * this only removes the extra "unlock to the home screen, then
     * separately find and open the app" friction a plain notification tap
     * would otherwise require, which is what left Accept/Decline effectively
     * stranded behind the keyguard. Reverted after SHOW_OVER_LOCK_SCREEN_MS
     * (see that field) rather than left on indefinitely.
     */
    private void showOverLockScreenBriefly() {
        setShowOverLockScreen(true);
        lockScreenHandler.removeCallbacks(clearShowOverLockScreen);
        lockScreenHandler.postDelayed(clearShowOverLockScreen, SHOW_OVER_LOCK_SCREEN_MS);
    }

    private void setShowOverLockScreen(boolean show) {
        // setShowWhenLocked/setTurnScreenOn were added in API 27; this app's
        // minSdkVersion is 24, so older devices fall back to the equivalent
        // (much older, still-supported) window flags instead.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(show);
            setTurnScreenOn(show);
        } else if (show) {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        } else {
            getWindow().clearFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }

        // requestDismissKeyguard (API 26+) is what actually prompts a secure
        // lock screen's own PIN/pattern/biometric challenge on top of this
        // Activity, the same clean hand-off a real incoming call gets —
        // without it, some devices/keyguard configs would otherwise leave
        // the user on a bare lock screen with no obvious path back to the
        // call even with showWhenLocked set. No equivalent exists below
        // API 26; those devices rely on showWhenLocked alone.
        if (show && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        }
    }

    @Override
    public void onDestroy() {
        // BridgeActivity's own onDestroy() (Capacitor) is declared public,
        // widened from Activity's own protected — Java doesn't allow
        // narrowing it back down in this subclass, hence public here too.
        lockScreenHandler.removeCallbacks(clearShowOverLockScreen);
        super.onDestroy();
    }
}
