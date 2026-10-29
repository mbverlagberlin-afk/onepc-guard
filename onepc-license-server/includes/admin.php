<?php
/**
 * Verwaltungsseite unter WooCommerce → Lizenzen.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('admin_menu', function () {
    add_submenu_page(
        'woocommerce',
        __('Lizenzen', 'onepc-license-server'),
        __('Lizenzen', 'onepc-license-server'),
        'manage_woocommerce',
        'opls-licenses',
        'opls_render_admin_page'
    );
});

function opls_admin_url($args = []) {
    return add_query_arg($args, admin_url('admin.php?page=opls-licenses'));
}

function opls_admin_action_url($action, $license_id) {
    return wp_nonce_url(
        admin_url('admin-post.php?action=opls_' . $action . '&license=' . absint($license_id)),
        'opls_' . $action . '_' . absint($license_id)
    );
}

foreach (['revoke', 'unrevoke', 'reset'] as $opls_action) {
    add_action('admin_post_opls_' . $opls_action, function () use ($opls_action) {
        $id = isset($_GET['license']) ? absint($_GET['license']) : 0;
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('Keine Berechtigung.', 'onepc-license-server'));
        }
        check_admin_referer('opls_' . $opls_action . '_' . $id);

        if ($opls_action === 'reset') {
            opls_reset_activations($id);
        } else {
            opls_set_status($id, $opls_action === 'revoke' ? 'revoked' : 'active');
        }

        wp_safe_redirect(wp_get_referer() ?: opls_admin_url());
        exit;
    });
}

add_action('admin_post_opls_create', function () {
    if (!current_user_can('manage_woocommerce')) {
        wp_die(esc_html__('Keine Berechtigung.', 'onepc-license-server'));
    }
    check_admin_referer('opls_create');

    $key = opls_create_license([
        'product' => isset($_POST['product']) ? sanitize_key(wp_unslash($_POST['product'])) : 'onepc-guard',
        'email' => isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '',
        'customer' => isset($_POST['customer']) ? sanitize_text_field(wp_unslash($_POST['customer'])) : '',
        'max_activations' => isset($_POST['max_activations']) ? absint($_POST['max_activations']) : 1,
        'days' => isset($_POST['days']) ? absint($_POST['days']) : 0,
    ]);

    wp_safe_redirect(opls_admin_url(['created' => rawurlencode($key)]));
    exit;
});

function opls_render_admin_page() {
    global $wpdb;
    if (!current_user_can('manage_woocommerce')) {
        return;
    }

    $search = isset($_GET['s']) ? sanitize_text_field(wp_unslash($_GET['s'])) : '';
    $paged = max(1, isset($_GET['paged']) ? absint($_GET['paged']) : 1);
    $per_page = 30;
    $table = opls_table('licenses');

    $where = '';
    $params = [];
    if ($search !== '') {
        $like = '%' . $wpdb->esc_like($search) . '%';
        $where = 'WHERE license_key LIKE %s OR email LIKE %s OR customer LIKE %s OR order_id = %d';
        $params = [$like, $like, $like, absint($search)];
    }

    $total = (int) ($params
        ? $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $table $where", $params))
        : $wpdb->get_var("SELECT COUNT(*) FROM $table"));
    $query = "SELECT l.*, (SELECT COUNT(*) FROM " . opls_table('activations') . " a WHERE a.license_id = l.id) AS used
        FROM $table l " . str_replace(['license_key', 'email', 'customer', 'order_id'], ['l.license_key', 'l.email', 'l.customer', 'l.order_id'], $where) . '
        ORDER BY l.id DESC LIMIT %d OFFSET %d';
    $rows = $wpdb->get_results($wpdb->prepare($query, array_merge($params, [$per_page, ($paged - 1) * $per_page])));
    ?>
    <div class="wrap">
        <h1 class="wp-heading-inline"><?php esc_html_e('Lizenzen', 'onepc-license-server'); ?></h1>

        <?php if (!empty($_GET['created'])) : ?>
            <div class="notice notice-success"><p>
                <?php esc_html_e('Lizenz erstellt:', 'onepc-license-server'); ?>
                <code style="font-size:14px"><?php echo esc_html(sanitize_text_field(wp_unslash($_GET['created']))); ?></code>
            </p></div>
        <?php endif; ?>

        <form method="get" style="margin:16px 0">
            <input type="hidden" name="page" value="opls-licenses">
            <input type="search" name="s" value="<?php echo esc_attr($search); ?>" placeholder="<?php esc_attr_e('Schlüssel, E-Mail, Name oder Bestellnummer', 'onepc-license-server'); ?>" style="width:320px">
            <?php submit_button(__('Suchen', 'onepc-license-server'), 'secondary', '', false); ?>
        </form>

        <table class="widefat striped">
            <thead>
                <tr>
                    <th><?php esc_html_e('Schlüssel', 'onepc-license-server'); ?></th>
                    <th><?php esc_html_e('Kunde', 'onepc-license-server'); ?></th>
                    <th><?php esc_html_e('Bestellung', 'onepc-license-server'); ?></th>
                    <th><?php esc_html_e('Status', 'onepc-license-server'); ?></th>
                    <th><?php esc_html_e('PCs', 'onepc-license-server'); ?></th>
                    <th><?php esc_html_e('Gültig bis', 'onepc-license-server'); ?></th>
                    <th><?php esc_html_e('Aktionen', 'onepc-license-server'); ?></th>
                </tr>
            </thead>
            <tbody>
            <?php if (!$rows) : ?>
                <tr><td colspan="7"><?php esc_html_e('Noch keine Lizenzen vorhanden.', 'onepc-license-server'); ?></td></tr>
            <?php endif; ?>
            <?php foreach ($rows as $row) : ?>
                <?php
                $order = $row->order_id ? wc_get_order($row->order_id) : null;
                $devices = implode(', ', wp_list_pluck(opls_get_activations($row->id), 'device_name'));
                $expired = opls_is_expired($row);
                ?>
                <tr>
                    <td><code><?php echo esc_html($row->license_key); ?></code><br><small><?php echo esc_html($row->product); ?></small></td>
                    <td><?php echo esc_html($row->customer); ?><br><small><?php echo esc_html($row->email); ?></small></td>
                    <td>
                        <?php if ($order) : ?>
                            <a href="<?php echo esc_url($order->get_edit_order_url()); ?>">#<?php echo esc_html($order->get_order_number()); ?></a>
                        <?php else : ?>
                            <?php esc_html_e('manuell', 'onepc-license-server'); ?>
                        <?php endif; ?>
                    </td>
                    <td>
                        <?php if ($row->status === 'revoked') : ?>
                            <span style="color:#b32d2e"><?php esc_html_e('Gesperrt', 'onepc-license-server'); ?></span>
                        <?php elseif ($expired) : ?>
                            <span style="color:#996800"><?php esc_html_e('Abgelaufen', 'onepc-license-server'); ?></span>
                        <?php else : ?>
                            <span style="color:#008a20"><?php esc_html_e('Aktiv', 'onepc-license-server'); ?></span>
                        <?php endif; ?>
                    </td>
                    <td title="<?php echo esc_attr($devices); ?>"><?php echo esc_html($row->used . ' / ' . $row->max_activations); ?></td>
                    <td><?php echo $row->expires_at ? esc_html(wp_date(get_option('date_format'), strtotime($row->expires_at . ' UTC'))) : esc_html__('unbegrenzt', 'onepc-license-server'); ?></td>
                    <td>
                        <?php if ($row->status === 'revoked') : ?>
                            <a href="<?php echo esc_url(opls_admin_action_url('unrevoke', $row->id)); ?>"><?php esc_html_e('Entsperren', 'onepc-license-server'); ?></a>
                        <?php else : ?>
                            <a href="<?php echo esc_url(opls_admin_action_url('revoke', $row->id)); ?>" onclick="return confirm('<?php echo esc_js(__('Lizenz sperren? Das Programm schaltet beim nächsten Abgleich auf die eingeschränkte Version um.', 'onepc-license-server')); ?>')"><?php esc_html_e('Sperren', 'onepc-license-server'); ?></a>
                        <?php endif; ?>
                        <?php if ($row->used) : ?>
                            | <a href="<?php echo esc_url(opls_admin_action_url('reset', $row->id)); ?>" onclick="return confirm('<?php echo esc_js(__('Alle Aktivierungen zurücksetzen? Der Kunde kann den Schlüssel danach auf einem neuen PC aktivieren.', 'onepc-license-server')); ?>')"><?php esc_html_e('PCs zurücksetzen', 'onepc-license-server'); ?></a>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>

        <?php
        $pages = (int) ceil($total / $per_page);
        if ($pages > 1) {
            echo '<div class="tablenav"><div class="tablenav-pages">';
            echo wp_kses_post(paginate_links([
                'base' => add_query_arg('paged', '%#%'),
                'format' => '',
                'current' => $paged,
                'total' => $pages,
            ]));
            echo '</div></div>';
        }
        ?>

        <h2 style="margin-top:32px"><?php esc_html_e('Lizenz manuell erstellen', 'onepc-license-server'); ?></h2>
        <p><?php esc_html_e('Zum Beispiel für Testkunden, Händler oder Ersatzlieferungen.', 'onepc-license-server'); ?></p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="opls_create">
            <?php wp_nonce_field('opls_create'); ?>
            <table class="form-table" role="presentation">
                <tr><th><label for="opls-customer"><?php esc_html_e('Name', 'onepc-license-server'); ?></label></th>
                    <td><input id="opls-customer" name="customer" class="regular-text"></td></tr>
                <tr><th><label for="opls-email"><?php esc_html_e('E-Mail', 'onepc-license-server'); ?></label></th>
                    <td><input id="opls-email" name="email" type="email" class="regular-text"></td></tr>
                <tr><th><label for="opls-product"><?php esc_html_e('Produktkennung', 'onepc-license-server'); ?></label></th>
                    <td><input id="opls-product" name="product" value="onepc-guard" class="regular-text"></td></tr>
                <tr><th><label for="opls-max"><?php esc_html_e('Anzahl PCs', 'onepc-license-server'); ?></label></th>
                    <td><input id="opls-max" name="max_activations" type="number" min="1" value="1" class="small-text"></td></tr>
                <tr><th><label for="opls-days"><?php esc_html_e('Laufzeit in Tagen', 'onepc-license-server'); ?></label></th>
                    <td><input id="opls-days" name="days" type="number" min="0" value="365" class="small-text">
                        <span class="description"><?php esc_html_e('0 = unbegrenzt', 'onepc-license-server'); ?></span></td></tr>
            </table>
            <?php submit_button(__('Lizenz erstellen', 'onepc-license-server')); ?>
        </form>

        <h2 style="margin-top:32px"><?php esc_html_e('OnePC-App fürs Handy', 'onepc-license-server'); ?></h2>
        <p>
            <?php esc_html_e('Kunden öffnen diese Adresse auf dem Handy, melden sich mit ihrem Kundenkonto an und können ihre PCs prüfen und aufräumen lassen. Im Kundenkonto gibt es dafür den Menüpunkt „OnePC-App“.', 'onepc-license-server'); ?>
            <br><a href="<?php echo esc_url(opls_app_url()); ?>" target="_blank" rel="noopener"><code><?php echo esc_html(opls_app_url()); ?></code></a>
        </p>

        <h2 style="margin-top:32px"><?php esc_html_e('Einstellungen für das Programm', 'onepc-license-server'); ?></h2>
        <p><?php esc_html_e('Diese beiden Werte gehören in die Datei onepc-guard/config/app.json, bevor das Programm gebaut wird:', 'onepc-license-server'); ?></p>
        <table class="form-table" role="presentation">
            <tr><th>serverUrl</th><td><code><?php echo esc_html(untrailingslashit(home_url())); ?></code></td></tr>
            <tr><th>publicKey</th><td><input type="text" readonly class="large-text code" value="<?php echo esc_attr(opls_public_key()); ?>" onclick="this.select()"></td></tr>
        </table>
        <p class="description"><?php esc_html_e('Der zugehörige private Schlüssel bleibt geheim in der Datenbank. Geht er verloren (z. B. durch Löschen der Optionen opls_sign_secret/opls_sign_public), entsteht ein neues Schlüsselpaar und bereits verkaufte Programmversionen können keine Lizenzen mehr aktivieren. In Backups der Datenbank ist er enthalten.', 'onepc-license-server'); ?></p>
    </div>
    <?php
}
