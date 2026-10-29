'use strict';

/**
 * Verbindung zur OnePC-App (Handy). Der PC meldet regelmäßig seinen Status an
 * den Lizenzserver und holt dort Aufträge ab, die in der App ausgelöst wurden.
 * Der PC baut die Verbindung immer selbst auf – es wird kein Port geöffnet.
 */

const COMMANDS = ['scan-quick', 'scan-full', 'clean', 'security-check'];
const DEFAULT_INTERVAL = 60 * 1000;

class RemoteLink {
    constructor({ request, licenseKey, isEnabled, getStatus, execute, onChange = () => {}, intervalMs = DEFAULT_INTERVAL, now = () => Date.now() }) {
        this.request = request;
        this.licenseKey = licenseKey;
        this.isEnabled = isEnabled;
        this.getStatus = getStatus;
        this.execute = execute;
        this.onChange = onChange;
        this.intervalMs = intervalMs;
        this.now = now;

        this.outbox = [];
        this.queue = [];
        this.seen = new Set();
        this.busy = null;
        this.timer = null;
        this.syncing = false;
        this.state = { connected: false, lastSync: null, error: null, busy: null };
    }

    start(delay = 3000) {
        this.schedule(delay);
    }

    stop() {
        clearTimeout(this.timer);
        this.timer = null;
    }

    schedule(delay) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.tick(), delay);
    }

    update(patch) {
        this.state = { ...this.state, ...patch };
        this.onChange(this.state);
    }

    async tick() {
        if (this.syncing) {
            this.schedule(1000);
            return;
        }
        const key = this.licenseKey();
        if (!this.isEnabled() || !key) {
            this.update({ connected: false, error: null });
            this.schedule(this.intervalMs);
            return;
        }

        this.syncing = true;
        const sending = this.outbox.length;
        try {
            const data = await this.request('device/sync', {
                license_key: key,
                status: { ...await this.getStatus(), busy: this.busy ? this.busy.type : null },
                results: this.outbox.slice(0, sending),
            });
            this.outbox.splice(0, sending);

            for (const command of (data && data.commands) || []) {
                if (!this.seen.has(command.id) && COMMANDS.includes(command.type)) {
                    this.seen.add(command.id);
                    this.queue.push(command);
                } else if (!COMMANDS.includes(command.type)) {
                    this.outbox.push({ id: command.id, state: 'failed', result: { message: 'Unbekannter Auftrag.' } });
                }
            }

            if (data && data.poll_seconds) {
                this.intervalMs = Math.max(15, Math.min(600, data.poll_seconds)) * 1000;
            }
            this.update({ connected: true, lastSync: new Date(this.now()).toISOString(), error: null });
        } catch (error) {
            this.update({ connected: false, error: error.message });
        } finally {
            this.syncing = false;
        }

        this.runQueue();
        // Ergebnisse sofort nachreichen, sonst im normalen Takt weiter.
        this.schedule(this.outbox.length ? 1000 : this.intervalMs);
    }

    async runQueue() {
        if (this.busy || !this.queue.length) {
            return;
        }
        const command = this.queue.shift();
        this.busy = command;
        this.update({ busy: command.type });
        this.outbox.push({ id: command.id, state: 'running' });
        this.schedule(500);

        try {
            const result = await this.execute(command.type);
            this.outbox.push({ id: command.id, state: 'done', result });
        } catch (error) {
            this.outbox.push({ id: command.id, state: 'failed', result: { message: error.message } });
        }

        this.busy = null;
        this.update({ busy: null });
        this.schedule(500);
        this.runQueue();
    }
}

module.exports = { RemoteLink, COMMANDS };
