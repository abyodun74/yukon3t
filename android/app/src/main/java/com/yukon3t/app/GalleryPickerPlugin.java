package com.yukon3t.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Wraps Android's built-in Photo Picker (androidx.activity's
 * PickMultipleVisualMedia) for multi-select gallery picking from the web
 * layer — this is Google's own actively-maintained, edge-to-edge-compliant
 * picker UI, not a bundled third-party library, so it carries none of the
 * deprecated-Window-API baggage @capacitor/camera's bundled
 * io.ionic.libs:ioncamera-android did (see that dependency's removal).
 * No new Gradle dependency either — androidx.activity is already a direct
 * :app dependency for MainActivity's EdgeToEdge.enable() call.
 *
 * Resolves with each picked image as base64 + mimeType + filename rather
 * than a content:// URI: the WebView has no direct way to fetch() a
 * content:// URI, so reading the bytes here and handing them across the
 * bridge in one resolved payload is the simplest correct option. JS
 * reconstructs a File from those raw bytes (Uint8Array), not a Blob URL —
 * see upload-client.ts's resizeImageFile for why a canvas-derived Blob
 * specifically (not a plain byte-backed File) is the thing that goes stale
 * on this app's Android build; this path never produces one.
 */
@CapacitorPlugin(name = "GalleryPicker")
public class GalleryPickerPlugin extends Plugin {

    private static final int DEFAULT_LIMIT = 10;

    // Kept in sync with post-composer.tsx/story-upload-modal.tsx's own
    // IMAGE_TYPES — see readImage() below for why this exists.
    private static final Set<String> WEB_ALLOWED_IMAGE_TYPES = new HashSet<>(
        Arrays.asList("image/jpeg", "image/png", "image/webp", "image/gif")
    );

    @PluginMethod
    public void pickImages(PluginCall call) {
        int limit = call.getInt("limit", DEFAULT_LIMIT);

        ActivityResultContracts.PickMultipleVisualMedia contract = new ActivityResultContracts.PickMultipleVisualMedia(
            Math.max(2, limit)
        );

        PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
            .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
            .build();

        Intent intent = contract.createIntent(getContext(), request);

        // Kept alive across the picker Activity's own lifecycle — resolved
        // later from handlePickImagesResult, not here.
        call.setKeepAlive(true);
        startActivityForResult(call, intent, "handlePickImagesResult");
    }

    @ActivityCallback
    private void handlePickImagesResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        JSArray images = new JSArray();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            // Mirrors androidx's own GetMultipleContents.getClipDataUris(): a
            // single-fallback intent can set getData() alone, ClipData
            // alone, or (rarely) both — union rather than either/or, deduped
            // since some devices set both to the same single Uri.
            Set<Uri> uris = new LinkedHashSet<>();
            if (data.getData() != null) uris.add(data.getData());
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                for (int i = 0; i < count; i++) {
                    Uri uri = data.getClipData().getItemAt(i).getUri();
                    if (uri != null) uris.add(uri);
                }
            }

            for (Uri uri : uris) {
                JSObject image = readImage(uri);
                if (image != null) images.put(image);
            }
        }

        // Empty (not rejected) when the user backs out of the picker with
        // nothing selected — same "no-op" shape the plain <input type=file>
        // cancel path already produces for callers.
        JSObject ret = new JSObject();
        ret.put("images", images);
        call.resolve(ret);
    }

    private JSObject readImage(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            byte[] rawBytes = buffer.toByteArray();
            String mimeType = resolver.getType(uri);

            // Recent Android/Samsung camera defaults save gallery photos as
            // HEIC/HEIF, which android.graphics can decode fine natively but
            // the web layer's IMAGE_TYPES allow-list (post-composer.tsx etc.)
            // never included — confirmed live: a HEIC pick silently vanished
            // with no error, since the JS side's own MIME filter just
            // dropped it before it ever reached the upload path. Re-encoding
            // to JPEG here for anything outside that allow-list normalizes
            // it to something the web layer is guaranteed to accept — same
            // "don't trust the device's own reported format" approach
            // normalizeVideoFile takes on the web side for video. Anything
            // already in the allow-list (jpeg/png/webp/gif) is passed
            // through untouched, since re-encoding would flatten an
            // animated GIF to one frame and drop PNG alpha transparency —
            // both real regressions, not just a quality cost, for formats
            // that were never broken to begin with.
            byte[] finalBytes = rawBytes;
            String finalMimeType = mimeType != null ? mimeType : "image/jpeg";
            if (!WEB_ALLOWED_IMAGE_TYPES.contains(finalMimeType)) {
                Bitmap bitmap = BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.length);
                if (bitmap != null) {
                    try {
                        ByteArrayOutputStream jpegOut = new ByteArrayOutputStream();
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, jpegOut);
                        finalBytes = jpegOut.toByteArray();
                        finalMimeType = "image/jpeg";
                    } finally {
                        bitmap.recycle();
                    }
                }
            }

            JSObject image = new JSObject();
            image.put("base64", Base64.encodeToString(finalBytes, Base64.NO_WRAP));
            image.put("mimeType", finalMimeType);
            image.put("name", queryDisplayName(resolver, uri));
            return image;
        } catch (Exception e) {
            return null;
        }
    }

    private String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception e) {
            // Falls through to the generic name below.
        }
        return "photo.jpg";
    }

    private long queryFileSize(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (idx >= 0 && !cursor.isNull(idx)) return cursor.getLong(idx);
            }
        } catch (Exception e) {
            // Falls through to 0 below — callers treat that as "unknown
            // size", not as a real empty file.
        }
        return 0;
    }

    /**
     * Single-video counterpart to pickImages, for the same underlying
     * reason: the WebView's plain {@code <input type="file">} file-chooser
     * does not reliably deliver a content:// result back to the page for a
     * video pick on this platform — confirmed live via adb logcat (the
     * system picker opens and returns a result, but the page's file input
     * never receives it, with no error anywhere). Bypasses that broken
     * path entirely by launching Android's own picker from native code,
     * the same way pickImages already does for photos.
     *
     * Unlike pickImages, this does NOT read the video's bytes into the JS
     * bridge at all — a video can run to hundreds of MB or more, and
     * base64-inflating that across the bridge in one payload the way
     * readImage() does for photos would be impractical (bridge message
     * size, memory, both directions). Instead this resolves with just the
     * content:// URI (as a string) plus metadata and a small JPEG
     * thumbnail; uploadVideo() below then streams the actual video bytes
     * straight from ContentResolver to R2's presigned PUT URL, entirely
     * inside native code, never touching JS.
     */
    @PluginMethod
    public void pickVideo(PluginCall call) {
        PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
            .setMediaType(ActivityResultContracts.PickVisualMedia.VideoOnly.INSTANCE)
            .build();
        Intent intent = new ActivityResultContracts.PickVisualMedia().createIntent(getContext(), request);

        call.setKeepAlive(true);
        startActivityForResult(call, intent, "handlePickVideoResult");
    }

    @ActivityCallback
    private void handlePickVideoResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        Uri uri = (result.getResultCode() == Activity.RESULT_OK && data != null) ? data.getData() : null;

        JSObject ret = new JSObject();
        if (uri == null) {
            // User backed out of the picker with nothing selected — same
            // no-op shape pickImages' empty array uses for the same case.
            ret.put("uri", JSObject.NULL);
            call.resolve(ret);
            return;
        }

        // Best-effort persistable grant so this URI is still readable by
        // the time uploadVideo() — a separate, later plugin call — uses
        // it. Not every provider supports persistable grants (some
        // cloud-backed Photos URIs don't), but the URI stays readable for
        // the rest of this app session regardless of whether this throws.
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            // Ignored — see comment above.
        }

        ContentResolver resolver = getContext().getContentResolver();
        String mimeType = resolver.getType(uri);
        if (mimeType == null) mimeType = "video/mp4";
        long size = queryFileSize(resolver, uri);
        String name = queryDisplayName(resolver, uri);

        Long durationMs = null;
        String thumbnailBase64 = null;
        // release() manually rather than try-with-resources: MediaMetadataRetriever
        // only became AutoCloseable in API 29, but this app's minSdk is 24.
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            String durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (durationStr != null) durationMs = Long.parseLong(durationStr);
            long frameTimeUs = durationMs != null ? Math.min(1_000_000L, durationMs * 500) : 0;
            Bitmap frame = retriever.getFrameAtTime(frameTimeUs);
            if (frame != null) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                frame.compress(Bitmap.CompressFormat.JPEG, 85, out);
                thumbnailBase64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            }
        } catch (Exception e) {
            // Duration/thumbnail are both best-effort niceties — a codec
            // MediaMetadataRetriever can't decode shouldn't block the
            // actual upload below.
        } finally {
            try {
                retriever.release();
            } catch (Exception e) {
                // release() declares a checked IOException on newer API
                // levels — nothing useful to do about a failure to
                // release resources for an object already going out of
                // scope, so this is deliberately swallowed rather than
                // propagated past the actual result below.
            }
        }

        ret.put("uri", uri.toString());
        ret.put("name", name != null ? name : "video.mp4");
        ret.put("mimeType", mimeType);
        ret.put("size", size);
        ret.put("durationSeconds", durationMs != null ? durationMs / 1000.0 : JSObject.NULL);
        ret.put("thumbnailBase64", thumbnailBase64 != null ? thumbnailBase64 : JSObject.NULL);
        call.resolve(ret);
    }

    /**
     * Streams the video at {@code uri} (from pickVideo above) directly to
     * a presigned R2 PUT URL, entirely inside native code — the video's
     * bytes never cross the Capacitor JS bridge in either direction. Fixed
     * -length streaming (not chunked) to match what the existing plain
     * JS fetch() upload path already sends successfully for every other
     * upload kind in this app, since the presigned URL was signed against
     * an unsigned-payload scheme that doesn't otherwise care either way.
     */
    @PluginMethod
    public void uploadVideo(PluginCall call) {
        String uriString = call.getString("uri");
        String uploadUrl = call.getString("uploadUrl");
        String contentType = call.getString("contentType", "video/mp4");
        if (uriString == null || uploadUrl == null) {
            call.reject("Missing uri or uploadUrl");
            return;
        }

        Uri uri = Uri.parse(uriString);
        ContentResolver resolver = getContext().getContentResolver();
        long size = queryFileSize(resolver, uri);

        HttpURLConnection connection = null;
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) {
                call.reject("Could not open video for reading");
                return;
            }

            URL url = new URL(uploadUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("PUT");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", contentType);
            if (size > 0) {
                connection.setFixedLengthStreamingMode(size);
            } else {
                connection.setChunkedStreamingMode(64 * 1024);
            }

            try (OutputStream out = connection.getOutputStream()) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                call.reject("Upload failed with status " + status);
                return;
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Upload failed: " + e.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
