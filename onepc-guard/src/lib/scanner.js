'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { isWindows, runPowerShell, runPowerShellJson } = require('./powershell');

// Der Scan nutzt die Erkennung von Microsoft Defender. OnePC Guard bringt bewusst
// keine eigene Virendatenbank mit, sondern steuert den eingebauten Scanner.

const SCAN_TYPES = { quick: '1', full: '2', custom: '3' };

function mpCmdRunPath() {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    return path.join(programFiles, 'Windows Defender', 'MpCmdRun.exe');
}

function isAvailable() {
    return isWindows && fs.existsSync(mpCmdRunPath());
}

let current = null;

function startScan(type, target) {
    if (!isAvailable()) {
        return Promise.reject(new Error('Microsoft Defender ist auf diesem PC nicht verfügbar. Wenn du ein anderes Virenschutzprogramm nutzt, starte die Prüfung bitte dort.'));
    }
    if (current) {
        return Promise.reject(new Error('Es läuft bereits eine Prüfung.'));
    }
    if (!SCAN_TYPES[type]) {
        return Promise.reject(new Error('Unbekannte Prüfart.'));
    }

    const args = ['-Scan', '-ScanType', SCAN_TYPES[type]];
    if (type === 'custom') {
        if (!target || !fs.existsSync(target)) {
            return Promise.reject(new Error('Der gewählte Ordner existiert nicht.'));
        }
        args.push('-File', target);
    }

    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
        const child = spawn(mpCmdRunPath(), args, { windowsHide: true });
        let output = '';
        let cancelled = false;
        current = { child, cancel: () => { cancelled = true; child.kill(); } };

        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('error', (error) => {
            current = null;
            reject(error);
        });
        child.on('close', async (code) => {
            current = null;
            if (cancelled) {
                resolve({ cancelled: true, threats: [], durationMs: Date.now() - startedAt });
                return;
            }

            // Exit-Code 0 = nichts gefunden, 2 = Bedrohung gefunden.
            if (code !== 0 && code !== 2) {
                reject(new Error(`Die Prüfung wurde mit Code ${code} beendet.\n${output.trim().slice(-500)}`));
                return;
            }

            const threats = code === 2 ? await recentThreats(startedAt).catch(() => []) : [];
            resolve({
                cancelled: false,
                threatsFound: code === 2,
                threats,
                durationMs: Date.now() - startedAt,
            });
        });
    });
}

function cancelScan() {
    if (current) {
        current.cancel();
        return true;
    }
    return false;
}

function isScanning() {
    return current !== null;
}

async function recentThreats(since) {
    const result = await runPowerShellJson(String.raw`
$names = @{}
Get-MpThreat -ErrorAction SilentlyContinue | ForEach-Object { $names[[string]$_.ThreatID] = $_.ThreatName }
@(Get-MpThreatDetection -ErrorAction SilentlyContinue | ForEach-Object {
    @{
        name = $names[[string]$_.ThreatID]
        time = ([datetime]$_.InitialDetectionTime).ToUniversalTime().ToString('o')
        resources = @($_.Resources)
        removed = [bool]$_.ActionSuccess
    }
}) | ConvertTo-Json -Depth 4 -Compress
`);
    const list = Array.isArray(result) ? result : (result ? [result] : []);
    return list
        .filter((t) => Date.parse(t.time) >= since - 60000)
        .map((t) => ({
            name: t.name || 'Unbekannte Bedrohung',
            files: (t.resources || []).map((r) => String(r).replace(/^file:_/, '')),
            removed: t.removed,
        }));
}

function updateSignatures() {
    if (!isAvailable()) {
        return Promise.reject(new Error('Microsoft Defender ist nicht verfügbar.'));
    }
    return runPowerShell(`& '${mpCmdRunPath()}' -SignatureUpdate`, { timeout: 300000 });
}

module.exports = { isAvailable, startScan, cancelScan, isScanning, updateSignatures };
