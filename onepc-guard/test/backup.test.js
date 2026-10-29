'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runBackup, restore, listVersions, backupRoot, sourceFolderName } = require('../src/lib/backup');

function write(p, content, mtime) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    if (mtime) {
        fs.utimesSync(p, mtime, mtime);
    }
}

test('sichert, erkennt Änderungen, bewahrt alte Fassungen und stellt wieder her', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onepc-backup-'));
    const docs = path.join(root, 'Dokumente');
    const target = path.join(root, 'USB');
    fs.mkdirSync(target);

    write(path.join(docs, 'brief.txt'), 'Version 1', new Date('2026-01-01'));
    write(path.join(docs, 'fotos', 'bild.jpg'), 'JPG');
    write(path.join(docs, '~$brief.docx'), 'Office-Sperrdatei');

    const t1 = Date.parse('2026-10-01T10:00:00');
    let stats = await runBackup({ sources: [docs], target, now: t1 });
    assert.strictEqual(stats.copied, 2);
    assert.strictEqual(stats.failed, 0);

    const current = path.join(backupRoot(target), 'Aktuell', sourceFolderName(docs));
    assert.strictEqual(fs.readFileSync(path.join(current, 'brief.txt'), 'utf8'), 'Version 1');
    assert.ok(!fs.existsSync(path.join(current, '~$brief.docx')));

    // Zweiter Lauf ohne Änderung: nichts kopiert
    stats = await runBackup({ sources: [docs], target, now: t1 + 1000 });
    assert.strictEqual(stats.copied, 0);
    assert.strictEqual(stats.unchanged, 2);

    // Änderung + Löschung
    write(path.join(docs, 'brief.txt'), 'Version 2 (länger)');
    fs.rmSync(path.join(docs, 'fotos', 'bild.jpg'));
    const t2 = Date.parse('2026-10-02T10:00:00');
    stats = await runBackup({ sources: [docs], target, now: t2 });
    assert.strictEqual(stats.copied, 1);
    assert.strictEqual(stats.versioned, 2);
    assert.strictEqual(fs.readFileSync(path.join(current, 'brief.txt'), 'utf8'), 'Version 2 (länger)');
    assert.ok(!fs.existsSync(path.join(current, 'fotos', 'bild.jpg')));

    const versions = await listVersions(target);
    assert.strictEqual(versions.length, 1);
    const old = path.join(versions[0].path, sourceFolderName(docs));
    assert.strictEqual(fs.readFileSync(path.join(old, 'brief.txt'), 'utf8'), 'Version 1');
    assert.strictEqual(fs.readFileSync(path.join(old, 'fotos', 'bild.jpg'), 'utf8'), 'JPG');

    // Alte Fassungen werden nach keepDays entfernt
    stats = await runBackup({ sources: [docs], target, keepDays: 30, now: t2 + 31 * 86400000 });
    assert.strictEqual(stats.prunedVersions, 1);

    // Wiederherstellen in neuen Ordner
    const dest = path.join(root, 'Wiederhergestellt');
    await restore({ target, source: docs, destination: dest });
    assert.strictEqual(fs.readFileSync(path.join(dest, 'brief.txt'), 'utf8'), 'Version 2 (länger)');

    assert.ok(JSON.parse(fs.readFileSync(path.join(backupRoot(target), 'backup-info.json'), 'utf8')).lastRun);
    fs.rmSync(root, { recursive: true, force: true });
});

test('verhindert Sicherung in den eigenen Quellordner', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onepc-backup-'));
    await assert.rejects(runBackup({ sources: [root], target: path.join(root) }), /Speicherort darf nicht/);
    fs.mkdirSync(path.join(root, 'inner'));
    await assert.rejects(runBackup({ sources: [path.join(root, 'inner')], target: root }), /gesicherte Ordner darf nicht/);
    await assert.rejects(runBackup({ sources: [root], target: path.join(root, 'fehlt') }), /nicht erreichbar/);
    fs.rmSync(root, { recursive: true, force: true });
});
