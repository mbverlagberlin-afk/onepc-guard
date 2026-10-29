# Änderungen

## 1.1.1

- Einstellungen: Hinweis zur OnePC-App aktualisiert – Anmeldung mit E-Mail-Adresse und Lizenzschlüssel, Android-App „OnePC“
- Erste Version, die über die automatische Aktualisierung verteilt wird (installiertes 1.1.0 aktualisiert sich selbst)

**Dateien in diesem Release**
- `OnePC-Guard-Setup-1.1.1.exe` – Installer für Windows 10/11 (64 Bit)
- `OnePC-Guard-Setup-1.1.1.zip` – derselbe Installer zum Hochladen ins WooCommerce-Produkt
- `onepc-license-server-1.2.0.zip` – Lizenz-Plugin 1.2.0 (Handy-App mit Anmeldung per E-Mail + Lizenzschlüssel)
- `onepc-guard-shopbilder.zip` – Logo, Produktbilder, Banner und Screenshots
- Android-App: siehe Release „OnePC für Android“

## 1.1.0

**Neu: OnePC-App fürs Handy**
- Unter onemultimedia.de/onepc-app/ mit dem Kundenkonto anmelden (iPhone und Android, zum Startbildschirm hinzufügbar)
- Zeigt für jeden PC Sicherheitsbewertung, gefundene Probleme, letzte Virenprüfung, aufräumbaren Speicher, Sicherung und Version
- Startet Schnellprüfung, vollständige Prüfung, Aufräumen und Sicherheitscheck aus der Ferne; Ergebnisse erscheinen in der App
- Im Programm unter „Einstellungen“ einschaltbar; der PC baut die Verbindung selbst auf, es wird kein Port geöffnet

**Neu: automatische Updates**
- OnePC Guard sucht alle 6 Stunden nach neuen Versionen, lädt sie im Hintergrund und installiert sie beim nächsten Start (oder sofort über „Jetzt neu starten“)

**Weitere Verbesserungen**
- Einstellungsseite mit Start mit Windows (im Hintergrund, im Infobereich)
- Lizenzserver: Weiterleitungen (z. B. www → ohne www) werden korrekt behandelt

**Wichtig beim Update von 1.0.0:** Version 1.0.0 hat noch keine automatische Aktualisierung. Bestehende Kunden installieren 1.1.0 einmal von Hand; ab dann geht es automatisch. Das Lizenz-Plugin im Shop muss ebenfalls auf 1.1.0 aktualisiert werden.

## 1.0.0

Erste Verkaufsversion von OnePC Guard.

**Funktionen**
- Sicherheitscheck (immer kostenlos): Virenschutz, Virendefinitionen, Firewall, Windows-Updates, Windows-Version, Benutzerkontensteuerung, Remotedesktop, BitLocker, Speicherplatz und Autostart mit Bewertung von 0 bis 100
- Virenprüfung mit Microsoft Defender: Schnell-, Komplett- und Ordnerprüfung, Aktualisierung der Virendefinitionen
- Aufräumen: temporäre Dateien, Browser-Zwischenspeicher (Chrome, Edge, Firefox), Absturzberichte, Papierkorb, große Dateien finden
- Sicherung: Ordner auf USB-Festplatte oder NAS, ältere Fassungen aufbewahren, täglich automatisch, Wiederherstellen
- 14 Tage Testphase, danach Freischaltung per Lizenzschlüssel aus dem Shop onemultimedia.de

**Dateien in diesem Release**
- `OnePC-Guard-Setup-1.0.0.exe` – Installer für Windows 10/11 (64 Bit)
- `OnePC-Guard-Setup-1.0.0.zip` – derselbe Installer als ZIP, zum Hochladen ins WooCommerce-Produkt (WordPress blockiert .exe-Dateien)
- `onepc-license-server-1.0.0.zip` – Lizenz-Plugin für WordPress/WooCommerce
- `onepc-guard-shopbilder.zip` – Logo, Produktbilder, Banner und Screenshots
