'use strict';

(function () {
    const config = window.ONEPC || {};
    const app = document.getElementById('app');
    const REFRESH = 15000;
    let timer = null;
    let devices = [];

    const LABELS = {
        'scan-quick': 'Schnellprüfung',
        'scan-full': 'Vollständige Prüfung',
        'clean': 'Aufräumen',
        'security-check': 'Sicherheitscheck',
    };

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function bytes(value) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let n = Number(value) || 0;
        let u = 0;
        while (n >= 1024 && u < units.length - 1) {
            n /= 1024;
            u++;
        }
        return n.toLocaleString('de-DE', { maximumFractionDigits: u > 1 ? 1 : 0 }) + ' ' + units[u];
    }

    function ago(iso) {
        if (!iso) {
            return 'noch nie';
        }
        const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
        if (s < 90) return 'gerade eben';
        if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
        if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
        return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function color(score) {
        if (score >= 80) return '#16a34a';
        if (score >= 50) return '#d97706';
        return '#dc2626';
    }

    let toastTimer;
    function toast(message, error = false) {
        const el = document.getElementById('toast');
        el.textContent = message;
        el.className = 'show' + (error ? ' error' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.className = ''; }, 4000);
    }

    async function api(path, options = {}) {
        const response = await fetch(config.rest + path, {
            credentials: 'same-origin',
            ...options,
            headers: { 'X-WP-Nonce': config.nonce, 'Content-Type': 'application/json', ...(options.headers || {}) },
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 || (response.status === 403 && data.code === 'rest_cookie_invalid_nonce')) {
            // Anmeldung abgelaufen: einmal neu laden, das führt zur Anmeldung.
            // Ein zweites Mal nicht, falls ein Sicherheits-Plugin die Schnittstelle blockiert.
            let reloaded = false;
            try {
                reloaded = sessionStorage.getItem('onepc-reloaded') === '1';
                sessionStorage.setItem('onepc-reloaded', '1');
            } catch {
                reloaded = true;
            }
            if (!reloaded) {
                location.reload();
            }
            throw new Error('Die Anmeldung ist abgelaufen oder die Schnittstelle /wp-json/ wird blockiert. Bitte melde dich ab und wieder an.');
        }
        try {
            sessionStorage.removeItem('onepc-reloaded');
        } catch {
            // Ohne sessionStorage einfach weitermachen.
        }
        if (!response.ok) {
            throw new Error(data.message || 'Der Server antwortet nicht.');
        }
        return data;
    }

    function jobText(job) {
        const r = job.result || {};
        switch (job.state) {
            case 'queued': return { text: 'Wartet auf den PC', cls: '' };
            case 'sent': return { text: 'An PC übertragen', cls: '' };
            case 'running': return { text: 'Läuft …', cls: '' };
            case 'expired': return { text: 'PC war nicht erreichbar', cls: 'failed' };
            case 'failed': return { text: 'Fehler: ' + (r.message || 'unbekannt'), cls: 'failed' };
            case 'done':
                if (job.type.startsWith('scan')) {
                    return r.threatsFound
                        ? { text: `${r.threats || 'Eine oder mehrere'} Bedrohung(en) gefunden und behandelt`, cls: 'alert' }
                        : { text: 'Keine Bedrohung gefunden', cls: 'done' };
                }
                if (job.type === 'clean') return { text: `${bytes(r.freed)} freigegeben`, cls: 'done' };
                if (job.type === 'security-check') return { text: `Bewertung ${r.score ?? '–'} von 100`, cls: 'done' };
                return { text: 'Fertig', cls: 'done' };
            default: return { text: job.state, cls: '' };
        }
    }

    function deviceCard(d) {
        const s = d.status || {};
        const pending = new Set(d.commands.filter((c) => ['queued', 'sent', 'running'].includes(c.state)).map((c) => c.type));
        const ring = typeof s.score === 'number'
            ? `<div class="ring" style="--p:${s.score};--c:${color(s.score)}"><span>${s.score}</span></div>`
            : '<div class="ring"><span>–</span></div>';
        const problems = (s.problems || []).slice(0, 4).map((p) => `<li class="${esc(p.status)}"><div><strong>${esc(p.title)}</strong>${esc(p.detail)}</div></li>`).join('');
        const scan = s.lastScan
            ? (s.lastScan.threatsFound ? `${s.lastScan.threats} Bedrohung(en)` : 'Keine Bedrohung')
            : 'Noch nie';
        const button = (type, label, primary) => `<button class="button${primary ? ' primary' : ''}" data-device="${d.id}" data-type="${type}" ${pending.has(type) || !d.license_ok ? 'disabled' : ''}>${pending.has(type) ? '<span class="spinner"></span>' : ''}${label}</button>`;

        let notice = '';
        if (!d.license_ok) {
            notice = '<div class="notice bad">Die Lizenz für diesen PC ist abgelaufen oder gesperrt.</div>';
        } else if (!d.linked) {
            notice = '<div class="notice">Dieser PC ist noch nicht mit der App verbunden. Öffne OnePC Guard auf dem PC → <strong>Einstellungen</strong> → „Mit der OnePC-App verbinden“.</div>';
        } else if (!d.online) {
            notice = '<div class="notice">Der PC ist gerade nicht erreichbar. Aufträge werden ausgeführt, sobald er wieder online ist (bis zu 6 Stunden).</div>';
        }

        return `<section class="card">
            <div class="device-head">
                ${ring}
                <div class="name">
                    <h2>${esc(d.name)}</h2>
                    <span class="muted small"><span class="dot${d.online ? ' on' : ''}"></span>${d.online ? 'Online' : 'Zuletzt ' + esc(ago(d.last_seen))}${s.busy ? ' · ' + esc(LABELS[s.busy] || s.busy) + ' läuft' : ''}</span>
                </div>
            </div>
            ${notice ? '<div style="margin-top:14px">' + notice + '</div>' : ''}
            <div class="stats">
                <div class="stat"><span class="label">Virenprüfung</span><span class="value">${esc(scan)}</span><span class="muted small">${esc(s.lastScan ? ago(s.lastScan.at) : '')}</span></div>
                <div class="stat"><span class="label">Aufräumbar</span><span class="value">${typeof s.cleanable === 'number' ? esc(bytes(s.cleanable)) : '–'}</span><span class="muted small">${s.lastClean ? 'zuletzt ' + esc(bytes(s.lastClean.freed)) + ' frei' : ''}</span></div>
                <div class="stat"><span class="label">Sicherung</span><span class="value">${s.lastBackup ? (s.lastBackup.ok ? 'Erfolgreich' : 'Mit Fehlern') : 'Keine'}</span><span class="muted small">${esc(s.lastBackup ? ago(s.lastBackup.at) : '')}</span></div>
                <div class="stat"><span class="label">Version</span><span class="value">${esc(s.version || '–')}</span><span class="muted small">${s.updateReady ? 'Update bereit' : ''}</span></div>
            </div>
            ${problems ? `<ul class="problems">${problems}</ul>` : ''}
            <div class="actions">
                ${button('scan-quick', 'Schnellprüfung', true)}
                ${button('clean', 'Aufräumen', true)}
                ${button('scan-full', 'Vollprüfung')}
                ${button('security-check', 'Status prüfen')}
            </div>
            ${d.commands.length ? `<ul class="jobs">${d.commands.slice(0, 5).map((c) => {
                const t = jobText(c);
                return `<li><span>${esc(LABELS[c.type] || c.type)}<br><span class="muted small">${esc(ago(c.created_at))}</span></span><span class="state ${t.cls}">${esc(t.text)}</span></li>`;
            }).join('')}</ul>` : ''}
        </section>`;
    }

    function render() {
        if (!devices.length) {
            app.innerHTML = `<section class="card">
                <h1>Noch kein PC verbunden</h1>
                <ol class="steps">
                    <li>OnePC Guard auf dem PC installieren.</li>
                    <li>Den Lizenzschlüssel aus deiner Bestellung aktivieren (Seite „Lizenz“).</li>
                    <li>In OnePC Guard unter <strong>Einstellungen</strong> „Mit der OnePC-App verbinden“ einschalten.</li>
                </ol>
                <p class="muted small">Die Lizenz muss mit der E-Mail-Adresse dieses Kundenkontos gekauft worden sein.</p>
                <a class="button" href="${esc(config.shop)}">Zum Shop</a>
            </section>`;
            return;
        }
        app.innerHTML = devices.map(deviceCard).join('')
            + '<p class="muted small" style="text-align:center">Tipp: Über „Zum Home-Bildschirm“ im Browsermenü wird OnePC zur App.</p>';
    }

    async function load() {
        try {
            const data = await api('app/devices');
            devices = data.devices || [];
            render();
        } catch (error) {
            app.innerHTML = `<section class="card"><div class="notice bad">${esc(error.message)}</div><button class="button" onclick="location.reload()">Erneut versuchen</button></section>`;
        }
    }

    function schedule() {
        clearTimeout(timer);
        if (document.visibilityState === 'visible') {
            timer = setTimeout(() => load().then(schedule), REFRESH);
        }
    }

    app.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-type]');
        if (!button || button.disabled) {
            return;
        }
        button.disabled = true;
        try {
            await api('app/command', { method: 'POST', body: JSON.stringify({ device: Number(button.dataset.device), type: button.dataset.type }) });
            toast(`${LABELS[button.dataset.type]} wurde an den PC gesendet.`);
        } catch (error) {
            toast(error.message, true);
        }
        await load();
        schedule();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && config.nonce) {
            load().then(schedule);
        } else {
            clearTimeout(timer);
        }
    });

    if ('serviceWorker' in navigator && config.sw) {
        navigator.serviceWorker.register(config.sw, { scope: config.scope }).catch(() => {});
    }

    /* Installieren auf dem Startbildschirm ------------------------------- */

    const installBox = document.getElementById('install');
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSamsung = /SamsungBrowser/.test(ua);
    let installPrompt = null;
    let dismissed = false;
    try {
        dismissed = localStorage.getItem('onepc-install-dismissed') === '1';
    } catch {
        // Ohne Speicher den Hinweis einfach zeigen.
    }

    function showInstall(html) {
        if (standalone || dismissed || !installBox) {
            return;
        }
        installBox.innerHTML = `<div class="install-card">${html}<button class="install-close" data-install="close" aria-label="Hinweis schließen">×</button></div>`;
        installBox.hidden = false;
    }

    // Android/Chrome: eigener Knopf statt verstecktem Menüpunkt.
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        installPrompt = event;
        showInstall(`<div><strong>OnePC als App installieren</strong><span>Mit eigenem Symbol auf dem Startbildschirm.</span></div>
            <button class="button primary" data-install="go">Installieren</button>`);
    });

    window.addEventListener('appinstalled', () => {
        installBox.hidden = true;
        toast('OnePC wurde installiert. Du findest die App auf dem Startbildschirm.');
    });

    // Anleitung, falls der Browser keinen Installations-Dialog anbietet.
    setTimeout(() => {
        if (installPrompt || standalone) {
            return;
        }
        let steps;
        if (isIOS) {
            steps = 'In Safari unten auf <strong>Teilen</strong> <span aria-hidden="true">⬆︎</span> tippen, dann <strong>„Zum Home-Bildschirm“</strong>.';
        } else if (isSamsung) {
            steps = 'Unten auf <strong>☰ Menü</strong> tippen, dann <strong>„Seite hinzufügen zu“ → „Startbildschirm“</strong>.';
        } else {
            steps = 'Oben rechts auf <strong>⋮</strong> tippen, dann <strong>„App installieren“</strong> oder <strong>„Zum Startbildschirm hinzufügen“</strong>.';
        }
        showInstall(`<div><strong>OnePC auf den Startbildschirm legen</strong><span>${steps}</span></div>`);
    }, 2500);

    installBox && installBox.addEventListener('click', async (event) => {
        const action = event.target.closest('[data-install]');
        if (!action) {
            return;
        }
        if (action.dataset.install === 'go' && installPrompt) {
            installPrompt.prompt();
            const choice = await installPrompt.userChoice.catch(() => null);
            installPrompt = null;
            if (choice && choice.outcome === 'accepted') {
                installBox.hidden = true;
            }
            return;
        }
        installBox.hidden = true;
        try {
            localStorage.setItem('onepc-install-dismissed', '1');
        } catch {
            // egal
        }
    });

    if (config.nonce) {
        load().then(schedule);
    }
})();
