<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/oriatunnel-logo-dark.svg">
    <img src="../assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<p align="center">Manage SSH tunnels on a connection map. Keep remote services within reach.</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · English · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a>
</p>

OriaTunnel is an SSH port forwarding desktop app for Windows and macOS. See your SSH hosts, forwarding paths, and live status together in a connection map or list. Save reusable connections for databases, web dashboards, development services, and remote desktops.

**[Full user guide (Simplified Chinese)](../USAGE.md)** · [Quick start](#quick-start) · [Choose a forwarding mode](#choose-a-forwarding-mode)

## What you can do

- **Manage multiple tunnels:** view connections by host and start or stop rules individually or in batches.
- **Use familiar SSH forwarding modes:** local forwarding (L), remote forwarding (R), and dynamic SOCKS5 forwarding (D), with ordered multi-hop ProxyJump support.
- **Reuse host settings:** discover candidates from SSH configuration or add hosts manually; authenticate with a password, private key, or system SSH Agent.
- **See what is happening:** inspect connection status, listening paths, traffic, active connections, reconnect progress, and filterable event logs.
- **Keep tunnels available:** run in the tray or menu bar, reconnect after network failures, and optionally start at login or connect selected rules at app startup.
- **Organize and move configurations:** customize names, tags, colors, and icons; import or export connection rules.
- **Use one of eight interface languages:** Simplified Chinese, Traditional Chinese, Japanese, Korean, English, German, French, and Russian, including native error messages and SSH configuration diagnostics. Light, dark, and theme settings are available.

## Choose a forwarding mode

| Mode | When to use it | How you access the service |
| --- | --- | --- |
| **L · Local forwarding** | Access a server's web app, database, or VNC service from this computer | Connect to a local listening port, which reaches the remote service over SSH |
| **R · Remote forwarding** | Let a server access a development service running on this computer | Connect to a listening port on the server, which reaches the local service over SSH |
| **D · Dynamic forwarding** | Reach multiple internal addresses through an SSH host | Configure your browser or other client to use a local SOCKS5 proxy |

A server with a shared IP and only one assigned SSH port can still provide access to multiple services through that port. See the [shared IP example (Chinese)](../USAGE.md#场景四共享-ip只分配一个-ssh-端口).

## Quick start

Have your SSH address, port, username, and authentication method ready. The service you want to reach must already be running.

1. Open OriaTunnel and choose **Add host**. Select a host discovered from SSH configuration, or enter its details manually. Discovery only reads configuration; it does not connect automatically.
2. Choose **New forward**, select the host and L / R / D, then fill in the listening endpoint. L / R also require a target address and port.
3. Choose **Save and start**, authenticate when prompted, and verify the server fingerprint on the first connection.
4. Wait for **Listening**, then use the forwarding endpoint in your browser or service client. For D, configure the client to use SOCKS5 first.

For example, to reach a web app on your SSH server, choose **L**, listen on `127.0.0.1:13000`, and target `127.0.0.1:3000`. Once started, open `http://127.0.0.1:13000` on this computer. The target `127.0.0.1` means **the SSH server itself**; this example assumes the web app is running on port 3000 there.

**Listening** means the forwarding endpoint is ready. Service availability also depends on the target application, network, and permissions. See [status and troubleshooting (Chinese)](../USAGE.md#查看状态与排查问题) if needed.

## Get and run OriaTunnel

Windows and macOS source code is available; this repository has not yet published installation packages. To run from source, install Node.js 22.12+, pnpm, and Rust. Windows also requires MSVC C++ build tools and the WebView2 Runtime; macOS requires Xcode Command Line Tools or a configured Xcode installation.

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` only opens a browser preview. SSH connections and configuration persistence require the desktop app.

## User documentation

The [full user guide (Simplified Chinese)](../USAGE.md) covers host management, authentication, worked forwarding examples, background operation, and common problems:

- [Add and manage SSH hosts](../USAGE.md#添加和管理-ssh-主机)
- [Create and manage forwards](../USAGE.md#创建和管理转发)
- [L: access remote services](../USAGE.md#场景一访问服务器上的网页或数据库l) · [R: access local services](../USAGE.md#场景二让服务器访问本机开发服务r) · [D: SOCKS5 proxy](../USAGE.md#场景三通过-ssh-代理访问多个服务d)
- [Import and export configurations](../USAGE.md#配置导入与导出)
- [Background operation, reconnects, and startup](../USAGE.md#后台运行重连与自动启动)
- [Status and troubleshooting](../USAGE.md#查看状态与排查问题)

## Things to know

L / R / D forward TCP traffic. D listens only on loopback addresses and supports SOCKS5 CONNECT, without UDP or automatic system/browser proxy setup. Access to R from other computers depends on the server's SSH policy, firewall, and network configuration.

Closing the window keeps forwards running in the tray or menu bar by default. **Quit OriaTunnel** stops all connections. Automatic connection is a separate opt-in setting, requires trusted hosts on every hop and private-key or Agent authentication, and does not use saved passwords.

On Windows and macOS, you may opt to save passwords in the system credential store. Exported configurations exclude passwords, private key contents, and trust records, but include host addresses, usernames, and ports. Review them before sharing. See [feature boundaries (Chinese)](../USAGE.md#当前功能边界) for details.

For development, see the [development guide (Simplified Chinese)](../DEVELOPMENT.md).
