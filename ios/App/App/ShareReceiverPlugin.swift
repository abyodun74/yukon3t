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
        let skipped = manifest["skipped"] as? Int ?? 0
        let rawFiles = manifest["files"] as? [[String: String]] ?? []

        // Read every file's bytes out of the shared container *before*
        // deleting it below — deleting first would remove the very files
        // this is about to read.
        var files: [[String: Any]] = []
        for entry in rawFiles {
            guard
                let relativePath = entry["path"],
                let name = entry["name"],
                let mimeType = entry["mimeType"],
                let fileData = try? Data(contentsOf: pendingDir.appendingPathComponent(relativePath))
            else { continue }
            files.append(["name": name, "mimeType": mimeType, "base64": fileData.base64EncodedString()])
        }

        // Consumed exactly once, same contract as the Android plugin — a
        // later relaunch/resume must never redeliver the same share.
        try? FileManager.default.removeItem(at: pendingDir)

        call.resolve(["text": text ?? NSNull(), "files": files, "skipped": skipped])
    }
}
