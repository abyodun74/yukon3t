package com.yukon3t.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Shader;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Fetches the caller's profile picture for the incoming-call notification's
 * large icon (FCM `callerAvatarUrl`, see src/lib/call-avatar-server.ts):
 * an absolute, short-lived presigned https link to the caller's THUMBNAIL
 * only, never sent at all for a caller announced as "Private call".
 *
 * Never on the ring's critical path: CallMessagingService starts ringing
 * first (no picture), then hands the URL here; the notification is updated
 * in place once (and only if) the picture arrives while that same call is
 * still ringing or in progress. Any failure (timeout, too big, not an image,
 * decode error, offline) just leaves the notification without a picture.
 *
 * Runs on its own single background thread, not the FCM delivery thread, so
 * a slow download can never hold up a following call_cancelled message.
 * Keeps only the most recent caller's picture in memory (one ~256px bitmap,
 * ~256KB), for the later "Call in progress" and "Missed call" notifications
 * of that same call.
 */
final class CallAvatarLoader {

    private static final String TAG = "YuKon3tCall";

    private static final int CONNECT_TIMEOUT_MS = 4_000;
    private static final int READ_TIMEOUT_MS = 4_000;
    // The server caps an uploaded thumbnail at 2MB; anything bigger isn't ours.
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    // Large-icon size: comfortably above the ~64dp icon at xxxhdpi, small in memory.
    private static final int ICON_SIZE_PX = 256;
    private static final int MAX_URL_LENGTH = 2048;

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static final Object CACHE_LOCK = new Object();
    private static String cachedCallId;
    private static Bitmap cachedBitmap;

    private CallAvatarLoader() {}

    /** The picture already fetched for this call, or null. */
    @Nullable
    static Bitmap cached(@Nullable String callId) {
        if (callId == null) return null;
        synchronized (CACHE_LOCK) {
            return callId.equals(cachedCallId) ? cachedBitmap : null;
        }
    }

    static void clear() {
        synchronized (CACHE_LOCK) {
            cachedCallId = null;
            cachedBitmap = null;
        }
    }

    /** Starts the download in the background; returns at once. Never throws. */
    static void load(Context context, String callId, @Nullable String url) {
        if (callId == null || !isAllowedUrl(url)) return;
        final Context appContext = context.getApplicationContext();
        try {
            EXECUTOR.execute(() -> {
                Bitmap icon = null;
                try {
                    icon = fetchCircularIcon(url);
                } catch (Throwable t) {
                    // Expected now and then (offline, expired link): no picture.
                    Log.w(TAG, "caller picture unavailable: " + t.getClass().getSimpleName());
                }
                if (icon == null) return;
                final Bitmap result = icon;
                synchronized (CACHE_LOCK) {
                    cachedCallId = callId;
                    cachedBitmap = result;
                }
                // Notification state lives on the main thread (CallForegroundService).
                MAIN.post(() -> CallForegroundService.onCallerAvatarReady(appContext, callId));
            });
        } catch (Throwable t) {
            Log.w(TAG, "caller picture not scheduled", t);
        }
    }

    static boolean isAllowedUrl(@Nullable String url) {
        if (url == null || url.isEmpty() || url.length() > MAX_URL_LENGTH) return false;
        return url.startsWith("https://");
    }

    @Nullable
    private static Bitmap fetchCircularIcon(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            // A presigned link answers 200 directly; never follow a redirect anywhere else.
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "image/*");
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(java.util.Locale.ROOT).startsWith("image/")) return null;
            long declared = connection.getContentLengthLong();
            if (declared > MAX_BYTES) return null;

            byte[] bytes;
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16 * 1024];
                int total = 0;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_BYTES) return null;
                    out.write(buffer, 0, read);
                }
                bytes = out.toByteArray();
            }
            return decodeCircular(bytes);
        } finally {
            connection.disconnect();
        }
    }

    @Nullable
    private static Bitmap decodeCircular(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        // A small file can still declare absurd dimensions; a profile thumbnail never does.
        if ((long) bounds.outWidth * bounds.outHeight > 25_000_000L) return null;

        int sample = 1;
        while (Math.min(bounds.outWidth, bounds.outHeight) / (sample * 2) >= ICON_SIZE_PX) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap source = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (source == null) return null;

        // Centre-crop to a square, scale to ICON_SIZE_PX and mask to a circle,
        // the way the app shows every profile picture.
        int side = Math.min(source.getWidth(), source.getHeight());
        float scale = (float) ICON_SIZE_PX / side;
        Matrix matrix = new Matrix();
        matrix.setScale(scale, scale);
        matrix.postTranslate(
            -(source.getWidth() - side) / 2f * scale,
            -(source.getHeight() - side) / 2f * scale
        );
        BitmapShader shader = new BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        shader.setLocalMatrix(matrix);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        paint.setShader(shader);

        Bitmap output = Bitmap.createBitmap(ICON_SIZE_PX, ICON_SIZE_PX, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        float radius = ICON_SIZE_PX / 2f;
        canvas.drawCircle(radius, radius, radius, paint);
        if (source != output) source.recycle();
        return output;
    }
}
