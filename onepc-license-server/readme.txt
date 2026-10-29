=== OnePC Lizenzserver ===
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later

Lizenzschlüssel für OnePC Guard über WooCommerce verkaufen.

== Funktionen ==

* Erzeugt bei bezahlter Bestellung automatisch Lizenzschlüssel (OPC-XXXX-XXXX-XXXX-XXXX)
* Schlüssel erscheinen in Bestell-E-Mail, Kundenkonto und Bestellung
* Pro Produkt einstellbar: Anzahl PCs, Laufzeit (Tage oder unbegrenzt)
* REST-API für die Aktivierung im Programm, mit Ed25519-Signatur und Anfragebegrenzung
* Verwaltung unter WooCommerce → Lizenzen: suchen, sperren, PCs zurücksetzen, manuell erstellen
* Automatische Sperre bei Stornierung oder Rückerstattung
* OnePC-App fürs Handy unter /onepc-app/: Status der eigenen PCs, Virenprüfung und Aufräumen aus der Ferne (Anmeldung mit dem Kundenkonto)

== Installation ==

1. Plugin hochladen und aktivieren (WooCommerce muss aktiv sein).
2. Unter WooCommerce → Lizenzen den öffentlichen Schlüssel (publicKey) kopieren und ins Programm übernehmen.
3. Beim Produkt im Reiter „Allgemein“ „Lizenzschlüssel erzeugen“ ankreuzen.

Der private Signaturschlüssel liegt in der Option opls_sign_secret und darf nicht verloren gehen (Datenbank-Backup!).

== Changelog ==

= 1.1.0 =
* Neu: OnePC-App fürs Handy (/onepc-app/) mit Geräte-Status und Aufträgen
* Neu: REST-Endpunkte device/sync, app/devices, app/command
* Menüpunkt „OnePC-App“ im WooCommerce-Kundenkonto

= 1.0.0 =
* Lizenzschlüssel, Aktivierung, Verwaltung
