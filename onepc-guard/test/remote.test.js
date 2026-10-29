'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { RemoteLink } = require('../src/lib/remote');

function link(overrides = {}) {
    const requests = [];
    const replies = overrides.replies || [];
    const executed = [];
    const r = new RemoteLink({
        request: async (action, body) => {
            requests.push({ action, body: JSON.parse(JSON.stringify(body)) });
            const reply = replies.shift();
            if (reply instanceof Error) throw reply;
            return reply || { commands: [], poll_seconds: 60 };
        },
        licenseKey: () => ('key' in overrides ? overrides.key : 'OPC-AAAA-BBBB-CCCC-DDDD'),
        isEnabled: () => overrides.enabled !== false,
        getStatus: async () => ({ score: 90 }),
        execute: overrides.execute || (async (type) => { executed.push(type); return { ok: type }; }),
    });
    r.schedule = () => {}; // Zeitsteuerung im Test von Hand
    return { r, requests, executed };
}

test('ohne Lizenz oder ausgeschaltet wird nichts gesendet', async () => {
    for (const opts of [{ key: null }, { enabled: false }]) {
        const { r, requests } = link(opts);
        await r.tick();
        assert.strictEqual(requests.length, 0);
        assert.strictEqual(r.state.connected, false);
    }
});

test('meldet Status, führt Aufträge nacheinander aus und meldet Ergebnisse', async () => {
    const { r, requests, executed } = link({
        replies: [{ commands: [{ id: 7, type: 'scan-quick' }, { id: 8, type: 'clean' }, { id: 9, type: 'format-c' }], poll_seconds: 30 }],
    });
    await r.tick();
    assert.strictEqual(requests[0].action, 'device/sync');
    assert.strictEqual(requests[0].body.license_key, 'OPC-AAAA-BBBB-CCCC-DDDD');
    assert.deepStrictEqual(requests[0].body.status, { score: 90, busy: null });
    assert.strictEqual(r.state.connected, true);
    assert.strictEqual(r.intervalMs, 30000);

    // Warteschlange abarbeiten lassen
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(executed, ['scan-quick', 'clean'], 'unbekannte Aufträge werden nicht ausgeführt');

    await r.tick();
    const results = requests[1].body.results;
    assert.deepStrictEqual(results.find((x) => x.id === 9), { id: 9, state: 'failed', result: { message: 'Unbekannter Auftrag.' } });
    assert.deepStrictEqual(results.filter((x) => x.id === 7).map((x) => x.state), ['running', 'done']);
    assert.deepStrictEqual(results.find((x) => x.id === 8 && x.state === 'done').result, { ok: 'clean' });

    // Gesendete Ergebnisse werden nicht doppelt geschickt
    await r.tick();
    assert.deepStrictEqual(requests[2].body.results, []);
});

test('Fehler bei der Ausführung werden als failed gemeldet, Netzfehler behalten Ergebnisse', async () => {
    const { r, requests } = link({
        replies: [{ commands: [{ id: 1, type: 'scan-full' }] }, new Error('offline')],
        execute: async () => { throw new Error('Defender nicht verfügbar'); },
    });
    await r.tick();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    await r.tick(); // schlägt fehl
    assert.strictEqual(r.state.connected, false);
    assert.strictEqual(r.state.error, 'offline');

    await r.tick(); // nächster Versuch enthält die Ergebnisse noch
    const results = requests[2].body.results;
    assert.deepStrictEqual(results.map((x) => x.state), ['running', 'failed']);
    assert.strictEqual(results[1].result.message, 'Defender nicht verfügbar');
});

test('derselbe Auftrag wird nur einmal ausgeführt', async () => {
    const { r, executed } = link({
        replies: [{ commands: [{ id: 5, type: 'clean' }] }, { commands: [{ id: 5, type: 'clean' }] }],
    });
    await r.tick();
    await r.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(executed, ['clean']);
});
