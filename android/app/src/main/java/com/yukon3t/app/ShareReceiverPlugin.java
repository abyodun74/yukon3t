package com.yukon3t.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
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
 * base64 string in memory at once — too tight for a real video file, so this
 * plugin now streams straight to disk instead (see MAX_SHARE_FILE_BYTES).
 * This matters whenever a source app *does* hand over a real file — most
 * reliably a locally-saved photo/video shared from Gallery/Photos, or
 * whichever other apps turn out to behave this way.
 *
 * IMPORTANT, confirmed live via adb logcat (2026-09-25) — corrects a wrong
 * assumption an earlier pass at this file stated as fact: sharing an
 * Instagram Reel or photo post to this app via its own share sheet's
 * "More"/system-chooser option does NOT attach a real file at all, for
 * either photos or videos — the actual Android Intent handed to this app
 * contains only ACTION_SEND with a text/plain EXTRA_TEXT link, no
 * EXTRA_STREAM whatsoever. Same result from TikTok. This is decided
 * entirely inside those apps' own closed-source code before the Intent is
 * even constructed — there is nothing on the receiving side (this plugin,
 * or any third-party app) that can change what gets attached. The apps
 * that reportedly *do* receive real media from Instagram this way
 * (WhatsApp, Messenger) are Meta's own sibling apps, special-cased in
 * Instagram's own code — not reachable via any public Android API. Do not
 * re-investigate this as a receiving-side bug without new evidence; if it
 * needs revisiting, capture a fresh adb logcat of the actual Intent first.
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

        // A Uri (Parcelable) extra crossing over from another app's process
        // needs the receiving side's own ClassLoader explicitly set before
        // it's read, or Bundle.getParcelable can silently return null
        // instead of the real value/throwing. Genuinely worth doing (the
        // typed getParcelableExtra(String, Class) overload below is
        // Android's own recommended fix for exactly this on API 33+) — but
        // NOT what was behind the "Instagram/TikTok share comes back
        // link-only" report: confirmed via adb logcat (2026-09-25) that
        // those apps' own Intent never carries EXTRA_STREAM at all, a
        // source-app decision this class-level fix can't touch. See the
        // class doc comment above.
        intent.setExtrasClassLoader(Uri.class.getClassLoader());

        ContentResolver resolver = context.getContentResolver();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = getStreamExtra(intent);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = getStreamListExtra(intent);
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
     * The single-argument Intent#getParcelableExtra(String) is deprecated
     * as of API 33 (Tiramisu) specifically because of the silent-null
     * failure mode described above — the typed two-argument overload is
     * Android's own recommended replacement and doesn't have that issue.
     * Older OS versions never had the typed overload at all, so they keep
     * using the deprecated one (still reliable pre-33 — this bug is
     * specific to 33+'s Bundle/ClassLoader handling).
     */
    @SuppressWarnings("deprecation")
    private Uri getStreamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    /** Same reasoning as getStreamExtra above, for ACTION_SEND_MULTIPLE's list form. */
    @SuppressWarnings("deprecation")
    private ArrayList<Uri> getStreamListExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
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
