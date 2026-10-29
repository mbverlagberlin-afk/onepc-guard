'use strict';

const { execFile } = require('child_process');

const isWindows = process.platform === 'win32';

/**
 * Führt ein PowerShell-Skript aus. Das Skript wird als -EncodedCommand
 * übergeben, damit keine Anführungszeichen maskiert werden müssen.
 */
function runPowerShell(script, { timeout = 120000 } = {}) {
    if (!isWindows) {
        return Promise.reject(new Error('PowerShell ist nur unter Windows verfügbar.'));
    }

    const full = '$ProgressPreference = "SilentlyContinue"\n'
        + '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n'
        + script;
    const encoded = Buffer.from(full, 'utf16le').toString('base64');

    return new Promise((resolve, reject) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
            { timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error((stderr || error.message).trim()));
                    return;
                }
                resolve(stdout.trim());
            }
        );
    });
}

async function runPowerShellJson(script, options) {
    const output = await runPowerShell(script, options);
    if (!output) {
        return null;
    }
    return JSON.parse(output);
}

module.exports = { isWindows, runPowerShell, runPowerShellJson };
