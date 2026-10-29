'use strict';

const content = document.getElementById('content');
const state = {
    page: 'overview',
    license: null,
    security: null,
    scan: { running: false, result: null },
    clean: { analysis: null, busy: false, large: null },
    backup: { running: false, progress: null },
    update: null,
    remote: null,
};

/* Hilfsfunktionen -------------------------------------------------------- */

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

function dateTime(iso) {
    return iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–';
}

function duration(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} Sekunden` : `${Math.floor(s / 60)} Min. ${s % 60} Sek.`;
}

let toastTimer;
function toast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, isError ? 6000 : 3500);
}

async function call(channel, ...args) {
    const result = await window.api.invoke(channel, ...args);
    if (!result.ok) {
        const error = new Error(result.error);
        error.code = result.code;
        throw error;
    }
    return result.data;
}

function fail(error) {
    if (error.code === 'LICENSE_REQUIRED') {
        toast('Für diese Funktion wird eine Lizenz benötigt.', true);
        go('license');
        return;
    }
    toast(error.message, true);
}

function locked() {
    return state.license && !state.license.fullAccess;
}

function lockNotice() {
    if (!locked()) {
        return '';
    }
    return `<div class="notice bad"><p><strong>Gesperrt.</strong> ${esc(state.license.message || 'Für diese Funktion wird eine Lizenz benötigt.')}</p>
        <button class="button primary" data-action="go" data-target="license">Lizenz eingeben</button></div>`;
}

function statusIcon(status) {
    return { ok: '✓', warn: '!', bad: '✕', unknown: '?' }[status] || '?';
}

function scoreColor(score) {
    if (score >= 80) return 'var(--ok)';
    if (score >= 50) return 'var(--warn)';
    return 'var(--bad)';
}

/* Navigation ------------------------------------------------------------- */

function go(page) {
    state.page = page;
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    render();
    content.scrollTop = 0;
    content.focus();
}

document.querySelector('nav').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (button) {
        go(button.dataset.page);
    }
});

function renderLicenseBadge() {
    const l = state.license;
    const el = document.getElementById('license-badge');
    if (!l) {
        el.innerHTML = '';
        return;
    }
    const text = {
        licensed: ['Vollversion', l.expiresAt ? 'gültig bis ' + new Date(l.expiresAt).toLocaleDateString('de-DE') : 'unbegrenzt gültig'],
        trial: ['Testversion', `noch ${l.daysLeft} Tag(e)`],
        'trial-ended': ['Testphase abgelaufen', 'Lizenz erforderlich'],
        expired: ['Lizenz abgelaufen', 'bitte verlängern'],
        offline: ['Lizenzprüfung nötig', 'Internet verbinden'],
    }[l.status] || ['', ''];
    el.innerHTML = `<strong>${esc(text[0])}</strong>${esc(text[1])}`;
}

async function loadLicense() {
    try {
        state.license = await call('license:state');
    } catch {
        state.license = null;
    }
    renderLicenseBadge();
}

/* Seiten ----------------------------------------------------------------- */

const pages = {};

pages.overview = async () => {
    const o = await call('app:overview');
    state.license = o.license;
    renderLicenseBadge();

    const sec = o.lastSecurity;
    const ring = sec
        ? `<div class="ring" style="--p:${sec.score};--c:${scoreColor(sec.score)}"><span>${sec.score}<small>von 100</small></span></div>`
        : '<div class="ring"><span>–<small>nicht geprüft</small></span></div>';

    let licenseNotice = '';
    if (o.license.status === 'trial') {
        licenseNotice = `<div class="notice info"><p>Du nutzt die <strong>Testversion</strong> mit allen Funktionen – noch ${o.license.daysLeft} Tag(e).</p>
            <button class="button" data-action="open" data-target="shop">Vollversion kaufen</button>
            <button class="button primary" data-action="go" data-target="license">Schlüssel eingeben</button></div>`;
    } else if (!o.license.fullAccess) {
        licenseNotice = lockNotice();
    }

    const scanText = o.lastScan
        ? (o.lastScan.threatsFound ? `<span style="color:var(--bad)">${o.lastScan.threats} Bedrohung(en)</span>` : 'Keine Bedrohung')
        : 'Noch nicht geprüft';
    const backupText = !o.backupConfigured
        ? 'Nicht eingerichtet'
        : (o.lastBackup ? (o.lastBackup.ok ? 'Erfolgreich' : '<span style="color:var(--bad)">Mit Fehlern</span>') : 'Noch nicht gesichert');

    return `
        <h1>Übersicht</h1>
        <p class="lead">Der Zustand deines PCs auf einen Blick.</p>
        ${licenseNotice}
        <section class="panel score">
            ${ring}
            <div>
                <h2>${sec ? (sec.problems ? `${sec.problems} Punkt(e) brauchen Aufmerksamkeit` : 'Alles in Ordnung') : 'Starte den ersten Sicherheitscheck'}</h2>
                <p class="muted">${sec ? 'Zuletzt geprüft: ' + esc(dateTime(sec.at)) : 'Der Check prüft Virenschutz, Firewall, Updates, Verschlüsselung und mehr – in wenigen Sekunden.'}</p>
                <button class="button primary" data-action="go" data-target="security">${sec ? 'Erneut prüfen' : 'Jetzt prüfen'}</button>
            </div>
        </section>
        <div class="grid">
            <div class="card">
                <span class="label">Virenprüfung</span>
                <span class="value">${scanText}</span>
                <span class="muted small">${o.lastScan ? esc(dateTime(o.lastScan.at)) : 'Mit Microsoft Defender'}</span>
                <button class="button" data-action="go" data-target="scan">Prüfen</button>
            </div>
            <div class="card">
                <span class="label">Aufräumen</span>
                <span class="value">${o.lastClean ? esc(bytes(o.lastClean.freed)) + ' frei' : 'Noch nicht'}</span>
                <span class="muted small">${o.lastClean ? esc(dateTime(o.lastClean.at)) : 'Temporäre Dateien &amp; Caches'}</span>
                <button class="button" data-action="go" data-target="clean">Aufräumen</button>
            </div>
            <div class="card">
                <span class="label">Sicherung</span>
                <span class="value">${backupText}</span>
                <span class="muted small">${o.lastBackup ? esc(dateTime(o.lastBackup.at)) : 'Schutz vor Datenverlust'}</span>
                <button class="button" data-action="go" data-target="backup">Öffnen</button>
            </div>
        </div>
        ${o.platform !== 'win32' ? '<div class="notice"><p>Hinweis: Die Prüfungen funktionieren nur unter Windows.</p></div>' : ''}
        <p class="muted small">OnePC Guard ${esc(o.version)}</p>`;
};

pages.security = async () => {
    const r = state.security;
    let body;

    if (r === 'loading') {
        body = '<section class="panel"><div class="row"><div class="spinner"></div><span>Dein PC wird geprüft … das dauert meist unter einer Minute.</span></div></section>';
    } else if (r) {
        const startup = r.startup.length
            ? `<details><summary>Autostart-Programme anzeigen (${r.startup.length})</summary>
                <table><thead><tr><th>Name</th><th>Befehl</th></tr></thead><tbody>
                ${r.startup.map((s) => `<tr><td>${esc(s.name)}</td><td class="path small muted">${esc(s.command)}</td></tr>`).join('')}
                </tbody></table></details>`
            : '';
        body = `
            <section class="panel score">
                <div class="ring" style="--p:${r.score};--c:${scoreColor(r.score)}"><span>${r.score}<small>von 100</small></span></div>
                <div>
                    <h2>${r.score >= 80 ? 'Dein PC ist gut geschützt' : (r.score >= 50 ? 'Es gibt Verbesserungsbedarf' : 'Dein PC ist gefährdet')}</h2>
                    <p class="muted">Geprüft: ${esc(dateTime(r.checkedAt))}</p>
                    <button class="button primary" data-action="security-check">Erneut prüfen</button>
                </div>
            </section>
            <section class="panel">
                <ul class="checks">
                ${r.checks.map((c) => `
                    <li>
                        <span class="badge ${c.status}">${statusIcon(c.status)}</span>
                        <div class="text"><strong>${esc(c.title)}</strong><span>${esc(c.detail)}</span></div>
                        ${c.action ? `<button class="button small" data-action="check-action" data-type="${esc(c.action.type)}" data-target="${esc(c.action.target || '')}">${esc(c.action.label)}</button>` : ''}
                    </li>`).join('')}
                </ul>
            </section>
            <section class="panel">${startup || '<span class="muted">Keine Autostart-Programme gefunden.</span>'}</section>`;
    } else {
        body = `<section class="panel"><div class="row"><p class="spacer">Der Check liest nur Einstellungen aus und verändert nichts an deinem PC.</p>
            <button class="button primary" data-action="security-check">Prüfung starten</button></div></section>`;
    }

    return `<h1>Sicherheitscheck</h1>
        <p class="lead">Prüft Virenschutz, Firewall, Windows-Updates, Benutzerkontensteuerung, Verschlüsselung, Speicherplatz und Autostart.</p>
        ${body}`;
};

pages.scan = async () => {
    const o = await call('app:overview');
    const s = state.scan;
    let result = '';

    if (s.running) {
        result = `<section class="panel"><h2>Prüfung läuft …</h2><div class="progress"><div></div></div>
            <p class="muted">${s.type === 'quick' ? 'Eine Schnellprüfung dauert meist 2–10 Minuten.' : 'Eine vollständige Prüfung kann über eine Stunde dauern. Du kannst den PC währenddessen weiter benutzen.'}</p>
            <button class="button" data-action="scan-cancel">Abbrechen</button></section>`;
    } else if (s.result && s.result.cancelled) {
        result = '<div class="notice info"><p>Die Prüfung wurde abgebrochen.</p></div>';
    } else if (s.result && !s.result.threatsFound) {
        result = `<div class="notice ok"><p><strong>Keine Bedrohungen gefunden.</strong> Dauer: ${esc(duration(s.result.durationMs))}.</p></div>`;
    } else if (s.result) {
        result = `<div class="notice bad"><p><strong>${s.result.threats.length || 'Eine oder mehrere'} Bedrohung(en) gefunden.</strong> Microsoft Defender hat sie automatisch in Quarantäne verschoben oder entfernt. Details findest du in der Windows-Sicherheit unter „Schutzverlauf“.</p>
            <button class="button" data-action="open" data-target="defender">Schutzverlauf öffnen</button></div>
            ${s.result.threats.length ? `<section class="panel"><table><thead><tr><th>Bedrohung</th><th>Datei</th><th>Status</th></tr></thead><tbody>
            ${s.result.threats.map((t) => `<tr><td>${esc(t.name)}</td><td class="path small">${esc(t.files.join(', '))}</td><td>${t.removed ? 'Entfernt' : 'Aktion nötig'}</td></tr>`).join('')}
            </tbody></table></section>` : ''}`;
    }

    const disabled = s.running || locked() || !o.defenderAvailable ? 'disabled' : '';
    return `<h1>Virenprüfung</h1>
        <p class="lead">Durchsucht deinen PC mit der Erkennung von Microsoft Defender, die täglich von Microsoft aktualisiert wird.</p>
        ${lockNotice()}
        ${!o.defenderAvailable ? '<div class="notice"><p>Microsoft Defender ist nicht verfügbar oder durch ein anderes Virenschutzprogramm ersetzt. Bitte starte die Prüfung dann in deinem Virenschutzprogramm.</p></div>' : ''}
        ${result}
        <div class="grid">
            <div class="card"><span class="value">Schnellprüfung</span><span class="muted">Prüft die Stellen, an denen sich Schadsoftware meist einnistet.</span>
                <button class="button primary" data-action="scan" data-type="quick" ${disabled}>Starten</button></div>
            <div class="card"><span class="value">Vollständige Prüfung</span><span class="muted">Prüft alle Dateien auf allen Laufwerken. Dauert länger.</span>
                <button class="button" data-action="scan" data-type="full" ${disabled}>Starten</button></div>
            <div class="card"><span class="value">Ordner prüfen</span><span class="muted">Zum Beispiel den Download-Ordner oder einen USB-Stick.</span>
                <button class="button" data-action="scan" data-type="custom" ${disabled}>Ordner wählen</button></div>
        </div>
        <section class="panel"><div class="row"><p class="spacer">Virendefinitionen jetzt bei Microsoft aktualisieren.</p>
            <button class="button" data-action="update-signatures" ${disabled}>Aktualisieren</button></div></section>`;
};

pages.clean = async () => {
    const c = state.clean;
    let analysis;

    if (c.analysis === 'loading') {
        analysis = '<div class="row"><div class="spinner"></div><span>Speicherplatz wird analysiert …</span></div>';
    } else if (c.analysis) {
        const total = c.analysis.reduce((sum, item) => sum + item.size, 0);
        analysis = `
            <table><thead><tr><th></th><th>Bereich</th><th class="num">Größe</th></tr></thead><tbody>
            ${c.analysis.map((item) => `<tr>
                <td style="width:32px"><input type="checkbox" class="clean-item" value="${esc(item.id)}" ${item.size > 0 ? 'checked' : ''} aria-label="${esc(item.label)}"></td>
                <td><strong>${esc(item.label)}</strong><br><span class="muted small">${esc(item.description)}</span></td>
                <td class="num">${esc(bytes(item.size))}</td></tr>`).join('')}
            </tbody></table>
            <div class="row" style="margin-top:16px"><strong class="spacer">Insgesamt: ${esc(bytes(total))}</strong>
                <button class="button" data-action="clean-analyze">Neu analysieren</button>
                <button class="button primary" data-action="clean-run" ${c.busy || locked() ? 'disabled' : ''}>${c.busy ? '<span class="spinner"></span>' : ''}Ausgewählte bereinigen</button></div>`;
    } else {
        analysis = `<div class="row"><p class="spacer">Findet temporäre Dateien, Browser-Zwischenspeicher, Absturzberichte und den Papierkorb.</p>
            <button class="button primary" data-action="clean-analyze">Analysieren</button></div>`;
    }

    let large;
    if (c.large === 'loading') {
        large = '<div class="row"><div class="spinner"></div><span>Suche große Dateien …</span></div>';
    } else if (Array.isArray(c.large)) {
        large = c.large.length
            ? `<table><thead><tr><th>Datei</th><th class="num">Größe</th><th></th></tr></thead><tbody>
                ${c.large.map((f, i) => `<tr><td class="path">${esc(f.path)}<br><span class="muted small">geändert ${esc(dateTime(f.modified))}</span></td>
                <td class="num">${esc(bytes(f.size))}</td>
                <td class="num"><button class="button small" data-action="file-show" data-index="${i}">Zeigen</button>
                <button class="button small danger" data-action="file-trash" data-index="${i}" ${locked() ? 'disabled' : ''}>In den Papierkorb</button></td></tr>`).join('')}
               </tbody></table>`
            : '<div class="empty">Keine Dateien über 500 MB gefunden.</div>';
    } else {
        large = `<div class="row"><p class="spacer">Zeigt Dateien über 500 MB in deinem Benutzerordner – oft alte Videos oder Installationsdateien.</p>
            <button class="button" data-action="large-files">Suchen</button></div>`;
    }

    return `<h1>Aufräumen</h1>
        <p class="lead">Schafft Speicherplatz, ohne persönliche Dateien anzurühren.</p>
        ${lockNotice()}
        <section class="panel"><h2>Überflüssige Dateien</h2>${analysis}</section>
        <section class="panel"><h2>Große Dateien</h2>${large}</section>`;
};

pages.backup = async () => {
    const b = await call('backup:get');
    const s = b.settings;
    state.backup.running = b.running;
    state.backup.settings = s;
    const last = (await call('app:overview')).lastBackup;

    let lastHtml = '';
    if (state.backup.running) {
        const p = state.backup.progress;
        lastHtml = `<div class="notice info"><div class="spinner"></div><p>Sicherung läuft … ${p ? `${p.processed} Dateien geprüft, ${p.copied} kopiert` : ''}</p></div>`;
    } else if (last) {
        lastHtml = last.ok
            ? `<div class="notice ok"><p>Letzte Sicherung ${esc(dateTime(last.at))}: ${last.stats.copied} Dateien kopiert, ${last.stats.unchanged} unverändert${last.stats.versioned ? `, ${last.stats.versioned} ältere Fassungen aufbewahrt` : ''}.</p></div>`
            : `<div class="notice bad"><p>Letzte Sicherung ${esc(dateTime(last.at))} mit Fehlern: ${esc(last.error || `${last.stats.failed} Datei(en) konnten nicht gesichert werden (z. B. weil sie geöffnet waren).`)}</p></div>`;
    }

    const sources = s.sources.length
        ? `<ul class="list">${s.sources.map((src, i) => `<li><span>${esc(src)}</span>
            <button class="button small" data-action="backup-restore" data-index="${i}" ${s.target ? '' : 'disabled'}>Wiederherstellen …</button>
            <button class="button small danger" data-action="backup-remove" data-index="${i}">Entfernen</button></li>`).join('')}</ul>`
        : '<div class="empty" style="margin-bottom:12px">Noch keine Ordner ausgewählt. Tipp: Dokumente, Bilder und Desktop.</div>';

    const versions = b.versions.length
        ? `<ul class="list">${b.versions.slice(0, 15).map((v) => `<li><span>${esc(dateTime(v.time))}</span>
            <button class="button small" data-action="backup-version" data-path="${esc(v.path)}">Öffnen</button></li>`).join('')}</ul>`
        : '<p class="muted">Noch keine älteren Fassungen vorhanden.</p>';

    return `<h1>Sicherung</h1>
        <p class="lead">Kopiert deine wichtigsten Ordner auf eine externe Festplatte oder ein Netzlaufwerk. Geänderte und gelöschte Dateien bleiben als ältere Fassungen erhalten – auch ein Schutz vor Erpressungstrojanern.</p>
        ${lockNotice()}
        ${lastHtml}
        <section class="panel">
            <h2>1. Was soll gesichert werden?</h2>
            ${sources}
            <button class="button" data-action="backup-add">Ordner hinzufügen</button>
        </section>
        <section class="panel">
            <h2>2. Wohin?</h2>
            <div class="row">
                <span class="spacer">${s.target ? esc(s.target) : '<span class="muted">Kein Speicherort gewählt</span>'}</span>
                <button class="button" data-action="backup-target">${s.target ? 'Ändern' : 'Speicherort wählen'}</button>
                ${s.target ? '<button class="button" data-action="backup-open">Öffnen</button>' : ''}
            </div>
        </section>
        <section class="panel">
            <h2>3. Wann?</h2>
            <label class="check" style="margin-bottom:14px"><input type="checkbox" id="backup-daily" ${s.schedule === 'daily' ? 'checked' : ''}>
                <span>Täglich automatisch sichern um <input type="time" id="backup-time" value="${esc(s.time)}">
                <br><span class="muted small">Läuft über die Windows-Aufgabenplanung, auch wenn OnePC Guard geschlossen ist. Verpasste Sicherungen werden beim nächsten Start nachgeholt.</span></span></label>
            <label class="field" style="max-width:280px"><span>Ältere Fassungen aufbewahren (Tage)</span>
                <input type="number" id="backup-keep" min="1" max="365" value="${esc(s.keepDays)}"></label>
            <div class="row">
                <button class="button" data-action="backup-save">Einstellungen speichern</button>
                <span class="spacer"></span>
                <button class="button primary" data-action="backup-run" ${state.backup.running || locked() || !s.target || !s.sources.length ? 'disabled' : ''}>Jetzt sichern</button>
            </div>
        </section>
        <section class="panel"><h2>Ältere Fassungen</h2>${versions}</section>`;
};

pages.license = async () => {
    const l = await call('license:state');
    state.license = l;
    renderLicenseBadge();

    let status;
    if (l.status === 'licensed') {
        status = `<div class="notice ok"><p><strong>Vollversion aktiviert.</strong> Schlüssel ${esc(l.key)}${l.customer ? ` · ${esc(l.customer)}` : ''}<br>
            ${l.expiresAt ? 'Gültig bis ' + esc(new Date(l.expiresAt).toLocaleDateString('de-DE')) : 'Unbegrenzt gültig'} · bis zu ${esc(l.maxActivations)} PC(s)</p></div>`;
    } else if (l.status === 'trial') {
        status = `<div class="notice info"><p><strong>Testversion:</strong> noch ${l.daysLeft} Tag(e) mit allen Funktionen.</p></div>`;
    } else {
        status = `<div class="notice bad"><p>${esc(l.message)}</p></div>`;
    }

    const form = l.status === 'licensed'
        ? `<section class="panel"><h2>Lizenz auf diesem PC</h2>
            <p class="muted">Du möchtest OnePC Guard auf einem anderen PC nutzen? Deaktiviere die Lizenz hier, dann kannst du sie dort aktivieren.</p>
            <div class="row"><button class="button" data-action="license-refresh">Lizenz prüfen</button>
            <button class="button danger" data-action="license-deactivate">Auf diesem PC deaktivieren</button></div></section>`
        : `<section class="panel"><h2>Lizenzschlüssel eingeben</h2>
            <p class="muted">Den Schlüssel findest du in der Bestellbestätigung per E-Mail und in deinem Kundenkonto auf onemultimedia.de.</p>
            <form id="license-form" class="row">
                <input class="key" id="license-key" type="text" placeholder="OPC-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" required>
                <button class="button primary" type="submit">Aktivieren</button>
            </form></section>`;

    return `<h1>Lizenz</h1>
        <p class="lead">Mit der Vollversion nutzt du Virenprüfung, Aufräumen und automatische Sicherung ohne Einschränkung. Der Sicherheitscheck ist immer kostenlos.</p>
        ${status}
        ${form}
        <section class="panel"><div class="row"><p class="spacer">Noch keinen Schlüssel? Die Vollversion gibt es im Shop von onemultimedia.</p>
            <button class="button" data-action="open" data-target="shop">Zum Shop</button>
            <button class="button" data-action="open" data-target="support">Hilfe &amp; Kontakt</button></div></section>`;
};

pages.settings = async () => {
    const st = await call('settings:get');
    state.update = st.update;
    state.remote = st.remoteState;
    const licensed = state.license && state.license.status === 'licensed';
    const r = st.remoteState || {};

    let remoteStatus = '';
    if (st.remote) {
        remoteStatus = r.connected
            ? `<div class="notice ok"><p><strong>Verbunden.</strong> Zuletzt abgeglichen: ${esc(dateTime(r.lastSync))}${r.busy ? ' · Auftrag aus der App läuft' : ''}</p></div>`
            : `<div class="notice"><p>Verbindung wird hergestellt …${r.error ? ' ' + esc(r.error) : ''}</p></div>`;
    }

    const u = st.update || {};
    const updateText = {
        disabled: 'Automatische Updates sind in der Entwicklerversion ausgeschaltet.',
        idle: 'Noch nicht geprüft.',
        checking: 'Suche nach Updates …',
        current: 'OnePC Guard ist aktuell.',
        downloading: `Version ${esc(u.version || '')} wird geladen … ${u.percent || 0} %`,
        ready: `Version ${esc(u.version || '')} ist bereit und wird beim nächsten Start installiert.`,
        error: 'Updates konnten gerade nicht geprüft werden (keine Internetverbindung?).',
    }[u.status] || '';

    return `<h1>Einstellungen</h1>
        <p class="lead">Verbindung mit dem Handy, Start mit Windows und Updates.</p>

        <section class="panel">
            <h2>OnePC-App fürs Handy</h2>
            <p class="muted">Mit der App siehst du den Zustand deiner PCs auf dem Handy und startest Virenprüfung und Aufräumen aus der Ferne.</p>
            ${!licensed ? `<div class="notice info"><p>Die Verbindung mit der App ist Teil der Vollversion.</p><button class="button primary" data-action="go" data-target="license">Lizenz eingeben</button></div>` : ''}
            ${remoteStatus}
            <label class="switch"><input type="checkbox" data-setting="remote" ${st.remote ? 'checked' : ''} ${licensed ? '' : 'disabled'}>
                <span><strong>Mit der OnePC-App verbinden</strong>
                <span class="muted">Übertragen werden nur Bewertung, gefundene Probleme, Ergebnisse von Prüfung, Aufräumen und Sicherung sowie die Programmversion – keine Dateien. OnePC Guard läuft dafür im Infobereich weiter, wenn du das Fenster schließt.</span></span></label>
            <div class="row" style="margin-top:8px"><p class="spacer muted">Auf dem Handy öffnen und mit dem Kundenkonto anmelden, mit dem die Lizenz gekauft wurde:</p>
                <button class="button" data-action="open" data-target="mobileapp">App-Adresse öffnen</button></div>
        </section>

        <section class="panel">
            <h2>Start</h2>
            <label class="switch"><input type="checkbox" data-setting="autostart" ${st.autostart ? 'checked' : ''}>
                <span><strong>Mit Windows starten (im Hintergrund)</strong>
                <span class="muted">Empfohlen zusammen mit der App-Verbindung, damit Aufträge vom Handy jederzeit ankommen.</span></span></label>
        </section>

        <section class="panel">
            <h2>Updates</h2>
            <div class="row"><p class="spacer">Installierte Version: <strong>${esc(st.version)}</strong><br><span class="muted">${updateText}</span></p>
                ${u.status === 'ready'
                    ? '<button class="button primary" data-action="update-install">Jetzt neu starten</button>'
                    : `<button class="button" data-action="update-check" ${u.status === 'disabled' || u.status === 'checking' || u.status === 'downloading' ? 'disabled' : ''}>Nach Updates suchen</button>`}</div>
            <p class="muted small">OnePC Guard sucht automatisch alle 6 Stunden nach neuen Versionen und installiert sie beim nächsten Start.</p>
        </section>`;
};

function renderUpdateBar() {
    const bar = document.getElementById('update-bar');
    const u = state.update;
    if (u && u.status === 'ready') {
        bar.innerHTML = `<p><strong>Update bereit:</strong> OnePC Guard ${esc(u.version)} ist geladen.</p>
            <button class="button primary" data-action="update-install">Jetzt neu starten</button>`;
        bar.hidden = false;
    } else {
        bar.hidden = true;
    }
}

document.getElementById('update-bar').addEventListener('click', (event) => {
    if (event.target.closest('[data-action="update-install"]')) {
        call('update:install').catch(fail);
    }
});

async function render() {
    const page = state.page;
    try {
        const html = await pages[page]();
        if (state.page === page) {
            content.innerHTML = html;
        }
    } catch (error) {
        content.innerHTML = `<h1>Fehler</h1><div class="notice bad"><p>${esc(error.message)}</p></div>`;
    }
}

/* Aktionen --------------------------------------------------------------- */

const actions = {
    go: (el) => go(el.dataset.target),
    open: (el) => call('app:open', el.dataset.target).catch(fail),

    async 'security-check'() {
        state.security = 'loading';
        render();
        try {
            state.security = await call('security:check');
        } catch (error) {
            state.security = null;
            fail(error);
        }
        render();
    },
    async 'check-action'(el) {
        const { type, target } = el.dataset;
        if (type === 'page') {
            go(target);
        } else if (type === 'open') {
            call('app:open', target).catch(fail);
        } else if (type === 'defender-update') {
            await actions['update-signatures'](el);
            actions['security-check']();
        }
    },

    async 'update-signatures'(el) {
        el.disabled = true;
        toast('Virendefinitionen werden aktualisiert …');
        try {
            await call('security:update-signatures');
            toast('Virendefinitionen sind aktuell.');
        } catch (error) {
            fail(error);
        }
        el.disabled = false;
    },

    async scan(el) {
        const type = el.dataset.type;
        let target = null;
        if (type === 'custom') {
            target = await call('scan:choose-folder').catch(fail);
            if (!target) {
                return;
            }
        }
        state.scan = { running: true, type, result: null };
        render();
        try {
            state.scan.result = await call('scan:start', type, target);
        } catch (error) {
            fail(error);
        }
        state.scan.running = false;
        if (state.page === 'scan') {
            render();
        }
    },
    'scan-cancel': () => call('scan:cancel').catch(fail),

    async 'update-check'() {
        try {
            state.update = await call('update:check');
        } catch (error) {
            fail(error);
        }
        render();
    },
    'update-install': () => call('update:install').catch(fail),

    async 'clean-analyze'() {
        state.clean.analysis = 'loading';
        render();
        try {
            state.clean.analysis = await call('clean:analyze');
        } catch (error) {
            state.clean.analysis = null;
            fail(error);
        }
        render();
    },
    async 'clean-run'() {
        const ids = [...document.querySelectorAll('.clean-item:checked')].map((i) => i.value);
        if (!ids.length) {
            toast('Bitte mindestens einen Bereich auswählen.', true);
            return;
        }
        state.clean.busy = true;
        render();
        try {
            const result = await call('clean:run', ids);
            toast(`${bytes(result.freed)} freigegeben.${result.failed ? ` ${result.failed} Datei(en) waren in Benutzung und wurden übersprungen.` : ''}`);
            state.clean.analysis = await call('clean:analyze');
        } catch (error) {
            fail(error);
        }
        state.clean.busy = false;
        render();
    },
    async 'large-files'() {
        state.clean.large = 'loading';
        render();
        try {
            state.clean.large = await call('clean:large-files');
        } catch (error) {
            state.clean.large = null;
            fail(error);
        }
        render();
    },
    'file-show': (el) => call('file:show', state.clean.large[el.dataset.index].path).catch(fail),
    async 'file-trash'(el) {
        const file = state.clean.large[el.dataset.index];
        if (!confirm(`„${file.path}“ in den Papierkorb verschieben?`)) {
            return;
        }
        try {
            await call('file:trash', file.path);
            state.clean.large.splice(el.dataset.index, 1);
            toast('In den Papierkorb verschoben.');
            render();
        } catch (error) {
            fail(error);
        }
    },

    async 'backup-add'() {
        const folders = await call('backup:choose-folder', 'source').catch(fail);
        if (folders && folders.length) {
            const sources = [...new Set([...state.backup.settings.sources, ...folders])];
            await saveBackup({ sources });
        }
    },
    async 'backup-remove'(el) {
        const sources = state.backup.settings.sources.filter((_, i) => i !== Number(el.dataset.index));
        await saveBackup({ sources });
    },
    async 'backup-target'() {
        const folders = await call('backup:choose-folder', 'target').catch(fail);
        if (folders && folders.length) {
            await saveBackup({ target: folders[0] });
        }
    },
    'backup-open': () => call('backup:open-target').catch(fail),
    'backup-version': (el) => call('backup:open-version', el.dataset.path).catch(fail),
    async 'backup-save'() {
        await saveBackup({}, true);
    },
    async 'backup-run'() {
        state.backup.running = true;
        state.backup.progress = null;
        render();
        try {
            const stats = await call('backup:run');
            toast(`Sicherung fertig: ${stats.copied} Dateien kopiert.`);
        } catch (error) {
            fail(error);
        }
        state.backup.running = false;
        if (state.page === 'backup') {
            render();
        }
    },
    async 'backup-restore'(el) {
        try {
            const destination = await call('backup:restore', state.backup.settings.sources[el.dataset.index]);
            if (destination) {
                toast('Dateien wiederhergestellt nach ' + destination);
            }
        } catch (error) {
            fail(error);
        }
    },

    async 'license-deactivate'() {
        if (!confirm('Lizenz auf diesem PC deaktivieren?')) {
            return;
        }
        try {
            await call('license:deactivate');
            toast('Lizenz deaktiviert.');
        } catch (error) {
            fail(error);
        }
        await loadLicense();
        render();
    },
    async 'license-refresh'() {
        try {
            await call('license:refresh');
            toast('Lizenz geprüft.');
        } catch (error) {
            fail(error);
        }
        await loadLicense();
        render();
    },
};

async function saveBackup(changes, announce = false) {
    const s = state.backup.settings;
    const daily = document.getElementById('backup-daily');
    const input = {
        sources: s.sources,
        target: s.target,
        keepDays: document.getElementById('backup-keep')?.value ?? s.keepDays,
        schedule: daily ? (daily.checked ? 'daily' : 'off') : s.schedule,
        time: document.getElementById('backup-time')?.value || s.time,
        ...changes,
    };
    try {
        state.backup.settings = await call('backup:save', input);
        if (announce) {
            toast(input.schedule === 'daily' ? `Gespeichert. Tägliche Sicherung um ${input.time} Uhr.` : 'Gespeichert.');
        }
    } catch (error) {
        fail(error);
    }
    render();
}

content.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (el && !el.disabled && actions[el.dataset.action]) {
        actions[el.dataset.action](el);
    }
});

content.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-setting]');
    if (!input) {
        return;
    }
    input.disabled = true;
    try {
        await call('settings:save', { [input.dataset.setting]: input.checked });
        toast(input.checked ? 'Eingeschaltet.' : 'Ausgeschaltet.');
    } catch (error) {
        input.checked = !input.checked;
        fail(error);
    }
    render();
});

content.addEventListener('submit', async (event) => {
    if (event.target.id !== 'license-form') {
        return;
    }
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
        await call('license:activate', document.getElementById('license-key').value);
    } catch (error) {
        // Eingabe stehen lassen, damit der Schlüssel korrigiert werden kann.
        button.disabled = false;
        fail(error);
        return;
    }
    toast('Vielen Dank! Die Vollversion ist aktiviert.');
    await loadLicense();
    render();
});

window.api.on('backup:progress', (progress) => {
    state.backup.progress = progress;
    if (state.page === 'backup') {
        const p = content.querySelector('.notice.info p');
        if (p) {
            p.textContent = `Sicherung läuft … ${progress.processed} Dateien geprüft, ${progress.copied} kopiert`;
        }
    }
});
window.api.on('backup:state', ({ running }) => {
    state.backup.running = running;
    if (state.page === 'backup') {
        render();
    }
});
window.api.on('update:state', (update) => {
    state.update = update;
    renderUpdateBar();
    if (state.page === 'settings') {
        render();
    }
});
window.api.on('remote:state', (remote) => {
    state.remote = remote;
});
window.api.on('remote:activity', ({ type, running }) => {
    const names = { 'scan-quick': 'Schnellprüfung', 'scan-full': 'Vollständige Prüfung', clean: 'Aufräumen', 'security-check': 'Sicherheitscheck' };
    toast(running ? `Die OnePC-App hat „${names[type] || type}“ gestartet.` : `„${names[type] || type}“ aus der OnePC-App ist fertig.`);
    if (!running && state.page !== 'license' && state.page !== 'settings') {
        render();
    }
});
window.api.on('license:changed', (license) => {
    state.license = license;
    renderLicenseBadge();
});

loadLicense().then(render);
call('settings:get').then((st) => {
    state.update = st.update;
    renderUpdateBar();
}).catch(() => {});
