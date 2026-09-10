package com.yukon3t.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Backs the Share-target intent-filters in AndroidManifest.xml — MainActivity's
 * setPendingShareIntent (called from onCreate/onNewIntent, same pattern as
 * handleCallDeepLink there) stashes whatever ACTION_SEND/SEND_MULTIPLE intent
 * launched or resumed the app; getPendingShare() below reads it out for the
 * JS side (share-receiver.ts) once, then clears it, so a later relaunch never
 * redelivers stale content.
 *
 * Files are read fully into memory and returned base64-encoded — the
 * simplest thing that works over the JS bridge, and fine for the photos/short
 * clips this is realistically used for, but not a good fit for a large
 * video: there's no streaming/chunking here, and base64 adds ~33% on top of
 * whatever's already held in memory twice over (the raw bytes, then the
 * encoded string) before it ever reaches JS. Revisit with a real disk-backed
 * transfer (e.g. copy to a FileProvider-exposed cache file, hand JS the
 * content:// URI, let it stream via a Capacitor filesystem read) if large
 * video sharing becomes a real use case.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {

    // 20MB — comfortably covers a phone photo or a short clip without risking
    // an OutOfMemoryError from double-buffering (raw bytes + base64 string)
    // a large video in memory on a mid-range device.
    private static final long MAX_FILE_BYTES = 20L * 1024 * 1024;

    private static Intent pendingShareIntent;

    /** Called from MainActivity, not JS — see its own doc comment for why. */
    static void setPendingShareIntent(Intent intent) {
        pendingShareIntent = intent;
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        Intent intent = pendingShareIntent;
        pendingShareIntent = null; // consumed — never redelivered on a later call/relaunch

        JSObject result = new JSObject();
        JSArray files = new JSArray();
        result.put("files", files);
        result.put("text", (String) null);

        if (intent == null) {
            call.resolve(result);
            return;
        }

        String action = intent.getAction();
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text != null) result.put("text", text);

        ContentResolver resolver = getContext().getContentResolver();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }

        for (Uri uri : uris) {
            JSObject file = readUriToJson(resolver, uri, intent.getType());
            if (file != null) files.put(file);
        }

        call.resolve(result);
    }

    private JSObject readUriToJson(ContentResolver resolver, Uri uri, String fallbackMimeType) {
        try {
            String mimeType = resolver.getType(uri);
            if (mimeType == null) mimeType = fallbackMimeType != null ? fallbackMimeType : "application/octet-stream";
            String name = queryDisplayName(resolver, uri);

            try (InputStream in = resolver.openInputStream(uri)) {
                if (in == null) return null;
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[16 * 1024];
                int read;
                long total = 0;
                while ((read = in.read(chunk)) != -1) {
                    total += read;
                    if (total > MAX_FILE_BYTES) return null; // silently skip — oversized files just don't show up on the JS side
                    buffer.write(chunk, 0, read);
                }

                JSObject file = new JSObject();
                file.put("name", name);
                file.put("mimeType", mimeType);
                file.put("base64", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
                return file;
            }
        } catch (Exception e) {
            return null; // best-effort — one unreadable file shouldn't fail the whole share
        }
    }

    /**
     * content:// URIs don't carry a filename the way a file path does — this
     * is the standard way to ask the provider for one (same column Storage
     * Access Framework pickers use), falling back to the URI's last path
     * segment for providers that don't answer it.
     */
    private String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null) return name;
                }
            }
        } catch (Exception e) {
            // fall through to the URI-based fallback below
        }
        String lastSegment = uri.getLastPathSegment();
        return lastSegment != null ? lastSegment : "shared-file";
    }
}
