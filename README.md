# OnePC Guard

Sicherheitscheck, Virenprüfung, Aufräumen und Datensicherung für Windows – mit Handy-App und automatischen Updates.
Vertrieb über [onemultimedia.de](https://onemultimedia.de).

| Ordner | Inhalt |
|---|---|
| [`onepc-guard/`](onepc-guard/) | Windows-Programm (Electron): Sicherheitscheck, Virenprüfung mit Microsoft Defender, Aufräumen, Sicherung, Lizenz, Verbindung zur Handy-App, automatische Updates |
| [`onepc-license-server/`](onepc-license-server/) | WordPress/WooCommerce-Plugin: Lizenzschlüssel beim Kauf, Aktivierung, Verwaltung, Handy-App unter `/onepc-app/` |
| [`onepc-android/`](onepc-android/) | Android-App „OnePC“ (öffnet die Handy-App aus dem Shop mit eigenem Symbol) |
| [`.github/workflows/`](.github/workflows/) | Baut Windows-Installer und Android-APK und veröffentlicht die Releases |

## Downloads

Alle Dateien stehen unter [Releases](../../releases):

- **Windows:** `OnePC-Guard-Setup-<Version>.exe` (aktualisiert sich danach selbst)
- **Android:** `OnePC-<Version>.apk` im Release „OnePC für Android“
- **Shop-Plugin:** `onepc-license-server-<Version>.zip`
- **Shop-Bilder:** `onepc-guard-shopbilder.zip`

## Neue Version veröffentlichen

- **Windows-Programm:** Version in `onepc-guard/package.json` erhöhen, Abschnitt in `onepc-guard/CHANGELOG.md` ergänzen, pushen. Installierte Programme aktualisieren sich innerhalb von 6 Stunden.
- **Android-App:** `versionCode` und `versionName` in `onepc-android/app/build.gradle.kts` erhöhen, pushen.
- **Plugin:** Version im Kopf von `onepc-license-server/onepc-license-server.php` erhöhen; die ZIP liegt dem nächsten Windows-Release bei.

Details: [`onepc-guard/README.md`](onepc-guard/README.md)
