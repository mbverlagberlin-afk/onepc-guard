'use strict';

const { runPowerShellJson } = require('./powershell');

// Sammelt alle Werte in einem einzigen PowerShell-Aufruf. Datumswerte werden
// als ISO-Text ausgegeben, weil Windows PowerShell 5.1 sie sonst als
// "/Date(...)/" serialisiert.
const COLLECT_SCRIPT = String.raw`
$r = [ordered]@{}
function Iso($d) { if ($d) { ([datetime]$d).ToUniversalTime().ToString('o') } else { $null } }

try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $r.os = @{ caption = $os.Caption; version = $os.Version; build = [int]$os.BuildNumber }
} catch { $r.os = $null }

try {
    $mp = Get-MpComputerStatus -ErrorAction Stop
    $r.defender = @{
        service = [bool]$mp.AMServiceEnabled
        enabled = [bool]$mp.AntivirusEnabled
        realtime = [bool]$mp.RealTimeProtectionEnabled
        signatureAgeDays = [int]$mp.AntivirusSignatureAge
        quickScanAgeDays = [int]$mp.QuickScanAge
        fullScanAgeDays = [int]$mp.FullScanAge
        tamperProtected = [bool]$mp.IsTamperProtected
        mode = [string]$mp.AMRunningMode
    }
} catch { $r.defender = $null }

try {
    $r.antivirus = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop |
        ForEach-Object { @{ name = $_.displayName; state = [int]$_.productState } })
} catch { $r.antivirus = @() }

try {
    $r.firewall = @(Get-NetFirewallProfile -ErrorAction Stop |
        ForEach-Object { @{ name = [string]$_.Name; enabled = ([string]$_.Enabled -eq 'True') } })
} catch { $r.firewall = $null }

$r.lastUpdate = $null
try {
    $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
    $count = $searcher.GetTotalHistoryCount()
    if ($count -gt 0) {
        $last = $searcher.QueryHistory(0, [Math]::Min($count, 100)) |
            Where-Object { $_.ResultCode -eq 2 } | Sort-Object Date -Descending | Select-Object -First 1
        if ($last) { $r.lastUpdate = Iso $last.Date }
    }
} catch { }
if (-not $r.lastUpdate) {
    try {
        $hf = Get-HotFix -ErrorAction Stop | Where-Object { $_.InstalledOn } |
            Sort-Object InstalledOn -Descending | Select-Object -First 1
        if ($hf) { $r.lastUpdate = Iso $hf.InstalledOn }
    } catch { }
}

$r.pendingReboot = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or
    (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')

try { $r.uac = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction Stop).EnableLUA } catch { $r.uac = $null }
try { $r.rdpDenied = [int](Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -ErrorAction Stop).fDenyTSConnections } catch { $r.rdpDenied = $null }

try {
    $bl = (New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive + '\').Self.ExtendedProperty('System.Volume.BitLockerProtection')
    $r.bitlocker = if ($bl -ne $null) { [int]$bl } else { $null }
} catch { $r.bitlocker = $null }

try {
    $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'") -ErrorAction Stop
    $r.disk = @{ drive = $env:SystemDrive; size = [double]$disk.Size; free = [double]$disk.FreeSpace }
} catch { $r.disk = $null }

try {
    $r.startup = @(Get-CimInstance Win32_StartupCommand -ErrorAction Stop |
        ForEach-Object { @{ name = $_.Name; command = $_.Command; location = $_.Location } })
} catch { $r.startup = @() }

$r | ConvertTo-Json -Depth 5 -Compress
`;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Wertet productState aus dem Windows-Sicherheitscenter aus.
 * Byte 2 (0x10/0x11) = aktiv, Byte 3 (0x00) = Signaturen aktuell.
 */
function decodeProductState(state) {
    const hex = Number(state).toString(16).padStart(6, '0');
    return {
        enabled: ['10', '11'].includes(hex.slice(2, 4)),
        upToDate: hex.slice(4, 6) === '00',
    };
}

function isDefenderName(name) {
    return /defender|windows-sicherheit|windows security/i.test(name || '');
}

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(bytes) || 0;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return value.toLocaleString('de-DE', { maximumFractionDigits: unit > 1 ? 1 : 0 }) + ' ' + units[unit];
}

function check(id, title, status, detail, action) {
    return { id, title, status, detail, action: action || null };
}

/**
 * Bewertet die gesammelten Rohdaten. Reine Funktion, damit sie ohne Windows testbar ist.
 * status: ok | warn | bad | unknown (unknown fließt nicht in die Punktzahl ein)
 */
function evaluate(data, now = Date.now()) {
    const checks = [];
    const d = data || {};

    // Virenschutz
    const thirdParty = (d.antivirus || [])
        .filter((av) => !isDefenderName(av.name))
        .map((av) => ({ name: av.name, ...decodeProductState(av.state) }))
        .filter((av) => av.enabled);

    if (thirdParty.length) {
        const av = thirdParty[0];
        checks.push(av.upToDate
            ? check('antivirus', 'Virenschutz', 'ok', `${av.name} ist aktiv und aktuell.`)
            : check('antivirus', 'Virenschutz', 'warn', `${av.name} ist aktiv, aber nicht aktuell. Bitte im Programm aktualisieren.`));
    } else if (!d.defender) {
        checks.push(check('antivirus', 'Virenschutz', 'bad', 'Es wurde kein aktiver Virenschutz gefunden.', { label: 'Windows-Sicherheit öffnen', type: 'open', target: 'defender' }));
    } else if (!d.defender.enabled || !d.defender.realtime) {
        checks.push(check('antivirus', 'Virenschutz', 'bad', 'Der Echtzeitschutz von Microsoft Defender ist ausgeschaltet.', { label: 'Echtzeitschutz einschalten', type: 'open', target: 'defender' }));
    } else {
        checks.push(check('antivirus', 'Virenschutz', 'ok', 'Microsoft Defender mit Echtzeitschutz ist aktiv.'));
    }

    // Virensignaturen (nur relevant, wenn Defender der aktive Schutz ist)
    if (!thirdParty.length && d.defender && d.defender.enabled) {
        const age = d.defender.signatureAgeDays;
        if (age <= 2) {
            checks.push(check('signatures', 'Virendefinitionen', 'ok', 'Die Virendefinitionen sind aktuell.'));
        } else {
            checks.push(check('signatures', 'Virendefinitionen', age > 7 ? 'bad' : 'warn',
                `Die Virendefinitionen sind ${age} Tage alt.`,
                { label: 'Jetzt aktualisieren', type: 'defender-update' }));
        }

        const scanAge = d.defender.quickScanAgeDays;
        checks.push(scanAge <= 14
            ? check('lastscan', 'Letzte Virenprüfung', 'ok', scanAge === 0 ? 'Heute geprüft.' : `Vor ${scanAge} Tag(en) geprüft.`)
            : check('lastscan', 'Letzte Virenprüfung', 'warn', `Die letzte Schnellprüfung ist ${scanAge} Tage her.`, { label: 'Jetzt prüfen', type: 'page', target: 'scan' }));
    }

    // Firewall
    if (Array.isArray(d.firewall) && d.firewall.length) {
        const names = { Domain: 'Domänennetzwerk', Private: 'privates Netzwerk', Public: 'öffentliches Netzwerk' };
        const off = d.firewall.filter((p) => !p.enabled).map((p) => names[p.name] || p.name);
        checks.push(off.length
            ? check('firewall', 'Firewall', 'bad', `Die Firewall ist ausgeschaltet für: ${off.join(', ')}.`, { label: 'Firewall-Einstellungen', type: 'open', target: 'firewall' })
            : check('firewall', 'Firewall', 'ok', 'Die Windows-Firewall ist für alle Netzwerke aktiv.'));
    } else {
        checks.push(check('firewall', 'Firewall', 'unknown', 'Der Firewall-Status konnte nicht gelesen werden.', { label: 'Firewall-Einstellungen', type: 'open', target: 'firewall' }));
    }

    // Windows-Updates
    if (d.lastUpdate) {
        const days = Math.floor((now - Date.parse(d.lastUpdate)) / DAY);
        const status = days <= 35 ? 'ok' : (days <= 60 ? 'warn' : 'bad');
        checks.push(check('updates', 'Windows-Updates', status,
            status === 'ok' ? `Letztes Update vor ${days} Tag(en).` : `Das letzte Update ist ${days} Tage her.`,
            status === 'ok' ? null : { label: 'Nach Updates suchen', type: 'open', target: 'windowsupdate' }));
    } else {
        checks.push(check('updates', 'Windows-Updates', 'unknown', 'Das Datum des letzten Updates ist nicht bekannt.', { label: 'Windows Update öffnen', type: 'open', target: 'windowsupdate' }));
    }

    if (d.pendingReboot) {
        checks.push(check('reboot', 'Neustart', 'warn', 'Ein Neustart ist nötig, um Updates abzuschließen.'));
    }

    // Unterstützte Windows-Version
    if (d.os && d.os.caption) {
        if (/Windows 10/i.test(d.os.caption)) {
            checks.push(check('os', 'Windows-Version', 'warn',
                `${d.os.caption}: Seit dem 14.10.2025 gibt es nur noch Sicherheitsupdates mit dem ESU-Programm. Ein Umstieg auf Windows 11 wird empfohlen.`,
                { label: 'Windows Update öffnen', type: 'open', target: 'windowsupdate' }));
        } else if (/Windows [78]/i.test(d.os.caption)) {
            checks.push(check('os', 'Windows-Version', 'bad', `${d.os.caption} erhält keine Sicherheitsupdates mehr.`));
        } else {
            checks.push(check('os', 'Windows-Version', 'ok', `${d.os.caption} wird unterstützt.`));
        }
    }

    // Benutzerkontensteuerung
    if (d.uac === 0) {
        checks.push(check('uac', 'Benutzerkontensteuerung', 'bad', 'Die Benutzerkontensteuerung (UAC) ist deaktiviert. Programme können unbemerkt Änderungen vornehmen.', { label: 'UAC-Einstellungen', type: 'open', target: 'uac' }));
    } else if (d.uac === 1) {
        checks.push(check('uac', 'Benutzerkontensteuerung', 'ok', 'Die Benutzerkontensteuerung ist aktiv.'));
    }

    // Remotedesktop
    if (d.rdpDenied === 0) {
        checks.push(check('rdp', 'Remotedesktop', 'warn', 'Remotedesktop ist eingeschaltet. Wenn du ihn nicht nutzt, schalte ihn aus.', { label: 'Remotedesktop-Einstellungen', type: 'open', target: 'remotedesktop' }));
    } else if (d.rdpDenied === 1) {
        checks.push(check('rdp', 'Remotedesktop', 'ok', 'Remotedesktop ist ausgeschaltet.'));
    }

    // Laufwerksverschlüsselung
    if ([1, 3, 6].includes(d.bitlocker)) {
        checks.push(check('encryption', 'Laufwerksverschlüsselung', 'ok', 'Das Systemlaufwerk ist mit BitLocker verschlüsselt.'));
    } else if (d.bitlocker === 2 || d.bitlocker === 5) {
        checks.push(check('encryption', 'Laufwerksverschlüsselung', 'warn', d.bitlocker === 5
            ? 'Die BitLocker-Verschlüsselung ist angehalten.'
            : 'Das Systemlaufwerk ist nicht verschlüsselt. Bei Diebstahl (besonders bei Laptops) sind die Daten lesbar.',
        { label: 'Verschlüsselung einrichten', type: 'open', target: 'bitlocker' }));
    } else {
        checks.push(check('encryption', 'Laufwerksverschlüsselung', 'unknown', 'BitLocker ist auf diesem Gerät nicht verfügbar (z. B. Windows Home).'));
    }

    // Speicherplatz
    if (d.disk && d.disk.size > 0) {
        const ratio = d.disk.free / d.disk.size;
        const status = ratio >= 0.1 ? 'ok' : (ratio >= 0.05 ? 'warn' : 'bad');
        checks.push(check('disk', 'Speicherplatz', status,
            `${formatBytes(d.disk.free)} von ${formatBytes(d.disk.size)} frei auf ${d.disk.drive}.`,
            status === 'ok' ? null : { label: 'Aufräumen', type: 'page', target: 'clean' }));
    }

    // Autostart
    const startup = Array.isArray(d.startup) ? d.startup : [];
    checks.push(startup.length > 15
        ? check('startup', 'Autostart', 'warn', `${startup.length} Programme starten mit Windows. Das verlangsamt den Start.`, { label: 'Autostart verwalten', type: 'open', target: 'startupapps' })
        : check('startup', 'Autostart', 'ok', `${startup.length} Programme starten mit Windows.`));

    const weights = { ok: 1, warn: 0.5, bad: 0 };
    const rated = checks.filter((c) => c.status in weights);
    let score = rated.length ? Math.round(100 * rated.reduce((sum, c) => sum + weights[c.status], 0) / rated.length) : 0;
    // Ein kritischer Punkt (z. B. Firewall aus) darf nie als "gut geschützt" erscheinen.
    if (checks.some((c) => c.status === 'bad')) {
        score = Math.min(score, 59);
    }

    return { score, checks, startup, checkedAt: new Date(now).toISOString() };
}

async function runSecurityCheck() {
    const data = await runPowerShellJson(COLLECT_SCRIPT, { timeout: 90000 });
    return evaluate(data);
}

module.exports = { runSecurityCheck, evaluate, decodeProductState, formatBytes };
