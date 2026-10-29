'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { walk } = require('./cleaner');

/*
 * Aufbau des Sicherungsziels:
 *
 *   <Ziel>/OnePC-Backup/
 *     Aktuell/<Ordnername>_<kennung>/...      aktueller Stand jeder Quelle
 *     Versionen/<Zeitpunkt>/<Ordnername>_.../ ältere Fassungen geänderter oder gelöschter Dateien
 *     backup-info.json                        Quellen und Ergebnis des letzten Laufs
 */

const ROOT_NAME = 'OnePC-Backup';
const DAY = 24 * 60 * 60 * 1000;
const SKIP_FILES = /^(~\$.*|thumbs\.db|desktop\.ini|\.ds_store)$/i;

function backupRoot(target) {
    return path.join(target, ROOT_NAME);
}

function sourceFolderName(source) {
    const resolved = path.resolve(source);
    const base = path.basename(resolved).replace(/[<>:"/\\|?*]+/g, '') || 'Laufwerk-' + resolved.replace(/[^A-Za-z0-9]/g, '');
    const id = crypto.createHash('sha1').update(resolved.toLowerCase()).digest('hex').slice(0, 6);
    return `${base}_${id}`;
}

function timestamp(now) {
    const d = new Date(now);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function parseTimestamp(name) {
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(name);
    return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN;
}

function isInside(child, parent) {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function validate(sources, target) {
    if (!target) {
        throw new Error('Bitte einen Speicherort für die Sicherung wählen.');
    }
    if (!sources || !sources.length) {
        throw new Error('Bitte mindestens einen Ordner zum Sichern auswählen.');
    }
    if (!fs.existsSync(target)) {
        throw new Error('Der Speicherort ist nicht erreichbar. Ist die Festplatte angeschlossen?');
    }
    for (const source of sources) {
        if (isInside(target, source)) {
            throw new Error(`Der Speicherort darf nicht im gesicherten Ordner liegen: ${source}`);
        }
        if (isInside(source, target)) {
            throw new Error(`Der gesicherte Ordner darf nicht im Speicherort liegen: ${source}`);
        }
    }
}

async function moveFile(from, to) {
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    try {
        await fs.promises.rename(from, to);
    } catch {
        await fs.promises.copyFile(from, to);
        await fs.promises.unlink(from);
    }
}

async function copyFile(from, to, stat) {
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(from, to);
    await fs.promises.utimes(to, stat.atime, stat.mtime);
}

function unchanged(a, b) {
    // 2 Sekunden Toleranz wegen der Zeitauflösung von FAT32/exFAT-Laufwerken.
    return a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 2000;
}

async function pruneVersions(versionsDir, keepDays, now) {
    let removed = 0;
    let entries = [];
    try {
        entries = await fs.promises.readdir(versionsDir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        const time = parseTimestamp(entry.name);
        if (entry.isDirectory() && !Number.isNaN(time) && now - time > keepDays * DAY) {
            await fs.promises.rm(path.join(versionsDir, entry.name), { recursive: true, force: true });
            removed++;
        }
    }
    return removed;
}

async function runBackup({ sources, target, keepDays = 30, onProgress = () => {}, now = Date.now() }) {
    validate(sources, target);

    const root = backupRoot(target);
    const currentDir = path.join(root, 'Aktuell');
    const versionDir = path.join(root, 'Versionen', timestamp(now));
    const stats = { copied: 0, unchanged: 0, versioned: 0, failed: 0, bytes: 0, errors: [] };
    const fail = (file, error) => {
        stats.failed++;
        if (stats.errors.length < 20) {
            stats.errors.push(`${file}: ${error.message}`);
        }
    };

    for (const source of sources) {
        if (!fs.existsSync(source)) {
            fail(source, new Error('Ordner nicht gefunden'));
            continue;
        }

        const name = sourceFolderName(source);
        const dest = path.join(currentDir, name);
        const seen = new Set();
        let processed = 0;

        await walk(source, async (file, stat) => {
            if (SKIP_FILES.test(path.basename(file))) {
                return;
            }
            const rel = path.relative(source, file);
            const destFile = path.join(dest, rel);
            seen.add(rel.toLowerCase());

            try {
                const existing = await fs.promises.stat(destFile).catch(() => null);
                if (existing && unchanged(stat, existing)) {
                    stats.unchanged++;
                } else {
                    if (existing) {
                        await moveFile(destFile, path.join(versionDir, name, rel));
                        stats.versioned++;
                    }
                    await copyFile(file, destFile, stat);
                    stats.copied++;
                    stats.bytes += stat.size;
                }
            } catch (error) {
                fail(file, error);
            }

            if (++processed % 50 === 0) {
                onProgress({ source, processed, copied: stats.copied });
            }
        });

        // Im Original gelöschte Dateien wandern in die Versionen, statt verloren zu gehen.
        await walk(dest, async (file) => {
            const rel = path.relative(dest, file);
            if (!seen.has(rel.toLowerCase())) {
                try {
                    await moveFile(file, path.join(versionDir, name, rel));
                    stats.versioned++;
                } catch (error) {
                    fail(file, error);
                }
            }
        });

        onProgress({ source, processed, copied: stats.copied });
    }

    stats.prunedVersions = await pruneVersions(path.join(root, 'Versionen'), keepDays, now);

    const info = {
        lastRun: new Date(now).toISOString(),
        sources: sources.map((source) => ({ path: source, folder: sourceFolderName(source) })),
        stats: { ...stats, errors: stats.errors.slice(0, 5) },
    };
    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.writeFile(path.join(root, 'backup-info.json'), JSON.stringify(info, null, 2));

    return stats;
}

async function listVersions(target) {
    const versionsDir = path.join(backupRoot(target), 'Versionen');
    try {
        const entries = await fs.promises.readdir(versionsDir, { withFileTypes: true });
        return entries
            .filter((e) => e.isDirectory() && !Number.isNaN(parseTimestamp(e.name)))
            .map((e) => ({ name: e.name, time: new Date(parseTimestamp(e.name)).toISOString(), path: path.join(versionsDir, e.name) }))
            .sort((a, b) => b.time.localeCompare(a.time));
    } catch {
        return [];
    }
}

/**
 * Stellt den gesicherten Stand einer Quelle in einen Zielordner wieder her.
 * Vorhandene Dateien im Zielordner werden nicht überschrieben.
 */
async function restore({ target, source, destination }) {
    const from = path.join(backupRoot(target), 'Aktuell', sourceFolderName(source));
    if (!fs.existsSync(from)) {
        throw new Error('Für diesen Ordner gibt es noch keine Sicherung.');
    }
    await fs.promises.cp(from, destination, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true });
    return destination;
}

module.exports = { runBackup, restore, listVersions, backupRoot, sourceFolderName, validate };
