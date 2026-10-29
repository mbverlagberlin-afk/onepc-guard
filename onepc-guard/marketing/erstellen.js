const { chromium } = require('playwright');
const HD = process.argv[2], OUT = process.argv[3];
const shot = (n) => 'data:image/png;base64,' + require('fs').readFileSync(`${HD}/${n}.png`).toString('base64');

const ICON = (size, check = '#0b1736') => `<svg width="${size}" height="${size}" viewBox="0 0 512 512"><defs><linearGradient id="g${size}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#0b1736"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="108" fill="url(#g${size})"/><path d="M256 84 120 136v92c0 88 58 156 136 176 78-20 136-88 136-176v-92L256 84z" fill="#4ade80"/><path d="m188 248 46 46 92-96" fill="none" stroke="${check}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const BASE = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.bg{position:relative;overflow:hidden;background:radial-gradient(1200px 800px at 85% -10%,#2b5ee8 0%,rgba(37,99,235,0) 60%),linear-gradient(160deg,#0b1736 0%,#0f2257 55%,#0b1736 100%);color:#fff}
.win{border-radius:18px;overflow:hidden;background:#f4f6fb;box-shadow:0 40px 90px rgba(2,8,30,.55),0 0 0 1px rgba(255,255,255,.08)}
.bar{height:44px;background:#fff;display:flex;align-items:center;padding:0 18px;gap:10px;font-size:15px;color:#17213a;border-bottom:1px solid #e2e7f0}
.bar .ctl{margin-left:auto;display:flex;gap:26px;color:#5b6680;font-size:16px}
.win img{display:block;width:100%}
.pill{display:inline-flex;align-items:center;gap:10px;padding:10px 20px;border-radius:999px;background:rgba(74,222,128,.14);color:#86efac;font-weight:600;font-size:22px;border:1px solid rgba(74,222,128,.35)}
h1{font-weight:800;letter-spacing:-.02em;line-height:1.05}
ul.b{list-style:none}
ul.b li{position:relative;padding-left:44px;margin:14px 0;font-size:27px;color:#d6def0;line-height:1.35}
ul.b li:before{content:"";position:absolute;left:0;top:5px;width:28px;height:28px;border-radius:50%;background:#4ade80 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m6 12 4 4 8-8' fill='none' stroke='%230b1736' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/18px no-repeat}
</style>`;

const win = (img, w) => `<div class="win" style="width:${w}px"><div class="bar">${ICON(22)}<span>OnePC Guard</span><span class="ctl"><span>–</span><span>☐</span><span>✕</span></span></div><img src="${shot(img)}"></div>`;

const pages = {
  'logo': { w: 1600, h: 420, transparent: true, html: `<div style="display:flex;align-items:center;gap:48px;height:420px;padding:0 40px">${ICON(300)}<div><div style="font-size:150px;font-weight:800;letter-spacing:-.03em;color:#0b1736;line-height:1">OnePC Guard</div><div style="font-size:52px;color:#2563eb;font-weight:600;margin-top:14px">Sicherheit &amp; Pflege für Windows</div></div></div>` },
  'logo-hell': { w: 1600, h: 420, transparent: true, html: `<div style="display:flex;align-items:center;gap:48px;height:420px;padding:0 40px">${ICON(300)}<div><div style="font-size:150px;font-weight:800;letter-spacing:-.03em;color:#fff;line-height:1">OnePC Guard</div><div style="font-size:52px;color:#86efac;font-weight:600;margin-top:14px">Sicherheit &amp; Pflege für Windows</div></div></div>` },
  'icon': { w: 1024, h: 1024, transparent: true, html: ICON(1024) },

  'produktbild': { w: 1200, h: 1200, html: `<div class="bg" style="width:1200px;height:1200px;padding:80px 80px 0">
     <div style="display:flex;align-items:center;gap:22px">${ICON(92)}<div><div style="font-size:52px;font-weight:800;letter-spacing:-.02em">OnePC Guard</div><div style="font-size:24px;color:#a9b8da">für Windows 10 &amp; 11</div></div></div>
     <h1 style="font-size:78px;margin:50px 0 22px">Sicher. Sauber.<br><span style="color:#4ade80">Gesichert.</span></h1>
     <div style="font-size:30px;color:#c7d2ea;max-width:900px;line-height:1.4">Sicherheitscheck, Virenprüfung, Aufräumen und automatische Datensicherung – in einem Programm.</div>
     <div style="position:absolute;left:150px;top:580px">${win('1-uebersicht', 1180)}</div>
     <div style="position:absolute;right:60px;top:80px" class="pill">14 Tage kostenlos testen</div></div>` },

  'funktion-1-sicherheitscheck': feature('Sicherheitscheck', 'Weißt du, wie sicher dein PC ist?', ['Prüft Virenschutz, Firewall, Updates, Verschlüsselung', 'Bewertung von 0 bis 100', 'Ein Klick führt zur richtigen Einstellung'], '2-sicherheit', 'Immer kostenlos'),
  'funktion-2-virenpruefung': feature('Virenprüfung', 'Viren finden – mit Microsofts Erkennung', ['Schnell-, Komplett- und Ordnerprüfung', 'Nutzt den täglich aktualisierten Windows-Virenschutz', 'Ideal für Downloads und USB-Sticks'], '3-virenpruefung'),
  'funktion-3-aufraeumen': feature('Aufräumen', 'Gigabytes zurückholen', ['Temporäre Dateien &amp; Browser-Zwischenspeicher', 'Papierkorb und Absturzberichte', 'Große vergessene Dateien finden'], '4-aufraeumen'),
  'funktion-4-sicherung': feature('Sicherung', 'Nie wieder Daten verlieren', ['Täglich automatisch auf USB-Festplatte oder NAS', 'Ältere Fassungen bleiben erhalten', 'Schutz bei Erpressungstrojanern'], '5-sicherung'),

  'banner': { w: 1920, h: 640, html: `<div class="bg" style="width:1920px;height:640px;padding:96px 110px">
     <div class="pill">Neu von onemultimedia</div>
     <h1 style="font-size:92px;margin:34px 0 26px">OnePC Guard</h1>
     <div style="font-size:34px;color:#c7d2ea;max-width:780px;line-height:1.4">Sicherheitscheck, Virenprüfung, Aufräumen und Datensicherung für Windows – einfach in einem Programm.</div>
     <div style="position:absolute;left:1000px;top:90px">${win('1-uebersicht', 1100)}</div></div>` },
};

function feature(label, title, bullets, img, badge) {
  return { w: 1200, h: 1200, html: `<div class="bg" style="width:1200px;height:1200px;padding:80px">
    <div style="display:flex;align-items:center;gap:18px">${ICON(64)}<span style="font-size:28px;font-weight:700;color:#a9b8da;letter-spacing:.04em;text-transform:uppercase">${label}</span>${badge ? `<span class="pill" style="margin-left:auto">${badge}</span>` : ''}</div>
    <h1 style="font-size:68px;margin:40px 0 20px;max-width:1000px">${title}</h1>
    <ul class="b">${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
    <div style="position:absolute;left:80px;top:560px">${win(img, 1180)}</div></div>` };
}

(async () => {
  const b = await chromium.launch();
  for (const [name, p] of Object.entries(pages)) {
    const page = await b.newPage({ viewport: { width: p.w, height: p.h } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${BASE}</head><body style="${p.transparent ? 'background:transparent' : ''}">${p.html}</body></html>`);
    await page.waitForLoadState('load');
    await page.screenshot({ path: `${OUT}/${name}.png`, omitBackground: !!p.transparent });
    await page.close();
    console.log('ok', name);
  }
  await b.close();
})();
