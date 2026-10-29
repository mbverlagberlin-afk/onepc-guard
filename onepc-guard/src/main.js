'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, Tray, nativeImage } = require('electron');

const config = require('../config/app.json');
const { Store } = require('./lib/store');
const { LicenseManager, getDeviceId } = require('./lib/license');
const security = require('./lib/security');
const scanner = require('./lib/scanner');
const cleaner = require('./lib/cleaner');
const backup = require('./lib/backup');
const { isWindows } = require('./lib/powershell');
const { RemoteLink } = require('./lib/remote');
const { createUpdater } = require('./lib/updater');

const TASK_NAME = 'OnePC Guard Sicherung';
const AUTOSTART_TASK = 'OnePC Guard Autostart';
const BACKUP_NOW = process.argv.includes('--backup-now');
const START_HIDDEN = process.argv.includes('--hidden');
// Bereiche, die beim Aufräumen aus der App bereinigt werden (ohne Papierkorb).
const REMOTE_CLEAN_IDS = ['usertemp', 'wintemp', 'chrome', 'edge', 'firefox', 'crashdumps'];

// Ziele für "Einstellungen öffnen"-Knöpfe. Nur diese dürfen aus der Oberfläche geöffnet werden.
const OPEN_TARGETS = {
    defender: { uri: 'windowsdefender:' },
    firewall: { uri: 'windowsdefender://network/' },
    windowsupdate: { uri: 'ms-settings:windowsupdate' },
    startupapps: { uri: 'ms-settings:startupapps' },
    remotedesktop: { uri: 'ms-settings:remotedesktop' },
    uac: { command: ['UserAccountControlSettings.exe', []] },
    bitlocker: { command: ['control.exe', ['/name', 'Microsoft.BitLockerDriveEncryption']] },
    shop: { uri: config.shopUrl },
    mobileapp: { uri: config.serverUrl.replace(/\/$/, '') + '/onepc-app/' },
    support: { uri: config.supportUrl },
};

let mainWindow = null;
let tray = null;
let quitting = false;
let store;
let license;
let remote;
let updater;
let backupRunning = false;

/* ----------------------------------------------------------------------- */

function requireFullAccess() {
    if (!license.state().fullAccess) {
        const error = new Error('Für diese Funktion wird eine gültige Lizenz benötigt.');
        error.code = 'LICENSE_REQUIRED';
        throw error;
    }
}

function handle(channel, fn) {
    ipcMain.handle(channel, async (event, ...args) => {
        try {
            return { ok: true, data: await fn(...args) };
        } catch (error) {
            return { ok: false, error: error.message, code: error.code || null };
        }
    });
}

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

function remember(key, value) {
    store.set(key, { ...value, at: new Date().toISOString() });
}

function scheduleCommand(flag) {
    return app.isPackaged
        ? `"${process.execPath}" ${flag}`
        : `"${process.execPath}" "${app.getAppPath()}" ${flag}`;
}

function schtasks(args) {
    return new Promise((resolve, reject) => {
        execFile('schtasks.exe', args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error((stderr || error.message).trim()));
            } else {
                resolve(stdout);
            }
        });
    });
}

async function applyBackupSchedule(settings) {
    if (!isWindows) {
        return;
    }
    if (settings.schedule === 'daily') {
        await schtasks(['/Create', '/F', '/TN', TASK_NAME, '/SC', 'DAILY', '/ST', settings.time || '12:00', '/RL', 'HIGHEST', '/TR', scheduleCommand('--backup-now')]);
    } else {
        await schtasks(['/Delete', '/F', '/TN', TASK_NAME]).catch(() => {});
    }
}

async function performBackup() {
    requireFullAccess();
    if (backupRunning) {
        throw new Error('Es läuft bereits eine Sicherung.');
    }

    const settings = store.get('backup');
    backupRunning = true;
    send('backup:state', { running: true });
    try {
        const stats = await backup.runBackup({
            sources: settings.sources,
            target: settings.target,
            keepDays: settings.keepDays,
            onProgress: (progress) => send('backup:progress', progress),
        });
        remember('lastBackup', { ok: stats.failed === 0, stats });
        return stats;
    } catch (error) {
        remember('lastBackup', { ok: false, error: error.message });
        throw error;
    } finally {
        backupRunning = false;
        send('backup:state', { running: false });
    }
}

function notify(title, body) {
    if (Notification.isSupported()) {
        new Notification({ title, body, icon: path.join(__dirname, 'renderer', 'icon.png') }).show();
    }
}

async function backupAndNotify() {
    try {
        const stats = await performBackup();
        notify('Sicherung abgeschlossen', stats.failed
            ? `${stats.copied} Dateien gesichert, ${stats.failed} konnten nicht gesichert werden.`
            : `${stats.copied} Dateien neu gesichert, ${stats.unchanged} unverändert.`);
    } catch (error) {
        notify('Sicherung fehlgeschlagen', error.message);
    }
}

async function applyAutostart(enabled) {
    if (!isWindows) {
        return;
    }
    if (enabled) {
        // Aufgabenplanung statt Autostart-Ordner: startet mit Administratorrechten ohne Rückfrage.
        await schtasks(['/Create', '/F', '/TN', AUTOSTART_TASK, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/TR', scheduleCommand('--hidden')]);
    } else {
        await schtasks(['/Delete', '/F', '/TN', AUTOSTART_TASK]).catch(() => {});
    }
}

function saveSecurity(result) {
    store.set('lastSecurity', {
        score: result.score,
        at: result.checkedAt,
        problems: result.checks.filter((c) => c.status === 'bad' || c.status === 'warn').length,
        details: result.checks
            .filter((c) => c.status === 'bad' || c.status === 'warn')
            .map((c) => ({ title: c.title, status: c.status, detail: c.detail })),
    });
}

async function runSecurity() {
    const result = await security.runSecurityCheck();
    saveSecurity(result);
    return result;
}

async function analyzeCleanable() {
    const analysis = await cleaner.analyze();
    const total = analysis.filter((a) => REMOTE_CLEAN_IDS.includes(a.id)).reduce((sum, a) => sum + a.size, 0);
    store.set('lastAnalysis', { total, at: new Date().toISOString() });
    return analysis;
}

function deviceStatus() {
    const sec = store.get('lastSecurity');
    const analysis = store.get('lastAnalysis');
    const update = updater ? updater.state() : {};
    return {
        version: app.getVersion(),
        score: sec ? sec.score : null,
        checkedAt: sec ? sec.at : null,
        problems: sec && sec.details ? sec.details.slice(0, 10) : [],
        lastScan: store.get('lastScan') || null,
        lastClean: store.get('lastClean') || null,
        lastBackup: store.get('lastBackup') ? { ok: store.get('lastBackup').ok, at: store.get('lastBackup').at } : null,
        cleanable: analysis ? analysis.total : null,
        defenderAvailable: scanner.isAvailable(),
        updateReady: update.status === 'ready',
    };
}

const ACTIVITY = {
    'scan-quick': 'Schnellprüfung',
    'scan-full': 'Vollständige Prüfung',
    clean: 'Aufräumen',
    'security-check': 'Sicherheitscheck',
};

async function executeRemote(type) {
    requireFullAccess();
    send('remote:activity', { type, running: true });
    try {
        if (type === 'scan-quick' || type === 'scan-full') {
            const result = await scanner.startScan(type === 'scan-quick' ? 'quick' : 'full');
            remember('lastScan', { type, threats: result.threats.length, threatsFound: result.threatsFound });
            notify('Virenprüfung abgeschlossen (über die OnePC-App gestartet)', result.threatsFound
                ? 'Bedrohungen wurden gefunden und von Microsoft Defender behandelt.'
                : 'Keine Bedrohung gefunden.');
            return {
                threatsFound: result.threatsFound,
                threats: result.threats.length,
                names: result.threats.slice(0, 5).map((t) => t.name),
                durationMs: result.durationMs,
            };
        }
        if (type === 'clean') {
            const result = await cleaner.clean(REMOTE_CLEAN_IDS);
            remember('lastClean', { freed: result.freed });
            await analyzeCleanable().catch(() => {});
            notify('Aufräumen abgeschlossen (über die OnePC-App gestartet)', `${security.formatBytes(result.freed)} freigegeben.`);
            return result;
        }
        if (type === 'security-check') {
            const result = await runSecurity();
            return { score: result.score, problems: store.get('lastSecurity').problems };
        }
        throw new Error('Unbekannter Auftrag.');
    } finally {
        send('remote:activity', { type, running: false });
    }
}

function settings() {
    return {
        remote: Boolean(store.get('remoteEnabled')),
        autostart: Boolean(store.get('autostart')),
    };
}

/* ----------------------------------------------------------------------- */

function registerHandlers() {
    handle('app:overview', () => ({
        version: app.getVersion(),
        platform: process.platform,
        license: license.state(),
        defenderAvailable: scanner.isAvailable(),
        lastSecurity: store.get('lastSecurity') || null,
        lastScan: store.get('lastScan') || null,
        lastClean: store.get('lastClean') || null,
        lastBackup: store.get('lastBackup') || null,
        backupConfigured: Boolean(store.get('backup').target && store.get('backup').sources.length),
    }));

    handle('app:open', (target) => {
        const entry = OPEN_TARGETS[target];
        if (!entry) {
            throw new Error('Unbekanntes Ziel.');
        }
        if (entry.uri) {
            return shell.openExternal(entry.uri);
        }
        return new Promise((resolve) => {
            execFile(entry.command[0], entry.command[1], { windowsHide: false }, () => resolve());
        });
    });

    // Sicherheitscheck ist immer frei nutzbar, auch ohne Lizenz.
    handle('security:check', () => runSecurity());

    handle('security:update-signatures', async () => {
        requireFullAccess();
        await scanner.updateSignatures();
        return true;
    });

    handle('scan:start', async (type, target) => {
        requireFullAccess();
        const result = await scanner.startScan(type, target);
        if (!result.cancelled) {
            remember('lastScan', { type, threats: result.threats.length, threatsFound: result.threatsFound });
        }
        return result;
    });
    handle('scan:cancel', () => scanner.cancelScan());
    handle('scan:choose-folder', async () => {
        const result = await dialog.showOpenDialog(mainWindow, { title: 'Ordner prüfen', properties: ['openDirectory'] });
        return result.canceled ? null : result.filePaths[0];
    });

    handle('clean:analyze', () => analyzeCleanable());
    handle('clean:run', async (ids) => {
        requireFullAccess();
        const result = await cleaner.clean(Array.isArray(ids) ? ids : []);
        remember('lastClean', { freed: result.freed });
        return result;
    });
    handle('clean:large-files', () => cleaner.findLargeFiles());
    handle('file:show', (file) => shell.showItemInFolder(String(file)));
    handle('file:trash', async (file) => {
        requireFullAccess();
        await shell.trashItem(String(file));
        return true;
    });

    handle('backup:get', async () => {
        const settings = store.get('backup');
        return {
            settings,
            running: backupRunning,
            versions: settings.target ? await backup.listVersions(settings.target) : [],
        };
    });
    handle('backup:save', async (input) => {
        const current = store.get('backup');
        const settings = {
            sources: Array.isArray(input.sources) ? input.sources.map(String) : current.sources,
            target: typeof input.target === 'string' ? input.target : current.target,
            keepDays: Math.min(365, Math.max(1, parseInt(input.keepDays, 10) || 30)),
            schedule: input.schedule === 'daily' ? 'daily' : 'off',
            time: /^\d{2}:\d{2}$/.test(input.time) ? input.time : '12:00',
        };
        if (settings.schedule === 'daily') {
            requireFullAccess();
        }
        if (settings.target && settings.sources.length) {
            backup.validate(settings.sources, settings.target);
        }
        await applyBackupSchedule(settings);
        store.set('backup', settings);
        return settings;
    });
    handle('backup:choose-folder', async (purpose) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: purpose === 'target' ? 'Speicherort für die Sicherung wählen' : 'Ordner zum Sichern auswählen',
            properties: purpose === 'target' ? ['openDirectory', 'createDirectory'] : ['openDirectory', 'multiSelections'],
        });
        return result.canceled ? [] : result.filePaths;
    });
    handle('backup:run', () => performBackup());
    handle('backup:open-target', () => shell.openPath(backup.backupRoot(store.get('backup').target)));
    handle('backup:open-version', (versionPath) => {
        const root = backup.backupRoot(store.get('backup').target);
        if (!path.resolve(versionPath).startsWith(path.resolve(root))) {
            throw new Error('Ungültiger Pfad.');
        }
        return shell.openPath(versionPath);
    });
    handle('backup:restore', async (source) => {
        requireFullAccess();
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Wohin sollen die Dateien wiederhergestellt werden?',
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled) {
            return null;
        }
        const destination = await backup.restore({ target: store.get('backup').target, source, destination: result.filePaths[0] });
        shell.openPath(destination);
        return destination;
    });

    handle('license:state', () => license.state());
    handle('license:activate', (key) => license.activate(key));
    handle('license:deactivate', () => license.deactivate());
    handle('license:refresh', () => license.refresh({ force: true }));

    handle('settings:get', () => ({ ...settings(), remoteState: remote.state, update: updater.state(), version: app.getVersion() }));
    handle('settings:save', async (input) => {
        if (typeof input.autostart === 'boolean') {
            await applyAutostart(input.autostart);
            store.set('autostart', input.autostart);
        }
        if (typeof input.remote === 'boolean') {
            if (input.remote && !license.licenseKey()) {
                const error = new Error('Die Verbindung mit der OnePC-App ist mit der Vollversion verfügbar.');
                error.code = 'LICENSE_REQUIRED';
                throw error;
            }
            store.set('remoteEnabled', input.remote);
            if (input.remote) {
                runSecurity().catch(() => {});
                analyzeCleanable().catch(() => {});
                remote.start(1000);
            }
        }
        updateTray();
        return settings();
    });
    handle('update:check', () => updater.check());
    handle('update:install', () => {
        quitting = true;
        return updater.install();
    });
}

/* ----------------------------------------------------------------------- */

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 780,
        minWidth: 960,
        minHeight: 640,
        show: false,
        title: 'OnePC Guard',
        backgroundColor: '#f4f6fb',
        icon: path.join(__dirname, 'renderer', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.once('ready-to-show', () => {
        if (!START_HIDDEN || !tray) {
            mainWindow.show();
        }
    });
    mainWindow.on('close', (event) => {
        // Mit App-Verbindung oder Autostart läuft OnePC Guard im Infobereich weiter.
        if (!quitting && (settings().remote || settings().autostart)) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
}

function showWindow() {
    if (!mainWindow) {
        createWindow();
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
}

function updateTray() {
    const wanted = settings().remote || settings().autostart;
    if (!wanted) {
        if (tray) {
            tray.destroy();
            tray = null;
        }
        return;
    }
    if (!tray) {
        tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png')).resize({ width: 16, height: 16 }));
        tray.setToolTip('OnePC Guard');
        tray.on('click', showWindow);
    }
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'OnePC Guard öffnen', click: showWindow },
        { label: settings().remote ? 'Mit der OnePC-App verbunden' : 'Nicht mit der App verbunden', enabled: false },
        { type: 'separator' },
        { label: 'Beenden', click: () => { quitting = true; app.quit(); } },
    ]));
}

function catchUpBackup() {
    const settings = store.get('backup');
    const last = store.get('lastBackup');
    const due = !last || Date.now() - Date.parse(last.at) > 26 * 60 * 60 * 1000;
    if (settings.schedule === 'daily' && settings.target && settings.sources.length && due && license.state().fullAccess) {
        backupAndNotify();
    }
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', (event, argv) => {
        // Geplante Sicherung, während das Programm schon läuft: hier ausführen.
        if (argv.includes('--backup-now')) {
            backupAndNotify();
            return;
        }
        if (!argv.includes('--hidden')) {
            showWindow();
        }
    });

    app.whenReady().then(async () => {
        app.setAppUserModelId('de.onemultimedia.onepcguard');
        Menu.setApplicationMenu(null);

        store = new Store(path.join(app.getPath('userData'), 'settings.json'), {
            backup: { sources: [], target: '', keepDays: 30, schedule: 'off', time: '12:00' },
        });
        license = new LicenseManager({ store, config, deviceId: getDeviceId(store) });

        if (BACKUP_NOW) {
            await license.refresh().catch(() => {});
            await backupAndNotify();
            // Kurz warten, damit die Benachrichtigung angezeigt wird.
            setTimeout(() => app.quit(), 5000);
            return;
        }

        updater = createUpdater({ app, onState: (state) => send('update:state', state) });
        remote = new RemoteLink({
            request: (action, body) => license.request(action, body),
            licenseKey: () => license.licenseKey(),
            isEnabled: () => settings().remote,
            getStatus: deviceStatus,
            execute: executeRemote,
            onChange: (state) => send('remote:state', state),
        });

        registerHandlers();
        createWindow();
        updateTray();
        remote.start();

        // Status für die App aktuell halten.
        const refreshStatus = () => {
            if (settings().remote && license.licenseKey()) {
                runSecurity().catch(() => {});
                analyzeCleanable().catch(() => {});
            }
        };
        setTimeout(refreshStatus, 20 * 1000);
        setInterval(refreshStatus, 6 * 60 * 60 * 1000);

        license.refresh().then((state) => send('license:changed', state)).catch(() => {});
        setInterval(() => license.refresh().then((state) => send('license:changed', state)).catch(() => {}), 12 * 60 * 60 * 1000);
        setTimeout(catchUpBackup, 60 * 1000);
    });

    app.on('web-contents-created', (event, contents) => {
        contents.on('will-navigate', (e) => e.preventDefault());
        contents.setWindowOpenHandler(({ url }) => {
            if (/^https:\/\//.test(url)) {
                shell.openExternal(url);
            }
            return { action: 'deny' };
        });
    });

    app.on('before-quit', () => { quitting = true; });

    app.on('window-all-closed', () => {
        if (!BACKUP_NOW && !tray) {
            app.quit();
        }
    });
}
