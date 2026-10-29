'use strict';

/**
 * Automatische Updates über GitHub-Releases (electron-updater).
 * Neue Versionen werden im Hintergrund geladen und beim nächsten Beenden
 * installiert – oder sofort, wenn der Nutzer „Jetzt neu starten“ wählt.
 */

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function createUpdater({ app, onState, log = () => {} }) {
    let state = { status: 'idle', version: null, percent: 0, error: null };
    let autoUpdater = null;

    const set = (patch) => {
        state = { ...state, ...patch };
        onState(state);
    };

    if (!app.isPackaged) {
        // In der Entwicklungsumgebung gibt es keine Update-Konfiguration.
        set({ status: 'disabled' });
        return {
            state: () => state,
            check: async () => state,
            install: () => false,
        };
    }

    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => set({ status: 'current' }));
    autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, percent: 100 }));
    autoUpdater.on('error', (error) => {
        log('Update-Fehler: ' + (error && error.message));
        // Ohne Internet oder bei GitHub-Störungen still weiterarbeiten.
        set({ status: state.status === 'ready' ? 'ready' : 'error', error: 'Updates konnten nicht geprüft werden.' });
    });

    const check = async () => {
        try {
            await autoUpdater.checkForUpdates();
        } catch {
            // Fehler wird über das error-Ereignis gemeldet.
        }
        return state;
    };

    setTimeout(check, 15 * 1000);
    setInterval(check, CHECK_INTERVAL);

    return {
        state: () => state,
        check,
        install: () => {
            if (state.status !== 'ready') {
                return false;
            }
            // Still installieren und das Programm danach wieder starten.
            setImmediate(() => autoUpdater.quitAndInstall(true, true));
            return true;
        },
    };
}

module.exports = { createUpdater };
