import Foundation
import UIKit

/// What the app is built around: the site it shows, and what it tells the
/// site about itself (SPEC.md §33).
enum AppConfig {
    /// The site the app is a window onto. The one place to change it.
    static let siteURL = URL(string: "https://unitosnotebook.com")!

    /// The scheme the site ends a sign-in on: `unitos://signed-in?token=…`
    /// (`APP_SCHEME`, src/lib/app-shell.ts).
    static let scheme = "unitos"

    /// The sign-in doors the app runs in the system sign-in sheet. Google
    /// refuses to sign anyone in inside an app's web view.
    static let sheetSignInPaths: Set<String> = ["/api/auth/login", "/api/auth/apple/login"]

    static var siteHost: String { siteURL.host ?? "" }

    /// The device the site lays itself out for: `mac`, `ipad`, or `iphone`.
    /// An iPad's web view reads as a Mac, so the app says which it is.
    static var device: String {
        if ProcessInfo.processInfo.isMacCatalystApp { return "mac" }
        return UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
    }

    static var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    /// Added to the web view's user agent; the site reads it with
    /// `appShellOf` (src/lib/app-shell.ts).
    static var userAgentToken: String { "UnitosApp/\(version) (\(device))" }

    /// True for the site's own pages.
    static func isSite(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased() else { return false }
        let site = siteHost.lowercased()
        return host == site || host == "www.\(site)"
    }

    /// An address on the site.
    static func site(path: String, query: [URLQueryItem] = []) -> URL {
        var parts = URLComponents(url: siteURL, resolvingAgainstBaseURL: false)!
        parts.path = path
        parts.queryItems = query.isEmpty ? nil : query
        return parts.url!
    }
}
