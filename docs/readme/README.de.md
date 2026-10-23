<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<p align="center">SSH-Tunnel in einer Verbindungsübersicht verwalten und entfernte Dienste bequem erreichen.</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · Deutsch · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a>
</p>

OriaTunnel ist eine Desktop-App zur SSH-Portweiterleitung für Windows und macOS. SSH-Hosts, Weiterleitungspfade und aktueller Status erscheinen gemeinsam in einer Verbindungsübersicht oder Liste. Speichern Sie wiederverwendbare Verbindungen für Datenbanken, Web-Dashboards, Entwicklungsdienste und Remote-Desktops.

**[Vollständiges Benutzerhandbuch (vereinfachtes Chinesisch)](../USAGE.md)** · [Schnellstart](#schnellstart) · [Weiterleitungsart wählen](#weiterleitungsart-wählen)

## Funktionen

- **Mehrere Tunnel verwalten:** Verbindungen nach Host anzeigen und Regeln einzeln oder gemeinsam starten und stoppen.
- **Vertraute SSH-Weiterleitungsarten nutzen:** lokale Weiterleitung (L), entfernte Weiterleitung (R) und dynamische SOCKS5-Weiterleitung (D), mit geordneten ProxyJump-Routen über mehrere Zwischenstationen.
- **Hosteinstellungen wiederverwenden:** Kandidaten aus der SSH-Konfiguration suchen oder Hosts manuell hinzufügen; Authentifizierung mit Passwort, privatem Schlüssel oder dem SSH-Agent des Systems.
- **Den Betrieb verfolgen:** Verbindungsstatus, Listen-Adressen und -Ports, Datenverkehr, aktive Verbindungen, Wiederverbindungsfortschritt und filterbare Ereignisprotokolle prüfen.
- **Tunnel verfügbar halten:** Betrieb im Infobereich oder in der Menüleiste, Wiederverbindung nach Netzwerkausfällen und optionaler Start bei der Anmeldung oder automatische Verbindung ausgewählter Regeln beim App-Start.
- **Konfigurationen ordnen und übertragen:** Namen, Tags, Farben und Symbole anpassen; Verbindungsregeln importieren und exportieren.
- **Eine von acht Oberflächensprachen wählen:** vereinfachtes Chinesisch, traditionelles Chinesisch, Japanisch, Koreanisch, Englisch, Deutsch, Französisch und Russisch, einschließlich nativer Fehlermeldungen und Diagnosen zur SSH-Konfiguration. Helle und dunkle Darstellung sowie Designeinstellungen sind verfügbar.

## Weiterleitungsart wählen

| Art | Geeignet für | Zugriff auf den Dienst |
| --- | --- | --- |
| **L · Lokale Weiterleitung** | Von diesem Computer auf eine Web-App, Datenbank oder einen VNC-Dienst des Servers zugreifen | Einen lokalen Listen-Port verwenden, der über SSH zum entfernten Dienst führt |
| **R · Entfernte Weiterleitung** | Einem Server Zugriff auf einen Entwicklungsdienst dieses Computers geben | Einen Listen-Port auf dem Server verwenden, der über SSH zum lokalen Dienst führt |
| **D · Dynamische Weiterleitung** | Über einen SSH-Host mehrere interne Adressen erreichen | Den Browser oder einen anderen Client für einen lokalen SOCKS5-Proxy konfigurieren |

Auch ein Server mit gemeinsam genutzter IP-Adresse und nur einem zugewiesenen SSH-Port kann über diesen Port Zugriff auf mehrere Dienste ermöglichen. Siehe das [Beispiel zur gemeinsam genutzten IP-Adresse (Chinesisch)](../USAGE.md#场景四共享-ip只分配一个-ssh-端口).

## Schnellstart

Halten Sie SSH-Adresse, Port, Benutzername und Authentifizierungsmethode bereit. Der gewünschte Dienst muss bereits laufen.

1. Öffnen Sie OriaTunnel und wählen Sie **Host hinzufügen**. Wählen Sie einen aus der SSH-Konfiguration gefundenen Host oder geben Sie seine Daten manuell ein. Die Hostsuche liest nur die Konfiguration und stellt keine automatische Verbindung her.
2. Wählen Sie **Neue Weiterleitung**, den Host und L / R / D. Geben Sie anschließend Listen-Adresse und -Port ein. L / R benötigen außerdem eine Zieladresse und einen Zielport.
3. Wählen Sie **Speichern und starten**, authentifizieren Sie sich bei Aufforderung und prüfen Sie bei der ersten Verbindung den Fingerabdruck des Servers.
4. Warten Sie auf **Listener bereit** und verwenden Sie dann den Weiterleitungsendpunkt im Browser oder im jeweiligen Client. Für D müssen Sie den Client zuerst für SOCKS5 konfigurieren.

Beispiel für den Zugriff auf eine Web-App auf dem SSH-Server: Wählen Sie **L**, verwenden Sie `127.0.0.1:13000` als lokalen Listen-Endpunkt und `127.0.0.1:3000` als Ziel. Öffnen Sie nach dem Start `http://127.0.0.1:13000` auf diesem Computer. Die Zieladresse `127.0.0.1` bezeichnet **den SSH-Server selbst**; das Beispiel setzt voraus, dass die Web-App dort auf Port 3000 läuft.

**Listener bereit** bedeutet, dass der Weiterleitungsendpunkt bereit ist. Die Verfügbarkeit des Dienstes hängt auch von der Zielanwendung, dem Netzwerk und den Berechtigungen ab. Bei Bedarf hilft der Abschnitt [Status und Fehlerbehebung (Chinesisch)](../USAGE.md#查看状态与排查问题).

## Herunterladen und installieren

Besuchen Sie die [Releases-Downloadseite](https://github.com/KrisLee1/OriaTunnel/releases) und wählen Sie das Paket für Ihr Betriebssystem und die Prozessorarchitektur Ihres Geräts.

- **Windows:** Laden Sie das `.exe`-Installationsprogramm herunter und folgen Sie dem Installationsassistenten.
- **macOS:** Laden Sie die `.dmg`-Datei herunter, öffnen Sie sie und ziehen Sie `OriaTunnel.app` in den Ordner **Programme (Applications)**. Wenn Sie eine `.zip`-Datei herunterladen, entpacken Sie zuerst die darin enthaltene `.dmg`-Datei.

Starten Sie OriaTunnel nach der Installation und folgen Sie dem [Schnellstart](#schnellstart), um einen SSH-Host hinzuzufügen und eine Weiterleitung zu erstellen. Für den täglichen Einsatz werden Node.js, pnpm und Rust nicht benötigt.

## Benutzerdokumentation

Das [vollständige Benutzerhandbuch (vereinfachtes Chinesisch)](../USAGE.md) beschreibt Hostverwaltung, Authentifizierung, ausführliche Weiterleitungsbeispiele, Hintergrundbetrieb und häufige Probleme:

- [SSH-Hosts hinzufügen und verwalten (Chinesisch)](../USAGE.md#添加和管理-ssh-主机)
- [Weiterleitungen erstellen und verwalten (Chinesisch)](../USAGE.md#创建和管理转发)
- [L: Auf entfernte Dienste zugreifen (Chinesisch)](../USAGE.md#场景一访问服务器上的网页或数据库l) · [R: Auf lokale Dienste zugreifen (Chinesisch)](../USAGE.md#场景二让服务器访问本机开发服务r) · [D: SOCKS5-Proxy (Chinesisch)](../USAGE.md#场景三通过-ssh-代理访问多个服务d)
- [Konfigurationen importieren und exportieren (Chinesisch)](../USAGE.md#配置导入与导出)
- [Hintergrundbetrieb, Wiederverbindungen und Start (Chinesisch)](../USAGE.md#后台运行重连与自动启动)
- [Status und Fehlerbehebung (Chinesisch)](../USAGE.md#查看状态与排查问题)

## Hinweise zur Nutzung

L / R / D leiten TCP-Datenverkehr weiter. D lauscht ausschließlich auf Loopback-Adressen und unterstützt SOCKS5 CONNECT, ohne UDP oder automatische Einrichtung des System- oder Browser-Proxys. Der Zugriff anderer Computer auf R hängt von den SSH-Richtlinien des Servers, seiner Firewall und der Netzwerkkonfiguration ab.

Beim Schließen des Fensters laufen Weiterleitungen standardmäßig im Infobereich oder in der Menüleiste weiter. **OriaTunnel beenden** stoppt alle Verbindungen. Die automatische Verbindung ist eine separate, ausdrücklich zu aktivierende Einstellung. Sie erfordert vertrauenswürdige Hosts auf jeder Zwischenstation sowie Authentifizierung per privatem Schlüssel oder Agent und verwendet keine gespeicherten Passwörter.

Unter Windows und macOS können Passwörter auf Wunsch im Anmeldeinformationsspeicher des Systems gespeichert werden. Exportierte Konfigurationen enthalten keine Passwörter, privaten Schlüsselinhalte oder Vertrauensdatensätze, aber Hostadressen, Benutzernamen und Ports. Prüfen Sie die Konfiguration vor dem Teilen. Einzelheiten stehen unter [Funktionsgrenzen (Chinesisch)](../USAGE.md#当前功能边界).

Hinweise zur Entwicklung finden Sie im [Entwicklerhandbuch (vereinfachtes Chinesisch)](../DEVELOPMENT.md).
