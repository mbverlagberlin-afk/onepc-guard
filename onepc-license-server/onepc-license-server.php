<?php
/**
 * Plugin Name: OnePC Lizenzserver
 * Description: Erzeugt beim Kauf in WooCommerce Lizenzschlüssel für OnePC Guard, prüft die Aktivierung im Programm und stellt die OnePC-App fürs Handy bereit (/onepc-app/).
 * Version: 1.1.1
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * Text Domain: onepc-license-server
 */

if (!defined('ABSPATH')) {
    exit;
}

define('OPLS_VERSION', '1.1.1');
define('OPLS_DB_VERSION', '2');
define('OPLS_FILE', __FILE__);

require_once __DIR__ . '/includes/licenses.php';
require_once __DIR__ . '/includes/api.php';
require_once __DIR__ . '/includes/woocommerce.php';
require_once __DIR__ . '/includes/admin.php';
require_once __DIR__ . '/includes/remote.php';
require_once __DIR__ . '/includes/app.php';

register_activation_hook(__FILE__, 'opls_install');

add_action('plugins_loaded', function () {
    if (get_option('opls_db_version') !== OPLS_DB_VERSION) {
        opls_install();
    }
});

add_action('before_woocommerce_init', function () {
    if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});
