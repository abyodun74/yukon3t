package com.yukon3t.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
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

            String mimeType = resolver.getType(uri);
            JSObject image = new JSObject();
            image.put("base64", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            image.put("mimeType", mimeType != null ? mimeType : "image/jpeg");
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
}
