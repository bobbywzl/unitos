import SwiftUI
import UIKit
import WebKit

/// The web view and everything the site needs from the app around it
/// (SPEC.md §33): which addresses stay in the app, sign-in in the system
/// sheet, files the site downloads, the site's JavaScript dialogs, the
/// microphone, and the Apple Pencil's double tap.
@MainActor
final class WebModel: NSObject, ObservableObject {
    /// The site could not be reached and no page is on screen.
    @Published var unreachable = false

    let webView: WKWebView
    private let signIn = SignInSheet()
    private var downloads: [WKDownload: URL] = [:]
    /// The last address the app tried to open: Try again opens it.
    private var wanted: URL

    override init() {
        let configuration = WKWebViewConfiguration()
        // The web view's own user agent, then what the app is. The site
        // reads the last part (appShellOf, src/lib/app-shell.ts).
        configuration.applicationNameForUserAgent = "Mobile/15E148 \(AppConfig.userAgentToken)"
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.isElementFullscreenEnabled = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        wanted = AppConfig.siteURL
        super.init()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        // The pages fill the window and scroll their own panes: the window
        // itself has nothing to bounce.
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        #if DEBUG
        webView.isInspectable = true
        #endif

        // The Apple Pencil's double tap and squeeze switch the pen and the
        // eraser of the Jot tool; the page listens for the event.
        let pencil = UIPencilInteraction()
        pencil.delegate = self
        webView.addInteraction(pencil)

        webView.load(URLRequest(url: AppConfig.siteURL))
    }

    func reload() {
        unreachable = false
        webView.load(URLRequest(url: wanted))
    }

    /// A link to the site opened from outside the app (Mail, Messages).
    func open(link: URL) {
        guard AppConfig.isSite(link) else { return }
        unreachable = false
        wanted = link
        webView.load(URLRequest(url: link))
    }

    private func openOutside(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(scheme) else { return }
        UIApplication.shared.open(url)
    }

    private func startSignIn(path: String) {
        signIn.start(path: path) { [weak self] outcome in
            DispatchQueue.main.async {
                guard let self, case .open(let url) = outcome else { return }
                self.wanted = AppConfig.siteURL
                self.webView.load(URLRequest(url: url))
            }
        }
    }

    private var presenter: UIViewController? {
        var top = webView.window?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }

    private func tellPage(_ event: String) {
        webView.evaluateJavaScript("window.dispatchEvent(new Event('\(event)'))", completionHandler: nil)
    }
}

// MARK: - Where a link opens

extension WebModel: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        // A frame inside a page (a video, a checkout field) loads as it does in a browser.
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if !mainFrame || ["about", "blob", "data"].contains(scheme) {
            decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
            return
        }
        if scheme != "http" && scheme != "https" {
            openOutside(url)
            decisionHandler(.cancel)
            return
        }
        if AppConfig.isSite(url) {
            // Google's and Apple's sign-in run in the system sheet. The
            // sheet's own address carries ?app=, and never comes through here.
            if AppConfig.sheetSignInPaths.contains(url.path) {
                decisionHandler(.cancel)
                startSignIn(path: url.path)
                return
            }
            if navigationAction.shouldPerformDownload {
                decisionHandler(.download)
                return
            }
            wanted = url
            decisionHandler(.allow)
            return
        }
        // Another site. A link the reader pressed opens in the browser; a
        // step the site itself takes (a checkout, its way back) stays here.
        if navigationAction.navigationType == .linkActivated {
            openOutside(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        // An export, or a file the web view cannot show: saved as a file.
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        if disposition.hasPrefix("attachment") || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        unreachable = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        // A cancelled load (a sign-in door, a download, a second tap) is not a failure.
        if code == NSURLErrorCancelled || code == 102 { return }
        // With a page on screen the page stays; with none the app says why.
        if webView.url == nil || webView.url?.absoluteString == "about:blank" { unreachable = true }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The system ended the page's process (memory): the page loads again.
        webView.reload()
    }
}

// MARK: - New windows, dialogs, the microphone

extension WebModel: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // The app has one window: a page of the site opens in it, anything
        // else in the browser.
        if let url = navigationAction.request.url {
            if AppConfig.isSite(url) { webView.load(navigationAction.request) } else { openOutside(url) }
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        guard let presenter else {
            completionHandler()
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard let presenter else {
            completionHandler(false)
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presenter.present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        guard let presenter else {
            completionHandler(nil)
            return
        }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        presenter.present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        // The site's own pages record (a spoken note, a voice command) once
        // the system's own question has been answered; no other page does.
        let own = origin.host.lowercased() == AppConfig.siteHost.lowercased()
        decisionHandler(own && frame.isMainFrame ? .grant : .deny)
    }
}

// MARK: - Files the site downloads

extension WebModel: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        // A folder of its own per file, so the name the site gave stays.
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let file = folder.appendingPathComponent(suggestedFilename.isEmpty ? "Unitos export" : suggestedFilename)
        downloads[download] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: download), let presenter else { return }
        // The system's own sheet: Save to Files on an iPhone and an iPad, a
        // save dialog on a Mac.
        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
        presenter.present(picker, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: download)
    }
}

// MARK: - The Apple Pencil

extension WebModel: UIPencilInteractionDelegate {
    private static let pencilTap = "unitos:pencil-tap"

    // Before iOS 17.5.
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        if UIPencilInteraction.preferredTapAction == .ignore { return }
        tellPage(Self.pencilTap)
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        if UIPencilInteraction.preferredTapAction == .ignore { return }
        tellPage(Self.pencilTap)
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        if UIPencilInteraction.preferredSqueezeAction == .ignore { return }
        if squeeze.phase == .ended { tellPage(Self.pencilTap) }
    }
}

// MARK: - The view

struct WebScreen: UIViewRepresentable {
    @ObservedObject var model: WebModel

    func makeUIView(context: Context) -> WKWebView { model.webView }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
