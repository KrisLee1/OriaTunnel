<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<p align="center">Manage SSH tunnels visually. Use remote services with ease.</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · English · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a>
</p>

OriaTunnel is a desktop tool for managing SSH tunnels and remote services on Windows and macOS. Manage multiple servers, tunnels, and services in a visual interface, without memorizing complex forwarding commands. Access internal databases, web dashboards, and development environments, and run configured service actions.

Save hosts and forwarding rules once, then start, stop, and open services through the interface. If you are unfamiliar with SSH commands, you can import a configuration prepared by an administrator or colleague and supply your own authentication details.

Current version: **v0.1.0** · [Version history](#version-history)

**[Full user guide (Simplified Chinese)](../USAGE.md)** · [Quick start](#quick-start) · [Choose a forwarding mode](#choose-a-forwarding-mode)

## What you can do

- **Manage multiple tunnels:** view connections by host and start or stop rules individually or in batches.
- **Turn service commands into buttons:** save start, stop, restart, status, and log actions, then run them from a linked forward. Built-in templates help you get started.
- **Check and connect services:** configure status and health probes, or use a supported non-interactive start action to start a service and connect its forward, with results for each step.
- **Open an SSH terminal:** use multiple interactive terminal tabs, or run interactive and long-running foreground commands in dedicated terminals.
- **Use familiar SSH forwarding modes:** local forwarding (L), remote forwarding (R), and dynamic SOCKS5 forwarding (D), with ordered multi-hop ProxyJump support.
- **Reuse host settings:** discover candidates from SSH configuration or add hosts manually; authenticate with a password, private key, or system SSH Agent.
- **See what is happening:** inspect connection status, listening paths, traffic, active connections, reconnect progress, and filterable event logs.
- **Keep tunnels available:** run in the tray or menu bar, reconnect after network failures, and optionally start at login or connect selected rules at app startup.
- **Organize and share configurations:** customize names, tags, colors, and icons; import or export hosts, forwards, and explicitly selected service templates.
- **Use one of eight interface languages:** Simplified Chinese, Traditional Chinese, Japanese, Korean, English, German, French, and Russian, including native error messages and SSH configuration diagnostics. Light, dark, and theme settings are available.

## Download and install

Visit the [Releases download page](https://github.com/KrisLee1/OriaTunnel/releases/tag/v0.1.0) and choose the package for your operating system and device architecture.

- **Windows:** download the `.exe` installer and follow the installation wizard.
- **macOS:** download and open the `.dmg`, then drag `OriaTunnel.app` into **Applications**. If you download a `.zip`, extract the `.dmg` inside it first.

| Platform | Download |
| --- | --- |
| Windows x64 | [OriaTunnel_0.1.0_x64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/OriaTunnel_0.1.0_x64-setup.exe) |
| Windows ARM64 | [OriaTunnel_0.1.0_arm64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/OriaTunnel_0.1.0_arm64-setup.exe) |
| macOS Apple Silicon | [OriaTunnel_0.1.0_aarch64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/OriaTunnel_0.1.0_aarch64.dmg) |
| macOS Intel | [OriaTunnel_0.1.0_x64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/OriaTunnel_0.1.0_x64.dmg) |

Check for updates under **About → Version update**, then download and install when ready. Startup checks can be disabled. Installation disconnects SSH sessions; save terminal work first. Use the installers above for a first installation or an older development build. See [application updates (Chinese)](../USAGE.md#应用更新).

Launch OriaTunnel after installation, then follow the [quick start](#quick-start) to add an SSH host and create a forward. Everyday use does not require Node.js, pnpm, or Rust.

## Quick start

For initial setup, have the SSH address, port, username, authentication method, and target service address and port ready. Ask your administrator if needed; you do not need to learn SSH command syntax first. This example assumes the service is already running.

1. Open OriaTunnel and choose **Add host**. Select a host discovered from SSH configuration, or enter its details manually. Discovery only reads configuration; it does not connect automatically.
2. Choose **New forward**, select the host and L / R / D, then fill in the listening endpoint. L / R also require a target address and port.
3. Choose **Save and start**, authenticate when prompted, and verify the server fingerprint on the first connection.
4. Wait for **Listening**, then use the forwarding endpoint in your browser or service client. For D, configure the client to use SOCKS5 first.

For example, to reach a web app on your SSH server, choose **L**, listen on `127.0.0.1:13000`, and target `127.0.0.1:3000`. Once started, open `http://127.0.0.1:13000` on this computer. The target `127.0.0.1` means **the SSH server itself**; this example assumes the web app is running on port 3000 there.

**Listening** means the forwarding endpoint is ready. Service availability also depends on the target application, network, and permissions. See [status and troubleshooting (Chinese)](../USAGE.md#查看状态与排查问题) if needed.

After setup, start the saved rule from the map or forward list. For a ready HTTP, HTTPS, or VNC endpoint, use **Open service**; databases use their corresponding clients.

Already have an OriaTunnel configuration file? Choose **Import configuration** on the forward page, review it, and supply your authentication details before starting. Imported service templates require review and explicit enablement. See [use an existing configuration (Chinese)](../USAGE.md#使用现成配置).

To operate a remote service, create or import a template on the services page, check its commands and paths, then link it in the forward editor. Run actions from that forward’s service menu. Saving or linking a template does not execute commands. See [service templates (Chinese)](../USAGE.md#预设远程命令).

## Choose a forwarding mode

| Mode | When to use it | How you access the service |
| --- | --- | --- |
| **L · Local forwarding** | Access a server's web app, database, or VNC service from this computer | Connect to a local listening port, which reaches the remote service over SSH |
| **R · Remote forwarding** | Let a server access a development service running on this computer | Connect to a listening port on the server, which reaches the local service over SSH |
| **D · Dynamic forwarding** | Reach multiple internal addresses through an SSH host | Configure your browser or other client to use a local SOCKS5 proxy |

A server with a shared IP and only one assigned SSH port can still provide access to multiple services through that port. See the [shared IP example (Chinese)](../USAGE.md#场景四共享-ip只分配一个-ssh-端口).

## Screenshots

Light and dark views of the connection map, forwards, services, hosts, logs, and SSH terminal. Images use isolated example data, without real servers or credentials.

| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/connection-map-dark.png"><img src="../assets/screenshots/connection-map-light.png" alt="Connection map"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/terminal-dark.png"><img src="../assets/screenshots/terminal-light.png" alt="SSH terminal"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/forwards-dark.png"><img src="../assets/screenshots/forwards-light.png" alt="Forwards"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/services-dark.png"><img src="../assets/screenshots/services-light.png" alt="Services"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/hosts-dark.png"><img src="../assets/screenshots/hosts-light.png" alt="SSH hosts"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/logs-dark.png"><img src="../assets/screenshots/logs-light.png" alt="Logs"></picture> |

## User documentation

The [full user guide (Simplified Chinese)](../USAGE.md) covers host management, authentication, worked forwarding examples, background operation, and common problems.

- [First connection and everyday use](../USAGE.md#第一次连接远程服务)
- [Use an existing configuration](../USAGE.md#使用现成配置)
- [Service templates and actions](../USAGE.md#预设远程命令)
- [Status, health checks, and starting a service with its forward](../USAGE.md#服务状态健康检查与启动并连接)
- [Interactive SSH terminal](../USAGE.md#ssh-交互终端)
- [Add and manage SSH hosts](../USAGE.md#添加和管理-ssh-主机)
- [Create and manage forwards](../USAGE.md#创建和管理转发)
- [L: access remote services](../USAGE.md#场景一访问服务器上的网页或数据库l) · [R: access local services](../USAGE.md#场景二让服务器访问本机开发服务r) · [D: SOCKS5 proxy](../USAGE.md#场景三通过-ssh-代理访问多个服务d)
- [Import and export configurations](../USAGE.md#配置导入与导出)
- [Background operation, reconnects, and startup](../USAGE.md#后台运行重连与自动启动)
- [Status and troubleshooting](../USAGE.md#查看状态与排查问题)

## Version history

### v0.1.0 · Initial version · 2026-10-25

- Visual SSH host and L / R / D tunnel management, multi-hop authentication, and connection diagnostics.
- Reusable service templates, command actions, status and health checks, and combined service startup and forwarding.
- Multi-tab SSH terminals and dedicated terminals for interactive or foreground service commands.
- Configuration import/export, tray or menu bar operation, tunnel reconnection, eight interface languages, and theme settings.

## Things to know

L / R / D forward TCP traffic. D listens only on loopback addresses and supports SOCKS5 CONNECT, without UDP or automatic system/browser proxy setup. Access to R from other computers depends on the server's SSH policy, firewall, and network configuration.

Closing the window keeps forwards running in the tray or menu bar by default. **Quit OriaTunnel** stops all connections. Automatic connection is a separate opt-in setting, requires trusted hosts on every hop and private-key or Agent authentication, and does not use saved passwords.

On Windows and macOS, you may opt to save passwords in the system credential store. Exports do not include stored authentication passwords, private key contents, or trust records. They do include host addresses, usernames, and ports, plus scripts and environment variables when services are selected. Review the contents before sharing. See [feature boundaries (Chinese)](../USAGE.md#当前功能边界) for details.

Service templates must match the software, paths, and permissions on the server; they do not install or deploy applications. Starting or stopping a forward controls the tunnel. Remote service actions are separate, and checks run on demand without continuous background monitoring.

For development, see the [development guide (Simplified Chinese)](../DEVELOPMENT.md).

For problems, check the [troubleshooting guide (Chinese)](../USAGE.md#查看状态与排查问题) or report steps and redacted details in [GitHub Issues](https://github.com/KrisLee1/OriaTunnel/issues).

## License

Copyright (C) 2026 KrisLee.

OriaTunnel is licensed under the **GNU General Public License, version 3 only (GPL-3.0-only)**. See [LICENSE](../../LICENSE) for the full terms.

This software is provided without any warranty, as detailed in the license. Third-party code, dependencies, and assets retain their respective licenses and notices. Bundled third-party license texts are available in [docs/licenses](../licenses).
