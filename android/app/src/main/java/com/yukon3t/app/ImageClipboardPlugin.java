package com.yukon3t.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;

/**
 * Puts a picture on the system clipboard, so the press-and-hold "Copy photo" menu
 * (src/components/link-copy-menu.tsx, via src/lib/copy-image.ts) can paste as a real photo
 * into other apps. The WebView's own async Clipboard API can't do this on Android:
 * Chromium's Android clipboard silently drops an image unless the embedding app
 * installed an image file provider (only Chrome does), so navigator.clipboard.write
 * resolves but nothing is copied.
 *
 * Android's clipboard only carries a picture as a content:// URI, so the bytes the web
 * side already fetched and converted (PNG, longest side capped at 4096px) are written to
 * cacheDir/clipboard-images/ and exposed through the app's existing FileProvider
 * (${applicationId}.fileprovider, whose file_paths.xml already covers the whole cache dir).
 * ClipboardService grants a temporary read permission on the URI to whichever app reads
 * the clip, because that provider has grantUriPermissions="true". Only the newest
 * KEEP_FILES copies are kept, so a clipboard history (e.g. Gboard's) can still paste a
 * recent one without the folder growing.
 *
 * Android 13+ shows its own "Copied" preview for every clipboard write; the web menu's
 * in-place "Photo copied" status is not a toast, so the two don't stack.
 */
@CapacitorPlugin(name = "ImageClipboard")
public class ImageClipboardPlugin extends Plugin {

    private static final String DIR_NAME = "clipboard-images";
    private static final int KEEP_FILES = 5;
    /** A 4096x4096 PNG of a noisy photo is ~30-50 MB; anything past this is not one of ours. */
    private static final int MAX_BYTES = 64 * 1024 * 1024;

    @PluginMethod
    public void copyImage(PluginCall call) {
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "image/png");
        String ext = extensionFor(mimeType);
        if (data == null || data.isEmpty()) {
            call.reject("missing_data");
            return;
        }
        if (ext == null) {
            call.reject("unsupported_type");
            return;
        }
        // Base64 inflates by 4/3; reject before allocating the decoded copy.
        if ((long) data.length() * 3 / 4 > MAX_BYTES) {
            call.reject("too_large");
            return;
        }

        Context context = getContext();
        File file;
        Uri uri;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > MAX_BYTES) {
                call.reject("too_large");
                return;
            }
            // Only a decodable image goes on the clipboard (bounds only, no pixel allocation).
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                call.reject("not_an_image");
                return;
            }

            File dir = new File(context.getCacheDir(), DIR_NAME);
            if (!dir.isDirectory() && !dir.mkdirs()) {
                call.reject("cache_unavailable");
                return;
            }
            file = new File(dir, "yukon3t-photo-" + System.currentTimeMillis() + "." + ext);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            pruneOldCopies(dir, file);
            uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        } catch (OutOfMemoryError e) {
            // Never take the app down over a copy.
            call.reject("too_large");
            return;
        } catch (Exception e) {
            // Bad base64 (IllegalArgumentException), disk full, or a FileProvider path mismatch.
            call.reject("write_failed", e);
            return;
        }

        final Uri clipUri = uri;
        Runnable setClip = () -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard == null) {
                    call.reject("clipboard_unavailable");
                    return;
                }
                // newUri asks the provider for the type (image/png from the extension), so
                // the clip description advertises an image to apps that read it.
                ClipData clip = ClipData.newUri(context.getContentResolver(), "Photo", clipUri);
                clipboard.setPrimaryClip(clip);
                call.resolve();
            } catch (Exception e) {
                // e.g. SecurityException from a provider/grant problem.
                call.reject("clipboard_failed", e);
            }
        };
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(setClip);
        else setClip.run();
    }

    private static String extensionFor(String mimeType) {
        if (mimeType == null) return null;
        switch (mimeType) {
            case "image/png":
                return "png";
            case "image/jpeg":
                return "jpg";
            case "image/webp":
                return "webp";
            default:
                return null;
        }
    }

    /** Deletes all but the newest KEEP_FILES copies; never the one just written. */
    private static void pruneOldCopies(File dir, File keep) {
        File[] files = dir.listFiles();
        if (files == null || files.length <= KEEP_FILES) return;
        Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = KEEP_FILES; i < files.length; i++) {
            if (!files[i].equals(keep)) {
                //noinspection ResultOfMethodCallIgnored
                files[i].delete();
            }
        }
    }
}
