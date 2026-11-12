# Unitos for iPhone, iPad, and Mac

One Xcode project, one target. The app is a window onto the site: a web view
that loads the same pages a browser loads (SPEC.md §33). What each device
shows is the site's own doing.

- **Mac**: the web app as it is, in its own window (Mac Catalyst).
- **iPad**: the web app, with the Apple Pencil writing jottings across the
  reader and a finger selecting words for the AI toolbar.
- **iPhone**: the phone page, `/phone`: Notes and Assistant, no side bar.

The app tells the site what it is in the user agent, `UnitosApp/<version>
(mac|ipad|iphone)`, which the site reads with `appShellOf`
(`src/lib/app-shell.ts`).

## Files

| File | What it does |
| --- | --- |
| `Unitos/AppConfig.swift` | The site's address (`siteURL`, the one place to change it), the user agent token, the sign-in doors. |
| `Unitos/UnitosApp.swift` | The app's one window, and the page shown when the site cannot be reached. |
| `Unitos/WebScreen.swift` | The web view: which links stay in the app, downloads, the site's dialogs, the microphone, the Apple Pencil's double tap. |
| `Unitos/SignInSheet.swift` | Google's and Apple's sign-in in the system sign-in sheet, and the handoff back to the web view (`src/lib/app-handoff.ts`). |
| `Unitos/Unitos.entitlements` | The Mac sandbox: network, microphone, camera, files the reader picks. |

## Run it

Xcode 16 or later.

1. Open `apps/apple/Unitos.xcodeproj`.
2. Target **Unitos** → Signing & Capabilities → pick your team. Change the
   bundle identifier (`com.unitosnotebook.app`) if it is not yours.
3. Check `siteURL` in `AppConfig.swift`. To run against a local server, set
   it to the server's address (`http://<your Mac's address>:3000`) and add
   that host under App Transport Security exceptions.
4. Pick a destination and run: an iPhone, an iPad, or **My Mac (Mac
   Catalyst)**.

## Set up on the site

- **Links from email.** The sign-in link and the password reset link open in
  the browser unless the app claims them. To have them open in the app:
  set `IOS_APP_ID` on the site to `<Team ID>.<bundle identifier>` (the site
  then serves `/.well-known/apple-app-site-association`), and in Xcode add
  the capability Associated Domains with `applinks:<the site's host>`. The
  capability needs a paid developer team, so the project ships without it.
- **Google and Apple sign-in.** Set `APP_SIGNIN=on` on the site. The app
  opens the site's own `/api/auth/login?app=…` in the system sign-in sheet,
  and the site hands the sign-in back at `unitos://signed-in`. The redirect
  address registered with Google stays the site's. The switch is off by
  default because any app on a device can claim a custom scheme
  (`src/lib/app-handoff.ts` says what that allows); a later version should
  move the way back to an https address claimed through the associated
  domain. With the switch off, email and password sign-in still work in
  the app.

## What the app does not do yet

- **Save for offline.** A web view runs no service worker unless the app
  limits itself to its own domain, which would stop the checkout page. Notes
  written with no network still wait in the offline queue while the app is
  open.
- **Link Google Drive.** Google's account page refuses to open in a web
  view, and the link is tied to the browser's session. Link Drive in a
  browser; the files then show in the app.
- **Subscriptions.** The site's billing pages open in the app as they do in
  a browser. Apple's review rules on buying digital goods inside an app
  apply before a release to the App Store.

## The build check

`.github/workflows/apple.yml` builds the target for the iOS simulator and
for Mac Catalyst, with no signing, whenever a file under `apps/apple`
changes.
