import Foundation
import Capacitor
import os

/// Console.app / Xcode console: filter on subsystem "com.yukon3t.app.share". Never logs file names or content.
private let shareLog = Logger(subsystem: "com.yukon3t.app.share", category: "plugin")

/**
 * Reads what ShareExtension's ShareViewController.swift wrote into the
 * shared App Group container — the iOS counterpart to
 * ShareReceiverPlugin.java, exposed to the JS side under the exact same
 * plugin/method name ("ShareReceiver" / getPendingShare) as Android.
 *
 * Unlike Android (an in-process static field set from MainActivity's own
 * onCreate/onNewIntent), the Share Extension runs as a wholly separate
 * process/sandbox with no way to reach into this app directly — the App
 * Group container on disk is the only channel, and it has to be read back
 * here as a real file, not handed across an in-memory reference.
 *
 * Each file is *moved* out of the App Group container into this app's own
 * tmp directory and handed to JS as an opaque id plus its size. The page
 * then reads it with readPendingFile in base64 chunks. It cannot fetch the
 * file through Capacitor.convertFileSrc the way Android does: the WebView
 * shows https://yukon3t.com (server.url), and on iOS convertFileSrc gives a
 * capacitor://localhost URL, which is another origin, outside the site's
 * CSP connect-src, and served without CORS headers for video files.
 */
@objc(ShareReceiverPlugin)
public class ShareReceiverPlugin: CAPPlugin {
    private let appGroupId = "group.com.yukon3t.app.share"
    private let maxChunkBytes = 4 * 1024 * 1024

    public override func load() {
        shareLog.notice("plugin loaded")
    }

    private var pendingFilesDirectory: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("pending_share", isDirectory: true)
    }

    @objc func getPendingShare(_ call: CAPPluginCall) {
        let empty: [String: Any] = ["text": NSNull(), "files": [], "skipped": 0]

        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            shareLog.error("getPendingShare: App Group container unavailable (check the App Groups entitlement)")
            call.resolve(empty)
            return
        }
        let pendingDir = containerURL.appendingPathComponent("PendingShare", isDirectory: true)
        let manifestURL = pendingDir.appendingPathComponent("manifest.json")

        guard let manifestData = try? Data(contentsOf: manifestURL) else {
            shareLog.notice("getPendingShare: no manifest")
            call.resolve(empty)
            return
        }
        guard let manifest = (try? JSONSerialization.jsonObject(with: manifestData)) as? [String: Any] else {
            shareLog.error("getPendingShare: manifest unreadable")
            try? FileManager.default.removeItem(at: pendingDir)
            call.resolve(empty)
            return
        }

        let text = manifest["text"] as? String
        let manifestSkipped = manifest["skipped"] as? Int ?? 0
        let rawFiles = manifest["files"] as? [[String: String]] ?? []

        // A share the page never finished reading is replaced by this one.
        let destDir = pendingFilesDirectory
        try? FileManager.default.removeItem(at: destDir)
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
            let id = ext.isEmpty ? UUID().uuidString : "\(UUID().uuidString).\(ext)"
            let destURL = destDir.appendingPathComponent(id)
            do {
                try FileManager.default.moveItem(at: sourceURL, to: destURL)
                let size = (try? FileManager.default.attributesOfItem(atPath: destURL.path)[.size]) as? Int ?? 0
                files.append(["id": id, "name": name, "mimeType": mimeType, "size": size])
            } catch {
                let nsError = error as NSError
                shareLog.error("getPendingShare: move failed error=\(nsError.domain, privacy: .public)#\(nsError.code)")
                moveFailures += 1
            }
        }

        // Consumed exactly once, same contract as the Android plugin — a
        // later relaunch/resume must never redeliver the same share. Every
        // file that moved successfully is already out of pendingDir by now;
        // this just clears the manifest and anything left behind (e.g. a
        // file this loop failed to move).
        try? FileManager.default.removeItem(at: pendingDir)

        shareLog.notice("getPendingShare: delivered files=\(files.count) skipped=\(manifestSkipped + moveFailures) text=\(text != nil, privacy: .public)")
        call.resolve(["text": text ?? NSNull(), "files": files, "skipped": manifestSkipped + moveFailures])
    }

    /// Returns up to `length` bytes of a file handed out by getPendingShare, from `offset`, as base64. The file is
    /// deleted once its last byte has been read. Only ids getPendingShare produced resolve: a bare file name inside
    /// pending_share, never a path.
    @objc func readPendingFile(_ call: CAPPluginCall) {
        guard
            let id = call.getString("id"),
            id.range(of: "^[A-Fa-f0-9-]{36}(\\.[A-Za-z0-9]{1,10})?$", options: .regularExpression) != nil
        else {
            shareLog.error("readPendingFile: invalid id")
            call.reject("invalid_id")
            return
        }
        let offset = call.getInt("offset") ?? 0
        let length = min(max(call.getInt("length") ?? maxChunkBytes, 1), maxChunkBytes)
        guard offset >= 0 else {
            call.reject("invalid_offset")
            return
        }

        let fileURL = pendingFilesDirectory.appendingPathComponent(id)
        do {
            let handle = try FileHandle(forReadingFrom: fileURL)
            defer { try? handle.close() }
            let size = try Int(handle.seekToEnd())
            try handle.seek(toOffset: UInt64(min(offset, size)))
            let data = try handle.read(upToCount: length) ?? Data()
            let end = offset + data.count >= size
            if end {
                try? FileManager.default.removeItem(at: fileURL)
            }
            call.resolve(["data": data.base64EncodedString(), "size": size, "end": end])
        } catch {
            let nsError = error as NSError
            shareLog.error("readPendingFile: failed error=\(nsError.domain, privacy: .public)#\(nsError.code)")
            call.reject("read_failed")
        }
    }
}
