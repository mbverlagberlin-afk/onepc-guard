<?php
/**
 * Verbindung zwischen PC und OnePC-App (Handy).
 *
 * Der PC meldet sich regelmäßig mit Lizenzschlüssel und Gerätekennung:
 *   POST /wp-json/onepc/v1/device/sync   { license_key, device_id, product, status, results }
 * Die App meldet sich mit E-Mail-Adresse und Lizenzschlüssel an und erhält ein
 * Token (Header X-OnePC-Token). Alternativ gilt eine bestehende WordPress-Anmeldung.
 *   POST /wp-json/onepc/v1/app/login     { email, license_key }
 *   POST /wp-json/onepc/v1/app/logout
 *   GET  /wp-json/onepc/v1/app/devices
 *   POST /wp-json/onepc/v1/app/command   { device, type }
 */

if (!defined('ABSPATH')) {
    exit;
}

const OPLS_COMMANDS = ['scan-quick', 'scan-full', 'clean', 'security-check'];
const OPLS_ONLINE_SECONDS = 180;
const OPLS_TOKEN_DAYS = 180;

add_action('rest_api_init', function () {
    register_rest_route('onepc/v1', '/device/sync', [
        'methods' => 'POST',
        'callback' => 'opls_api_device_sync',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('onepc/v1', '/app/login', [
        'methods' => 'POST',
        'callback' => 'opls_api_app_login',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('onepc/v1', '/app/logout', [
        'methods' => 'POST',
        'callback' => 'opls_api_app_logout',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('onepc/v1', '/app/devices', [
        'methods' => 'GET',
        'callback' => 'opls_api_app_devices',
        'permission_callback' => 'opls_app_permission',
    ]);
    register_rest_route('onepc/v1', '/app/command', [
        'methods' => 'POST',
        'callback' => 'opls_api_app_command',
        'permission_callback' => 'opls_app_permission',
    ]);
});

function opls_now() {
    return current_time('mysql', true);
}

function opls_json_limited($value, $max) {
    $json = wp_json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return ($json !== false && strlen($json) <= $max) ? $json : null;
}

/* ---------------------------------------------------------------------- */
/* PC                                                                       */
/* ---------------------------------------------------------------------- */

function opls_api_device_sync(WP_REST_Request $request) {
    global $wpdb;

    // Eigener, großzügigerer Zähler: Jeder PC meldet sich etwa einmal pro Minute.
    $license = opls_api_license($request, 'sync', 300);
    if (is_wp_error($license)) {
        return $license;
    }
    $usable = opls_api_check_usable($license);
    if (is_wp_error($usable)) {
        return $usable;
    }

    $activation = opls_find_activation($license->id, (string) $request->get_param('device_id'));
    if (!$activation) {
        return opls_api_error('not_activated', 'Die Lizenz ist auf diesem PC nicht mehr aktiviert.', 403);
    }

    $now = opls_now();
    $table = opls_table('commands');
    $update = ['last_seen' => $now, 'status_at' => $now];
    $status = $request->get_param('status');
    if (is_array($status)) {
        $json = opls_json_limited($status, 30000);
        if ($json !== null) {
            $update['status'] = $json;
        }
    }
    $wpdb->update(opls_table('activations'), $update, ['id' => $activation->id]);

    // Ergebnisse von Aufträgen übernehmen.
    $results = $request->get_param('results');
    foreach (is_array($results) ? array_slice($results, 0, 50) : [] as $item) {
        $state = isset($item['state']) ? (string) $item['state'] : '';
        if (!isset($item['id']) || !in_array($state, ['running', 'done', 'failed'], true)) {
            continue;
        }
        $wpdb->update($table, [
            'state' => $state,
            'result' => isset($item['result']) ? opls_json_limited($item['result'], 5000) : null,
            'updated_at' => $now,
        ], [
            'id' => absint($item['id']),
            'activation_id' => $activation->id,
        ]);
    }

    // Liegengebliebene Aufträge auslaufen lassen.
    $wpdb->query($wpdb->prepare(
        "UPDATE $table SET state = 'expired', updated_at = %s
         WHERE activation_id = %d AND (
            (state IN ('queued', 'sent') AND created_at < %s) OR (state = 'running' AND updated_at < %s)
         )",
        $now,
        $activation->id,
        gmdate('Y-m-d H:i:s', time() - 6 * HOUR_IN_SECONDS),
        gmdate('Y-m-d H:i:s', time() - DAY_IN_SECONDS)
    ));

    // Neue Aufträge ausliefern und als „gesendet“ markieren.
    $commands = $wpdb->get_results($wpdb->prepare(
        "SELECT id, type FROM $table WHERE activation_id = %d AND state = 'queued' ORDER BY id LIMIT 5",
        $activation->id
    ));
    foreach ($commands as $command) {
        $wpdb->update($table, ['state' => 'sent', 'updated_at' => $now], ['id' => $command->id]);
    }

    return rest_ensure_response([
        'commands' => array_map(function ($c) {
            return ['id' => (int) $c->id, 'type' => $c->type];
        }, $commands),
        'poll_seconds' => (int) apply_filters('opls_poll_seconds', 60),
    ]);
}

/* ---------------------------------------------------------------------- */
/* App                                                                      */
/* ---------------------------------------------------------------------- */

function opls_request_token() {
    $token = isset($_SERVER['HTTP_X_ONEPC_TOKEN']) ? (string) wp_unslash($_SERVER['HTTP_X_ONEPC_TOKEN']) : '';
    return preg_match('/^[a-f0-9]{64}$/', $token) ? $token : '';
}

/**
 * Wer nutzt die App gerade? Token aus der App-Anmeldung oder WordPress-Konto.
 * Rückgabe: ['email' => ..., 'user_id' => ..., 'name' => ...] oder null.
 */
function opls_app_identity() {
    global $wpdb;
    static $identity = false;
    if ($identity !== false) {
        return $identity;
    }
    $identity = null;

    $token = opls_request_token();
    if ($token !== '') {
        $table = opls_table('app_tokens');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE token_hash = %s", hash('sha256', $token)));
        if ($row && strtotime($row->last_used . ' UTC') > time() - OPLS_TOKEN_DAYS * DAY_IN_SECONDS) {
            if (strtotime($row->last_used . ' UTC') < time() - HOUR_IN_SECONDS) {
                $wpdb->update($table, ['last_used' => opls_now()], ['id' => $row->id]);
            }
            $identity = ['email' => $row->email, 'user_id' => 0, 'name' => $row->name !== '' ? $row->name : $row->email];
        }
        return $identity;
    }

    if (is_user_logged_in()) {
        $user = wp_get_current_user();
        $identity = ['email' => $user->user_email, 'user_id' => (int) $user->ID, 'name' => $user->display_name];
    }
    return $identity;
}

function opls_app_permission() {
    return opls_app_identity()
        ? true
        : new WP_Error('opls_login', 'Bitte melde dich mit E-Mail-Adresse und Lizenzschlüssel an.', ['status' => 401]);
}

function opls_api_app_login(WP_REST_Request $request) {
    global $wpdb;

    if (opls_rate_limited('login', 10)) {
        return opls_api_error('rate_limited', 'Zu viele Anmeldeversuche. Bitte warte 10 Minuten.', 429);
    }

    $email = strtolower(trim((string) $request->get_param('email')));
    $license = opls_get_license((string) $request->get_param('license_key'));

    // Absichtlich dieselbe Meldung, ob Schlüssel oder E-Mail falsch ist.
    if (!$license || $email === '' || strtolower(trim($license->email)) !== $email) {
        return opls_api_error('login_failed', 'E-Mail-Adresse und Lizenzschlüssel passen nicht zusammen. Bitte nimm die Angaben aus deiner Bestell-E-Mail.', 401);
    }
    if ($license->status === 'revoked') {
        return opls_api_error('revoked', 'Dieser Lizenzschlüssel wurde gesperrt.', 403);
    }

    $table = opls_table('app_tokens');
    $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE last_used < %s", gmdate('Y-m-d H:i:s', time() - OPLS_TOKEN_DAYS * DAY_IN_SECONDS)));

    $token = bin2hex(random_bytes(32));
    $name = $license->customer !== '' ? $license->customer : $license->email;
    $wpdb->insert($table, [
        'token_hash' => hash('sha256', $token),
        'email' => $license->email,
        'name' => $name,
        'created_at' => opls_now(),
        'last_used' => opls_now(),
    ]);

    return rest_ensure_response(['token' => $token, 'name' => $name]);
}

function opls_api_app_logout() {
    global $wpdb;
    $token = opls_request_token();
    if ($token !== '') {
        $wpdb->delete(opls_table('app_tokens'), ['token_hash' => hash('sha256', $token)]);
    }
    return rest_ensure_response(['success' => true]);
}

/**
 * Alle Geräte, die zu Lizenzen der angemeldeten Person gehören
 * (gleiche E-Mail-Adresse oder eigene Bestellung im Kundenkonto).
 */
function opls_user_activations($identity) {
    global $wpdb;

    $where = ['LOWER(l.email) = %s'];
    $params = [strtolower($identity['email'])];

    if ($identity['user_id'] && function_exists('wc_get_orders')) {
        $orders = array_map('absint', (array) wc_get_orders(['customer_id' => $identity['user_id'], 'return' => 'ids', 'limit' => -1]));
        if ($orders) {
            $where[] = 'l.order_id IN (' . implode(',', array_fill(0, count($orders), '%d')) . ')';
            $params = array_merge($params, $orders);
        }
    }

    $sql = 'SELECT a.*, l.license_key, l.status AS license_status, l.expires_at
        FROM ' . opls_table('activations') . ' a
        JOIN ' . opls_table('licenses') . ' l ON l.id = a.license_id
        WHERE ' . implode(' OR ', $where) . '
        ORDER BY a.last_seen DESC';

    return $wpdb->get_results($wpdb->prepare($sql, $params));
}

function opls_mask_key($key) {
    $parts = explode('-', $key);
    $count = count($parts);
    foreach ($parts as $i => $part) {
        if ($i > 0 && $i < $count - 1) {
            $parts[$i] = '****';
        }
    }
    return implode('-', $parts);
}

function opls_api_app_devices() {
    global $wpdb;
    $identity = opls_app_identity();
    $devices = [];

    foreach (opls_user_activations($identity) as $row) {
        $commands = $wpdb->get_results($wpdb->prepare(
            'SELECT id, type, state, result, created_at, updated_at FROM ' . opls_table('commands') . ' WHERE activation_id = %d ORDER BY id DESC LIMIT 8',
            $row->id
        ));
        $usable = $row->license_status !== 'revoked' && !opls_is_expired($row);

        $devices[] = [
            'id' => (int) $row->id,
            'name' => $row->device_name !== '' ? $row->device_name : 'PC',
            'license' => opls_mask_key($row->license_key),
            'license_ok' => $usable,
            'last_seen' => opls_iso($row->status_at ?: $row->last_seen),
            'online' => $row->status_at && strtotime($row->status_at . ' UTC') > time() - OPLS_ONLINE_SECONDS,
            'linked' => (bool) $row->status_at,
            'status' => $row->status ? json_decode($row->status, true) : null,
            'commands' => array_map(function ($c) {
                return [
                    'id' => (int) $c->id,
                    'type' => $c->type,
                    'state' => $c->state,
                    'result' => $c->result ? json_decode($c->result, true) : null,
                    'created_at' => opls_iso($c->created_at),
                    'updated_at' => opls_iso($c->updated_at),
                ];
            }, $commands),
        ];
    }

    return rest_ensure_response([
        'user' => $identity['name'],
        'devices' => $devices,
        'server_time' => gmdate('Y-m-d\TH:i:s\Z'),
    ]);
}

function opls_api_app_command(WP_REST_Request $request) {
    global $wpdb;
    $identity = opls_app_identity();

    if (opls_rate_limited('command', 30, 'user-' . $identity['email'])) {
        return opls_api_error('rate_limited', 'Zu viele Aufträge. Bitte warte einige Minuten.', 429);
    }

    $type = (string) $request->get_param('type');
    if (!in_array($type, OPLS_COMMANDS, true)) {
        return opls_api_error('invalid_command', 'Unbekannter Auftrag.', 400);
    }

    $device_id = absint($request->get_param('device'));
    $device = null;
    foreach (opls_user_activations($identity) as $row) {
        if ((int) $row->id === $device_id) {
            $device = $row;
            break;
        }
    }
    if (!$device) {
        return opls_api_error('not_found', 'Dieser PC gehört nicht zu deinem Konto.', 404);
    }
    if ($device->license_status === 'revoked' || opls_is_expired($device)) {
        return opls_api_error('license', 'Die Lizenz für diesen PC ist abgelaufen oder gesperrt.', 403);
    }

    $table = opls_table('commands');
    $pending = $wpdb->get_var($wpdb->prepare(
        "SELECT id FROM $table WHERE activation_id = %d AND type = %s AND state IN ('queued', 'sent', 'running')",
        $device->id,
        $type
    ));
    if ($pending) {
        return opls_api_error('pending', 'Dieser Auftrag läuft bereits oder wartet auf den PC.', 409);
    }

    $now = opls_now();
    $wpdb->insert($table, [
        'activation_id' => $device->id,
        'type' => $type,
        'state' => 'queued',
        'created_by' => $identity['user_id'],
        'created_at' => $now,
        'updated_at' => $now,
    ]);

    return rest_ensure_response(['id' => (int) $wpdb->insert_id, 'type' => $type, 'state' => 'queued']);
}
