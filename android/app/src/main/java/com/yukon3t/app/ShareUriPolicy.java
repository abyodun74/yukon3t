package com.yukon3t.app;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Pure rules (no Android framework calls, so they run as plain JVM unit tests,
 * see ShareUriPolicyTest) for what ShareReceiverPlugin may read from another
 * app's ACTION_SEND / ACTION_SEND_MULTIPLE intent.
 *
 * The threat (security audit M6): MainActivity is exported and accepts SEND
 * from any installed app, and the plugin opens EXTRA_STREAM with THIS app's
 * own identity. A malicious app could hand it file:///data/data/com.yukon3t.app/
 * app_webview/Default/Cookies (the session cookie DB), shared_prefs, databases,
 * or a content:// URI of this app's own FileProvider, labelled "image/jpeg",
 * and YuKon3t would copy the file into the composer where an upload or a tap
 * posts or sends it. The plugin therefore:
 *  1. accepts only content:// (never file://, android.resource://, ...);
 *  2. refuses every content provider this app itself declares, except its own
 *     FileProvider, and that one only for files inside the share-out dirs
 *     (OWN_PROVIDER_ALLOWED_DIRS), so sharing a post's picture from YuKon3t
 *     back into YuKon3t keeps working;
 *  3. after opening, reads the real path of the file descriptor it actually
 *     got (/proc/self/fd, so symlinks, "..", "0@authority" user-prefixed
 *     authorities and any provider bug are all judged on where the bytes really
 *     live) and refuses anything inside this app's private storage;
 *  4. only takes image/video/audio types, caps the size per type, the number
 *     of files and the shared text, and refuses content whose first bytes are
 *     an SQLite database or an XML/HTML document whatever it is labelled.
 */
final class ShareUriPolicy {

    private ShareUriPolicy() {}

    /** Most files one share may carry (the post composer's album cap). Extras count as skipped. */
    static final int MAX_FILES = 10;
    /** Shared text (a link and a caption, in practice) is cut to this many characters. */
    static final int MAX_TEXT_CHARS = 10_000;

    static final long MAX_IMAGE_BYTES = 64L * 1024 * 1024;
    /** Same ceiling as storage.ts's MAX_VIDEO_BYTES. */
    static final long MAX_VIDEO_BYTES = 2048L * 1024 * 1024;
    static final long MAX_AUDIO_BYTES = 200L * 1024 * 1024;

    /** Subdirectories of the cache dir this app's own FileProvider may hand back in. */
    static final String[] OWN_PROVIDER_ALLOWED_DIRS = {"share-out", "clipboard-images"};

    private static final Pattern SAFE_EXTENSION = Pattern.compile("^\\.[A-Za-z0-9]{1,8}$");
    private static final Pattern USER_ID_PREFIX = Pattern.compile("^\\d+@");

    // ---- scheme / authority -------------------------------------------------

    /** Only content:// is accepted; file:// in particular reads with this app's own permissions. */
    static boolean isAcceptedScheme(String scheme) {
        return scheme != null && scheme.toLowerCase(Locale.ROOT).equals("content");
    }

    /**
     * "10@com.example.provider" addresses a provider as another Android user;
     * ContentResolver strips the prefix to find the provider, so ownership is
     * judged on the authority without it.
     */
    static String authorityWithoutUserId(String authority) {
        if (authority == null) return null;
        return USER_ID_PREFIX.matcher(authority).replaceFirst("");
    }

    static boolean hasUserIdPrefix(String authority) {
        return authority != null && USER_ID_PREFIX.matcher(authority).find();
    }

    static String ownFileProviderAuthority(String packageName) {
        return packageName + ".fileprovider";
    }

    // ---- paths --------------------------------------------------------------

    /**
     * Lexically normalises an absolute path (collapses "//", resolves "." and
     * ".."; a ".." above the root stays at the root, as the kernel does), and
     * drops the " (deleted)" suffix /proc adds for an unlinked file. Returns
     * null for anything that isn't an absolute filesystem path, e.g. the
     * "pipe:[1234]" or "socket:[..]" a provider that streams gives back.
     */
    static String normalizePath(String path) {
        if (path == null) return null;
        String p = path;
        if (p.endsWith(" (deleted)")) p = p.substring(0, p.length() - " (deleted)".length());
        if (!p.startsWith("/")) return null;
        if (p.indexOf('\0') >= 0) return null;
        Deque<String> parts = new ArrayDeque<>();
        for (String segment : p.split("/")) {
            if (segment.isEmpty() || segment.equals(".")) continue;
            if (segment.equals("..")) {
                if (!parts.isEmpty()) parts.removeLast();
                continue;
            }
            parts.addLast(segment);
        }
        if (parts.isEmpty()) return "/";
        StringBuilder out = new StringBuilder();
        for (String segment : parts) out.append('/').append(segment);
        return out.toString();
    }

    /** True when `path` is `root` or below it (both normalised; "/a/bc" is not inside "/a/b"). */
    static boolean isInside(String path, String root) {
        String p = normalizePath(path);
        String r = normalizePath(root);
        if (p == null || r == null) return false;
        if (r.equals("/")) return true;
        return p.equals(r) || p.startsWith(r + "/");
    }

    /**
     * True for a path inside this app's own storage: any of `privateRoots`
     * (the Context's data/cache/files/external-app dirs, canonical and not),
     * or any path with a component equal to the package name, which covers
     * every alias of the app's dirs without listing them: /data/data/<pkg>,
     * /data/user/N/<pkg>, /data/user_de/N/<pkg>, /mnt/expand/<uuid>/user/N/<pkg>,
     * .../Android/data/<pkg>, .../Android/obb/<pkg> and /data/media/N/... forms.
     */
    static boolean isPrivatePath(String path, String packageName, List<String> privateRoots) {
        String p = normalizePath(path);
        if (p == null) return false;
        for (String segment : p.split("/")) {
            if (segment.equals(packageName)) return true;
        }
        if (privateRoots != null) {
            for (String root : privateRoots) {
                if (root != null && isInside(p, root)) return true;
            }
        }
        return false;
    }

    enum OpenedFileDecision { ALLOW, REJECT }

    /**
     * Judges the file descriptor a provider actually handed back, by the real
     * path /proc/self/fd reports for it (`fdPath`, null when it couldn't be
     * read).
     *
     * - From this app's own FileProvider: only a real file inside one of
     *   `allowedOwnDirs` (the share-out dirs); a pipe, an unreadable fd or any
     *   other path is refused.
     * - From anyone else: refused if it resolves into this app's private
     *   storage (which no other app's provider can legitimately open), refused
     *   if the fd path couldn't be read at all (fail closed), otherwise
     *   allowed — including pipes, which is how cloud-backed providers stream.
     */
    static OpenedFileDecision decideOpenedFile(
        String fdPath,
        boolean fromOwnProvider,
        String packageName,
        List<String> privateRoots,
        List<String> allowedOwnDirs
    ) {
        if (fdPath == null) return OpenedFileDecision.REJECT;
        String p = normalizePath(fdPath);
        if (fromOwnProvider) {
            if (p == null || allowedOwnDirs == null) return OpenedFileDecision.REJECT;
            for (String dir : allowedOwnDirs) {
                if (dir != null && isInside(p, dir) && !p.equals(normalizePath(dir))) {
                    return OpenedFileDecision.ALLOW;
                }
            }
            return OpenedFileDecision.REJECT;
        }
        if (p == null) {
            // Not a filesystem path: a pipe/socket/anon inode the provider
            // streams through. Nothing of ours can be behind it.
            return isStreamDescriptor(fdPath) ? OpenedFileDecision.ALLOW : OpenedFileDecision.REJECT;
        }
        return isPrivatePath(p, packageName, privateRoots) ? OpenedFileDecision.REJECT : OpenedFileDecision.ALLOW;
    }

    private static boolean isStreamDescriptor(String fdPath) {
        return fdPath.startsWith("pipe:") || fdPath.startsWith("socket:") || fdPath.startsWith("anon_inode:");
    }

    // ---- types and sizes ----------------------------------------------------

    /** "image/JPEG; charset=x" -> "image/jpeg"; null/blank stays null. */
    static String baseMime(String mime) {
        if (mime == null) return null;
        String m = mime.trim().toLowerCase(Locale.ROOT);
        int semi = m.indexOf(';');
        if (semi >= 0) m = m.substring(0, semi).trim();
        return m.isEmpty() ? null : m;
    }

    /**
     * A concrete image/video/audio type (no wildcard, no SVG: an XML document
     * the web side doesn't accept anyway). ACTION_SEND_MULTIPLE is declared
     * for images and videos only, so audio isn't taken there.
     */
    static boolean isAllowedMime(String mime, boolean multiple) {
        String m = baseMime(mime);
        if (m == null) return false;
        int slash = m.indexOf('/');
        if (slash <= 0 || slash == m.length() - 1) return false;
        String subtype = m.substring(slash + 1);
        if (subtype.equals("*") || subtype.contains("/")) return false;
        if (m.startsWith("image/")) return !subtype.startsWith("svg");
        if (m.startsWith("video/")) return true;
        if (m.startsWith("audio/")) return !multiple;
        return false;
    }

    /**
     * The type to treat a shared file as: the provider's own answer if it is
     * an allowed concrete type; else the intent's declared type if that one
     * is; else a type inferred from the display name's extension (some
     * providers answer "application/octet-stream" for a real photo). Null
     * when none of those gives an allowed type, i.e. the file is refused.
     */
    static String resolveMime(String providerType, String intentType, String displayName, boolean multiple) {
        if (isAllowedMime(providerType, multiple)) return baseMime(providerType);
        String generic = baseMime(providerType);
        // A provider that names a concrete type outside image/video/audio
        // (text/html, application/x-sqlite3, ...) is believed: refused.
        if (generic != null && !generic.equals("application/octet-stream") && !generic.endsWith("/*")) {
            return null;
        }
        if (isAllowedMime(intentType, multiple)) return baseMime(intentType);
        String byName = mimeForExtension(displayName);
        return isAllowedMime(byName, multiple) ? byName : null;
    }

    static String mimeForExtension(String name) {
        if (name == null) return null;
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return null;
        switch (name.substring(dot + 1).toLowerCase(Locale.ROOT)) {
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "heic": return "image/heic";
            case "heif": return "image/heif";
            case "bmp": return "image/bmp";
            case "mp4":
            case "m4v": return "video/mp4";
            case "mov": return "video/quicktime";
            case "3gp":
            case "3gpp": return "video/3gpp";
            case "webm": return "video/webm";
            case "mkv": return "video/x-matroska";
            case "avi": return "video/x-msvideo";
            case "mp3": return "audio/mpeg";
            case "m4a": return "audio/mp4";
            case "aac": return "audio/aac";
            case "wav": return "audio/wav";
            case "ogg": return "audio/ogg";
            case "opus": return "audio/opus";
            default: return null;
        }
    }

    static long maxBytesFor(String mime) {
        String m = baseMime(mime);
        if (m == null) return 0;
        if (m.startsWith("video/")) return MAX_VIDEO_BYTES;
        if (m.startsWith("audio/")) return MAX_AUDIO_BYTES;
        if (m.startsWith("image/")) return MAX_IMAGE_BYTES;
        return 0;
    }

    /**
     * True when the first bytes are clearly not media but the kind of file
     * an app keeps privately: an SQLite database (cookies, WebView storage,
     * app databases) or an XML/HTML document (shared_prefs). Defence in
     * depth behind the path checks: whatever the label says, these never go
     * into the composer.
     */
    static boolean looksLikePrivateData(byte[] head, int length) {
        if (head == null || length <= 0) return false;
        int n = Math.min(length, head.length);
        if (startsWith(head, n, "SQLite format 3\u0000")) return true;
        int i = 0;
        // Skip a UTF-8 BOM and leading whitespace before looking for markup.
        if (n >= 3 && (head[0] & 0xFF) == 0xEF && (head[1] & 0xFF) == 0xBB && (head[2] & 0xFF) == 0xBF) i = 3;
        while (i < n && (head[i] == ' ' || head[i] == '\t' || head[i] == '\r' || head[i] == '\n')) i++;
        if (i >= n || head[i] != '<') return false;
        String rest = new String(head, i, Math.min(n - i, 16), java.nio.charset.StandardCharsets.ISO_8859_1)
            .toLowerCase(Locale.ROOT);
        return rest.startsWith("<?xml") || rest.startsWith("<map") || rest.startsWith("<!doctype")
            || rest.startsWith("<html") || rest.startsWith("<svg");
    }

    private static boolean startsWith(byte[] data, int length, String ascii) {
        if (length < ascii.length()) return false;
        for (int i = 0; i < ascii.length(); i++) {
            if (data[i] != (byte) ascii.charAt(i)) return false;
        }
        return true;
    }

    // ---- names --------------------------------------------------------------

    /**
     * Extension for the cached copy: the display name's own if it is a plain
     * ".abc" (1-8 letters/digits), else one inferred from the type. Never
     * contains a path separator, so it can't steer where the copy is written.
     */
    static String safeExtension(String mime, String name) {
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot >= 0) {
                String ext = name.substring(dot);
                if (SAFE_EXTENSION.matcher(ext).matches()) return ext.toLowerCase(Locale.ROOT);
            }
        }
        String m = baseMime(mime);
        if (m == null) return "";
        if (m.equals("image/png")) return ".png";
        if (m.equals("image/gif")) return ".gif";
        if (m.equals("image/webp")) return ".webp";
        if (m.startsWith("image/")) return ".jpg";
        if (m.equals("video/webm")) return ".webm";
        if (m.equals("video/quicktime")) return ".mov";
        if (m.startsWith("video/")) return ".mp4";
        if (m.startsWith("audio/")) return ".m4a";
        return "";
    }

    /** The name shown to the web side: last path component only, no control chars, at most 120 chars. */
    static String safeDisplayName(String name) {
        if (name == null) return "shared-file";
        String n = name;
        int slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (slash >= 0) n = n.substring(slash + 1);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < n.length() && out.length() < 120; i++) {
            char c = n.charAt(i);
            if (c >= 0x20 && c != 0x7F) out.append(c);
        }
        String result = out.toString().trim();
        if (result.isEmpty() || result.equals(".") || result.equals("..")) return "shared-file";
        return result;
    }

    static String capText(String text) {
        if (text == null) return null;
        return text.length() <= MAX_TEXT_CHARS ? text : text.substring(0, MAX_TEXT_CHARS);
    }
}
