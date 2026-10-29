<?php
/**
 * WooCommerce-Anbindung: Produktoptionen, Schlüssel bei Zahlung, Sperre bei Storno.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('woocommerce_product_options_general_product_data', function () {
    echo '<div class="options_group">';
    woocommerce_wp_checkbox([
        'id' => '_opls_enabled',
        'label' => __('Lizenzschlüssel erzeugen', 'onepc-license-server'),
        'description' => __('Beim Kauf automatisch einen Lizenzschlüssel für OnePC Guard erzeugen und mitsenden.', 'onepc-license-server'),
    ]);
    woocommerce_wp_text_input([
        'id' => '_opls_product',
        'label' => __('Produktkennung', 'onepc-license-server'),
        'placeholder' => 'onepc-guard',
        'desc_tip' => true,
        'description' => __('Muss mit "product" in der config/app.json des Programms übereinstimmen.', 'onepc-license-server'),
    ]);
    woocommerce_wp_text_input([
        'id' => '_opls_activations',
        'label' => __('Anzahl PCs', 'onepc-license-server'),
        'type' => 'number',
        'placeholder' => '1',
        'custom_attributes' => ['min' => 1, 'step' => 1],
    ]);
    woocommerce_wp_text_input([
        'id' => '_opls_days',
        'label' => __('Laufzeit in Tagen', 'onepc-license-server'),
        'type' => 'number',
        'placeholder' => '365',
        'desc_tip' => true,
        'description' => __('0 = unbegrenzt gültig. 365 = ein Jahr.', 'onepc-license-server'),
        'custom_attributes' => ['min' => 0, 'step' => 1],
    ]);
    echo '</div>';
});

add_action('woocommerce_admin_process_product_object', function ($product) {
    // Nonce und Rechte prüft WooCommerce vor diesem Hook.
    // phpcs:disable WordPress.Security.NonceVerification.Missing
    $product->update_meta_data('_opls_enabled', isset($_POST['_opls_enabled']) ? 'yes' : 'no');
    $product->update_meta_data('_opls_product', isset($_POST['_opls_product']) && $_POST['_opls_product'] !== '' ? sanitize_key(wp_unslash($_POST['_opls_product'])) : 'onepc-guard');
    $product->update_meta_data('_opls_activations', isset($_POST['_opls_activations']) ? max(1, absint($_POST['_opls_activations'])) : 1);
    $product->update_meta_data('_opls_days', isset($_POST['_opls_days']) ? absint($_POST['_opls_days']) : 0);
    // phpcs:enable
});

/**
 * Erzeugt die Schlüssel, sobald die Bestellung bezahlt ist. Läuft mit Priorität 5,
 * also vor dem Versand der Bestell-E-Mail, damit die Schlüssel darin stehen.
 */
function opls_generate_for_order($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) {
        return;
    }

    $created = [];
    foreach ($order->get_items() as $item) {
        $product = wc_get_product($item->get_product_id());
        if (!$product || $product->get_meta('_opls_enabled') !== 'yes' || $item->get_meta('_opls_keys')) {
            continue;
        }

        $keys = [];
        for ($i = 0; $i < max(1, (int) $item->get_quantity()); $i++) {
            $keys[] = opls_create_license([
                'product' => $product->get_meta('_opls_product') ?: 'onepc-guard',
                'order_id' => $order->get_id(),
                'email' => $order->get_billing_email(),
                'customer' => trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()),
                'max_activations' => (int) $product->get_meta('_opls_activations') ?: 1,
                'days' => (int) $product->get_meta('_opls_days'),
            ]);
        }

        $item->add_meta_data('_opls_keys', $keys, true);
        // Sichtbare Metadaten erscheinen automatisch in E-Mail, Kundenkonto und Rechnung.
        $item->add_meta_data(__('Lizenzschlüssel', 'onepc-license-server'), implode(', ', $keys), true);
        $item->save();
        $created = array_merge($created, $keys);
    }

    if ($created) {
        $order->add_order_note(sprintf(__('Lizenzschlüssel erzeugt: %s', 'onepc-license-server'), implode(', ', $created)));
    }
}
add_action('woocommerce_order_status_processing', 'opls_generate_for_order', 5);
add_action('woocommerce_order_status_completed', 'opls_generate_for_order', 5);

function opls_revoke_for_order($order_id) {
    global $wpdb;
    $wpdb->update(opls_table('licenses'), ['status' => 'revoked'], ['order_id' => absint($order_id)]);

    $order = wc_get_order($order_id);
    if ($order) {
        $order->add_order_note(__('Lizenzschlüssel dieser Bestellung wurden gesperrt.', 'onepc-license-server'));
    }
}
add_action('woocommerce_order_status_refunded', 'opls_revoke_for_order');
add_action('woocommerce_order_status_cancelled', 'opls_revoke_for_order');

// Hinweis mit Download-Tipp unter den Schlüsseln in der Bestell-E-Mail.
add_action('woocommerce_email_after_order_table', function ($order, $sent_to_admin, $plain_text) {
    if ($sent_to_admin) {
        return;
    }
    $has_keys = false;
    foreach ($order->get_items() as $item) {
        if ($item->get_meta('_opls_keys')) {
            $has_keys = true;
            break;
        }
    }
    if (!$has_keys) {
        return;
    }

    $text = __('So aktivierst du die Vollversion: OnePC Guard öffnen, links auf „Lizenz“ klicken und den Lizenzschlüssel aus dieser E-Mail eingeben.', 'onepc-license-server');
    if ($plain_text) {
        echo "\n" . esc_html($text) . "\n";
    } else {
        echo '<p>' . esc_html($text) . '</p>';
    }
}, 10, 3);
