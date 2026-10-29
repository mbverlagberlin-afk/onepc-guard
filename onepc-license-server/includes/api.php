<?php
/**
 * REST-API für das Programm:
 *   POST /wp-json/onepc/v1/activate    { license_key, device_id, device_name, product }
 *   POST /wp-json/onepc/v1/validate    { license_key, device_id, product }
 *   POST /wp-json/onepc/v1/deactivate  { license_key, device_id, product }
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {
    foreach (['activate', 'validate', 'deactivate'] as $action) {
        register_rest_route('onepc/v1', '/' . $action, [
            'methods' => 'POST',
            'callback' => 'opls_api_' . $action,
            'permission_callback' => '__return_true',
            'args' => [
                'license_key' => ['type' => 'string', 'required' => true],
                'device_id' => ['type' => 'string', 'required' => true],
                'product' => ['type' => 'string', 'required' => true],
                'device_name' => ['type' => 'string', 'required' => false],
            ],
        ]);
    }
});

function opls_api_error($code, $message, $status) {
    return new WP_Error($code, $message, ['status' => $status]);
}

function opls_rate_limited($bucket = 'auth', $limit = 30, $who = null) {
    if ($who === null) {
        $who = isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : '';
    }
    $key = 'opls_rl_' . md5($bucket . '|' . $who);
    $count = (int) get_transient($key);

    if ($count >= (int) apply_filters('opls_rate_limit', $limit, $bucket)) {
        return true;
    }
    set_transient($key, $count + 1, 10 * MINUTE_IN_SECONDS);
    return false;
}

/**
 * Gemeinsame Prüfung für alle Endpunkte. Gibt die Lizenz oder ein WP_Error zurück.
 */
function opls_api_license(WP_REST_Request $request, $bucket = 'auth', $limit = 30) {
    if (opls_rate_limited($bucket, $limit)) {
        return opls_api_error('rate_limited', 'Zu viele Anfragen. Bitte versuche es in einigen Minuten erneut.', 429);
    }

    $device_id = (string) $request->get_param('device_id');
    if (!preg_match('/^[a-f0-9]{16,64}$/', $device_id)) {
        return opls_api_error('invalid_device', 'Ungültige Gerätekennung.', 400);
    }

    $license = opls_get_license((string) $request->get_param('license_key'));
    if (!$license) {
        return opls_api_error('invalid_key', 'Dieser Lizenzschlüssel ist nicht gültig. Bitte prüfe die Eingabe.', 404);
    }
    if ($license->product !== sanitize_key($request->get_param('product'))) {
        return opls_api_error('wrong_product', 'Dieser Lizenzschlüssel gehört zu einem anderen Produkt.', 400);
    }

    return $license;
}

function opls_api_check_usable($license) {
    if ($license->status === 'revoked') {
        return opls_api_error('revoked', 'Dieser Lizenzschlüssel wurde gesperrt. Bitte wende dich an den Support.', 403);
    }
    if (opls_is_expired($license)) {
        return opls_api_error('expired', 'Dieser Lizenzschlüssel ist abgelaufen. Bitte verlängere die Lizenz im Shop.', 403);
    }
    return true;
}

function opls_find_activation($license_id, $device_id) {
    global $wpdb;
    return $wpdb->get_row($wpdb->prepare(
        'SELECT * FROM ' . opls_table('activations') . ' WHERE license_id = %d AND device_id = %s',
        $license_id,
        $device_id
    ));
}

function opls_touch_activation($activation_id) {
    global $wpdb;
    $wpdb->update(opls_table('activations'), ['last_seen' => current_time('mysql', true)], ['id' => $activation_id]);
}

function opls_api_activate(WP_REST_Request $request) {
    global $wpdb;

    $license = opls_api_license($request);
    if (is_wp_error($license)) {
        return $license;
    }
    $usable = opls_api_check_usable($license);
    if (is_wp_error($usable)) {
        return $usable;
    }

    $device_id = (string) $request->get_param('device_id');
    $activation = opls_find_activation($license->id, $device_id);

    if ($activation) {
        opls_touch_activation($activation->id);
    } else {
        $count = (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM ' . opls_table('activations') . ' WHERE license_id = %d', $license->id));
        if ($count >= (int) $license->max_activations) {
            return opls_api_error(
                'too_many_activations',
                sprintf('Dieser Lizenzschlüssel ist bereits auf %d PC(s) aktiv. Bitte deaktiviere ihn zuerst in OnePC Guard auf einem anderen PC (Seite „Lizenz“).', $license->max_activations),
                403
            );
        }

        $now = current_time('mysql', true);
        $wpdb->insert(opls_table('activations'), [
            'license_id' => $license->id,
            'device_id' => $device_id,
            'device_name' => mb_substr(sanitize_text_field((string) $request->get_param('device_name')), 0, 190),
            'created_at' => $now,
            'last_seen' => $now,
        ]);
    }

    return rest_ensure_response(opls_signed_license($license, $device_id));
}

function opls_api_validate(WP_REST_Request $request) {
    $license = opls_api_license($request);
    if (is_wp_error($license)) {
        return $license;
    }
    $usable = opls_api_check_usable($license);
    if (is_wp_error($usable)) {
        return $usable;
    }

    $device_id = (string) $request->get_param('device_id');
    $activation = opls_find_activation($license->id, $device_id);
    if (!$activation) {
        return opls_api_error('not_activated', 'Die Lizenz ist auf diesem PC nicht mehr aktiviert.', 403);
    }

    opls_touch_activation($activation->id);
    return rest_ensure_response(opls_signed_license($license, $device_id));
}

function opls_api_deactivate(WP_REST_Request $request) {
    global $wpdb;

    $license = opls_api_license($request);
    if (is_wp_error($license)) {
        return $license;
    }

    $wpdb->delete(opls_table('activations'), [
        'license_id' => $license->id,
        'device_id' => (string) $request->get_param('device_id'),
    ]);

    return rest_ensure_response(['success' => true]);
}
