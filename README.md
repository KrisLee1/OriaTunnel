<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/oriatunnel-logo-dark.svg">
    <img src="docs/assets/oriatunnel-logo.svg" alt="OriaTunnel" width="440">
  </picture>
</p>

<p align="center">在连接图中管理 SSH 隧道，让远端服务触手可及。</p>

<p align="center">
  简体中文 · <a href="docs/readme/README.zh-TW.md">繁體中文</a> · <a href="docs/readme/README.en.md">English</a> · <a href="docs/readme/README.ja.md">日本語</a> · <a href="docs/readme/README.ko.md">한국어</a> · <a href="docs/readme/README.de.md">Deutsch</a> · <a href="docs/readme/README.fr.md">Français</a> · <a href="docs/readme/README.ru.md">Русский</a>
</p>

OriaTunnel 是面向 Windows 和 macOS 的 SSH 端口转发桌面工具。通过连接图和列表，把 SSH 主机、转发路径和运行状态放在一起；为数据库、网页后台、开发服务或远程桌面保存可重复使用的连接规则。

**[阅读完整使用指南](docs/USAGE.md)** · [快速上手](#快速上手) · [选择转发方式](#选择转发方式)

## 能做什么

- **管理多条隧道**：按主机查看连接图和转发列表，独立或批量启动、停止规则。
- **覆盖常见 SSH 转发场景**：本地转发 L、远程转发 R、动态 SOCKS5 代理 D，支持有序多跳 ProxyJump。
- **复用已有主机配置**：从 SSH 配置中发现候选主机，或手动添加；支持密码、私钥和系统 SSH Agent。
- **查看实际运行情况**：连接状态、监听路径、流量、活动连接、重连进度和可筛选的事件日志。
- **适合日常使用**：托盘或菜单栏后台运行、网络故障后自动重连、可选开机自启和规则自动连接。
- **整理与迁移配置**：自定义名称、标签、颜色和图标，导入或导出连接规则。
- **8 种界面语言**：简体中文、繁體中文、日本語、한국어、English、Deutsch、Français、Русский，包含原生错误提示和 SSH 来源诊断；支持浅色、深色和主题设置。

## 选择转发方式

| 方式 | 适合的场景 | 使用方法 |
| --- | --- | --- |
| **L · 本地转发** | 在本机访问服务器上的网页、数据库或 VNC | 访问本机监听端口，经 SSH 连接到远端服务 |
| **R · 远程转发** | 让服务器访问本机运行的开发服务 | 在服务器侧访问监听端口，经 SSH 连接到本机服务 |
| **D · 动态代理** | 通过 SSH 主机访问多个内网地址 | 将浏览器或其他客户端配置为使用本机 SOCKS5 代理 |

如果服务器使用共享 IP，只分配了一个 SSH 端口，也可以通过该端口访问服务器上的多个服务。参见[共享 IP 场景](docs/USAGE.md#场景四共享-ip只分配一个-ssh-端口)。

## 快速上手

准备 SSH 主机地址、端口、用户名和认证方式，并确认要访问的服务已经运行。

1. 打开 OriaTunnel，点击「添加主机」，选择从 SSH 配置发现的主机，或手动填写连接信息。发现配置只会读取配置，不会自动连接。
2. 点击「新建转发」，选择主机和 L / R / D，填写监听端点；L / R 还需要填写目标地址与端口。
3. 选择「保存并启动」，按提示完成认证，并核对首次连接的服务器指纹。
4. 等待规则显示「监听中」，在浏览器或相应客户端中使用转发入口。D 需要先在客户端设置 SOCKS5 代理。

例如，访问 SSH 服务器上的网页服务：选择 **L**，本机监听填写 `127.0.0.1:13000`，目标填写 `127.0.0.1:3000`。启动后，在本机打开 `http://127.0.0.1:13000`。此处目标的 `127.0.0.1` 指 **SSH 服务器自身**，示例假设网页服务运行于服务器的 3000 端口。

「监听中」说明转发入口已就绪，服务是否可用还取决于目标服务、网络和访问权限。遇到问题请查看[状态与排错](docs/USAGE.md#查看状态与排查问题)。

## 下载与安装

前往 [Releases 下载页面](https://github.com/KrisLee1/OriaTunnel/releases)，选择适合操作系统和设备架构的安装包。

- **Windows**：下载 `.exe` 安装程序，双击后按向导完成安装。
- **macOS**：下载 `.dmg`，打开后将 `OriaTunnel.app` 拖入「应用程序」文件夹。如果下载的是 `.zip`，先解压出其中的 `.dmg` 再打开。

安装完成后启动 OriaTunnel，按[快速上手](#快速上手)添加 SSH 主机并创建转发。日常使用无需安装 Node.js、pnpm 或 Rust。

## 使用文档

[完整使用指南](docs/USAGE.md)包含主机管理、认证、三种转发的完整示例，以及后台运行和常见问题：

- [添加和管理 SSH 主机](docs/USAGE.md#添加和管理-ssh-主机)
- [创建和管理转发](docs/USAGE.md#创建和管理转发)
- [L：访问远端服务](docs/USAGE.md#场景一访问服务器上的网页或数据库l) · [R：访问本机服务](docs/USAGE.md#场景二让服务器访问本机开发服务r) · [D：SOCKS5 代理](docs/USAGE.md#场景三通过-ssh-代理访问多个服务d)
- [配置导入与导出](docs/USAGE.md#配置导入与导出)
- [后台运行、重连与自动启动](docs/USAGE.md#后台运行重连与自动启动)
- [状态与排错](docs/USAGE.md#查看状态与排查问题)

## 使用须知

L / R / D 均用于 TCP。D 只监听本机回环地址，支持 SOCKS5 CONNECT，不支持 UDP，也不会自动修改系统或浏览器代理。R 能否从其他电脑访问取决于服务器的 SSH 策略、防火墙和网络配置。

默认关闭窗口后，转发继续在托盘或菜单栏运行；选择「退出 OriaTunnel」会停止全部连接。自动连接是单独的可选设置，并要求所有跳板已有信任且能通过私钥或 Agent 认证，不使用已保存密码。

Windows / macOS 可选择将密码保存在系统凭据库。导出的配置不含密码、私钥正文或信任记录，但仍含主机地址、用户名和端口，分享前请确认内容。更多说明见[功能边界](docs/USAGE.md#当前功能边界)。

继续开发请参阅[开发指南](docs/DEVELOPMENT.md)。
