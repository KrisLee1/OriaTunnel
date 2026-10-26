<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/oriatunnel-logo-dark.svg">
    <img src="docs/assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<p align="center">可视化管理 SSH 隧道，轻松使用远程服务。</p>

<p align="center">
  简体中文 · <a href="docs/readme/README.zh-TW.md">繁體中文</a> · <a href="docs/readme/README.en.md">English</a> · <a href="docs/readme/README.ja.md">日本語</a> · <a href="docs/readme/README.ko.md">한국어</a> · <a href="docs/readme/README.de.md">Deutsch</a> · <a href="docs/readme/README.fr.md">Français</a> · <a href="docs/readme/README.ru.md">Русский</a>
</p>

OriaTunnel 是面向 Windows 和 macOS 的 SSH 隧道与远程服务管理工具。通过直观的界面集中管理多台服务器、隧道和服务，无需记忆复杂的转发命令，即可连接和使用内网中的数据库、网页后台及开发环境，并执行配置好的服务操作。

如果你需要通过 SSH 使用多台服务器上的多个服务，可以把主机和转发规则保存下来，日常通过点击启动、停止和打开服务。不熟悉 SSH 命令的使用者，也可以导入他人准备好的配置，补全自己的认证信息后使用。

当前版本：**v0.1.1** · [版本记录](#版本记录)

**[下载与安装](#下载与安装)** · [快速上手](#快速上手) · [完整使用指南](docs/USAGE.md)

## 能做什么

- **管理多条隧道**：按主机查看连接图和转发列表，独立或批量启动、停止规则。
- **把常用服务操作变成按钮**：保存启动、停止、重启、状态和日志等命令，从关联转发执行；可从内置模板开始配置。
- **按需检查并连接服务**：配置状态与健康检查，在支持的非交互启动流程中执行「启动并连接」，查看每一步的实际结果。
- **随时打开 SSH 终端**：通过已添加的主机打开多标签交互终端，也可在专用终端运行需要交互或持续前台运行的服务命令。
- **覆盖常见 SSH 转发场景**：本地转发 L、远程转发 R、动态 SOCKS5 代理 D，支持有序多跳 ProxyJump。
- **复用已有主机配置**：从 SSH 配置中发现候选主机，或手动添加；支持密码、私钥和系统 SSH Agent。
- **查看实际运行情况**：连接状态、监听路径、流量、活动连接、重连进度和可筛选的事件日志。
- **适合日常使用**：托盘或菜单栏后台运行、网络故障后自动重连、可选开机自启和规则自动连接。
- **整理与分享配置**：自定义名称、标签、颜色和图标，导入或导出主机、转发，以及明确选择的服务模板。
- **8 种界面语言**：简体中文、繁體中文、日本語、한국어、English、Deutsch、Français、Русский，包含原生错误提示和 SSH 来源诊断；支持浅色、深色和主题设置。

## 下载与安装

前往 [Releases 下载页面](https://github.com/KrisLee1/OriaTunnel/releases/tag/v0.1.1)，选择适合操作系统和设备架构的安装包。

- **Windows**：下载 `.exe` 安装程序，双击后按向导完成安装。
- **macOS**：下载 `.dmg`，打开后将 `OriaTunnel.app` 拖入「应用程序」文件夹。如果下载的是 `.zip`，先解压出其中的 `.dmg` 再打开。

| 平台 | 下载 |
| --- | --- |
| Windows x64 | [OriaTunnel_0.1.1_x64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_x64-setup.exe) |
| Windows ARM64 | [OriaTunnel_0.1.1_arm64-setup.exe](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_arm64-setup.exe) |
| macOS Apple Silicon | [OriaTunnel_0.1.1_aarch64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_aarch64.dmg) |
| macOS Intel | [OriaTunnel_0.1.1_x64.dmg](https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.1/OriaTunnel_0.1.1_x64.dmg) |

在「关于」的「版本更新」中检查新版本，按提示下载并安装；可关闭「启动时检查更新」。安装会中断当前 SSH 连接，请先保存终端中的工作。首次安装或较早开发构建请使用上方安装包。详见[应用更新](docs/USAGE.md#应用更新)。

安装完成后启动 OriaTunnel，按[快速上手](#快速上手)添加 SSH 主机并创建转发。日常使用无需安装 Node.js、pnpm 或 Rust。

## 快速上手

首次配置需要 SSH 主机地址、端口、用户名和认证方式，以及要访问的服务地址和端口。不清楚这些信息时，可请服务器管理员提供；无需先学会编写 SSH 命令。以下示例假设服务已经运行。

1. 打开 OriaTunnel，点击「添加主机」，选择从 SSH 配置发现的主机，或手动填写连接信息。发现配置只会读取配置，不会自动连接。
2. 点击「新建转发」，选择主机和 L / R / D，填写监听端点；L / R 还需要填写目标地址与端口。
3. 选择「保存并启动」，按提示完成认证，并核对首次连接的服务器指纹。
4. 等待规则显示「监听中」，在浏览器或相应客户端中使用转发入口。D 可从菜单打开独立代理浏览器；关联服务后可直接打开对应网页。

例如，访问 SSH 服务器上的网页服务：选择 **L**，本机监听填写 `127.0.0.1:13000`，目标填写 `127.0.0.1:3000`。启动后，在本机打开 `http://127.0.0.1:13000`。此处目标的 `127.0.0.1` 指 **SSH 服务器自身**，示例假设网页服务运行于服务器的 3000 端口。

「监听中」说明转发入口已就绪，服务是否可用还取决于目标服务、网络和访问权限。遇到问题请查看[状态与排错](docs/USAGE.md#查看状态与排查问题)。

配置完成后，下次在连接图或转发列表中启动已保存的规则即可；已选择 HTTP、HTTPS 或 VNC 协议的可用入口，可以点击「打开服务」。数据库等服务使用对应客户端连接。

已有配置文件时，从转发页点击「导入配置」，预览并确认后补全本机认证信息，再手动启动。导入的服务模板需要核对并启用执行。详见[使用现成配置](docs/USAGE.md#使用现成配置)。

需要先启动服务器上的应用时，在「服务」页创建或导入模板，检查命令中的路径、端口及运行环境，再在转发编辑器中关联它。之后从该转发的服务菜单执行操作；保存或关联模板不会自动运行命令。详见[预设远程命令](docs/USAGE.md#预设远程命令)。

## 选择转发方式

| 方式 | 适合的场景 | 使用方法 |
| --- | --- | --- |
| **L · 本地转发** | 在本机访问服务器上的网页、数据库或 VNC | 访问本机监听端口，经 SSH 连接到远端服务 |
| **R · 远程转发** | 让服务器访问本机运行的开发服务 | 在服务器侧访问监听端口，经 SSH 连接到本机服务 |
| **D · 动态代理** | 通过 SSH 主机访问多个内网地址 | 从菜单打开独立代理浏览器，或为其他客户端配置本机 SOCKS5 代理 |

如果服务器使用共享 IP，只分配了一个 SSH 端口，也可以通过该端口访问服务器上的多个服务。参见[共享 IP 场景](docs/USAGE.md#场景四共享-ip只分配一个-ssh-端口)。

## 界面预览

连接图、转发、服务、主机、日志和 SSH 终端的浅色／深色界面预览。画面使用独立示例数据，不包含真实服务器或凭据。

| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/connection-map-dark.png"><img src="docs/assets/screenshots/connection-map-light.png" alt="连接图"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/terminal-dark.png"><img src="docs/assets/screenshots/terminal-light.png" alt="SSH 终端"></picture> |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/forwards-dark.png"><img src="docs/assets/screenshots/forwards-light.png" alt="转发列表"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/services-dark.png"><img src="docs/assets/screenshots/services-light.png" alt="服务列表"></picture> |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/hosts-dark.png"><img src="docs/assets/screenshots/hosts-light.png" alt="SSH 主机"></picture> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/logs-dark.png"><img src="docs/assets/screenshots/logs-light.png" alt="日志"></picture> |

## 使用文档

[完整使用指南](docs/USAGE.md)从首次连接和日常使用讲起，包含主机、转发、服务操作、SSH 终端和问题排查：

- [第一次连接远程服务](docs/USAGE.md#第一次连接远程服务) · [使用现成配置](docs/USAGE.md#使用现成配置)
- [添加和管理 SSH 主机](docs/USAGE.md#添加和管理-ssh-主机)
- [创建和管理转发](docs/USAGE.md#创建和管理转发)
- [L：访问远端服务](docs/USAGE.md#场景一访问服务器上的网页或数据库l) · [R：访问本机服务](docs/USAGE.md#场景二让服务器访问本机开发服务r) · [D：SOCKS5 代理](docs/USAGE.md#场景三通过-ssh-代理访问多个服务d)
- [配置导入与导出](docs/USAGE.md#配置导入与导出)
- [服务模板与命令按钮](docs/USAGE.md#预设远程命令) · [状态、健康检查与启动并连接](docs/USAGE.md#服务状态健康检查与启动并连接)
- [SSH 交互终端](docs/USAGE.md#ssh-交互终端)
- [后台运行、重连与自动启动](docs/USAGE.md#后台运行重连与自动启动)
- [状态与排错](docs/USAGE.md#查看状态与排查问题)

## 版本记录

### v0.1.1 · 2026-10-27

- 新增 D 转发打开代理浏览器和直接访问远程服务的入口；
- 优化服务关联和管理逻辑，以及访问远程服务的体验；
- 优化连接图渲染性能，修复卡片渲染问题。

### v0.1.0 · 首个版本 · 2026-10-25

- 可视化 SSH 主机与 L / R / D 隧道管理、多跳认证及连接诊断。
- 可复用服务模板、命令按钮、状态与健康检查，以及启动服务后连接转发的组合操作。
- 多标签 SSH 交互终端，以及交互命令和前台服务的专用终端。
- 配置导入导出、托盘或菜单栏后台运行、隧道重连、八种界面语言与主题设置。

## 使用须知

L / R / D 均用于 TCP。D 只监听本机回环地址，支持 SOCKS5 CONNECT，不支持 UDP。可打开独立 Chrome、Edge 或 Firefox 代理窗口；不修改系统代理或日常浏览器设置，不支持 Safari。R 能否从其他电脑访问取决于服务器的 SSH 策略、防火墙和网络配置。

默认关闭窗口后，转发继续在托盘或菜单栏运行；选择「退出 OriaTunnel」会停止全部连接。自动连接是单独的可选设置，并要求所有跳板已有信任且能通过私钥或 Agent 认证，不使用已保存密码。

Windows / macOS 可选择将密码保存在系统凭据库。导出不会附带已保存的认证密码、私钥正文或信任记录，但会包含主机地址、用户名和端口；选择导出服务时还会包含脚本与环境变量，分享前请检查。更多说明见[功能边界](docs/USAGE.md#当前功能边界)。

服务模板需要与服务器上的实际软件、路径和权限匹配，不会自动安装或部署应用。普通启动或停止转发只控制隧道；远端服务的启停通过单独的服务操作完成。服务检查按需执行，未提供后台持续监控。

继续开发请参阅[开发指南](docs/DEVELOPMENT.md)。

遇到问题可先查看[排错指南](docs/USAGE.md#查看状态与排查问题)，再通过 [GitHub Issues](https://github.com/KrisLee1/OriaTunnel/issues)反馈复现步骤和脱敏信息。

## 许可证

Copyright (C) 2026 KrisLee.

OriaTunnel 采用 **GNU General Public License v3.0 only（GPL-3.0-only）**，仅适用第 3 版。完整条款见 [LICENSE](LICENSE)。

本软件不提供任何担保，详见许可证。第三方代码、依赖和资源继续适用各自的许可证与声明；仓库随附的第三方许可见 [docs/licenses](docs/licenses)。
