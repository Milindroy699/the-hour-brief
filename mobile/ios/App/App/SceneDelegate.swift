import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// Capacitor's own view controller, with one change: a navigation that was merely cancelled is not treated as a failure.
// Capacitor loads its error page ("We couldn't load today's brief", errorPath in capacitor.config.json) for ANY failed
// navigation, and WebKit reports a cancelled one as failed (NSURLErrorCancelled): tapping a tab twice, or leaving a page
// before it finished loading. That showed the error page on the way to Voices (owner, 2026-11-18). Real failures,
// like being offline, still get the error page.
class MainViewController: CAPBridgeViewController {
    private var navigationGuard: NavigationGuard?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Between one page and the next, WebKit briefly shows nothing but the web view's own background. That was the
        // splash's near-black (#0c0d15, backgroundColor in capacitor.config.json), so every switch to or from Voices
        // flashed black (owner, 2026-11-18). Use the pages' own background instead, light or dark with the phone
        // (app.css --bg: #faf9fd / #121316). The launch splash is unaffected: it sits on top until the page is up.
        let pageBackground = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0x12 / 255.0, green: 0x13 / 255.0, blue: 0x16 / 255.0, alpha: 1)
                : UIColor(red: 0xfa / 255.0, green: 0xf9 / 255.0, blue: 0xfd / 255.0, alpha: 1)
        }
        webView?.backgroundColor = pageBackground
        webView?.scrollView.backgroundColor = pageBackground
        guard let webView = webView, let capacitorDelegate = webView.navigationDelegate else { return }
        let guardDelegate = NavigationGuard(wrapping: capacitorDelegate)
        navigationGuard = guardDelegate                  // the web view holds its navigation delegate weakly
        webView.navigationDelegate = guardDelegate
    }
}

// Sits between the web view and Capacitor's navigation delegate: drops "cancelled" failures, forwards everything else
// (including all the methods it doesn't implement itself) to Capacitor untouched.
final class NavigationGuard: NSObject, WKNavigationDelegate {
    private weak var inner: WKNavigationDelegate?

    init(wrapping inner: WKNavigationDelegate) {
        self.inner = inner
        super.init()
    }

    private static func isInterruption(_ error: Error) -> Bool {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return true }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return true }    // frame load interrupted
        return false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if NavigationGuard.isInterruption(error) { return }
        inner?.webView?(webView, didFail: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if NavigationGuard.isInterruption(error) { return }
        inner?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let inner = inner, inner.responds(to: aSelector) { return inner }
        return super.forwardingTarget(for: aSelector)
    }
}
