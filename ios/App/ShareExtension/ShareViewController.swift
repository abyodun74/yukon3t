import UIKit
import UniformTypeIdentifiers

/**
 * iOS's half of the Share-target feature — the equivalent of Android's
 * SEND/SEND_MULTIPLE intent-filters + ShareReceiverPlugin.java, but running
 * as a genuinely separate process with its own ~120MB memory budget, no
 * access to the main app's WebView/JS runtime, and no UIApplication of its
 * own. The only channel across that boundary is the App Group container on
 * disk (see App.entitlements / ShareExtension.entitlements, both carrying
 * the same group.com.yukon3t.app.share id) — this writes into it,
 * ShareReceiverPlugin.swift (main app target) reads it back.
 *
 * Deliberately a plain UIViewController with a programmatic "Sharing…"
 * spinner, not SLComposeServiceViewController's built-in compose UI or a
 * storyboard — see ios/SHARE_EXTENSION_PLAN.md for why this is enough:
 * there's no caption-editing step here any more than Android's version has
 * one, since ShareTargetGate.tsx in the main app is what the user actually
 * interacts with, moments after this hands off to it.
 */
class ShareViewController: UIViewController {
    // A shared video/image URL (the common case — see handleShare below)
    // goes through saveToAppGroup, which is a disk-to-disk
    // FileManager.copyItem — the OS streams it, never holding the file's
    // bytes in this process's memory at all, so this can be generous
    // without risking the extension's tight ~120MB ceiling. Confirmed live
    // need for this: Android's equivalent cap (ShareReceiverPlugin.java,
    // before it was fixed the same way) silently dropped real-world shared
    // Reels/TikTok/Facebook videos, which routinely exceed the old 20MB
    // limit even at well under a minute long.
    private let maxVideoFileBytes = 500 * 1024 * 1024
    // saveDataToAppGroup, by contrast, *is* an in-memory Data write (the
    // provider handed back a UIImage directly, already decoded, rather than
    // a file URL) — this path keeps the original conservative ceiling,
    // since it's the one case here that actually holds bytes in this
    // process's memory. 20MB is already generous for a single photo.
    private let maxImageDataBytes = 20 * 1024 * 1024
    private let appGroupId = "group.com.yukon3t.app.share"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        let indicator = UIActivityIndicatorView(style: .large)
        indicator.color = .white
        indicator.startAnimating()
        indicator.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(indicator)
        NSLayoutConstraint.activate([
            indicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            indicator.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])

        handleShare()
    }

    private func handleShare() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        guard !providers.isEmpty else {
            finish()
            return
        }

        let group = DispatchGroup()
        let lock = NSLock()
        var files: [[String: String]] = []
        var text: String?
        var skipped = 0

        func appendText(_ value: String) {
            lock.lock()
            text = text.map { "\($0) \(value)" } ?? value
            lock.unlock()
        }
        func appendFile(_ entry: [String: String]?) {
            lock.lock()
            if let entry = entry { files.append(entry) } else { skipped += 1 }
            lock.unlock()
        }

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.movie.identifier, options: nil) { data, _ in
                    defer { group.leave() }
                    guard let url = data as? URL else { appendFile(nil); return }
                    appendFile(self.saveToAppGroup(from: url, suggestedName: url.lastPathComponent))
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { data, _ in
                    defer { group.leave() }
                    if let url = data as? URL {
                        appendFile(self.saveToAppGroup(from: url, suggestedName: url.lastPathComponent))
                    } else if let image = data as? UIImage, let jpeg = image.jpegData(compressionQuality: 0.9) {
                        appendFile(self.saveDataToAppGroup(jpeg, suggestedName: "shared-image.jpg", mimeType: "image/jpeg"))
                    } else {
                        appendFile(nil)
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                    defer { group.leave() }
                    if let url = data as? URL { appendText(url.absoluteString) }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                    defer { group.leave() }
                    if let string = data as? String { appendText(string) }
                }
            }
        }

        group.notify(queue: .main) {
            self.writeManifest(text: text, files: files, skipped: skipped)
            self.openHostAppAndFinish()
        }
    }

    /// Copies a provider-owned temp file into the App Group's shared
    /// PendingShare directory, enforcing maxVideoFileBytes — an oversized
    /// file is reported back as "skipped" (nil here) rather than silently
    /// dropped, same reasoning as ShareReceiverPlugin.java's own size cap.
    private func saveToAppGroup(from sourceURL: URL, suggestedName: String) -> [String: String]? {
        guard
            let size = (try? FileManager.default.attributesOfItem(atPath: sourceURL.path)[.size]) as? Int,
            size <= maxVideoFileBytes,
            let containerURL = pendingShareDirectory()
        else { return nil }

        let ext = sourceURL.pathExtension.isEmpty ? "dat" : sourceURL.pathExtension
        let storedName = "\(UUID().uuidString).\(ext)"
        let destURL = containerURL.appendingPathComponent(storedName)
        do {
            try FileManager.default.copyItem(at: sourceURL, to: destURL)
        } catch {
            return nil
        }
        return ["path": storedName, "name": suggestedName, "mimeType": mimeType(forExtension: ext)]
    }

    private func saveDataToAppGroup(_ data: Data, suggestedName: String, mimeType: String) -> [String: String]? {
        guard data.count <= maxImageDataBytes, let containerURL = pendingShareDirectory() else { return nil }
        let ext = (suggestedName as NSString).pathExtension
        let storedName = "\(UUID().uuidString).\(ext.isEmpty ? "dat" : ext)"
        let destURL = containerURL.appendingPathComponent(storedName)
        do {
            try data.write(to: destURL, options: .atomic)
        } catch {
            return nil
        }
        return ["path": storedName, "name": suggestedName, "mimeType": mimeType]
    }

    private func pendingShareDirectory() -> URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            return nil
        }
        let dir = base.appendingPathComponent("PendingShare", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func mimeType(forExtension ext: String) -> String {
        if let type = UTType(filenameExtension: ext), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }

    /// A fresh manifest fully replaces any prior one — same "consumed
    /// exactly once" contract as Android's getPendingShare(), just
    /// implemented via a file the main app deletes after reading instead of
    /// an in-memory static field (there's no shared process here to hold one).
    private func writeManifest(text: String?, files: [[String: String]], skipped: Int) {
        guard let dir = pendingShareDirectory() else { return }
        var payload: [String: Any] = ["files": files, "skipped": skipped]
        if let text = text, !text.isEmpty { payload["text"] = text }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        try? data.write(to: dir.appendingPathComponent("manifest.json"), options: .atomic)
    }

    /// The sanctioned way for a Share Extension to hand off to its
    /// containing app (available since iOS 8) — there's no UIApplication
    /// here to just call openURL on directly, unlike a normal in-app deep
    /// link. If the host app is backgrounded this resumes it (Capacitor's
    /// "resume" App event, which share-target-gate.tsx already listens for);
    /// if it's not running at all, this launches it fresh, same as tapping
    /// its icon.
    private func openHostAppAndFinish() {
        guard let url = URL(string: "yukon3t://share") else {
            finish()
            return
        }
        extensionContext?.open(url) { _ in
            self.finish()
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
