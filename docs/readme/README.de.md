<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<h1 align="center">Ein SSH-Arbeitsbereich für die Serververwaltung</h1>

<p align="center">OriaTunnel vereint SSH-Tunnel, entfernte Dienste, Terminals, Dateiübertragungen und Remotedesktops in einer grafischen Oberfläche.</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · Deutsch · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a>
</p>

**[Herunterladen und installieren](#herunterladen-und-installieren)** · [Schnellstart](#schnellstart) · [Vollständiges Benutzerhandbuch (vereinfachtes Chinesisch)](../USAGE.md) · [Onlinedemo (Chinesisch)](https://oriamade.com/zh-CN/oria-tunnel#workspace)

## Funktionen

### 🔗 SSH-Tunnel im Überblick

- Die Verbindungskarte zeigt, wie lokale Ports und SSH-Hosts verbunden sind. Starten oder stoppen Sie Regeln einzeln oder gemeinsam und verfolgen Sie Status, aktive Verbindungen und Datenverkehr.
- Übernehmen Sie Hosts aus Ihrer SSH-Konfiguration oder fügen Sie sie manuell hinzu. Passwörter, private Schlüssel, der SSH-Agent des Systems und Verbindungen über mehrere Zwischenstationen (ProxyJump) werden unterstützt.
- Mit einer gespeicherten Regel öffnen Sie interne Webseiten direkt aus der Karte oder verbinden Ihren Datenbankclient mit dem lokalen Port.

### ⚙️ Entfernte Dienste verwalten

- Speichern Sie Befehle zum Starten, Stoppen und Neustarten sowie für Status- und Protokollabfragen in einer Vorlage. Verknüpfen Sie diese mit einer Weiterleitung, um die Befehle im Dienstmenü auszuführen.
- Muss der Dienst zuerst starten, richten Sie einen Startbefehl und eine Zustandsprüfung ein. Beim Starten und Verbinden sehen Sie das Ergebnis jedes Schritts bis zum Tunnelaufbau.

### 💻 Lokale und SSH-Terminals

- Wechseln Sie über Tabs zwischen lokalen und entfernten Sitzungen. Nutzen Sie Eingabevorschläge, rufen Sie mit ↑ den Verlauf auf oder suchen Sie gespeicherte Befehle sitzungsübergreifend per Stichwort.
- Mit Umschalt+Eingabe bearbeiten Sie mehrzeilige Befehle. Beim Verzeichniswechsel bleibt Ihr Entwurf erhalten. Lange Ausgaben lassen sich einklappen und Befehle oder Ergebnisse separat kopieren.

### 📁 Dateien übertragen

- Öffnen Sie lokale und entfernte Verzeichnisse nebeneinander und ziehen Sie mehrere Dateien zum Hoch- oder Herunterladen ins andere Fensterfeld. Mit je einem SSH-Host pro Feld übertragen Sie Dateien zwischen Hosts.
- Verfolgen Sie den Fortschritt in der Warteschlange. Sie können Aufträge pausieren, fortsetzen oder abbrechen, Dateien in der Vorschau öffnen und Texte direkt bearbeiten.

### 🖥️ VNC-Remotedesktop

- Öffnen Sie den Desktop über eine VNC-Weiterleitung in einem eigenen Fenster. Die Verbindung läuft durch den SSH-Tunnel und unterstützt Vollbild, Zoom und eine gemeinsame Textzwischenablage in beide Richtungen.
- Öffnen Sie im Desktopfenster ein SSH-Terminal oder übertragen Sie Dateien per SFTP. Bereits eingereihte Übertragungen laufen nach dem Schließen des Fensters weiter.

## Herunterladen und installieren

| Plattform | Installationspaket v0.5.0 | Installation |
| --- | --- | --- |
| macOS | [Apple Silicon](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.5.0/OriaTunnel_0.5.0_aarch64.dmg) · [Intel](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.5.0/OriaTunnel_0.5.0_x64.dmg) | Öffnen Sie das Image und ziehen Sie OriaTunnel in den Ordner „Programme“. |
| Windows | [x64](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.5.0/OriaTunnel_0.5.0_x64-setup.exe) · [ARM64](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.5.0/OriaTunnel_0.5.0_arm64-setup.exe) | Führen Sie das Installationsprogramm aus und folgen Sie dem Assistenten. |

### Versionsverlauf

**v0.5.0** · Terminals lassen sich per Drag-and-drop teilen. Für Windows-SSH-Hosts steht die intelligente PowerShell-Eingabe zur Verfügung. Die Übertragung großer Ordner, die Fortsetzung nach Verbindungsabbrüchen und die Reaktionszeit der Bereiche wurden verbessert. Unter **Über** können Sie nach Updates suchen.

[Versionshinweise (Chinesisch)](../releases/v0.5.0.md) · [Alle Versionen](https://github.com/KrisLee1/OriaTunnel/releases)

## Schnellstart

In diesem Beispiel läuft auf dem SSH-Server bereits ein Webdienst auf Port 3000.

1. Öffnen Sie OriaTunnel und wählen Sie **Host hinzufügen**. Wählen Sie einen aus der SSH-Konfiguration gefundenen Host oder geben Sie seine Daten manuell ein. Die Hostsuche liest nur die Konfiguration und stellt keine automatische Verbindung her.
2. Wählen Sie **Neue Weiterleitung**, den Host und die lokale Weiterleitung (L). Tragen Sie lokal `127.0.0.1:13000` und als Ziel auf dem SSH-Server `127.0.0.1:3000` ein.
3. Wählen Sie **Speichern und starten**, authentifizieren Sie sich bei Aufforderung und prüfen Sie bei der ersten Verbindung den Fingerabdruck des Servers. Sobald **Listener bereit** erscheint, öffnen Sie `http://127.0.0.1:13000` im lokalen Browser.

Beim nächsten Mal starten Sie die gespeicherte Regel. Lädt die Seite nicht, prüfen Sie, ob der Dienst auf dem Zielport läuft. [Fehlerhilfe (Chinesisch)](../USAGE.md#查看状态与排查问题)

### Weiterleitungsart wählen

| Art | Geeignet für | Zugriff auf den Dienst |
| --- | --- | --- |
| **L · Lokale Weiterleitung** | Von diesem Computer auf eine Web-App, Datenbank oder einen VNC-Dienst des Servers zugreifen | Einen lokalen Listen-Port verwenden, der über SSH zum entfernten Dienst führt |
| **R · Entfernte Weiterleitung** | Einem Server Zugriff auf einen Entwicklungsdienst dieses Computers geben | Einen Listen-Port auf dem Server verwenden, der über SSH zum lokalen Dienst führt |
| **D · Dynamische Weiterleitung** | Über einen SSH-Host mehrere interne Adressen erreichen | Separaten Proxy-Browser über das Menü öffnen oder einen anderen Client für lokales SOCKS5 konfigurieren |

Liegt bereits eine OriaTunnel-Konfiguration vor, importieren und prüfen Sie diese auf der Weiterleitungsseite und ergänzen Ihre Authentifizierung. Importierte Dienstvorlagen müssen vor der Ausführung geprüft und freigegeben werden. Siehe [vorbereitete Konfiguration nutzen (Chinesisch)](../USAGE.md#使用现成配置).

## Bildschirmansichten

Die hellen und dunklen Ansichten zeigen die Oberfläche mit Beispieldaten aus der OriaTunnel-Demo in OriaMadeWeb.

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/connection-map-dark.png"><img src="../assets/screenshots/connection-map-light.png" alt="Verbindungsübersicht"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/terminal-dark.png"><img src="../assets/screenshots/terminal-light.png" alt="Befehlssammlung im Terminal"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/files-dark.png"><img src="../assets/screenshots/files-light.png" alt="Dateiübertragungen"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/vnc-dark.png"><img src="../assets/screenshots/vnc-light.png" alt="VNC-Remotedesktop"></picture> |

<details>
<summary>Weitere Bildschirmansichten</summary>

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/forwards-dark.png"><img src="../assets/screenshots/forwards-light.png" alt="Weiterleitungen"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/services-dark.png"><img src="../assets/screenshots/services-light.png" alt="Dienste"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/hosts-dark.png"><img src="../assets/screenshots/hosts-light.png" alt="SSH-Hosts"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/logs-dark.png"><img src="../assets/screenshots/logs-light.png" alt="Aktivitätsprotokoll"></picture> |

</details>

## Dokumentation und Support

[Vollständiges Benutzerhandbuch (vereinfachtes Chinesisch)](../USAGE.md) · [Fehlerhilfe (Chinesisch)](../USAGE.md#查看状态与排查问题) · [Entwicklerhandbuch (vereinfachtes Chinesisch)](../DEVELOPMENT.md) · [GitHub Issues](https://github.com/KrisLee1/OriaTunnel/issues)

## Lizenz

Copyright (C) 2026 KrisLee.

OriaTunnel steht unter der **GNU General Public License, ausschließlich Version 3 (GPL-3.0-only)**. Die vollständigen Bedingungen finden Sie in [LICENSE](../../LICENSE).

Die Software wird ohne Gewährleistung gemäß den Lizenzbedingungen bereitgestellt. Für Code, Abhängigkeiten und Ressourcen Dritter gelten weiterhin deren jeweilige Lizenzen und Hinweise. Beigefügte Lizenztexte stehen unter [docs/licenses](../licenses).
