# OnePC Guard

Windows-Programm zum Verkauf über onemultimedia.de: **Sicherheitscheck, Virenprüfung, Aufräumen und Sicherung** in einem Programm.
14 Tage kostenlos testen, danach Vollversion per Lizenzschlüssel aus dem WooCommerce-Shop.

## Funktionen

| Bereich | Was es macht | Ohne Lizenz |
|---|---|---|
| Sicherheitscheck | Prüft Virenschutz, Virendefinitionen, Firewall, Windows-Updates, Windows-Version, Benutzerkontensteuerung, Remotedesktop, BitLocker, Speicherplatz und Autostart. Bewertung 0–100 mit Ein-Klick-Weg zur passenden Windows-Einstellung. | ✔ immer frei |
| Virenprüfung | Schnell-, Voll- und Ordnerprüfung mit dem in Windows eingebauten **Microsoft Defender** (echte, täglich aktualisierte Erkennung). Aktualisiert die Virendefinitionen. | gesperrt |
| Aufräumen | Temporäre Dateien, Browser-Zwischenspeicher (Chrome, Edge, Firefox), Absturzberichte, Papierkorb. Große Dateien finden. | Analyse frei, Löschen gesperrt |
| Sicherung | Ordner auf USB-Festplatte/NAS sichern, ältere Fassungen geänderter und gelöschter Dateien aufbewahren, täglich automatisch über die Windows-Aufgabenplanung, Wiederherstellen. | gesperrt |

| OnePC-App (Handy) | Android-App „OnePC“ oder `onemultimedia.de/onepc-app/`, Anmeldung mit E-Mail-Adresse und Lizenzschlüssel: Status aller eigenen PCs, Schnell-/Vollprüfung, Aufräumen und Sicherheitscheck aus der Ferne starten. Im Programm unter *Einstellungen* einschalten. | nur Vollversion |
| Automatische Updates | Sucht alle 6 Stunden nach neuen Versionen auf GitHub-Releases, lädt im Hintergrund, installiert beim nächsten Start. | ✔ |

**Wichtig:** OnePC Guard ist bewusst *kein eigenes Antivirenprogramm*, sondern steuert Microsoft Defender. So bekommen Kunden echten Schutz, und es gibt keine falschen Versprechen. Bitte im Shop auch so beschreiben (z. B. „nutzt den Virenscanner von Windows“).

## Verkauf einrichten (einmalig)

1. **Lizenz-Plugin installieren:** `onepc-license-server.zip` in WordPress unter *Plugins → Installieren → Plugin hochladen* installieren und aktivieren (WooCommerce muss aktiv sein).
2. **Öffentlichen Schlüssel kopieren:** *WooCommerce → Lizenzen*, ganz unten „publicKey“ kopieren.
3. **Schlüssel ins Programm übernehmen:** Auf GitHub im Repository unter *Settings → Secrets and variables → Actions → Variables* eine Variable `ONEPC_PUBLIC_KEY` mit diesem Wert anlegen.
   Ggf. in `config/app.json` die Adressen `serverUrl`, `shopUrl` und `supportUrl` anpassen (Standard: https://www.onemultimedia.de).
4. **Installer bauen:** Auf GitHub unter *Actions → „OnePC Guard – Windows-Installer“ → Run workflow*. Nach ca. 5–10 Minuten liegt unter dem Lauf das Artefakt `OnePC-Guard-Setup` (enthält `OnePC-Guard-Setup-1.0.0.exe`).
5. **Produkt in WooCommerce anlegen:** Neues Produkt, *Virtuell* und *Herunterladbar* ankreuzen, die Setup-Datei als Download hochladen. Im Reiter *Allgemein*:
   - „Lizenzschlüssel erzeugen“ ankreuzen
   - Anzahl PCs (z. B. 1 oder 3 – für unterschiedliche Pakete einfach mehrere Produkte anlegen)
   - Laufzeit in Tagen (365 = Jahreslizenz, 0 = unbegrenzt)
6. **Testkauf machen.** Der Schlüssel steht in der Bestell-E-Mail, im Kundenkonto und bei der Bestellung im Backend.

Die Setup-Datei kann zusätzlich frei zum Testen auf der Website angeboten werden – die Testphase läuft 14 Tage.

## Neue Version veröffentlichen (automatische Updates)

1. In `package.json` die `version` erhöhen (z. B. 1.1.0 → 1.1.1) und in `CHANGELOG.md` einen Abschnitt `## 1.1.1` ergänzen.
2. Committen und pushen. GitHub Actions baut den Installer und legt das Release `v1.1.1` mit `latest.yml` an.
3. Alle installierten Programme ab 1.1.0 finden das Update innerhalb von 6 Stunden und installieren es beim nächsten Start.
4. Die neue `OnePC-Guard-Setup-…zip` aus dem Release auch im WooCommerce-Produkt austauschen (für Neukunden).

Die Updates kommen aus dem öffentlichen Repository `mbverlagberlin-afk/onepc-guard` (Einstellung `build.publish` in `package.json`).

## OnePC-App (Handy)

- Wird vom Lizenz-Plugin unter `/onepc-app/` bereitgestellt (Plugin ab 1.1.0, „schöne“ Permalinks müssen aktiv sein).
- Kunden melden sich mit E-Mail-Adresse und Lizenzschlüssel aus der Bestellung an (kein Kundenkonto nötig) oder mit ihrem Kundenkonto. Angezeigt werden alle PCs mit Lizenzen auf diese E-Mail-Adresse. Im Kundenkonto erscheint zusätzlich der Menüpunkt „OnePC-App“.
- Android-App: `onepc-android/` (APK im Release `android-v…`).
- Der PC meldet sich jede Minute beim Shop (nur bei eingeschalteter Verbindung) und holt Aufträge ab; es wird kein Port am PC geöffnet. Aufträge verfallen nach 6 Stunden, wenn der PC nicht erreichbar ist.
- Auf dem Handy über „Zum Home-Bildschirm“ (iPhone: Teilen-Menü; Android: Browsermenü) als App installieren.
- Sicherheits- oder Cache-Plugins dürfen `/wp-json/onepc/` und `/onepc-app/` nicht blockieren bzw. zwischenspeichern.

## Lizenzen verwalten

*WooCommerce → Lizenzen*: suchen, sperren/entsperren, „PCs zurücksetzen“ (wenn ein Kunde einen neuen PC hat und den alten nicht mehr deaktivieren kann), Lizenzen von Hand erstellen.
Bei Stornierung oder Rückerstattung einer Bestellung werden deren Schlüssel automatisch gesperrt. Das Programm prüft die Lizenz alle 7 Tage online und funktioniert bis zu 30 Tage ohne Internet.

Die Lizenzen sind mit einer digitalen Signatur (Ed25519) geschützt: Nur dein Server kann gültige Lizenzen ausstellen.

## Vor dem Verkauf unbedingt erledigen

- **Code-Signatur-Zertifikat:** Ohne Signatur zeigt Windows beim Installieren „Der Computer wurde durch Windows geschützt“ (SmartScreen). Für Verkaufssoftware ist ein Code-Signing-Zertifikat (OV/EV, ca. 200–500 €/Jahr) praktisch Pflicht. electron-builder signiert automatisch, wenn `CSC_LINK`/`CSC_KEY_PASSWORD` als GitHub-Secrets gesetzt sind (bzw. Azure Trusted Signing).
- **Auf echten PCs testen:** Windows 10 und 11, mit und ohne Administratorrechte, mit Microsoft Defender und mit einem anderen Virenschutz.
- **Rechtliches prüfen lassen:** Lizenzvertrag `build/eula.txt` ist eine Vorlage. Datenschutzerklärung der Website um die Lizenzprüfung ergänzen (übertragen werden Lizenzschlüssel, anonyme Gerätekennung und Gerätename). Produktbeschreibung ohne Heilsversprechen („100 % Schutz“ o. Ä.).

## Entwicklung

```
npm install
npm test          # Tests (laufen auch unter Linux/Mac)
npm start         # Programm starten (Windows)
npm run dist      # Installer bauen (Windows)
```

Aufbau: `src/main.js` (Hauptprozess, Funktionen und Lizenzsperre), `src/lib/*` (Sicherheitscheck, Scan, Aufräumen, Sicherung, Lizenz), `src/renderer/*` (Oberfläche), `config/app.json` (Shop-Adressen, öffentlicher Schlüssel, Testtage).
Das Programm verlangt Administratorrechte (für Virenprüfung, Windows-Temp, geplante Sicherung und Autostart über die Aufgabenplanung).
Module: `src/lib/remote.js` (Verbindung zur App), `src/lib/updater.js` (automatische Updates).
