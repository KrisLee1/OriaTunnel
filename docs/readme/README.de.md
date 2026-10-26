<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<p align="center">SSH-Tunnel visuell verwalten und entfernte Dienste einfach nutzen.</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · Deutsch · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a>
</p>

OriaTunnel ist ein Desktop-Werkzeug zur Verwaltung von SSH-Tunneln und entfernten Diensten unter Windows und macOS. Verwalten Sie mehrere Server, Tunnel und Dienste über eine grafische Oberfläche, ohne sich komplexe Weiterleitungsbefehle merken zu müssen. Greifen Sie auf interne Datenbanken, Web-Oberflächen und Entwicklungsumgebungen zu und führen Sie vorbereitete Dienstaktionen aus.

Speichern Sie Hosts und Weiterleitungsregeln und nutzen Sie die Oberfläche zum Starten, Stoppen und Öffnen von Diensten. Auch ohne SSH-Befehlskenntnisse können Sie eine vorbereitete Konfiguration importieren und Ihre eigenen Authentifizierungsdaten ergänzen.

Aktuelle Version: **v0.1.1** · [Versionsverlauf](#versionsverlauf)

**[Vollständiges Benutzerhandbuch (vereinfachtes Chinesisch)](../USAGE.md)** · [Schnellstart](#schnellstart) · [Weiterleitungsart wählen](#weiterleitungsart-wählen)

## Funktionen

- **Mehrere Tunnel verwalten:** Verbindungen nach Host anzeigen und Regeln einzeln oder gemeinsam starten und stoppen.
- **Dienstbefehle als Schaltflächen speichern:** Start, Stopp, Neustart, Status und Protokolle über eine verknüpfte Weiterleitung ausführen; integrierte Vorlagen erleichtern die Einrichtung.
- **Dienste prüfen und verbinden:** Status- und Zustandsprüfungen konfigurieren oder einen unterstützten nichtinteraktiven Start mit der Weiterleitung verbinden und die einzelnen Ergebnisse verfolgen.
- **SSH-Terminal öffnen:** mehrere interaktive Terminal-Tabs nutzen oder interaktive und dauerhaft im Vordergrund laufende Befehle in eigenen Terminals ausführen.
- **Vertraute SSH-Weiterleitungsarten nutzen:** lokale Weiterleitung (L), entfernte Weiterleitung (R) und dynamische SOCKS5-Weiterleitung (D), mit geordneten ProxyJump-Routen über mehrere Zwischenstationen.
- **Hosteinstellungen wiederverwenden:** Kandidaten aus der SSH-Konfiguration suchen oder Hosts manuell hinzufügen; Authentifizierung mit Passwort, privatem Schlüssel oder dem SSH-Agent des Systems.
- **Den Betrieb verfolgen:** Verbindungsstatus, Listen-Adressen und -Ports, Datenverkehr, aktive Verbindungen, Wiederverbindungsfortschritt und filterbare Ereignisprotokolle prüfen.
- **Tunnel verfügbar halten:** Betrieb im Infobereich oder in der Menüleiste, Wiederverbindung nach Netzwerkausfällen und optionaler Start bei der Anmeldung oder automatische Verbindung ausgewählter Regeln beim App-Start.
- **Konfigurationen ordnen und teilen:** Namen, Tags, Farben und Symbole anpassen; Hosts, Weiterleitungen und ausdrücklich ausgewählte Dienstvorlagen importieren und exportieren.
- **Eine von acht Oberflächensprachen wählen:** vereinfachtes Chinesisch, traditionelles Chinesisch, Japanisch, Koreanisch, Englisch, Deutsch, Französisch und Russisch, einschließlich nativer Fehlermeldungen und Diagnosen zur SSH-Konfiguration. Helle und dunkle Darstellung sowie Designeinstellungen sind verfügbar.

## Herunterladen und installieren

Besuchen Sie die [Releases-Downloadseite](https://github.com/KrisLee1/OriaTunnel/releases/tag/v0.1.1) und wählen Sie das Paket für Ihr Betriebssystem und die Prozessorarchitektur Ihres Geräts.

- **Windows:** Laden Sie das `.exe`-Installationsprogramm herunter und folgen Sie dem Installationsassistenten.
- **macOS:** Laden Sie die `.dmg`-Datei herunter, öffnen Sie sie und ziehen Sie `OriaTunnel.app` in den Ordner **Programme (Applications)**. Wenn Sie eine `.zip`-Datei herunterladen, entpacken Sie zuerst die darin enthaltene `.dmg`-Datei.

| Plattform | Download |
| --- | --- |
| Windows x64 | [OriaTunnel_0.1.1_x64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_x64-setup.exe) |
| Windows ARM64 | [OriaTunnel_0.1.1_arm64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_arm64-setup.exe) |
| macOS Apple Silicon | [OriaTunnel_0.1.1_aarch64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_aarch64.dmg) |
| macOS Intel | [OriaTunnel_0.1.1_x64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_x64.dmg) |

Unter **Über → Versionsaktualisierung** können Sie Updates prüfen, herunterladen und installieren. Die Prüfung beim Start ist abschaltbar. Die Installation trennt SSH-Verbindungen; speichern Sie vorher Ihre Terminalarbeit. Für die Erstinstallation oder ältere Entwicklungsbuilds verwenden Sie die obigen Installationspakete. Siehe [App-Updates (Chinesisch)](../USAGE.md#应用更新).

Starten Sie OriaTunnel nach der Installation und folgen Sie dem [Schnellstart](#schnellstart), um einen SSH-Host hinzuzufügen und eine Weiterleitung zu erstellen. Für den täglichen Einsatz werden Node.js, pnpm und Rust nicht benötigt.

## Schnellstart

Für die erste Einrichtung benötigen Sie SSH-Adresse, Port, Benutzername und Authentifizierung sowie Adresse und Port des Zieldienstes. Fragen Sie bei Bedarf den Administrator; SSH-Befehle müssen Sie dafür nicht lernen. Im folgenden Beispiel läuft der Dienst bereits.

1. Öffnen Sie OriaTunnel und wählen Sie **Host hinzufügen**. Wählen Sie einen aus der SSH-Konfiguration gefundenen Host oder geben Sie seine Daten manuell ein. Die Hostsuche liest nur die Konfiguration und stellt keine automatische Verbindung her.
2. Wählen Sie **Neue Weiterleitung**, den Host und L / R / D. Geben Sie anschließend Listen-Adresse und -Port ein. L / R benötigen außerdem eine Zieladresse und einen Zielport.
3. Wählen Sie **Speichern und starten**, authentifizieren Sie sich bei Aufforderung und prüfen Sie bei der ersten Verbindung den Fingerabdruck des Servers.
4. Warten Sie auf **Listener bereit** und verwenden Sie dann den Weiterleitungsendpunkt im Browser oder im jeweiligen Client. Für D können Sie das Proxy-Browser-Menü verwenden und zugeordnete Dienste direkt öffnen.

Beispiel für den Zugriff auf eine Web-App auf dem SSH-Server: Wählen Sie **L**, verwenden Sie `127.0.0.1:13000` als lokalen Listen-Endpunkt und `127.0.0.1:3000` als Ziel. Öffnen Sie nach dem Start `http://127.0.0.1:13000` auf diesem Computer. Die Zieladresse `127.0.0.1` bezeichnet **den SSH-Server selbst**; das Beispiel setzt voraus, dass die Web-App dort auf Port 3000 läuft.

**Listener bereit** bedeutet, dass der Weiterleitungsendpunkt bereit ist. Die Verfügbarkeit des Dienstes hängt auch von der Zielanwendung, dem Netzwerk und den Berechtigungen ab. Bei Bedarf hilft der Abschnitt [Status und Fehlerbehebung (Chinesisch)](../USAGE.md#查看状态与排查问题).

Nach der Einrichtung starten Sie die gespeicherte Regel in der Übersicht oder Liste. Verfügbare HTTP-, HTTPS- oder VNC-Zugänge öffnen Sie über die Dienst-Schaltfläche; Datenbanken verwenden den jeweiligen Client.

Liegt bereits eine OriaTunnel-Konfiguration vor, importieren und prüfen Sie diese auf der Weiterleitungsseite und ergänzen Ihre Authentifizierung. Importierte Dienstvorlagen müssen vor der Ausführung geprüft und freigegeben werden. Siehe [vorbereitete Konfiguration nutzen (Chinesisch)](../USAGE.md#使用现成配置).

Für Dienstaktionen erstellen oder importieren Sie eine Vorlage auf der Diensteseite, prüfen Befehle und Pfade und verknüpfen sie im Weiterleitungseditor. Aktionen starten Sie im Dienstmenü dieser Weiterleitung. Speichern oder Verknüpfen führt keine Befehle aus. Siehe [Dienstvorlagen (Chinesisch)](../USAGE.md#预设远程命令).

## Weiterleitungsart wählen

| Art | Geeignet für | Zugriff auf den Dienst |
| --- | --- | --- |
| **L · Lokale Weiterleitung** | Von diesem Computer auf eine Web-App, Datenbank oder einen VNC-Dienst des Servers zugreifen | Einen lokalen Listen-Port verwenden, der über SSH zum entfernten Dienst führt |
| **R · Entfernte Weiterleitung** | Einem Server Zugriff auf einen Entwicklungsdienst dieses Computers geben | Einen Listen-Port auf dem Server verwenden, der über SSH zum lokalen Dienst führt |
| **D · Dynamische Weiterleitung** | Über einen SSH-Host mehrere interne Adressen erreichen | Separaten Proxy-Browser über das Menü öffnen oder einen anderen Client für lokales SOCKS5 konfigurieren |

Auch ein Server mit gemeinsam genutzter IP-Adresse und nur einem zugewiesenen SSH-Port kann über diesen Port Zugriff auf mehrere Dienste ermöglichen. Siehe das [Beispiel zur gemeinsam genutzten IP-Adresse (Chinesisch)](../USAGE.md#场景四共享-ip只分配一个-ssh-端口).

## Bildschirmansichten

Helle und dunkle Ansichten von Verbindungsübersicht, Weiterleitungen, Diensten, Hosts, Protokollen und SSH-Terminal. Die Bilder verwenden isolierte Beispieldaten ohne echte Server oder Zugangsdaten.

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/connection-map-dark.png"><img src="../assets/screenshots/connection-map-light.png" alt="Verbindungsübersicht"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/terminal-dark.png"><img src="../assets/screenshots/terminal-light.png" alt="SSH-Terminal"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/forwards-dark.png"><img src="../assets/screenshots/forwards-light.png" alt="Weiterleitungen"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/services-dark.png"><img src="../assets/screenshots/services-light.png" alt="Dienste"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/hosts-dark.png"><img src="../assets/screenshots/hosts-light.png" alt="SSH-Hosts"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/logs-dark.png"><img src="../assets/screenshots/logs-light.png" alt="Protokolle"></picture> |

## Benutzerdokumentation

Das [vollständige Benutzerhandbuch (vereinfachtes Chinesisch)](../USAGE.md) beschreibt Hostverwaltung, Authentifizierung, ausführliche Weiterleitungsbeispiele, Hintergrundbetrieb und häufige Probleme.

- [Erste Verbindung und tägliche Nutzung](../USAGE.md#第一次连接远程服务)
- [Vorbereitete Konfiguration nutzen](../USAGE.md#使用现成配置)
- [Dienstvorlagen und Aktionen](../USAGE.md#预设远程命令)
- [Status- und Zustandsprüfungen sowie Start und Verbindung](../USAGE.md#服务状态健康检查与启动并连接)
- [Interaktives SSH-Terminal](../USAGE.md#ssh-交互终端)
- [SSH-Hosts hinzufügen und verwalten (Chinesisch)](../USAGE.md#添加和管理-ssh-主机)
- [Weiterleitungen erstellen und verwalten (Chinesisch)](../USAGE.md#创建和管理转发)
- [L: Auf entfernte Dienste zugreifen (Chinesisch)](../USAGE.md#场景一访问服务器上的网页或数据库l) · [R: Auf lokale Dienste zugreifen (Chinesisch)](../USAGE.md#场景二让服务器访问本机开发服务r) · [D: SOCKS5-Proxy (Chinesisch)](../USAGE.md#场景三通过-ssh-代理访问多个服务d)
- [Konfigurationen importieren und exportieren (Chinesisch)](../USAGE.md#配置导入与导出)
- [Hintergrundbetrieb, Wiederverbindungen und Start (Chinesisch)](../USAGE.md#后台运行重连与自动启动)
- [Status und Fehlerbehebung (Chinesisch)](../USAGE.md#查看状态与排查问题)

## Versionsverlauf

### v0.1.1 · 2026-10-27

- D-Weiterleitungen können jetzt einen Proxy-Browser öffnen und direkt auf entfernte Dienste zugreifen.
- Dienstzuordnungen, Verwaltung und der Zugriff auf entfernte Dienste wurden verbessert.
- Die Darstellung der Verbindungsübersicht wurde beschleunigt und Darstellungsfehler bei Karten wurden behoben.

### v0.1.0 · Erste Version · 2026-10-25

- Visuelle Verwaltung von SSH-Hosts und L-/R-/D-Tunneln, mehrstufige Authentifizierung und Verbindungsdiagnose.
- Wiederverwendbare Dienstvorlagen, Befehlsaktionen, Status- und Zustandsprüfungen sowie kombinierter Dienststart und Verbindungsaufbau.
- SSH-Terminals mit mehreren Tabs und eigene Terminals für interaktive oder im Vordergrund laufende Befehle.
- Konfigurationsimport und -export, Betrieb im Infobereich oder in der Menüleiste, Tunnel-Wiederverbindung, acht Oberflächensprachen und Designeinstellungen.

## Hinweise zur Nutzung

L / R / D leiten TCP-Datenverkehr weiter. D lauscht ausschließlich auf Loopback-Adressen und unterstützt SOCKS5 CONNECT ohne UDP. Es kann separate Proxy-Fenster von Chrome, Edge oder Firefox öffnen, ohne Systemproxys oder normale Browserprofile zu ändern. Safari wird nicht unterstützt. Der Zugriff anderer Computer auf R hängt von den SSH-Richtlinien des Servers, seiner Firewall und der Netzwerkkonfiguration ab.

Beim Schließen des Fensters laufen Weiterleitungen standardmäßig im Infobereich oder in der Menüleiste weiter. **OriaTunnel beenden** stoppt alle Verbindungen. Die automatische Verbindung ist eine separate, ausdrücklich zu aktivierende Einstellung. Sie erfordert vertrauenswürdige Hosts auf jeder Zwischenstation sowie Authentifizierung per privatem Schlüssel oder Agent und verwendet keine gespeicherten Passwörter.

Unter Windows und macOS können Passwörter auf Wunsch im Anmeldeinformationsspeicher des Systems gespeichert werden. Gespeicherte Authentifizierungspasswörter, private Schlüsselinhalte und Vertrauensdatensätze werden nicht exportiert. Hostadressen, Benutzernamen und Ports sowie bei ausgewählten Diensten auch Skripte und Umgebungsvariablen sind enthalten. Prüfen Sie den Inhalt vor dem Teilen. Einzelheiten stehen unter [Funktionsgrenzen (Chinesisch)](../USAGE.md#当前功能边界).

Dienstvorlagen müssen zu Software, Pfaden und Rechten auf dem Server passen; sie installieren oder verteilen keine Anwendungen. Start und Stopp einer Weiterleitung steuern den Tunnel. Dienstaktionen sind davon getrennt. Prüfungen erfolgen auf Anfrage, ohne dauerhafte Hintergrundüberwachung.

Hinweise zur Entwicklung finden Sie im [Entwicklerhandbuch (vereinfachtes Chinesisch)](../DEVELOPMENT.md).

Prüfen Sie bei Problemen die [Fehlerhilfe (Chinesisch)](../USAGE.md#查看状态与排查问题) oder melden Sie Schritte und bereinigte Angaben über [GitHub Issues](https://github.com/KrisLee1/OriaTunnel/issues).

## Lizenz

Copyright (C) 2026 KrisLee.

OriaTunnel steht unter der **GNU General Public License, ausschließlich Version 3 (GPL-3.0-only)**. Die vollständigen Bedingungen finden Sie in [LICENSE](../../LICENSE).

Die Software wird ohne Gewährleistung gemäß den Lizenzbedingungen bereitgestellt. Für Code, Abhängigkeiten und Ressourcen Dritter gelten weiterhin deren jeweilige Lizenzen und Hinweise. Beigefügte Lizenztexte stehen unter [docs/licenses](../licenses).
