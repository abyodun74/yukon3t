import UIKit
import UniformTypeIdentifiers
import os

/// Console.app / Xcode console: filter on subsystem "com.yukon3t.app.share" (or "[YuKon3tShare]" in the Xcode
/// console). Never logs file names or content: only type identifiers, counts, byte sizes and error domain/code.
private let shareLog = Logger(subsystem: "com.yukon3t.app.share", category: "extension")

/// Every line goes to the unified log (public, so Console.app doesn't redact it to <private>) and to NSLog, which the
/// Xcode console shows whatever its log-level filter is.
private func shareTrace(_ message: String) {
    shareLog.notice("\(message, privacy: .public)")
    NSLog("[YuKon3tShare] %@", message)
}

private func describe(_ error: Error?) -> String {
    guard let error = error as NSError? else { return "error=none" }
    return "error=\(error.domain)#\(error.code)"
}

private func kindOf(_ item: Any?) -> String {
    guard let item = item else { return "nil" }
    if item is URL { return "url" }
    if item is Data { return "data" }
    if item is UIImage { return "uiimage" }
    if item is String { return "string" }
    return "other"
}

private struct RegisteredType {
    let id: String
    let type: UTType
}

private enum AttachmentPlan {
    case movie(String)
    case image(String)
    case url
    case text
    case unsupported

    var label: String {
        switch self {
        case .movie(let typeId): return "movie(\(typeId))"
        case .image(let typeId): return "image(\(typeId))"
        case .url: return "url"
        case .text: return "text"
        case .unsupported: return "unsupported"
        }
    }
}

/// Results arrive on NSItemProvider's own background queues. Kept by provider index so an album keeps the order the
/// person picked. Once closed (the load timeout fired), late results are refused.
private final class ShareCollector {
    private let lock = NSLock()
    private var files: [Int: [String: String]] = [:]
    private var texts: [Int: String] = [:]
    private var failed = 0
    private var pending = 0
    private var closed = false

    func begin() {
        lock.lock()
        defer { lock.unlock() }
        pending += 1
    }

    func addSkipped(_ count: Int) {
        lock.lock()
        defer { lock.unlock() }
        failed += count
    }

    /// False once closed: the caller deletes the file it just wrote, which no manifest will ever list.
    func finishFile(_ index: Int, _ entry: [String: String]?) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return false }
        pending -= 1
        if let entry = entry { files[index] = entry } else { failed += 1 }
        return true
    }

    func finishText(_ index: Int, _ text: String?) {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        pending -= 1
        if let text = text { texts[index] = text }
    }

    /// Anything still loading counts as skipped.
    func close() -> (files: [[String: String]], text: String?, skipped: Int, stillLoading: Int) {
        lock.lock()
        defer { lock.unlock() }
        closed = true
        let orderedFiles = files.keys.sorted().compactMap { files[$0] }
        let orderedTexts = texts.keys.sorted().compactMap { texts[$0] }
        let text = orderedTexts.isEmpty ? nil : orderedTexts.joined(separator: " ")
        return (orderedFiles, text, failed + pending, pending)
    }
}

/// Runs its body at most once, from whichever thread gets there first.
private final class Once {
    private let lock = NSLock()
    private var fired = false

    func run(_ body: () -> Void) {
        lock.lock()
        let first = !fired
        fired = true
        lock.unlock()
        if first { body() }
    }
}

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
 *
 * Every way out ends on screen: the "Saved. Open YuKon3t" notice, a "couldn't
 * share" notice, or (if iOS ever honours it) the app opening. completeRequest
 * runs once, only after every copy has finished or the load timeout fired.
 */
class ShareViewController: UIViewController {
    // Files (loadFileRepresentation) are copied disk-to-disk by FileManager,
    // never held in this process's memory, so this can be generous without
    // risking the extension's ~120MB ceiling. Real shared Reels/TikTok/
    // Facebook videos routinely exceed 20MB at well under a minute long.
    private let maxFileBytes = 500 * 1024 * 1024
    // Raw Data / UIImage fallbacks *are* in memory, so they keep the
    // conservative ceiling. 20MB is already generous for a single photo.
    private let maxDataBytes = 20 * 1024 * 1024
    // Same cap as Android's SEND_MULTIPLE handling; extra attachments count as skipped.
    private let maxAttachments = 10
    // Long enough for Photos to fetch an iCloud-only original; the spinner never stays up forever.
    private let loadTimeout: TimeInterval = 60
    private let openAnswerTimeout: TimeInterval = 3
    private let appGroupId = "group.com.yukon3t.app.share"

    private let collector = ShareCollector()
    // Main thread only.
    private var collectionDone = false
    private var openAnswered = false
    private var completed = false

    override init(nibName nibNameOrNil: String?, bundle nibBundleOrNil: Bundle?) {
        shareTrace("launched")
        super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
    }

    required init?(coder: NSCoder) {
        shareTrace("launched (coder)")
        super.init(coder: coder)
    }

    override func viewDidLoad() {
        shareTrace("viewDidLoad")
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

    // MARK: - Collecting

    private func handleShare() {
        let items = (extensionContext?.inputItems ?? []).compactMap { $0 as? NSExtensionItem }
        let allProviders = items.flatMap { $0.attachments ?? [] }
        let providers = Array(allProviders.prefix(maxAttachments))
        let overLimit = allProviders.count - providers.count
        let pendingDir = freshPendingShareDirectory()
        shareTrace("start items=\(items.count) providers=\(allProviders.count) overLimit=\(overLimit) appGroup=\(pendingDir != nil)")

        guard let dir = pendingDir else {
            fail(reason: "no_app_group")
            return
        }
        guard !providers.isEmpty else {
            fail(reason: "no_attachments")
            return
        }
        collector.addSkipped(overLimit)

        let group = DispatchGroup()
        for (index, provider) in providers.enumerated() {
            let plan = attachmentPlan(for: provider)
            shareTrace("provider[\(index)] types=\(provider.registeredTypeIdentifiers.joined(separator: ",")) plan=\(plan.label)")

            switch plan {
            case .movie(let typeId):
                group.enter()
                collector.begin()
                loadMovie(provider, typeId: typeId, index: index, dir: dir, done: fileDone(index: index, dir: dir, group: group))
            case .image(let typeId):
                group.enter()
                collector.begin()
                loadImageFile(provider, typeId: typeId, index: index, dir: dir, done: fileDone(index: index, dir: dir, group: group))
            case .url:
                group.enter()
                collector.begin()
                loadURL(provider, index: index, done: textDone(index: index, group: group))
            case .text:
                group.enter()
                collector.begin()
                loadText(provider, index: index, done: textDone(index: index, group: group))
            case .unsupported:
                continue
            }
        }

        group.notify(queue: .main) {
            self.collectionFinished(timedOut: false)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + loadTimeout) {
            self.collectionFinished(timedOut: true)
        }
    }

    private func fileDone(index: Int, dir: URL, group: DispatchGroup) -> ([String: String]?) -> Void {
        let once = Once()
        return { entry in
            once.run {
                if !self.collector.finishFile(index, entry), let path = entry?["path"] {
                    try? FileManager.default.removeItem(at: dir.appendingPathComponent(path))
                    shareTrace("provider[\(index)] finished after the timeout, discarded")
                }
                group.leave()
            }
        }
    }

    private func textDone(index: Int, group: DispatchGroup) -> (String?) -> Void {
        let once = Once()
        return { text in
            once.run {
                let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
                let value = (trimmed?.isEmpty ?? true) ? nil : trimmed
                shareTrace("provider[\(index)] text \(value != nil ? "ok" : "empty")")
                self.collector.finishText(index, value)
                group.leave()
            }
        }
    }

    /// Prefers the provider's own highest-fidelity concrete type (registeredTypeIdentifiers is in fidelity order),
    /// e.g. public.heic or public.jpeg before the generic public.image.
    private func attachmentPlan(for provider: NSItemProvider) -> AttachmentPlan {
        let registered = provider.registeredTypeIdentifiers.compactMap { id in
            UTType(id).map { RegisteredType(id: id, type: $0) }
        }
        if let movie = registered.first(where: { $0.type.conforms(to: .movie) && !Self.isLivePhoto($0.id) }) {
            return .movie(movie.id)
        }
        if let image = preferredImageType(registered) {
            return .image(image)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            return .movie(UTType.movie.identifier)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            return .image(UTType.image.identifier)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            return .url
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            return .text
        }
        return .unsupported
    }

    // Types the app's web side can show (src/lib/share-receiver.ts IMAGE_EXTENSIONS); a RAW/DNG original isn't one.
    private static let webImageTypes: [UTType] = [.heic, .heif, .jpeg, .png, .gif, .webP, .bmp]

    private func preferredImageType(_ registered: [RegisteredType]) -> String? {
        let candidates = registered.filter {
            $0.type.conforms(to: .image)
                && $0.type != .image
                && !Self.isLivePhoto($0.id)
                && !$0.id.hasPrefix("com.apple.private.")
                && !$0.id.contains("thumbnail")
        }
        if let usable = candidates.first(where: { candidate in
            Self.webImageTypes.contains { candidate.type.conforms(to: $0) }
        }) {
            return usable.id
        }
        return candidates.first?.id
    }

    private static func isLivePhoto(_ typeId: String) -> Bool {
        typeId.contains("live-photo")
    }

    // MARK: - Loading

    /// loadFileRepresentation hands over a readable temporary copy that is deleted when the handler returns, so the
    /// copy into the App Group happens inside it.
    private func loadMovie(_ provider: NSItemProvider, typeId: String, index: Int, dir: URL, done: @escaping ([String: String]?) -> Void) {
        shareTrace("provider[\(index)] method=fileRepresentation type=\(typeId)")
        _ = provider.loadFileRepresentation(forTypeIdentifier: typeId) { url, error in
            if let url = url {
                if let entry = self.copyFile(from: url, typeId: typeId, index: index, dir: dir) {
                    done(entry)
                    return
                }
            } else {
                shareTrace("provider[\(index)] fileRepresentation failed \(describe(error))")
            }
            self.loadLegacyItem(provider, typeId: typeId, index: index, dir: dir, done: done)
        }
    }

    /// File, then raw data (the screenshot editor and some apps only have the encoded bytes), then a UIImage, then
    /// the untyped loadItem as a last resort.
    private func loadImageFile(_ provider: NSItemProvider, typeId: String, index: Int, dir: URL, done: @escaping ([String: String]?) -> Void) {
        shareTrace("provider[\(index)] method=fileRepresentation type=\(typeId)")
        _ = provider.loadFileRepresentation(forTypeIdentifier: typeId) { url, error in
            if let url = url {
                if let entry = self.copyFile(from: url, typeId: typeId, index: index, dir: dir) {
                    done(entry)
                    return
                }
            } else {
                shareTrace("provider[\(index)] fileRepresentation failed \(describe(error))")
            }
            self.loadImageData(provider, typeId: typeId, index: index, dir: dir, done: done)
        }
    }

    private func loadImageData(_ provider: NSItemProvider, typeId: String, index: Int, dir: URL, done: @escaping ([String: String]?) -> Void) {
        shareTrace("provider[\(index)] method=dataRepresentation type=\(typeId)")
        _ = provider.loadDataRepresentation(forTypeIdentifier: typeId) { data, error in
            if let data = data {
                let ext = self.storedExtension("", typeId: typeId, fallback: "png")
                let mime = self.mimeType(forExtension: ext, typeId: typeId)
                if let entry = self.writeData(data, ext: ext, mimeType: mime, index: index, dir: dir) {
                    done(entry)
                    return
                }
            } else {
                shareTrace("provider[\(index)] dataRepresentation failed \(describe(error))")
            }
            self.loadImageObject(provider, typeId: typeId, index: index, dir: dir, done: done)
        }
    }

    private func loadImageObject(_ provider: NSItemProvider, typeId: String, index: Int, dir: URL, done: @escaping ([String: String]?) -> Void) {
        guard provider.canLoadObject(ofClass: UIImage.self) else {
            loadLegacyItem(provider, typeId: typeId, index: index, dir: dir, done: done)
            return
        }
        shareTrace("provider[\(index)] method=loadObject(UIImage)")
        _ = provider.loadObject(ofClass: UIImage.self) { object, error in
            if let image = object as? UIImage {
                if let entry = self.writeJPEG(image, index: index, dir: dir) {
                    done(entry)
                    return
                }
            } else {
                shareTrace("provider[\(index)] loadObject(UIImage) failed \(describe(error))")
            }
            self.loadLegacyItem(provider, typeId: typeId, index: index, dir: dir, done: done)
        }
    }

    /// In Swift, loadItem's completion is untyped, so the system logs "nil expectedValueClass allowing {...}" for
    /// every call; it still delivers a URL, Data or UIImage.
    private func loadLegacyItem(_ provider: NSItemProvider, typeId: String, index: Int, dir: URL, done: @escaping ([String: String]?) -> Void) {
        shareTrace("provider[\(index)] method=loadItem type=\(typeId)")
        provider.loadItem(forTypeIdentifier: typeId, options: nil) { item, error in
            shareTrace("provider[\(index)] loadItem gave \(kindOf(item)) \(describe(error))")
            if let url = item as? URL, url.isFileURL {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                done(self.copyFile(from: url, typeId: typeId, index: index, dir: dir))
            } else if let data = item as? Data {
                let ext = self.storedExtension("", typeId: typeId, fallback: "png")
                done(self.writeData(data, ext: ext, mimeType: self.mimeType(forExtension: ext, typeId: typeId), index: index, dir: dir))
            } else if let image = item as? UIImage {
                done(self.writeJPEG(image, index: index, dir: dir))
            } else {
                done(nil)
            }
        }
    }

    private func loadURL(_ provider: NSItemProvider, index: Int, done: @escaping (String?) -> Void) {
        guard provider.canLoadObject(ofClass: NSURL.self) else {
            loadLegacyURL(provider, index: index, done: done)
            return
        }
        shareTrace("provider[\(index)] method=loadObject(NSURL)")
        _ = provider.loadObject(ofClass: NSURL.self) { object, error in
            if let url = object as? NSURL {
                done(self.sharedLink(url as URL, index: index))
                return
            }
            shareTrace("provider[\(index)] loadObject(NSURL) failed \(describe(error))")
            self.loadLegacyURL(provider, index: index, done: done)
        }
    }

    private func loadLegacyURL(_ provider: NSItemProvider, index: Int, done: @escaping (String?) -> Void) {
        shareTrace("provider[\(index)] method=loadItem type=\(UTType.url.identifier)")
        provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
            shareTrace("provider[\(index)] loadItem gave \(kindOf(item)) \(describe(error))")
            if let url = item as? URL {
                done(self.sharedLink(url, index: index))
            } else if let data = item as? Data, let url = URL(dataRepresentation: data, relativeTo: nil) {
                done(self.sharedLink(url, index: index))
            } else if let string = item as? String, let url = URL(string: string) {
                done(self.sharedLink(url, index: index))
            } else {
                done(nil)
            }
        }
    }

    /// A file URL isn't a link anyone else can open.
    private func sharedLink(_ url: URL, index: Int) -> String? {
        if url.isFileURL {
            shareTrace("provider[\(index)] url is a file url, ignored")
            return nil
        }
        return url.absoluteString
    }

    private func loadText(_ provider: NSItemProvider, index: Int, done: @escaping (String?) -> Void) {
        guard provider.canLoadObject(ofClass: NSString.self) else {
            loadLegacyText(provider, index: index, done: done)
            return
        }
        shareTrace("provider[\(index)] method=loadObject(NSString)")
        _ = provider.loadObject(ofClass: NSString.self) { object, error in
            if let string = object as? NSString {
                done(string as String)
                return
            }
            shareTrace("provider[\(index)] loadObject(NSString) failed \(describe(error))")
            self.loadLegacyText(provider, index: index, done: done)
        }
    }

    private func loadLegacyText(_ provider: NSItemProvider, index: Int, done: @escaping (String?) -> Void) {
        shareTrace("provider[\(index)] method=loadItem type=\(UTType.plainText.identifier)")
        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, error in
            shareTrace("provider[\(index)] loadItem gave \(kindOf(item)) \(describe(error))")
            if let string = item as? String {
                done(string)
            } else if let data = item as? Data {
                done(String(data: data, encoding: .utf8))
            } else {
                done(nil)
            }
        }
    }

    // MARK: - Writing into the App Group

    /// The extension's own copy, disk to disk. An oversized file is reported back as skipped (nil) rather than
    /// silently dropped, same reasoning as ShareReceiverPlugin.java's own size cap.
    private func copyFile(from source: URL, typeId: String, index: Int, dir: URL) -> [String: String]? {
        let attributes: [FileAttributeKey: Any]
        do {
            attributes = try FileManager.default.attributesOfItem(atPath: source.path)
        } catch {
            shareTrace("provider[\(index)] copy: source unreadable \(describe(error))")
            return nil
        }
        let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
        guard size > 0, size <= maxFileBytes else {
            shareTrace("provider[\(index)] copy: rejected bytes=\(size)")
            return nil
        }

        let ext = storedExtension(source.pathExtension, typeId: typeId, fallback: "dat")
        let storedName = "\(UUID().uuidString).\(ext)"
        do {
            try FileManager.default.copyItem(at: source, to: dir.appendingPathComponent(storedName))
        } catch {
            shareTrace("provider[\(index)] copy failed \(describe(error))")
            return nil
        }
        shareTrace("provider[\(index)] copy ok bytes=\(size)")
        return ["path": storedName, "name": source.lastPathComponent, "mimeType": mimeType(forExtension: ext, typeId: typeId)]
    }

    private func writeData(_ data: Data, ext: String, mimeType: String, index: Int, dir: URL) -> [String: String]? {
        guard !data.isEmpty, data.count <= maxDataBytes else {
            shareTrace("provider[\(index)] write: rejected bytes=\(data.count)")
            return nil
        }
        let storedName = "\(UUID().uuidString).\(ext)"
        do {
            try data.write(to: dir.appendingPathComponent(storedName), options: .atomic)
        } catch {
            shareTrace("provider[\(index)] write failed \(describe(error))")
            return nil
        }
        shareTrace("provider[\(index)] write ok bytes=\(data.count)")
        return ["path": storedName, "name": "shared-image.\(ext)", "mimeType": mimeType]
    }

    private func writeJPEG(_ image: UIImage, index: Int, dir: URL) -> [String: String]? {
        guard let jpeg = image.jpegData(compressionQuality: 0.9) else {
            shareTrace("provider[\(index)] jpeg encoding failed")
            return nil
        }
        return writeData(jpeg, ext: "jpg", mimeType: "image/jpeg", index: index, dir: dir)
    }

    /// ShareReceiverPlugin.readPendingFile only accepts ids ending in 1-10 ASCII letters/digits.
    private func storedExtension(_ candidate: String, typeId: String, fallback: String) -> String {
        for raw in [candidate, UTType(typeId)?.preferredFilenameExtension ?? ""] {
            let ext = raw.lowercased()
            if (1...10).contains(ext.count), ext.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) {
                return ext
            }
        }
        return fallback
    }

    private func mimeType(forExtension ext: String, typeId: String) -> String {
        UTType(filenameExtension: ext)?.preferredMIMEType
            ?? UTType(typeId)?.preferredMIMEType
            ?? "application/octet-stream"
    }

    /// A share never opened in the app is replaced by this one anyway (the manifest is overwritten), so its files
    /// would only take up space.
    private func freshPendingShareDirectory() -> URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            shareTrace("App Group container unavailable (check the ShareExtension target's App Groups capability and provisioning profile)")
            return nil
        }
        let dir = base.appendingPathComponent("PendingShare", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            shareTrace("PendingShare directory create failed \(describe(error))")
            return nil
        }
        return dir
    }

    /// A fresh manifest fully replaces any prior one — same "consumed
    /// exactly once" contract as Android's getPendingShare(), just
    /// implemented via a file the main app deletes after reading instead of
    /// an in-memory static field (there's no shared process here to hold one).
    private func writeManifest(text: String?, files: [[String: String]], skipped: Int) -> Bool {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            shareTrace("manifest: App Group container unavailable")
            return false
        }
        let dir = base.appendingPathComponent("PendingShare", isDirectory: true)
        var payload: [String: Any] = ["files": files, "skipped": skipped]
        if let text = text, !text.isEmpty { payload["text"] = text }
        do {
            let data = try JSONSerialization.data(withJSONObject: payload)
            try data.write(to: dir.appendingPathComponent("manifest.json"), options: .atomic)
            shareTrace("manifest write ok files=\(files.count) skipped=\(skipped)")
            return true
        } catch {
            shareTrace("manifest write failed \(describe(error))")
            return false
        }
    }

    // MARK: - Finishing

    private func collectionFinished(timedOut: Bool) {
        guard !collectionDone else { return }
        collectionDone = true
        let result = collector.close()
        shareTrace("collected files=\(result.files.count) skipped=\(result.skipped) text=\(result.text != nil) timedOut=\(timedOut) stillLoading=\(result.stillLoading)")

        if result.files.isEmpty && result.text == nil {
            fail(reason: "nothing_usable")
            return
        }
        guard writeManifest(text: result.text, files: result.files, skipped: result.skipped) else {
            fail(reason: "manifest_write")
            return
        }
        openHostAppAndFinish()
    }

    private func fail(reason: String) {
        shareTrace("disposition=failed reason=\(reason)")
        let words = failedNoticeText()
        showNotice(message: words.message, ok: words.ok)
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
            hostAppOpenAnswered(nil)
            return
        }
        context.open(url) { opened in
            DispatchQueue.main.async {
                self.hostAppOpenAnswered(opened)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + openAnswerTimeout) {
            self.hostAppOpenAnswered(nil)
        }
    }

    private func hostAppOpenAnswered(_ opened: Bool?) {
        guard !openAnswered else { return }
        openAnswered = true
        shareTrace("open host app answered \(opened.map { String(describing: $0) } ?? "no_answer")")
        if opened == true {
            shareTrace("disposition=opened_app")
            finish()
        } else {
            shareTrace("disposition=saved_notice")
            let words = openAppNoticeText()
            showNotice(message: words.message, ok: words.ok)
        }
    }

    private func showNotice(message: String, ok: String) {
        view.subviews.forEach { $0.removeFromSuperview() }

        let label = UILabel()
        label.text = message
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .label

        let button = UIButton(type: .system)
        button.setTitle(ok, for: .normal)
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
        switch Self.languageCode() {
        case "es": return ("Guardado. Abre YuKon3t para elegir dónde compartirlo.", "OK")
        case "fr": return ("Enregistré. Ouvrez YuKon3t pour choisir où le partager.", "OK")
        case "pt": return ("Salvo. Abra o YuKon3t para escolher onde compartilhar.", "OK")
        case "ar": return ("تم الحفظ. افتح YuKon3t لتختار مكان مشاركته.", "حسنًا")
        default: return ("Saved. Open YuKon3t to choose where to share it.", "OK")
        }
    }

    private func failedNoticeText() -> (message: String, ok: String) {
        switch Self.languageCode() {
        case "es": return ("No se pudo compartir esto en YuKon3t. Inténtalo de nuevo.", "OK")
        case "fr": return ("Impossible de partager ceci sur YuKon3t. Réessayez.", "OK")
        case "pt": return ("Não foi possível compartilhar isto no YuKon3t. Tente novamente.", "OK")
        case "ar": return ("تعذّرت مشاركة هذا على YuKon3t. حاول مرة أخرى.", "حسنًا")
        default: return ("Couldn't share this to YuKon3t. Please try again.", "OK")
        }
    }

    private static func languageCode() -> String {
        Locale.preferredLanguages.first.map { String($0.prefix(2)) } ?? "en"
    }

    private func finish() {
        guard !completed else { return }
        completed = true
        shareTrace("completeRequest")
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
