'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = [
    'app:overview', 'app:open',
    'security:check', 'security:update-signatures',
    'scan:start', 'scan:cancel', 'scan:choose-folder',
    'clean:analyze', 'clean:run', 'clean:large-files', 'file:show', 'file:trash',
    'backup:get', 'backup:save', 'backup:choose-folder', 'backup:run', 'backup:open-target', 'backup:open-version', 'backup:restore',
    'license:state', 'license:activate', 'license:deactivate', 'license:refresh',
    'settings:get', 'settings:save', 'update:check', 'update:install',
];
const EVENTS = ['backup:progress', 'backup:state', 'license:changed', 'update:state', 'remote:state', 'remote:activity'];

contextBridge.exposeInMainWorld('api', {
    invoke(channel, ...args) {
        if (!INVOKE.includes(channel)) {
            return Promise.reject(new Error('Unbekannter Kanal: ' + channel));
        }
        return ipcRenderer.invoke(channel, ...args);
    },
    on(channel, callback) {
        if (!EVENTS.includes(channel)) {
            return () => {};
        }
        const listener = (event, payload) => callback(payload);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
});
