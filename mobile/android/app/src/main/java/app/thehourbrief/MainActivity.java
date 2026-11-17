package app.thehourbrief;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.WebViewListener;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * The app's own launch splash on Android, to match iOS: the icon with the name and tagline under it (owner, 2026-11-18).
 *
 * Android 12+ draws a system splash first, and that can only hold an icon (its bottom "branding image" isn't drawn on
 * many phones). So this shows the system splash only for the moment the app needs to start, then a screen of its own
 * with the very same icon in the very same place (no jump) plus the wordmark and tagline, the way the iOS splash looks.
 * It fades out once the page has loaded and has been up long enough to read; a few seconds at most.
 *
 * The SplashScreen plugin would otherwise hold the system splash (icon only) for up to 2s and hide this behind it, so
 * its hold is released here (iOS keeps the plugin's behaviour; this file is Android only). If that ever fails, the
 * plugin's own splash simply runs first, as before.
 */
public class MainActivity extends BridgeActivity {
    private static final long MIN_MS = 1400;   // long enough to take in the name and tagline
    private static final long MAX_MS = 5000;   // never keep someone waiting on a slow network

    private final Handler handler = new Handler(Looper.getMainLooper());
    private View splash;
    private long shownAt;
    private boolean pageLoaded;
    private int splashColor;
    private Integer wantedStatusColor, wantedNavColor;      // what the page asked for while the splash was up
    private Boolean wantedLightStatus, wantedLightNav;
    private ViewTreeObserver.OnPreDrawListener barGuard;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState == null) {                  // a fresh launch, not a rotation or theme change
            showSplash();
            releasePluginHold();
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void showSplash() {
        splashColor = ContextCompat.getColor(this, R.color.splash_background);
        FrameLayout v = new FrameLayout(this);
        v.setBackgroundColor(splashColor);
        v.setClickable(true);                               // nothing underneath reacts while it's up

        // Same drawable, size and centre as the system splash's icon (288dp canvas, centred in the window).
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.splash_icon);
        v.addView(icon, new FrameLayout.LayoutParams(dp(288), dp(288), Gravity.CENTER));

        // Wordmark + tagline under the icon, spaced as on iOS (see tools/brand/android-splash.py).
        ImageView text = new ImageView(this);
        text.setImageResource(R.drawable.splash_text);
        text.setTranslationY(dp(135));
        v.addView(text, new FrameLayout.LayoutParams(dp(240), dp(96), Gravity.CENTER));

        // On the window's decor view, so it covers the whole screen and centres exactly like the system splash.
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.addView(v, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash = v;
        shownAt = SystemClock.uptimeMillis();

        // Dark system bars with light icons while it's up. The page sets its own bar colours as it loads (behind the
        // splash); note what it asked for, keep the splash's look until the splash goes, then hand the bars back.
        forceSplashBars();
        barGuard = () -> {
            Window w = getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            if (w.getStatusBarColor() != splashColor) { wantedStatusColor = w.getStatusBarColor(); wantedLightStatus = c.isAppearanceLightStatusBars(); }
            if (w.getNavigationBarColor() != splashColor) { wantedNavColor = w.getNavigationBarColor(); wantedLightNav = c.isAppearanceLightNavigationBars(); }
            if (wantedStatusColor != null || wantedNavColor != null) forceSplashBars();
            return true;
        };
        decor.getViewTreeObserver().addOnPreDrawListener(barGuard);

        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                pageLoaded = true;
                maybeHide();
            }
        });
        handler.postDelayed(this::maybeHide, MIN_MS);
        handler.postDelayed(this::hideSplash, MAX_MS);
    }

    @SuppressWarnings("deprecation")
    private void forceSplashBars() {
        Window w = getWindow();
        if (w.getStatusBarColor() != splashColor) w.setStatusBarColor(splashColor);
        if (w.getNavigationBarColor() != splashColor) w.setNavigationBarColor(splashColor);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        if (c.isAppearanceLightStatusBars()) c.setAppearanceLightStatusBars(false);
        if (c.isAppearanceLightNavigationBars()) c.setAppearanceLightNavigationBars(false);
    }

    private void maybeHide() {
        if (splash == null) return;
        if (pageLoaded && SystemClock.uptimeMillis() - shownAt >= MIN_MS) hideSplash();
    }

    @SuppressWarnings("deprecation")
    private void hideSplash() {
        final View v = splash;
        if (v == null) return;
        splash = null;
        handler.removeCallbacksAndMessages(null);
        if (barGuard != null) {
            getWindow().getDecorView().getViewTreeObserver().removeOnPreDrawListener(barGuard);
            barGuard = null;
        }
        Window w = getWindow();
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        if (wantedStatusColor != null) w.setStatusBarColor(wantedStatusColor);
        if (wantedNavColor != null) w.setNavigationBarColor(wantedNavColor);
        if (wantedLightStatus != null) c.setAppearanceLightStatusBars(wantedLightStatus);
        if (wantedLightNav != null) c.setAppearanceLightNavigationBars(wantedLightNav);
        v.animate().alpha(0f).setDuration(260).withEndAction(() -> {
            ViewGroup parent = (ViewGroup) v.getParent();
            if (parent != null) parent.removeView(v);
        }).start();
    }

    // Lets the window draw now instead of after the SplashScreen plugin's hold. The plugin keeps its splash object in a
    // private field; this is the same hide() its own JS call (SplashScreen.hide() in capacitor-bridge.js) ends up in.
    private void releasePluginHold() {
        try {
            PluginHandle handle = bridge.getPlugin("SplashScreen");
            if (handle == null) return;
            Object plugin = handle.getInstance();
            Field field = plugin.getClass().getDeclaredField("splashScreen");
            field.setAccessible(true);
            Object splashScreen = field.get(plugin);
            if (splashScreen == null) return;
            Class<?> settingsClass = Class.forName("com.capacitorjs.plugins.splashscreen.SplashScreenSettings");
            Method hide = splashScreen.getClass().getMethod("hide", settingsClass);
            hide.invoke(splashScreen, settingsClass.getConstructor().newInstance());
            Log.d("HourBrief", "splash: plugin hold released");
        } catch (Throwable t) {
            // The plugin's own hold stays; this splash then simply appears after it.
            Log.w("HourBrief", "splash: could not release the plugin hold: " + t);
        }
    }
}
