'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluate, decodeProductState } = require('../src/lib/security');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const healthy = {
    os: { caption: 'Microsoft Windows 11 Pro', build: 26100 },
    defender: { service: true, enabled: true, realtime: true, signatureAgeDays: 0, quickScanAgeDays: 3 },
    antivirus: [{ name: 'Windows Defender', state: 397568 }],
    firewall: [{ name: 'Domain', enabled: true }, { name: 'Private', enabled: true }, { name: 'Public', enabled: true }],
    lastUpdate: '2026-10-20T08:00:00Z',
    pendingReboot: false,
    uac: 1,
    rdpDenied: 1,
    bitlocker: 1,
    disk: { drive: 'C:', size: 500e9, free: 200e9 },
    startup: [{ name: 'OneDrive', command: 'x', location: 'HKU' }],
};

const byId = (result, id) => result.checks.find((c) => c.id === id);

test('gesunder PC erreicht 100 Punkte', () => {
    const result = evaluate(healthy, NOW);
    assert.strictEqual(result.score, 100);
    assert.ok(result.checks.every((c) => c.status === 'ok'));
});

test('ausgeschalteter Echtzeitschutz und Firewall werden als kritisch erkannt', () => {
    const result = evaluate({
        ...healthy,
        defender: { ...healthy.defender, realtime: false },
        firewall: [{ name: 'Public', enabled: false }, { name: 'Private', enabled: true }],
    }, NOW);
    assert.strictEqual(byId(result, 'antivirus').status, 'bad');
    assert.strictEqual(byId(result, 'firewall').status, 'bad');
    assert.match(byId(result, 'firewall').detail, /öffentliches Netzwerk/);
    assert.ok(result.score < 60, 'kritische Punkte begrenzen die Bewertung');
});

test('aktiver Fremd-Virenschutz ersetzt Defender-Prüfungen', () => {
    // 266240 = 0x041000: aktiv, aktuell
    const result = evaluate({ ...healthy, defender: { ...healthy.defender, enabled: false, realtime: false }, antivirus: [{ name: 'Avira Security', state: 266240 }] }, NOW);
    assert.strictEqual(byId(result, 'antivirus').status, 'ok');
    assert.match(byId(result, 'antivirus').detail, /Avira/);
    assert.strictEqual(byId(result, 'signatures'), undefined);
});

test('alte Signaturen, alte Updates, Windows 10 und wenig Speicher', () => {
    const result = evaluate({
        ...healthy,
        os: { caption: 'Microsoft Windows 10 Home' },
        defender: { ...healthy.defender, signatureAgeDays: 9, quickScanAgeDays: 40 },
        lastUpdate: '2026-07-01T00:00:00Z',
        bitlocker: null,
        disk: { drive: 'C:', size: 100e9, free: 3e9 },
        startup: new Array(20).fill({ name: 'x', command: 'y' }),
    }, NOW);
    assert.strictEqual(byId(result, 'signatures').status, 'bad');
    assert.strictEqual(byId(result, 'signatures').action.type, 'defender-update');
    assert.strictEqual(byId(result, 'lastscan').status, 'warn');
    assert.strictEqual(byId(result, 'updates').status, 'bad');
    assert.strictEqual(byId(result, 'os').status, 'warn');
    assert.strictEqual(byId(result, 'encryption').status, 'unknown');
    assert.strictEqual(byId(result, 'disk').status, 'bad');
    assert.strictEqual(byId(result, 'startup').status, 'warn');
});

test('fehlende Daten führen nicht zum Absturz', () => {
    const result = evaluate({}, NOW);
    assert.strictEqual(byId(result, 'antivirus').status, 'bad');
    assert.ok(Number.isInteger(result.score));
});

test('productState wird korrekt dekodiert', () => {
    assert.deepStrictEqual(decodeProductState(397568), { enabled: true, upToDate: true });   // 0x061100
    assert.deepStrictEqual(decodeProductState(393472), { enabled: false, upToDate: true });  // 0x060100
    assert.deepStrictEqual(decodeProductState(397584), { enabled: true, upToDate: false });  // 0x061110
});
