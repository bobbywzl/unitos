import AuthenticationServices
import CryptoKit
import UIKit

/// Google's and Apple's sign-in, run in the system sign-in sheet (SPEC.md
/// §33, src/lib/app-handoff.ts). The sheet is the system browser, so the
/// session it would set is not the web view's. The site hands the sign-in
/// back instead: the sheet ends at `unitos://signed-in?token=…`, and the web
/// view trades the token, with the verifier made here, for its own session.
@MainActor
final class SignInSheet: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Outcome {
        /// Open this address in the web view: it sets the session, or shows why not.
        case open(URL)
        /// The person closed the sheet.
        case cancelled
    }

    private var session: ASWebAuthenticationSession?

    /// - Parameter path: `/api/auth/login` or `/api/auth/apple/login`.
    func start(path: String, completion: @escaping (Outcome) -> Void) {
        let verifier = Self.randomVerifier()
        let challenge = Self.challenge(of: verifier)
        let start = AppConfig.site(path: path, query: [URLQueryItem(name: "app", value: challenge)])

        let session = ASWebAuthenticationSession(url: start, callbackURLScheme: AppConfig.scheme) { [weak self] callback, _ in
            self?.session = nil
            guard let callback,
                  let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
            else {
                completion(.cancelled)
                return
            }
            if let token = items.first(where: { $0.name == "token" })?.value {
                completion(.open(AppConfig.site(path: "/api/auth/app/finish", query: [
                    URLQueryItem(name: "token", value: token),
                    URLQueryItem(name: "verifier", value: verifier),
                ])))
            } else {
                let reason = items.first(where: { $0.name == "error" })?.value ?? "Sign-in did not finish"
                completion(.open(AppConfig.site(path: "/signin", query: [URLQueryItem(name: "error", value: reason)])))
            }
        }
        session.presentationContextProvider = self
        // The sheet shares Safari's cookies: someone signed in to Google
        // there picks an account without typing a password.
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() {
            self.session = nil
            completion(.cancelled)
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap { $0.windows }
        return windows.first(where: { $0.isKeyWindow }) ?? windows.first ?? ASPresentationAnchor()
    }

    /// 32 random bytes in base64url: 43 characters.
    private static func randomVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64URL(Data(bytes))
    }

    /// The verifier's SHA-256 in base64url, as the site computes it
    /// (`challengeOf`, src/lib/app-handoff.ts).
    private static func challenge(of verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
