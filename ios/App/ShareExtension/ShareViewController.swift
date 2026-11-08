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
                // The concrete image type the provider offers (e.g. public.png for a
                // screenshot), for naming raw bytes handed over as Data below.
                let imageType = provider.registeredTypeIdentifiers
                    .compactMap { UTType($0) }
                    .first { $0.conforms(to: .image) && $0 != .image } ?? .png
                provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { data, _ in
                    defer { group.leave() }
                    if let url = data as? URL {
                        appendFile(self.saveToAppGroup(from: url, suggestedName: url.lastPathComponent))
                    } else if let raw = data as? Data {
                        // The screenshot editor and some apps hand over the encoded
                        // image itself rather than a file URL or a UIImage.
                        let ext = imageType.preferredFilenameExtension ?? "png"
                        let mime = imageType.preferredMIMEType ?? "image/png"
                        appendFile(self.saveDataToAppGroup(raw, suggestedName: "shared-image.\(ext)", mimeType: mime))
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
            if files.isEmpty && (text ?? "").isEmpty {
                self.finish()
            } else {
                self.openHostAppAndFinish()
            }
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

    /// Asks the system to bring the containing app forward. Apple only
    /// honours NSExtensionContext.open for Today and iMessage extensions, so
    /// for a Share extension it normally answers `false`; nothing here works
    /// around that with private API (App Review risk). Instead the share is
    /// already saved in the App Group, and the person is told to open
    /// YuKon3t: share-target-gate.tsx reads it on launch and on every
    /// "resume", so the picker appears as soon as the app comes forward.
    private func openHostAppAndFinish() {
        guard let url = URL(string: "yukon3t://share"), let context = extensionContext else {
            finish()
            return
        }
        context.open(url) { opened in
            DispatchQueue.main.async {
                if opened {
                    self.finish()
                } else {
                    self.showOpenAppNotice()
                }
            }
        }
    }

    private func showOpenAppNotice() {
        view.subviews.forEach { $0.removeFromSuperview() }
        let words = openAppNoticeText()

        let label = UILabel()
        label.text = words.message
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .label

        let button = UIButton(type: .system)
        button.setTitle(words.ok, for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.addTarget(self, action: #selector(noticeDismissed), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [label, button])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        let card = UIView()
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        view.addSubview(card)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
        ])
        UIAccessibility.post(notification: .screenChanged, argument: label)
    }

    @objc private func noticeDismissed() {
        finish()
    }

    /// The app's five languages (src/lib/i18n); anything else reads English.
    private func openAppNoticeText() -> (message: String, ok: String) {
        let language = Locale.preferredLanguages.first.map { String($0.prefix(2)) } ?? "en"
        switch language {
        case "es": return ("Guardado. Abre YuKon3t para elegir dónde compartirlo.", "OK")
        case "fr": return ("Enregistré. Ouvrez YuKon3t pour choisir où le partager.", "OK")
        case "pt": return ("Salvo. Abra o YuKon3t para escolher onde compartilhar.", "OK")
        case "ar": return ("تم الحفظ. افتح YuKon3t لتختار مكان مشاركته.", "حسنًا")
        default: return ("Saved. Open YuKon3t to choose where to share it.", "OK")
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
