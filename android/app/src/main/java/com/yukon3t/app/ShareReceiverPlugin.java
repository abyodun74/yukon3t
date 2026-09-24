package com.yukon3t.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Backs the Share-target intent-filters in AndroidManifest.xml — MainActivity's
 * setPendingShareIntent (called from onCreate/onNewIntent, same pattern as
 * handleCallDeepLink there) stashes whatever ACTION_SEND/SEND_MULTIPLE intent
 * launched or resumed the app; getPendingShare() below reads it out for the
 * JS side (share-receiver.ts) once, then clears it, so a later relaunch never
 * redelivers stale content.
 *
 * Copies each shared file into this app's own cache dir via a streaming copy
 * and hands JS a plain file path — NOT the base64-over-the-bridge approach
 * this file used before. That approach had to cap files at 20MB to avoid an
 * OutOfMemoryError from holding both the raw bytes and the ~33%-larger
 * base64 string in memory at once — comfortably enough for a photo, nowhere
 * near enough for a real-world shared video: an Instagram Reel, TikTok, or
 * Facebook video commonly exceeds 20MB even at well under a minute long, so
 * it silently vanished under that cap with no indication why — confirmed
 * live: a user sharing an Instagram Reel got told "that app only shared a
 * link," which was wrong — Instagram *had* attached the actual video (same
 * as it does to WhatsApp/TikTok/etc., which is also why those platforms'
 * own watermarks are baked into videos shared this way — there'd be no
 * point watermarking pixels that never leave the app as a real file), this
 * plugin just dropped it before JS ever saw it. Handing JS a file path
 * instead (read via Capacitor.convertFileSrc + fetch(), see
 * share-receiver.ts) lets the WebView stream the bytes itself — no full
 * in-memory duplicate at any point on this side — so the only real ceiling
 * left is MAX_SHARE_FILE_BYTES below, sized to match this app's own upload
 * limits rather than an implementation artifact of the old approach.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {

    // Matches storage.ts's own MAX_VIDEO_BYTES ceiling — no reason a shared
    // video should be held to a tighter limit than one recorded/picked
    // directly in the app, now that this no longer double-buffers in memory.
    private static final long MAX_SHARE_FILE_BYTES = 2048L * 1024 * 1024;
    // A share whose JS side never finished reading it (app killed mid-flow,
    // a crash, etc.) would otherwise leave its cached copy behind forever —
    // swept out the next time a *new* share comes in, rather than needing a
    // separate cleanup round-trip from JS once it's done fetching.
    private static final long STALE_FILE_MS = 5 * 60 * 1000;

    private static Intent pendingShareIntent;

    /** Called from MainActivity, not JS — see its own doc comment for why. */
    static void setPendingShareIntent(Intent intent) {
        pendingShareIntent = intent;
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        Intent intent = pendingShareIntent;
        pendingShareIntent = null; // consumed — never redelivered on a later call/relaunch

        Context context = getContext();
        File shareDir = new File(context.getCacheDir(), "pending_share");
        sweepStaleFiles(shareDir);

        JSObject result = new JSObject();
        JSArray files = new JSArray();
        result.put("files", files);
        result.put("text", (String) null);
        result.put("skipped", 0);

        if (intent == null) {
            call.resolve(result);
            return;
        }

        String action = intent.getAction();
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text != null) result.put("text", text);

        ContentResolver resolver = context.getContentResolver();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }

        int skipped = 0;
        for (Uri uri : uris) {
            JSObject file = copyUriToCache(resolver, uri, intent.getType(), shareDir);
            if (file != null) {
                files.put(file);
            } else {
                skipped++;
            }
        }
        result.put("skipped", skipped);

        call.resolve(result);
    }

    /**
     * Streams `uri`'s content straight to a file in `shareDir` — never
     * holding more than one 64KB chunk in memory at a time, unlike the old
     * ByteArrayOutputStream-then-base64 approach. Returns the file's own
     * absolute path (not a content:// URI — this is now *our* file, on
     * local disk, not something the WebView needs SAF permissions to read).
     */
    private JSObject copyUriToCache(ContentResolver resolver, Uri uri, String fallbackMimeType, File shareDir) {
        File dest = null;
        try {
            if (!shareDir.exists()) shareDir.mkdirs();

            String mimeType = resolver.getType(uri);
            if (mimeType == null) mimeType = fallbackMimeType != null ? fallbackMimeType : "application/octet-stream";
            String name = queryDisplayName(resolver, uri);
            dest = new File(shareDir, UUID.randomUUID().toString() + extensionFor(mimeType, name));

            try (InputStream in = resolver.openInputStream(uri);
                 OutputStream out = new FileOutputStream(dest)) {
                if (in == null) return null;
                byte[] chunk = new byte[64 * 1024];
                int read;
                long total = 0;
                while ((read = in.read(chunk)) != -1) {
                    total += read;
                    // Oversized — reported back as "skipped" rather than
                    // silently vanishing, since the whole point of this
                    // feature is handing over the real media, not quietly
                    // falling back to nothing.
                    if (total > MAX_SHARE_FILE_BYTES) {
                        out.close();
                        dest.delete();
                        return null;
                    }
                    out.write(chunk, 0, read);
                }
            }

            JSObject file = new JSObject();
            file.put("name", name);
            file.put("mimeType", mimeType);
            file.put("path", dest.getAbsolutePath());
            return file;
        } catch (Exception e) {
            if (dest != null) dest.delete(); // don't leave a partial file behind
            return null; // best-effort — one unreadable file shouldn't fail the whole share
        }
    }

    /**
     * The cached copy needs *some* extension for Capacitor.convertFileSrc's
     * MIME sniffing (and for the JS-side File object's own name) to work
     * reliably — the source content:// URI's own display name usually
     * already has one, but content providers aren't required to supply one
     * at all, so this falls back to inferring one from the MIME type itself.
     */
    private String extensionFor(String mimeType, String name) {
        int dot = name.lastIndexOf('.');
        if (dot >= 0 && dot < name.length() - 1) return name.substring(dot);
        if (mimeType.startsWith("video/")) return ".mp4";
        if (mimeType.equals("image/png")) return ".png";
        if (mimeType.startsWith("image/")) return ".jpg";
        return "";
    }

    private void sweepStaleFiles(File shareDir) {
        File[] existing = shareDir.listFiles();
        if (existing == null) return;
        long cutoff = System.currentTimeMillis() - STALE_FILE_MS;
        for (File f : existing) {
            if (f.lastModified() < cutoff) f.delete();
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
