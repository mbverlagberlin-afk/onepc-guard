'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isWindows, runPowerShell } = require('./powershell');

const HOUR = 60 * 60 * 1000;

/**
 * Bereiche, die gefahrlos geleert werden können. Ein "*" im Pfad steht für
 * beliebige Unterordner (z. B. mehrere Browser-Profile).
 * minAgeHours schützt Dateien, die gerade noch benutzt werden könnten.
 */
function cleanupTargets(env = process.env) {
    const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const windir = env.SystemRoot || 'C:\\Windows';
    const programData = env.ProgramData || 'C:\\ProgramData';

    const chromium = (base) => ['Cache', 'Code Cache', 'GPUCache'].map((dir) => path.join(base, 'User Data', '*', dir));

    return [
        {
            id: 'usertemp',
            label: 'Temporäre Dateien (Benutzer)',
            description: 'Reste von Installationen und Programmen. Nur Dateien älter als 24 Stunden.',
            patterns: [env.TEMP || os.tmpdir()],
            minAgeHours: 24,
        },
        {
            id: 'wintemp',
            label: 'Temporäre Dateien (Windows)',
            description: 'Temporärer Ordner von Windows. Nur Dateien älter als 24 Stunden.',
            patterns: [path.join(windir, 'Temp')],
            minAgeHours: 24,
        },
        {
            id: 'chrome',
            label: 'Google Chrome – Zwischenspeicher',
            description: 'Gespeicherte Webseiten-Daten. Logins und Lesezeichen bleiben erhalten. Chrome vorher schließen.',
            patterns: chromium(path.join(local, 'Google', 'Chrome')),
            minAgeHours: 0,
        },
        {
            id: 'edge',
            label: 'Microsoft Edge – Zwischenspeicher',
            description: 'Gespeicherte Webseiten-Daten. Logins und Favoriten bleiben erhalten. Edge vorher schließen.',
            patterns: chromium(path.join(local, 'Microsoft', 'Edge')),
            minAgeHours: 0,
        },
        {
            id: 'firefox',
            label: 'Firefox – Zwischenspeicher',
            description: 'Gespeicherte Webseiten-Daten. Logins und Lesezeichen bleiben erhalten. Firefox vorher schließen.',
            patterns: [path.join(local, 'Mozilla', 'Firefox', 'Profiles', '*', 'cache2')],
            minAgeHours: 0,
        },
        {
            id: 'crashdumps',
            label: 'Absturzberichte',
            description: 'Fehlerberichte und Speicherabbilder abgestürzter Programme.',
            patterns: [
                path.join(local, 'CrashDumps'),
                path.join(programData, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
                path.join(programData, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
            ],
            minAgeHours: 0,
        },
    ];
}

async function expandPattern(pattern) {
    const parts = pattern.split(/[\\/]/);
    const star = parts.indexOf('*');
    if (star === -1) {
        return [pattern];
    }

    const base = parts.slice(0, star).join(path.sep) || path.sep;
    const rest = parts.slice(star + 1).join(path.sep);
    let entries;
    try {
        entries = await fs.promises.readdir(base, { withFileTypes: true });
    } catch {
        return [];
    }

    const results = [];
    for (const entry of entries) {
        if (entry.isDirectory()) {
            results.push(...await expandPattern(path.join(base, entry.name, rest)));
        }
    }
    return results;
}

/**
 * Durchläuft einen Ordner und ruft onFile(fullPath, stat) für jede Datei auf.
 * Symbolische Links und Junctions werden nicht verfolgt.
 */
async function walk(dir, onFile, { skipDir } = {}) {
    let entries;
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            continue;
        }
        if (entry.isDirectory()) {
            if (!skipDir || !skipDir(full, entry.name)) {
                await walk(full, onFile, { skipDir });
            }
        } else if (entry.isFile()) {
            let stat;
            try {
                stat = await fs.promises.lstat(full);
            } catch {
                continue;
            }
            await onFile(full, stat);
        }
    }
}

async function targetDirs(target) {
    const dirs = [];
    for (const pattern of target.patterns) {
        for (const dir of await expandPattern(pattern)) {
            if (fs.existsSync(dir)) {
                dirs.push(dir);
            }
        }
    }
    return dirs;
}

function isEligible(stat, target, now) {
    return !target.minAgeHours || now - stat.mtimeMs >= target.minAgeHours * HOUR;
}

async function recycleBinSize() {
    if (!isWindows) {
        return 0;
    }
    const out = await runPowerShell(String.raw`
$sum = 0
(New-Object -ComObject Shell.Application).NameSpace(0xA).Items() | ForEach-Object { $sum += $_.Size }
$sum`).catch(() => '0');
    return Number(out) || 0;
}

async function analyze({ env = process.env, now = Date.now() } = {}) {
    const results = [];

    for (const target of cleanupTargets(env)) {
        let size = 0;
        let files = 0;
        for (const dir of await targetDirs(target)) {
            await walk(dir, (file, stat) => {
                if (isEligible(stat, target, now)) {
                    size += stat.size;
                    files++;
                }
            });
        }
        results.push({ id: target.id, label: target.label, description: target.description, size, files });
    }

    if (isWindows) {
        results.push({
            id: 'recyclebin',
            label: 'Papierkorb',
            description: 'Gelöschte Dateien im Papierkorb werden endgültig entfernt.',
            size: await recycleBinSize(),
            files: null,
        });
    }

    return results;
}

async function removeEmptyDirs(dir, isRoot = true) {
    let entries;
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            await removeEmptyDirs(path.join(dir, entry.name), false);
        }
    }
    if (!isRoot) {
        await fs.promises.rmdir(dir).catch(() => {});
    }
}

async function clean(ids, { env = process.env, now = Date.now() } = {}) {
    const selected = new Set(ids);
    let freed = 0;
    let deleted = 0;
    let failed = 0;

    for (const target of cleanupTargets(env)) {
        if (!selected.has(target.id)) {
            continue;
        }
        for (const dir of await targetDirs(target)) {
            await walk(dir, async (file, stat) => {
                if (!isEligible(stat, target, now)) {
                    return;
                }
                try {
                    await fs.promises.unlink(file);
                    freed += stat.size;
                    deleted++;
                } catch {
                    failed++; // Datei ist gerade in Benutzung.
                }
            });
            await removeEmptyDirs(dir);
        }
    }

    if (selected.has('recyclebin') && isWindows) {
        const size = await recycleBinSize();
        await runPowerShell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue').catch(() => {});
        freed += size - await recycleBinSize();
    }

    return { freed, deleted, failed };
}

/**
 * Sucht die größten Dateien im Benutzerordner (ohne AppData und versteckte Ordner).
 */
async function findLargeFiles({ root = os.homedir(), minBytes = 500 * 1024 * 1024, limit = 50 } = {}) {
    const found = [];
    await walk(root, (file, stat) => {
        if (stat.size >= minBytes) {
            found.push({ path: file, size: stat.size, modified: stat.mtime.toISOString() });
        }
    }, {
        skipDir: (full, name) => name === 'AppData' || name.startsWith('.') || name === 'node_modules',
    });

    return found.sort((a, b) => b.size - a.size).slice(0, limit);
}

module.exports = { cleanupTargets, analyze, clean, findLargeFiles, walk };
