import Foundation
import Capacitor

/**
 * Reads what ShareExtension's ShareViewController.swift wrote into the
 * shared App Group container — the iOS counterpart to
 * ShareReceiverPlugin.java, exposed to the JS side under the exact same
 * plugin/method name ("ShareReceiver" / getPendingShare) so
 * src/lib/share-receiver.ts needs no per-platform branching beyond which
 * platform to even attempt this on at all.
 *
 * Unlike Android (an in-process static field set from MainActivity's own
 * onCreate/onNewIntent), the Share Extension runs as a wholly separate
 * process/sandbox with no way to reach into this app directly — the App
 * Group container on disk is the only channel, and it has to be read back
 * here as a real file, not handed across an in-memory reference.
 *
 * Each file is *moved* out of the App Group container into this app's own
 * tmp directory and handed to JS as a plain path — not read into a `Data`
 * and base64-encoded the way an earlier version of this file did. Reading a
 * whole video into memory just to re-encode it ~33% larger for the bridge
 * call is exactly the mistake Android's ShareReceiverPlugin.java made (see
 * its own doc comment: it silently dropped anything over 20MB, which is
 * nowhere near enough for a typical shared Reel/TikTok/Facebook video) —
 * fixed there the same way, moving a file on disk instead of copying its
 * bytes through memory twice. Capacitor.convertFileSrc (share-receiver.ts)
 * then lets the WebView read the moved file directly via fetch().
 */
@objc(ShareReceiverPlugin)
public class ShareReceiverPlugin: CAPPlugin {
    private let appGroupId = "group.com.yukon3t.app.share"

    @objc func getPendingShare(_ call: CAPPluginCall) {
        let empty: [String: Any] = ["text": NSNull(), "files": [], "skipped": 0]

        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            call.resolve(empty)
            return
        }
        let pendingDir = containerURL.appendingPathComponent("PendingShare", isDirectory: true)
        let manifestURL = pendingDir.appendingPathComponent("manifest.json")

        guard
            let manifestData = try? Data(contentsOf: manifestURL),
            let manifest = try? JSONSerialization.jsonObject(with: manifestData) as? [String: Any]
        else {
            call.resolve(empty)
            return
        }

        let text = manifest["text"] as? String
        let manifestSkipped = manifest["skipped"] as? Int ?? 0
        let rawFiles = manifest["files"] as? [[String: String]] ?? []

        let destDir = FileManager.default.temporaryDirectory.appendingPathComponent("pending_share", isDirectory: true)
        try? FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)

        var files: [[String: Any]] = []
        var moveFailures = 0
        for entry in rawFiles {
            guard
                let relativePath = entry["path"],
                let name = entry["name"],
                let mimeType = entry["mimeType"]
            else {
                moveFailures += 1
                continue
            }
            let sourceURL = pendingDir.appendingPathComponent(relativePath)
            let ext = sourceURL.pathExtension
            let destURL = destDir.appendingPathComponent(ext.isEmpty ? UUID().uuidString : "\(UUID().uuidString).\(ext)")
            do {
                try FileManager.default.moveItem(at: sourceURL, to: destURL)
                files.append(["name": name, "mimeType": mimeType, "path": destURL.path])
            } catch {
                moveFailures += 1
            }
        }

        // Consumed exactly once, same contract as the Android plugin — a
        // later relaunch/resume must never redeliver the same share. Every
        // file that moved successfully is already out of pendingDir by now;
        // this just clears the manifest and anything left behind (e.g. a
        // file this loop failed to move).
        try? FileManager.default.removeItem(at: pendingDir)

        call.resolve(["text": text ?? NSNull(), "files": files, "skipped": manifestSkipped + moveFailures])
    }
}
