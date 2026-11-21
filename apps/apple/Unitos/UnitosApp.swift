import SwiftUI

/// Unitos for iPhone, iPad, and Mac (SPEC.md §33). The app is a window onto
/// the site: one web view that loads the same pages a browser loads. What
/// each device shows is the site's own doing — the phone page on an iPhone,
/// the reader with jottings on an iPad, the web app as it is on a Mac.
@main
struct UnitosApp: App {
    @StateObject private var model = WebModel()

    var body: some Scene {
        WindowGroup {
            ZStack {
                // Behind the status bar, where the page does not reach.
                Color("Paper").ignoresSafeArea()
                // The page runs to the screen's foot: it pads its own bars
                // for the home indicator (env(safe-area-inset-bottom)).
                WebScreen(model: model)
                    .ignoresSafeArea(.container, edges: .bottom)
                    .ignoresSafeArea(.keyboard)
                if model.unreachable {
                    UnreachableView { model.reload() }
                }
            }
            // A link the site emailed (the sign-in link, the reset link)
            // opens here once the app's associated domain is set up.
            .onOpenURL { model.open(link: $0) }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { model.open(link: url) }
            }
        }
    }
}

/// Shown when the site cannot be reached and no page is on screen.
private struct UnreachableView: View {
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Text("Unitos cannot be reached")
                .font(.title3.weight(.semibold))
            Text("Check the network, then try again.")
                .foregroundStyle(.secondary)
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .multilineTextAlignment(.center)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("Paper").ignoresSafeArea())
    }
}
