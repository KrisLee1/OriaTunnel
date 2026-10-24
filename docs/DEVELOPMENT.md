# OriaTunnel 开发指南

本指南用于在另一台 Windows 或 macOS 设备上继续开发。日常使用说明见 [使用指南](USAGE.md)，当前进度与验证边界见 [项目状态](PROJECT_STATUS.md)。

## 开始修改之前

按工作内容阅读以下文档：

| 文档 | 用途 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 项目工作规则、SSH 与凭据约束、提交和发布范围 |
| [项目状态](PROJECT_STATUS.md) | 当前实现、最近修改、验证证据与待验证范围 |
| [产品与界面设计](ORIA_TUNNEL_DESIGN.md) | 产品方向、阶段方案及架构背景；实际行为以源码和项目状态为准 |
| [UI 开发入口](ui-development.md) | 组件复用、主题、窗口、交互和多语言规则 |
| [组件索引](ui/components/index.md) | 查找现有组件及业务组合入口 |
| [外壳迁移清单](shell-migration.json) | 原版外壳的迁移来源与摘要 |

这些文档随仓库跟踪。`outputs/` 中的截图、验证夹具、备份和日志属于本机产物，不随仓库同步；项目状态中的历史路径只是证据位置，不是克隆仓库后必然存在的文件。

## 环境准备

共同需要 Git、Node.js 22.12+、pnpm 和 Rust 工具链。前端与 Rust 依赖分别由 `pnpm-lock.yaml` 和 `src-tauri/Cargo.lock` 锁定；首次准备环境需要下载依赖，不要为换设备而重新生成锁文件。

- **Windows**：安装 MSVC C++ 构建工具、Windows SDK 和 WebView2 Runtime，使用 MSVC Rust 工具链。运行 Rust 配置语义测试还需要系统 OpenSSH Client；跳过凭据测试也不会跳过该依赖。
- **macOS**：安装 Xcode Command Line Tools，或已接受许可并完成首次配置的 Xcode。打包配置的最低系统版本为 11.0，不代表已在所有旧系统和 Intel 设备验证。

克隆仓库后，后续命令均在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm tauri dev` 同时启动 Vite 和 Tauri 桌面应用。Vite 固定使用本机 1420 端口；若端口占用，先检查已有开发进程。`pnpm dev` 仅用于浏览器界面预览，不具备 SSH、配置持久化和原生窗口能力。

macOS 若默认选中了尚未配置完成的 Xcode，而 Command Line Tools 已安装，可仅为当前命令指定工具目录：

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools pnpm tauri dev
```

## 隔离验证数据

调试构建支持两个环境变量：

| 环境变量 | 作用 |
| --- | --- |
| `ORIATUNNEL_TEST_DATA_DIR` | 使用独立应用数据目录，隔离连接配置、信任记录和单实例锁 |
| `ORIATUNNEL_TEST_SSH_CONFIG` | 只从指定 SSH 配置文件发现主机，替代默认和附加来源 |

macOS 可创建一个空 SSH 配置后启动独立调试数据环境：

```sh
mkdir -p outputs/dev-profile
: > outputs/dev-profile/ssh_config
ORIATUNNEL_TEST_DATA_DIR="$PWD/outputs/dev-profile/data" \
ORIATUNNEL_TEST_SSH_CONFIG="$PWD/outputs/dev-profile/ssh_config" \
pnpm tauri dev
```

Windows PowerShell 对应写法：

```powershell
New-Item -ItemType Directory -Force outputs/dev-profile | Out-Null
Set-Content -Path outputs/dev-profile/ssh_config -Value ''
$env:ORIATUNNEL_TEST_DATA_DIR = Join-Path $PWD 'outputs/dev-profile/data'
$env:ORIATUNNEL_TEST_SSH_CONFIG = Join-Path $PWD 'outputs/dev-profile/ssh_config'
pnpm tauri dev
```

示例会清空专用夹具的 `ssh_config` 文件，仅用于测试目录。这两个变量只对调试构建生效，不能用来隔离 release 应用。它们也不隔离 WebView 偏好、操作系统凭据库或登录启动项；需要验证这些功能时，另用专用应用标识和隔离测试条目。

主机发现只解析配置，不执行配置命令或自动连接。SSH 传输测试使用仓库的回环夹具，不连接用户真实主机。不要将真实密码、口令、私钥正文、连接配置或测试凭据提交到仓库。

## 检查与测试

按改动范围运行相应检查：

```sh
pnpm typecheck
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Rust 库测试默认包含会访问系统凭据库的测试。仅验证不涉及系统凭据的逻辑时，明确跳过凭据测试模块：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --skip credentials::tests::
```

完整 Rust 测试包括回环 SSH 集成测试和系统凭据库测试，后者在 Windows / macOS 上使用独立条目并执行清理；运行前应核对测试范围和系统权限：

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

SSH 配置语义对照测试还需要系统 OpenSSH 客户端，使用独立配置文件执行 `ssh -G -F`，不登录真实主机。

依赖已缓存时可为 Cargo 命令添加 `--offline`；首次克隆的设备不要假定缓存存在。界面改动还应验证键盘、深浅主题、最小窗口及减少动态效果。前端运行状态必须来自 Rust 快照和事件，不用假数据证明连接成功。

## 构建与打包

打包应在对应操作系统上进行，输出位于 `src-tauri/target/release/`。

| 目标 | 命令 | 主要输出 |
| --- | --- | --- |
| Windows 独立 EXE | `pnpm tauri build --no-bundle` | `src-tauri/target/release/oria-tunnel.exe` |
| Windows NSIS 安装器 | `pnpm package:win` | `src-tauri/target/release/bundle/nsis/` |
| macOS 独立应用 | `pnpm tauri build` | `src-tauri/target/release/bundle/macos/OriaTunnel.app` |
| macOS DMG 与 ZIP | `pnpm package:mac` | `src-tauri/target/release/bundle/dmg/` |

使用 Tauri 构建命令嵌入前端，普通 `cargo build --release` 不能代替独立桌面应用构建。macOS 的 `pnpm tauri build --debug` 可生成支持上述调试数据目录的 app。

`pnpm icons` 从仓库内的应用图标导出图、托盘 SVG 和安装包 SVG 生成各平台图标。打包脚本会调用它，并在 macOS 上设置 DMG 卷图标、Finder 文件图标，生成保留图标元数据的 ZIP。签名、公证和公开发布需要另行配置及授权；构建成功不等于已发布。

## 应用更新开发

更新运行逻辑位于 `src-tauri/src/updater.rs`；前端通过 `src/lib/application-update.ts` 与六个业务 IPC 获取真实状态，不需要安装 JavaScript Updater 或 Process 插件。普通本地构建仍不生成签名更新包，开发构建禁用更新检查与安装。

`src-tauri/tauri.conf.json` 已包含更新公钥和稳定版入口，不包含私钥。更新启动偏好独立保存在应用数据目录的 `update-preferences.json`，不会进入连接配置或配置包。公钥缺失、开发构建和不支持的安装形态显示明确原因，不模拟发现或安装成功。

后续发布构建需要通过环境变量提供 `TAURI_SIGNING_PRIVATE_KEY` 与可选的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，并合并 `src-tauri/tauri.updater.conf.json` 才会生成签名更新产物。例如在对应操作系统执行：

```sh
# Windows NSIS
pnpm tauri build --bundles nsis --config src-tauri/tauri.updater.conf.json

# macOS App 与 DMG；正式发布仍需整合既有 DMG 图标后处理及平台签名/公证
pnpm tauri build --bundles app,dmg --config src-tauri/tauri.updater.conf.json
```

以上为发布构建入口说明，不代表已配置发布环境。不要把私钥或口令写入命令行、仓库、日志或测试产物；macOS 发布还需保留现有 `scripts/package-mac.sh` 的图标处理及 ZIP 包装流程。更新压缩包为 `.app.tar.gz`，不是现有的 DMG ZIP。

已启用 `requireSignedVersion`，使用支持版本绑定的锁定 Tauri CLI 构建。手动签名更新包时需提供 `--app-version`，使其与清单版本一致；清单只提供更高版本的稳定版。升级与验收计划见 [应用更新方案](APP_UPDATE_PLAN.md)。

新增 Rust 测试通过本机回环 HTTP 提供公开签名夹具来验证下载、验签与失败重试；HTTP 放宽仅存在于测试配置中，应用要求 HTTPS。`src-tauri/tests/fixtures/updater/` 仅包含测试载荷、公钥与签名，不含私钥，也不使用正式更新密钥。库测试仍按上文明确跳过系统凭据模块；图形界面与原生验证使用独立标识和隔离数据。

## 源码入口与同步范围

- `src/App.tsx` 组合连接图、转发、主机、日志及弹窗；复用组件见 UI 开发文档。
- `src/lib/bridge.ts` 与 `src/types.ts` 定义前端 IPC 和传输类型；Rust 权威类型在 `src-tauri/src/model.rs`。
- `src-tauri/src/app.rs`、`service.rs`、`supervisor.rs`、`tunnel.rs` 负责应用事务、服务、会话监督与 SSH 转发。
- `src/public/locales/` 存放八语言资源。增删用户可见文案时同步各语言，并运行对应多语言测试。

同步源码、测试、锁文件、图标母版与开发文档；保留 `.gitignore` 对依赖、构建产物、`outputs/`、本机配置及本机工具状态的排除。仓库不提供真实 SSH 配置或系统凭据的跨设备迁移。

[`scripts/migrate-shell.mjs`](../scripts/migrate-shell.mjs) 是从相邻 OriaAide 项目首次迁移外壳的一次性脚本，依赖外部源项目，且会覆盖现有文件。继续开发、安装依赖和打包都不需要重跑它。
