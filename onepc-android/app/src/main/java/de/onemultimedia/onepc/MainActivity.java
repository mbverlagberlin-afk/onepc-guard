package de.onemultimedia.onepc;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * OnePC für Android: zeigt die OnePC-App aus dem Shop (/onepc-app/) in einem
 * eigenen Fenster mit eigenem Symbol. Anmeldung und Daten kommen vom Shop.
 */
public class MainActivity extends Activity {

    private static final int NAVY = Color.rgb(11, 23, 54);

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(NAVY);
        webView = new WebView(this);
        webView.setBackgroundColor(NAVY);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        applySystemBarInsets(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        // Kennung, damit die Web-App weiß, dass sie schon als App läuft.
        settings.setUserAgentString(settings.getUserAgentString() + " OnePCApp/" + BuildConfig.VERSION_NAME);

        CookieManager.getInstance().setAcceptCookie(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isOwnSite(uri)) {
                    return false;
                }
                // Fremde Links (z. B. Zahlungsanbieter, soziale Netzwerke) im Browser öffnen.
                openExternal(uri);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showOffline();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(BuildConfig.START_URL);
        }
    }

    private boolean isOwnSite(Uri uri) {
        String host = uri.getHost();
        String scheme = uri.getScheme();
        return host != null && "https".equals(scheme)
                && (host.equals(BuildConfig.APP_HOST) || host.endsWith("." + BuildConfig.APP_HOST));
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // Keine App für diesen Link vorhanden.
        }
    }

    private void showOffline() {
        String html = "<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>"
                + "<body style=\"margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;"
                + "background:#0b1736;color:#fff;font-family:sans-serif;text-align:center;padding:24px\">"
                + "<div><h1 style=\"font-size:22px\">Keine Verbindung</h1>"
                + "<p style=\"color:#c7d2ea\">OnePC braucht eine Internetverbindung, um deine PCs anzuzeigen.</p>"
                + "<a href=\"" + BuildConfig.START_URL + "\" style=\"display:inline-block;margin-top:12px;padding:14px 28px;"
                + "border-radius:12px;background:#2563eb;color:#fff;text-decoration:none;font-weight:bold\">Erneut versuchen</a>"
                + "</div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    /** Ab Android 15 zeichnen Apps unter Status- und Navigationsleiste; Abstand einhalten. */
    private void applySystemBarInsets(View root) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
