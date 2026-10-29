'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { LicenseManager, verifySignature, maskKey } = require('../src/lib/license');

const DAY = 86400000;
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
const DEVICE = 'a'.repeat(32);
const KEY = 'OPC-ABCD-EFGH-JKLM-NPQR';

function memoryStore() {
    const data = {};
    return { get: (k) => data[k], set: (k, v) => { if (v === undefined) delete data[k]; else data[k] = v; }, data };
}

function signed(overrides = {}) {
    const payload = JSON.stringify({ product: 'onepc-guard', license_key: KEY, device_id: DEVICE, status: 'active', expires_at: null, customer: 'Max Muster', max_activations: 2, ...overrides });
    return { payload, signature: crypto.sign(null, Buffer.from(payload), privateKey).toString('base64') };
}

function server(handler) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ action: url.split('/').pop(), body });
        const [status, data] = handler(url.split('/').pop(), body);
        return { ok: status < 300, status, json: async () => data };
    };
    return { fetchImpl, calls };
}

function manager(store, fetchImpl, clock) {
    return new LicenseManager({
        store,
        config: { product: 'onepc-guard', serverUrl: 'https://shop.example', publicKey: PUBLIC, trialDays: 14 },
        deviceId: DEVICE,
        deviceName: 'TEST-PC',
        fetchImpl,
        now: () => clock.t,
    });
}

test('Signaturprüfung erkennt Manipulation', () => {
    const s = signed();
    assert.ok(verifySignature(s.payload, s.signature, PUBLIC));
    assert.ok(!verifySignature(s.payload.replace('"max_activations":2', '"max_activations":99'), s.signature, PUBLIC));
    assert.ok(!verifySignature(s.payload, s.signature, ''));
});

test('Testphase läuft 14 Tage und sperrt danach', () => {
    const clock = { t: Date.parse('2026-10-01') };
    const store = memoryStore();
    const lm = manager(store, null, clock);
    assert.deepStrictEqual([lm.state().status, lm.state().daysLeft, lm.state().fullAccess], ['trial', 14, true]);
    clock.t += 13 * DAY;
    assert.strictEqual(lm.state().daysLeft, 1);
    clock.t += DAY;
    assert.deepStrictEqual([lm.state().status, lm.state().fullAccess], ['trial-ended', false]);
});

test('Aktivierung, Offline-Nutzung, Sperre und Deaktivierung', async () => {
    const clock = { t: Date.parse('2026-10-01') };
    const store = memoryStore();
    let mode = 'ok';
    const { fetchImpl, calls } = server((action, body) => {
        assert.strictEqual(body.device_id, DEVICE);
        assert.strictEqual(body.product, 'onepc-guard');
        if (mode === 'revoked') return [403, { code: 'revoked', message: 'gesperrt' }];
        if (action === 'deactivate') return [200, { success: true }];
        return [200, signed()];
    });
    const lm = manager(store, fetchImpl, clock);

    await assert.rejects(lm.activate('quatsch'), /vollständig/);
    const state = await lm.activate(' opc-abcd-efgh-jklm-npqr ');
    assert.strictEqual(state.status, 'licensed');
    assert.strictEqual(state.key, 'OPC-****-****-****-NPQR');
    assert.strictEqual(calls[0].body.license_key, KEY);
    assert.strictEqual(calls[0].body.device_name, 'TEST-PC');

    // Nach Ablauf der Testphase weiterhin lizenziert
    clock.t += 20 * DAY;
    assert.strictEqual(lm.state().status, 'licensed');

    // Server nicht erreichbar → nach 30 Tagen ohne Prüfung gesperrt
    const offline = manager(store, async () => { throw new Error('offline'); }, clock);
    await offline.refresh();
    assert.strictEqual(offline.state().status, 'licensed');
    clock.t += 11 * DAY;
    assert.strictEqual(offline.state().status, 'offline');
    assert.strictEqual(offline.state().fullAccess, false);

    // Wieder online → Prüfung erneuert die Lizenz
    await lm.refresh();
    assert.strictEqual(lm.state().status, 'licensed');

    // Gesperrt auf dem Server → lokale Lizenz wird entfernt
    mode = 'revoked';
    clock.t += 8 * DAY;
    await lm.refresh();
    assert.strictEqual(lm.state().status, 'trial-ended');

    mode = 'ok';
    await lm.activate(KEY);
    await lm.deactivate();
    assert.strictEqual(calls.at(-1).action, 'deactivate');
    assert.strictEqual(store.get('license'), undefined);
});

test('gefälschte oder fremde Lizenzen werden abgelehnt', async () => {
    const clock = { t: Date.parse('2026-10-01') };
    const store = memoryStore();
    const forged = signed();
    forged.payload = forged.payload.replace('Max Muster', 'Hacker');
    let lm = manager(store, server(() => [200, forged]).fetchImpl, clock);
    await assert.rejects(lm.activate(KEY), /Signatur/);
    assert.strictEqual(lm.state().status, 'trial');

    lm = manager(store, server(() => [200, signed({ device_id: 'b'.repeat(32) })]).fetchImpl, clock);
    await assert.rejects(lm.activate(KEY), /Gerät/);

    store.set('license', { ...signed({ expires_at: '2026-09-01T00:00:00Z' }), lastValidated: clock.t });
    assert.strictEqual(lm.state().status, 'expired');

    lm = manager(store, server(() => [403, { code: 'too_many_activations', message: 'Bereits auf 2 PC(s) aktiv.' }]).fetchImpl, clock);
    store.set('license', undefined);
    await assert.rejects(lm.activate(KEY), /2 PC/);
});

test('maskKey', () => {
    assert.strictEqual(maskKey('OPC-AAAA-BBBB-CCCC-DDDD'), 'OPC-****-****-****-DDDD');
});

test('folgt Weiterleitungen (z. B. www → ohne www) und bleibt dabei bei POST', async () => {
    const clock = { t: Date.parse('2026-10-01') };
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, method: options.method, redirect: options.redirect });
        if (url.startsWith('https://www.')) {
            return { ok: false, status: 301, headers: new Map([['location', url.replace('https://www.', 'https://')]]), json: async () => ({}) };
        }
        return { ok: true, status: 200, headers: new Map(), json: async () => signed() };
    };
    const lm = new LicenseManager({
        store: memoryStore(),
        config: { product: 'onepc-guard', serverUrl: 'https://www.shop.example', publicKey: PUBLIC },
        deviceId: DEVICE, fetchImpl, now: () => clock.t,
    });
    assert.strictEqual((await lm.activate(KEY)).status, 'licensed');
    assert.deepStrictEqual(calls.map((c) => [c.url, c.method, c.redirect]), [
        ['https://www.shop.example/wp-json/onepc/v1/activate', 'POST', 'manual'],
        ['https://shop.example/wp-json/onepc/v1/activate', 'POST', 'manual'],
    ]);
});
