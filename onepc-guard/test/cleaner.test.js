'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze, clean } = require('../src/lib/cleaner');

function file(p, size, ageHours = 0) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(size));
    const t = new Date(Date.now() - ageHours * 3600 * 1000);
    fs.utimesSync(p, t, t);
}

test('analysiert und leert nur erlaubte Bereiche', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onepc-clean-'));
    const env = {
        TEMP: path.join(root, 'Temp'),
        LOCALAPPDATA: path.join(root, 'Local'),
        SystemRoot: path.join(root, 'Windows'),
        ProgramData: path.join(root, 'ProgramData'),
    };

    file(path.join(env.TEMP, 'alt.tmp'), 1000, 48);
    file(path.join(env.TEMP, 'sub', 'alt2.tmp'), 500, 48);
    file(path.join(env.TEMP, 'neu.tmp'), 300, 1);                   // jünger als 24 h → bleibt
    file(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache', 'a'), 2000);
    file(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Profile 1', 'Code Cache', 'b'), 700);
    file(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'), 50); // nicht im Cache → bleibt
    const keep = path.join(root, 'Dokumente', 'wichtig.docx');
    file(keep, 999, 100);

    const result = await analyze({ env });
    const get = (id) => result.find((r) => r.id === id);
    assert.strictEqual(get('usertemp').size, 1500);
    assert.strictEqual(get('usertemp').files, 2);
    assert.strictEqual(get('chrome').size, 2700);
    assert.strictEqual(get('edge').size, 0);

    const done = await clean(['usertemp', 'chrome'], { env });
    assert.strictEqual(done.freed, 4200);
    assert.strictEqual(done.deleted, 4);

    assert.ok(fs.existsSync(path.join(env.TEMP, 'neu.tmp')));
    assert.ok(fs.existsSync(env.TEMP), 'Wurzelordner bleibt erhalten');
    assert.ok(!fs.existsSync(path.join(env.TEMP, 'sub')), 'leere Unterordner werden entfernt');
    assert.ok(fs.existsSync(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks')));
    assert.ok(fs.existsSync(keep));

    fs.rmSync(root, { recursive: true, force: true });
});
