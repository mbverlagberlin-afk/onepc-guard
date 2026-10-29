'use strict';

const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const DAY = 24 * 60 * 60 * 1000;
const STOP_CODES = ['invalid_key', 'revoked', 'expired', 'not_activated', 'wrong_product'];

/**
 * Prüft die Ed25519-Signatur des Lizenzservers. Der öffentliche Schlüssel ist im
 * Programm hinterlegt; den privaten Schlüssel kennt nur der Shop. Dadurch lassen
 * sich Lizenzdateien nicht fälschen.
 */
function verifySignature(payload, signature, publicKeyBase64) {
    try {
        const raw = Buffer.from(publicKeyBase64, 'base64');
        if (raw.length !== 32) {
            return false;
        }
        const key = crypto.createPublicKey({
            key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
            format: 'der',
            type: 'spki',
        });
        return crypto.verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signature, 'base64'));
    } catch {
        return false;
    }
}

function getDeviceId(store) {
    if (process.platform === 'win32') {
        try {
            const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
            const match = /MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i.exec(out);
            if (match) {
                return crypto.createHash('sha256').update('onepc-guard:' + match[1].toLowerCase()).digest('hex').slice(0, 32);
            }
        } catch {
            // Rückfall auf eine zufällige, gespeicherte Kennung.
        }
    }

    let id = store.get('deviceId');
    if (!id) {
        id = crypto.randomBytes(16).toString('hex');
        store.set('deviceId', id);
    }
    return id;
}

function maskKey(key) {
    const parts = String(key).split('-');
    return parts.map((part, i) => (i === 0 || i === parts.length - 1 ? part : '****')).join('-');
}

class LicenseManager {
    constructor({ store, config, deviceId, deviceName = os.hostname(), fetchImpl = globalThis.fetch, now = () => Date.now() }) {
        this.store = store;
        this.config = {
            trialDays: 14,
            revalidateDays: 7,
            offlineGraceDays: 30,
            ...config,
        };
        this.deviceId = deviceId;
        this.deviceName = deviceName;
        this.fetch = fetchImpl;
        this.now = now;

        if (!this.store.get('firstRun')) {
            this.store.set('firstRun', this.now());
        }
    }

    readLicense() {
        const stored = this.store.get('license');
        if (!stored || !stored.payload || !stored.signature) {
            return null;
        }
        if (!verifySignature(stored.payload, stored.signature, this.config.publicKey)) {
            return null;
        }
        let payload;
        try {
            payload = JSON.parse(stored.payload);
        } catch {
            return null;
        }
        if (payload.device_id !== this.deviceId || payload.product !== this.config.product) {
            return null;
        }
        return { payload, lastValidated: stored.lastValidated || 0 };
    }

    state() {
        const now = this.now();
        const license = this.readLicense();

        if (license) {
            const { payload, lastValidated } = license;
            const expiresAt = payload.expires_at ? Date.parse(payload.expires_at) : null;
            const base = {
                key: maskKey(payload.license_key),
                customer: payload.customer || '',
                expiresAt: payload.expires_at || null,
                maxActivations: payload.max_activations || 1,
            };

            if (expiresAt && now > expiresAt) {
                return { ...base, status: 'expired', fullAccess: false, message: 'Deine Lizenz ist abgelaufen. Bitte verlängere sie im Shop.' };
            }
            if (now - lastValidated > this.config.offlineGraceDays * DAY) {
                return { ...base, status: 'offline', fullAccess: false, message: 'Die Lizenz konnte länger nicht geprüft werden. Bitte verbinde den PC mit dem Internet.' };
            }
            return { ...base, status: 'licensed', fullAccess: true };
        }

        const used = Math.floor((now - this.store.get('firstRun')) / DAY);
        const daysLeft = Math.max(0, this.config.trialDays - used);
        return daysLeft > 0
            ? { status: 'trial', fullAccess: true, daysLeft }
            : { status: 'trial-ended', fullAccess: false, daysLeft: 0, message: 'Die Testphase ist abgelaufen. Bitte gib einen Lizenzschlüssel ein.' };
    }

    /** Lizenzschlüssel, solange eine gültige Vollversion aktiv ist. */
    licenseKey() {
        const license = this.readLicense();
        return license && this.state().status === 'licensed' ? license.payload.license_key : null;
    }

    async request(action, body) {
        if (!this.config.serverUrl) {
            throw new Error('Es ist kein Lizenzserver konfiguriert.');
        }

        let url = this.config.serverUrl.replace(/\/$/, '') + '/wp-json/onepc/v1/' + action;
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, product: this.config.product, device_id: this.deviceId }),
            // Weiterleitungen selbst folgen: fetch würde bei 301/302 aus POST ein GET machen.
            redirect: 'manual',
        };

        let response;
        try {
            for (let hops = 0; ; hops++) {
                response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
                const location = response.headers && response.headers.get && response.headers.get('location');
                if (response.status < 300 || response.status >= 400 || !location || hops >= 3) {
                    break;
                }
                url = new URL(location, url).toString();
            }
        } catch {
            const error = new Error('Der Lizenzserver ist nicht erreichbar. Bitte prüfe die Internetverbindung.');
            error.code = 'network';
            throw error;
        }

        let data = {};
        try {
            data = await response.json();
        } catch {
            // Antwort ohne JSON, unten als Fehler behandelt.
        }

        if (!response.ok) {
            const error = new Error(data.message || `Der Lizenzserver meldet einen Fehler (HTTP ${response.status}).`);
            error.code = data.code || 'server';
            throw error;
        }
        return data;
    }

    acceptSignedResponse(data) {
        if (!data.payload || !data.signature || !verifySignature(data.payload, data.signature, this.config.publicKey)) {
            throw new Error('Die Antwort des Lizenzservers ist ungültig (Signatur stimmt nicht).');
        }
        this.store.set('license', { payload: data.payload, signature: data.signature, lastValidated: this.now() });
        if (!this.readLicense()) {
            this.store.set('license', undefined);
            throw new Error('Die Lizenz passt nicht zu diesem Gerät oder Produkt.');
        }
    }

    async activate(licenseKey) {
        const key = String(licenseKey || '').trim().toUpperCase();
        if (!/^[A-Z0-9]+(-[A-Z0-9]+){3,}$/.test(key)) {
            throw new Error('Bitte gib den Lizenzschlüssel vollständig ein (z. B. OPC-XXXX-XXXX-XXXX-XXXX).');
        }
        const data = await this.request('activate', { license_key: key, device_name: this.deviceName });
        this.acceptSignedResponse(data);
        return this.state();
    }

    /**
     * Prüft die Lizenz regelmäßig online. Ohne Internet bleibt sie bis zum Ablauf
     * der Offline-Frist gültig.
     */
    async refresh({ force = false } = {}) {
        const license = this.readLicense();
        if (!license) {
            return this.state();
        }
        if (!force && this.now() - license.lastValidated < this.config.revalidateDays * DAY) {
            return this.state();
        }

        try {
            const data = await this.request('validate', { license_key: license.payload.license_key });
            this.acceptSignedResponse(data);
        } catch (error) {
            if (STOP_CODES.includes(error.code)) {
                this.store.set('license', undefined);
            }
        }
        return this.state();
    }

    async deactivate() {
        const license = this.readLicense();
        if (license) {
            try {
                await this.request('deactivate', { license_key: license.payload.license_key });
            } catch (error) {
                // Ist die Lizenz auf dem Server ohnehin nicht mehr aktiv, trotzdem lokal entfernen.
                if (!STOP_CODES.includes(error.code)) {
                    throw error;
                }
            }
        }
        this.store.set('license', undefined);
        return this.state();
    }
}

module.exports = { LicenseManager, verifySignature, getDeviceId, maskKey };
