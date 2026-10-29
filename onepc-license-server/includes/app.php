<?php
/**
 * OnePC-App fürs Handy unter /onepc-app/ (installierbare Web-App).
 * Anmeldung über das normale Kundenkonto des Shops.
 */

if (!defined('ABSPATH')) {
    exit;
}

function opls_app_url($file = '') {
    return home_url('/onepc-app/' . $file);
}

function opls_app_path() {
    return trailingslashit((string) wp_parse_url(opls_app_url(), PHP_URL_PATH));
}

/**
 * Erkennt Aufrufe der App direkt an der Adresse – unabhängig von Permalink-
 * Einstellungen und WordPress-Adressregeln. Zusätzlich funktioniert immer
 * ?opls_app=index (z. B. bei „einfachen“ Permalinks).
 */
function opls_app_requested_view() {
    $views = ['index', 'manifest.webmanifest', 'sw.js'];

    // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- nur Anzeige
    if (isset($_GET['opls_app'])) {
        $view = (string) wp_unslash($_GET['opls_app']);
        return in_array($view, $views, true) ? $view : 'index';
    }

    $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '';
    $path = rawurldecode((string) wp_parse_url($uri, PHP_URL_PATH));
    $base = opls_app_path();

    if ($path === $base || $path === untrailingslashit($base)) {
        return 'index';
    }
    foreach (['manifest.webmanifest', 'sw.js'] as $file) {
        if ($path === $base . $file) {
            return $file;
        }
    }
    return null;
}

// So früh wie möglich ausliefern: vor 404-Erkennung und Weiterleitungen
// (Browser lehnen weitergeleitete Service-Worker ab).
add_action('parse_request', function () {
    $view = opls_app_requested_view();
    if ($view === null) {
        return;
    }

    status_header(200);
    if ($view === 'manifest.webmanifest') {
        opls_app_manifest();
    } elseif ($view === 'sw.js') {
        opls_app_service_worker();
    } else {
        opls_app_page();
    }
    exit;
}, 0);

function opls_app_asset($file) {
    return plugins_url('assets/app/' . $file, OPLS_FILE) . '?v=' . OPLS_VERSION;
}

function opls_app_manifest() {
    header('Content-Type: application/manifest+json; charset=utf-8');
    echo wp_json_encode([
        'name' => 'OnePC Guard',
        'short_name' => 'OnePC',
        'description' => 'Status, Virenprüfung und Aufräumen deiner PCs.',
        'lang' => 'de',
        'start_url' => opls_app_path(),
        'scope' => opls_app_path(),
        'display' => 'standalone',
        'background_color' => '#0b1736',
        'theme_color' => '#0b1736',
        'icons' => [
            ['src' => opls_app_asset('icon-192.png'), 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
            ['src' => opls_app_asset('icon-512.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
            ['src' => opls_app_asset('icon-maskable.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
        ],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function opls_app_service_worker() {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Service-Worker-Allowed: ' . opls_app_path());
    nocache_headers();

    $shell = [opls_app_asset('app.css'), opls_app_asset('app.js'), opls_app_asset('icon-192.png')];
    ?>
const CACHE = 'onepc-app-<?php echo esc_js(OPLS_VERSION); ?>';
const SHELL = <?php echo wp_json_encode($shell, JSON_UNESCAPED_SLASHES); ?>;

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('onepc-app-') && k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || request.url.includes('/wp-json/')) {
        return; // Daten immer frisch vom Server.
    }
    if (request.mode === 'navigate') {
        // Seite immer neu laden (enthält die Anmeldung), offline die letzte Fassung zeigen.
        event.respondWith(fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
        }).catch(() => caches.match(request)));
        return;
    }
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
    <?php
}

function opls_app_page() {
    nocache_headers();
    header('Content-Type: text/html; charset=utf-8');

    $user = wp_get_current_user();
    $logged_in = $user && $user->exists();
    $config = [
        'rest' => esc_url_raw(rest_url('onepc/v1/')),
        // Nur für Kunden mit WordPress-Konto; sonst Anmeldung per E-Mail + Lizenzschlüssel.
        'nonce' => $logged_in ? wp_create_nonce('wp_rest') : '',
        'user' => $logged_in ? $user->display_name : '',
        'wpLogin' => wp_login_url(opls_app_url()),
        'wpLogout' => wp_logout_url(opls_app_url()),
        'shop' => home_url('/'),
        'sw' => opls_app_url('sw.js'),
        'scope' => opls_app_path(),
    ];
    ?>
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#0b1736">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="OnePC">
    <meta name="robots" content="noindex">
    <title>OnePC Guard</title>
    <link rel="manifest" href="<?php echo esc_url(opls_app_url('manifest.webmanifest')); ?>">
    <link rel="icon" href="<?php echo esc_url(opls_app_asset('icon-192.png')); ?>">
    <link rel="apple-touch-icon" href="<?php echo esc_url(opls_app_asset('icon-192.png')); ?>">
    <link rel="stylesheet" href="<?php echo esc_url(opls_app_asset('app.css')); ?>">
</head>
<body>
    <header class="top">
        <img src="<?php echo esc_url(opls_app_asset('icon-192.png')); ?>" alt="" width="36" height="36">
        <div class="brand"><strong>OnePC Guard</strong><span id="who">Meine PCs</span></div>
        <button class="logout" id="logout" type="button" hidden>Abmelden</button>
    </header>
    <div id="install" hidden></div>
    <main id="app"><p class="loading">Einen Moment …</p></main>
    <div id="toast" role="status" aria-live="polite"></div>
    <script>window.ONEPC = <?php echo wp_json_encode($config, JSON_UNESCAPED_SLASHES); ?>;</script>
    <script src="<?php echo esc_url(opls_app_asset('app.js')); ?>"></script>
</body>
</html>
    <?php
}

// Link im WooCommerce-Kundenkonto.
add_filter('woocommerce_account_menu_items', function ($items) {
    $logout = isset($items['customer-logout']) ? ['customer-logout' => $items['customer-logout']] : [];
    unset($items['customer-logout']);
    return $items + ['onepc-app' => 'OnePC-App'] + $logout;
});

add_filter('woocommerce_get_endpoint_url', function ($url, $endpoint) {
    return $endpoint === 'onepc-app' ? opls_app_url() : $url;
}, 10, 2);
