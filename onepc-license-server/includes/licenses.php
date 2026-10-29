<?php
/**
 * Datenbank, Schlüsselerzeugung und Signatur.
 */

if (!defined('ABSPATH')) {
    exit;
}

function opls_table($name) {
    global $wpdb;
    return $wpdb->prefix . 'opls_' . $name;
}

function opls_install() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $charset = $wpdb->get_charset_collate();
    $licenses = opls_table('licenses');
    $activations = opls_table('activations');

    dbDelta("CREATE TABLE $licenses (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  license_key varchar(64) NOT NULL,
  product varchar(64) NOT NULL,
  order_id bigint(20) unsigned NOT NULL DEFAULT 0,
  email varchar(190) NOT NULL DEFAULT '',
  customer varchar(190) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'active',
  max_activations int(10) unsigned NOT NULL DEFAULT 1,
  expires_at datetime NULL DEFAULT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY license_key (license_key),
  KEY order_id (order_id),
  KEY email (email)
) $charset;");

    dbDelta("CREATE TABLE $activations (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  license_id bigint(20) unsigned NOT NULL,
  device_id varchar(64) NOT NULL,
  device_name varchar(190) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  last_seen datetime NOT NULL,
  status longtext NULL,
  status_at datetime NULL DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY license_device (license_id,device_id)
) $charset;");

    $commands = opls_table('commands');
    dbDelta("CREATE TABLE $commands (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  activation_id bigint(20) unsigned NOT NULL,
  type varchar(32) NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'queued',
  result text NULL,
  created_by bigint(20) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY activation_state (activation_id,state)
) $charset;");

    // Anmeldungen in der Handy-App (E-Mail + Lizenzschlüssel, ohne WordPress-Konto).
    $tokens = opls_table('app_tokens');
    dbDelta("CREATE TABLE $tokens (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  token_hash char(64) NOT NULL,
  email varchar(190) NOT NULL,
  name varchar(190) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  last_used datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY token_hash (token_hash),
  KEY email (email)
) $charset;");

    opls_keypair();
    update_option('opls_db_version', OPLS_DB_VERSION);
    delete_option('opls_flush_rewrite'); // aus 1.1.0–1.1.2, nicht mehr nötig
}

/**
 * Ed25519-Schlüsselpaar. Der private Schlüssel bleibt auf dem Server, der
 * öffentliche wird ins Programm eingebaut (config/app.json → publicKey).
 */
function opls_keypair() {
    $secret = get_option('opls_sign_secret');
    $public = get_option('opls_sign_public');

    if (!$secret || !$public) {
        $pair = sodium_crypto_sign_keypair();
        $secret = base64_encode(sodium_crypto_sign_secretkey($pair));
        $public = base64_encode(sodium_crypto_sign_publickey($pair));
        add_option('opls_sign_secret', $secret, '', false);
        add_option('opls_sign_public', $public, '', false);
    }

    return ['secret' => $secret, 'public' => $public];
}

function opls_public_key() {
    return opls_keypair()['public'];
}

function opls_sign($payload) {
    return base64_encode(sodium_crypto_sign_detached($payload, base64_decode(opls_keypair()['secret'])));
}

function opls_generate_key() {
    global $wpdb;
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I, um Verwechslungen zu vermeiden
    $prefix = apply_filters('opls_key_prefix', 'OPC');

    do {
        $groups = [];
        for ($g = 0; $g < 4; $g++) {
            $group = '';
            for ($i = 0; $i < 4; $i++) {
                $group .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            $groups[] = $group;
        }
        $key = $prefix . '-' . implode('-', $groups);
        $exists = $wpdb->get_var($wpdb->prepare('SELECT id FROM ' . opls_table('licenses') . ' WHERE license_key = %s', $key));
    } while ($exists);

    return $key;
}

function opls_create_license($args) {
    global $wpdb;
    $args = wp_parse_args($args, [
        'product' => 'onepc-guard',
        'order_id' => 0,
        'email' => '',
        'customer' => '',
        'max_activations' => 1,
        'days' => 0,
    ]);

    $key = opls_generate_key();
    $wpdb->insert(opls_table('licenses'), [
        'license_key' => $key,
        'product' => sanitize_key($args['product']),
        'order_id' => absint($args['order_id']),
        'email' => sanitize_email($args['email']),
        'customer' => sanitize_text_field($args['customer']),
        'status' => 'active',
        'max_activations' => max(1, absint($args['max_activations'])),
        'expires_at' => absint($args['days']) > 0 ? gmdate('Y-m-d H:i:s', time() + absint($args['days']) * DAY_IN_SECONDS) : null,
        'created_at' => current_time('mysql', true),
    ]);

    return $key;
}

function opls_get_license($key) {
    global $wpdb;
    return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . opls_table('licenses') . ' WHERE license_key = %s', strtoupper(trim($key))));
}

function opls_get_license_by_id($id) {
    global $wpdb;
    return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . opls_table('licenses') . ' WHERE id = %d', $id));
}

function opls_get_activations($license_id) {
    global $wpdb;
    return $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . opls_table('activations') . ' WHERE license_id = %d ORDER BY created_at', $license_id));
}

function opls_set_status($license_id, $status) {
    global $wpdb;
    $wpdb->update(opls_table('licenses'), ['status' => $status === 'revoked' ? 'revoked' : 'active'], ['id' => absint($license_id)]);
}

function opls_reset_activations($license_id) {
    global $wpdb;
    $wpdb->delete(opls_table('activations'), ['license_id' => absint($license_id)]);
}

function opls_is_expired($license) {
    return $license->expires_at && strtotime($license->expires_at . ' UTC') < time();
}

function opls_iso($mysql_utc) {
    return $mysql_utc ? gmdate('Y-m-d\TH:i:s\Z', strtotime($mysql_utc . ' UTC')) : null;
}

/**
 * Signierte Lizenz für ein Gerät. Das Programm prüft die Signatur mit dem
 * öffentlichen Schlüssel und speichert die Antwort für die Offline-Nutzung.
 */
function opls_signed_license($license, $device_id) {
    $payload = wp_json_encode([
        'product' => $license->product,
        'license_key' => $license->license_key,
        'device_id' => $device_id,
        'status' => $license->status,
        'expires_at' => opls_iso($license->expires_at),
        'issued_at' => gmdate('Y-m-d\TH:i:s\Z'),
        'customer' => $license->customer,
        'max_activations' => (int) $license->max_activations,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    return [
        'payload' => $payload,
        'signature' => opls_sign($payload),
    ];
}
