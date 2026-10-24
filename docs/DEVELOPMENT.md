# OriaTunnel 开发指南

本指南用于在另一台 Windows 或 macOS 设备上继续开发。日常使用说明见 [使用指南](USAGE.md)，当前进度与验证边界见 [项目状态](PROJECT_STATUS.md)。

## 开始修改之前

按工作内容阅读以下文档：

| 文档                                    | 用途                                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)               | 项目工作规则、SSH 与凭据约束、提交和发布范围               |
| [项目状态](PROJECT_STATUS.md)           | 当前实现、最近修改、验证证据与待验证范围                   |
| [产品与界面设计](ORIA_TUNNEL_DESIGN.md) | 产品方向、阶段方案及架构背景；实际行为以源码和项目状态为准 |
| [UI 开发入口](ui-development.md)        | 组件复用、主题、窗口、交互和多语言规则                     |
| [组件索引](ui/components/index.md)      | 查找现有组件及业务组合入口                                 |
| [外壳迁移清单](shell-migration.json)    | 原版外壳的迁移来源与摘要                                   |

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

托盘由 `desktop.rs` 构建原生子菜单：服务名称下按精确转发引用分组列动作，SSH 终端下仅打开面板及已添加主机，不设新建项。TRAY_PANELS 保留全局面板入口；具体服务请求只携带 ID/修订/停止类型，原生先重验当前可用性，前端从保存配置解析并复用现有确认/认证/执行；不从事件接受脚本或凭据。终端主机入口走原有 openHost；未绑定模板、诊断阻塞及忙碌状态在菜单体现。AppState.tray_service_activity 只提供忙碌集合和活动服务终端引用，状态集合变化才刷新配置菜单，避免输出/尺寸事件重复重建；主线程重读活动集合、拒绝旧配置 revision。顶层及目标组沿用原生 separator。

`pnpm tauri dev` 同时启动 Vite 和 Tauri 桌面应用。Vite 固定使用本机 1420 端口；若端口占用，先检查已有开发进程。`pnpm dev` 仅用于浏览器界面预览，不具备 SSH、配置持久化和原生窗口能力。

macOS 若默认选中了尚未配置完成的 Xcode，而 Command Line Tools 已安装，可仅为当前命令指定工具目录：

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools pnpm tauri dev
```

## 隔离验证数据

调试构建支持两个环境变量：

| 环境变量                     | 作用                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `ORIATUNNEL_TEST_DATA_DIR`   | 使用独立应用数据目录，隔离连接配置、信任记录和单实例锁 |
| `ORIATUNNEL_TEST_SSH_CONFIG` | 只从指定 SSH 配置文件发现主机，替代默认和附加来源      |

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

打包应在对应操作系统上进行，默认输出位于 `src-tauri/target/release/`；签名打包入口显式传入 `--target` 时位于 `src-tauri/target/<target>/release/`。

| 目标                | 命令                           | 主要输出                                               |
| ------------------- | ------------------------------ | ------------------------------------------------------ |
| Windows 独立 EXE    | `pnpm tauri build --no-bundle` | `src-tauri/target/release/oria-tunnel.exe`             |
| Windows NSIS 安装器 | `pnpm package:win`             | `src-tauri/target/release/bundle/nsis/`                |
| macOS 独立应用      | `pnpm tauri build`             | `src-tauri/target/release/bundle/macos/OriaTunnel.app` |
| macOS DMG 与 ZIP    | `pnpm package:mac`             | `src-tauri/target/release/bundle/dmg/`                 |
| macOS 签名、公证 App / DMG / ZIP | `pnpm package:mac:signed` | 同上，另有 `bundle/macos/OriaTunnel.app` |
| macOS Intel 签名、公证 App / DMG / ZIP | `pnpm package:mac:signed --target x86_64-apple-darwin` | `src-tauri/target/x86_64-apple-darwin/release/bundle/` |

使用 Tauri 构建命令嵌入前端，普通 `cargo build --release` 不能代替独立桌面应用构建。macOS 的 `pnpm tauri build --debug` 可生成支持上述调试数据目录的 app。

`pnpm icons` 从仓库内的应用图标导出图、托盘 SVG 和安装包 SVG 生成各平台图标。打包脚本会调用它，并在 macOS 上设置 DMG 卷图标、Finder 文件图标，生成保留图标元数据的 ZIP。普通打包命令不负责公证；正式签名、公证使用下一节入口。构建成功不等于已公开发布。

### macOS 签名、公证与换机

在需要正式打包的 Mac 上先完成以下一次性配置；日常开发运行不需要发布证书或公证凭据。

1. Xcode → Settings → Accounts / Apple Accounts，登录开发者账号并选择团队。Manage Certificates → ＋ → **Developer ID Application**，创建本机可用的签名身份。账号须具备创建此类证书的权限。
2. 在 [Apple 账户](https://account.apple.com/)的「登录与安全 → 应用专用密码」中生成公证专用密码。
3. 在本机终端运行下面的命令，将示例邮箱替换成开发者账号邮箱。按终端提示输入应用专用密码；密码不放入命令参数、Shell 配置或仓库。

```sh
xcrun notarytool store-credentials "OriaTunnel-notary" \
  --apple-id "developer@example.com" \
  --team-id "67577AA9ZH"
```

确认显示凭据已保存后，在仓库根目录执行：

```sh
pnpm package:mac:signed
```

脚本自动选择团队 `67577AA9ZH` 的有效 Developer ID Application 身份；存在多个身份时，用 `APPLE_SIGNING_IDENTITY` 指定完整证书名称。`ORIATUNNEL_APPLE_TEAM_ID` 可覆盖团队，`ORIATUNNEL_NOTARY_PROFILE` 可覆盖钥匙串配置名。脚本只通过 `notarytool --keychain-profile` 使用凭据，不读取或打印密码正文。

此入口默认构建当前 Mac 的原生架构 release，也接受 `--target x86_64-apple-darwin`（Intel）或 `--target aarch64-apple-darwin`（Apple Silicon）。首次跨架构构建先安装对应 Rust 目标；例如在 Apple Silicon Mac 构建 Intel 版：

```sh
rustup target add x86_64-apple-darwin
pnpm package:mac:signed --target x86_64-apple-darwin
```

显式目标的 App、DMG 与 ZIP 位于 `src-tauri/target/<target>/release/bundle/`，不会覆盖默认原生架构的产物。签名入口不接受其他 Tauri 参数、`CARGO_TARGET_DIR` 或 `CARGO_BUILD_TARGET` 覆盖。

脚本启用 Hardened Runtime，并在提交公证前核对 App 二进制架构及签名。上传 App 公证并装订票据后，将带票据的 App 放入 DMG；卷图标与 Finder 图标处理完成后，对最终 DMG 重新签名、公证和装订，最后生成保留图标元数据的 ZIP。App 与 DMG 均通过 `codesign`、`stapler` 和 Gatekeeper 检查后才报告成功。签名入口不生成自动更新压缩包，也不创建或发布 GitHub Release。交叉构建及公证成功不等于已在对应架构的实体设备上完成运行验收。

公证需要联网，Apple 的处理时间不固定。每次公证默认等待 15 分钟，`ORIATUNNEL_NOTARY_TIMEOUT` 可指定如 `30m`；超时不会取消 Apple 服务器上的任务。提交 ID 与结果保存在忽略目录 `outputs/macos-signing/`。先用原提交 ID 查询或继续等待，避免重复上传；`SUBMISSION_ID` 替换为提交收据中的 ID：

```sh
xcrun notarytool info SUBMISSION_ID --keychain-profile "OriaTunnel-notary"
xcrun notarytool wait SUBMISSION_ID --keychain-profile "OriaTunnel-notary" --timeout 30m
```

上述等待命令只确认公证状态，不会自动完成中断脚本后续的装订、DMG 处理或 ZIP 包装。

换另一台 Mac 构建时，源码和锁文件正常同步，并按本指南准备开发工具。签名身份可从原 Mac 的 Xcode 证书管理器导出为带密码的 `.p12`（包含证书及对应私钥），在新 Mac 导入登录钥匙串；单独复制 `.cer` 不包含签名所需的私钥。也可在新 Mac 为同一团队创建新的 Developer ID Application 证书。公证凭据在新 Mac 重新执行上面的 `store-credentials` 保存即可，无须复制整个钥匙串。

`.p12`、导出密码及应用专用密码通过安全渠道另行保管，不进入仓库或聊天。若需构建自动更新包，还要单独迁移既有 Tauri 更新私钥；Apple 证书不能替代更新签名。Windows / Linux 电脑可继续开发对应平台，正式 macOS 构建签名应在本地或 CI 的 macOS 环境进行；本项目当前尚未配置 GitHub Actions 发布流水线。

参考：[Apple 签名身份导出](https://developer.apple.com/documentation/xcode/sharing-your-teams-signing-certificates)、[公证凭据保存](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)。

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

## 预设远程命令开发

E1 的配置与 IPC 在 `src-tauri/src/app_commands.rs`，任务模型、有界输出及执行器在 `src-tauri/src/commands.rs`；与转发共用 `tunnel.rs` 的 SSH 建连、认证、信任、多跳和传输清理。命令不参与转发自动重连；更新/退出清理同时等待命令任务。输出只在内存中，不能加入调试日志。

针对命令执行运行以下测试；它们只创建本机回环 SSH 服务并执行受限的测试脚本，不访问用户主机或凭据：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test commands_exec
pnpm test src/features/commands
```

`src-tauri/examples/command_fixture.rs` 提供手动界面验证用的回环夹具，使用 `cargo run --manifest-path src-tauri/Cargo.toml --example command_fixture` 启动并打印随机 SSH 端口，以 Ctrl+C 关闭。应仅配合独立应用标识和上述隔离数据目录使用；夹具仅接受 `tests/common/command_server.rs` 中的测试身份，已知 `fixture-*` 命令映射到固定脚本，不执行任意输入，不创建真实主机配置。

第一版服务配置仍使用现有 JSON，新增字段缺省为空。首次保存服务时保留升级前配置备份；v1 配置包继续排除服务命令与关联，不悄悄改变现有包协议。交互执行由下节 E2 负责；状态、健康和组合执行由 E3 服务控制层负责；受控模板与服务包分享由 E4 提供，见下节。

## SSH 交互终端开发

E2 的 IPC 与任务注册在 `src-tauri/src/app_terminal.rs`，PTY 生命周期、输入序号、输出 ACK 与有界背压在 `src-tauri/src/terminal.rs`。`app_sessions.rs` 为命令和终端共用逐跳凭据/指纹适配层；连接仍由 `tunnel.rs` 创建。每个终端独立建连，更新和退出等待清理，WebView 重载取消终端，不进入自动重连监督器。

前台服务停止是运行时操作，不能伪装成空 Shell 或通用 kill 命令。前端 terminal-model.serviceForegroundSession 精确匹配当前 client/service/rule/start action，TerminalWorkspaceProvider.stopService 复用已有 close_terminal 等待 worker 结束，再 forget_terminal 移除标签；权限/归属和观察失效仍走既有 Rust 逻辑，不放宽同服务命令互斥、不把断开直接标记为服务已停止。

前端 `src/features/terminal/terminal-workspace.tsx` 管理工作面板与标签，`terminal-view.tsx` 懒加载 xterm.js、Fit 和 Search 官方插件；终端标签保持挂载，输入仅经 IPC 发送，状态只接受 Rust 快照/事件。依赖版本锁定于 lockfile，三个 MIT 许可正文见 `docs/licenses/xtermjs.txt`，由 Tauri resources 随包携带。

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test terminal_pty
pnpm test src/features/terminal src/lib/webview-guards.test.ts
```

真实 PTY 夹具和测试目前仅在 Unix 编译运行，通过 `openpty` 与系统 Shell 验证 UTF-8、Ctrl+C/D/Z、尺寸变化、PTY + exec、拒绝路径及多跳隔离；不把这些结果作为 Windows 原生证据。库测试按前文跳过系统凭据模块。最终 Windows WebView 输入法、快捷键与原生关闭行为需在 Windows 设备复核。

`cargo run --manifest-path src-tauri/Cargo.toml --example terminal_fixture` 启动手动验证夹具并打印随机回环端口。它会在临时 HOME 中执行任意输入的命令，权限仍为当前开发账号；只在隔离 QA 中输入受控测试命令，结束用 Ctrl+C 关闭。不得配置用户真实主机或读取真实凭据；不把测试密码保存至系统凭据库。

## 服务控制开发

E3 的配置/映射、观测结果和有限步骤执行器在 `src-tauri/src/service_control.rs`，本地窗口 IPC、冻结服务/路线校验及转发适配在 `src-tauri/src/app_service.rs`。普通非交互动作也经该控制层执行，继续使用 `commands::Manager` 管理请求去重、同服务互斥、输出和任务上限；更新/退出清理不另建一套生命周期。

一次操作使用独立控制连接，状态、动作与健康各用新的 exec 通道顺序执行；仅明确可重复的健康探针可以轮询，变更动作不重试。状态解析拥有独立完整的有界输入，不解析展示尾部；输出仍排空。观测记录绑定服务修订、冻结身份、runId、时间和有效期，不持久化。前端 `service-controls.tsx` 复用 Select/Switch/Input/Modal/AuthenticationField；每秒只读取 Rust 内存以显示过期，不触发 SSH 探测。

组合只选择一个关联转发，适配现有 supervisor；冻结路线在启动前重验，复用现有连接前核对实际 Runtime 的主机/跳板与运行代次。失败保留已有资源，本次新建连接单独提供停止入口；停止目标转发取消对应未完成的组合任务。不得添加隐式服务停止或自动 sudo。

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test service_controller
pnpm test src/features/commands
```

`service_controller` 目前为 Unix 真实回环集成测试，依赖系统 `/bin/sh` 与 PATH 中的 `curl`，验证实际 HTTP 503→200、一次启动、多次只读检查、另一 SSH 主机上的真实字节转发、已连接复用、失败/取消保留与严格解析；不连接用户主机。`cargo run --manifest-path src-tauri/Cargo.toml --example service_fixture` 启动对应隔离手动夹具，打印随机 SSH/HTTP 端口。只执行固定 `fixture-*` 测试脚本，HOME/工作目录为临时目录，结束用 Ctrl+C；需配合独立应用标识、空 SSH 来源和测试数据目录。Windows 原生仍需设备验证。

新服务配置缺省 `control` 为禁用探针；写入前为已有 E1/E2 配置保留 `connections.pre-service-checks.json`，不覆盖已有备份。迁移与失败路径要验证原命令保留、不自动连接、不执行探针；v1 配置包继续排除服务配置与运行观测。

## 源码入口与同步范围

- `src/App.tsx` 组合连接图、转发、主机、日志及弹窗；复用组件见 UI 开发文档。
- `src/lib/bridge.ts` 与 `src/types.ts` 定义前端 IPC 和传输类型；Rust 权威类型在 `src-tauri/src/model.rs`。
- `src-tauri/src/app.rs`、`service.rs`、`supervisor.rs`、`tunnel.rs` 负责应用事务、服务、会话监督与 SSH 转发。
- `src/public/locales/` 存放八语言资源。增删用户可见文案时同步各语言，并运行对应多语言测试。

同步源码、测试、锁文件、图标母版与开发文档；保留 `.gitignore` 对依赖、构建产物、`outputs/`、本机配置及本机工具状态的排除。仓库不提供真实 SSH 配置或系统凭据的跨设备迁移。

[`scripts/migrate-shell.mjs`](../scripts/migrate-shell.mjs) 是从相邻 OriaAide 项目首次迁移外壳的一次性脚本，依赖外部源项目，且会覆盖现有文件。继续开发、安装依赖和打包都不需要重跑它。

## 服务配置分享与模板开发

服务当前是主机无关的命令模板。`save_service_profile` 保留已有引用索引，新模板不带引用；只有 `save_rule` 的服务清单可以改引用。旧 `executionHostId` 仅为读取兼容，保存/导入清空，导出不带主机依赖；纯 v2 模板包允许没有主机和转发，导入仍禁用执行。普通动作/检查/组合与专用终端必须从引用转发解析目标，冻结其路线；多引用时不能默选第一台主机。检查缓存以服务/路线身份为键，最多 1024 项，UI 按 ruleId 显示对应结果。

服务与动作分别新增可选 `color`/`icon` 和 `invocation`；后者作为结构化编辑数据，可选 environment 保存名称/值对，脚本模式可选 script 保存独立源正文（固定 sh 标识/空参数）；Rust 对最多 64 项、POSIX 名称、唯一性及值边界做校验。脚本模式编译为 export 加原正文，变量可用于整段多行脚本；普通结构化命令生成字面环境赋值，为 systemd-run 生成 --setenv 参数；变量不从本机读取，空字符串值保留。Rust 要求其确定性引用结果与 `command` 一致，执行器继续读取既有 `command`。旧配置无这些字段时按原路径工作；v2 服务分享保留这些字段，导入仍撤销执行许可。`save_rule` 可接收服务绑定修订清单，在同一配置克隆/原子写入中保存规则和关联，失败不部分写入。

默认应用配方由 `src/features/commands/direct-service-templates.ts` 生成，统一在 `service-template-catalog.ts` 登记：原生 CLI、独立动作 ID、按真实支持保留操作，不补造通用 kill、后台脚本或状态映射。常驻前台启动为 terminal 模式，timeoutSecs=0；Rust 仅对 Terminal 允许 0，terminal::execute 将 0 视为不设置会话期限，普通命令仍限 1–3600 秒。默认导入直接构建本地草稿、不调用托管模板 IPC；旧的有限期限与服务互斥保持。可选的「· systemd」配方继续由 Rust `service_templates.rs` 生成基础命令，应用启动时加用户临时单元包装，美元符号按 systemd 规则额外转义；Docker 容器默认使用原生 CLI。新配方应附官方命令文档 URL，测试引用、执行方式、环境变量字面传递及实际支持的生命周期，不连接用户主机。

E4 的配置包入口仍为 `config_import.rs` / `config_export.rs`。不选择服务继续生成 v1；显式选择才生成 v2。PortableService 使用严格字段白名单，动作和探针复用有界校验；错误不回显不可信 JSON 值。v2 导入统一重映射依赖和动作引用、只保留选中规则的关联，并撤销执行/重复探针/后检查许可。预览令牌绑定当前持久配置，确认时在更新/退出门禁下原子提交，不启动任何传输。

服务 `executionEnabled` 对旧本机配置缺省为 true，对所有导入服务强制 false；普通编辑保存保留原许可；新服务允许显式保留禁用状态，供独立副本沿用来源许可，缺省仍为 true。`app_commands.rs` 的独立启用接口检查明确确认、当前修订与空闲状态；前端点击「启用执行」即提交该确认，不使用额外勾选，持久化失败不改变内存。普通动作和 E3 操作在 `app_service.rs`、专用终端在 `app_terminal.rs` 均于凭据处理和建连前检查许可；通用手动 Shell 独立于服务。首次写入前保留 `connections.pre-service-sharing.json`；回退步骤见使用指南。

`service_templates.rs` 在 Rust 校验有限 ASCII 资源名并生成完整 POSIX sh 脚本，前端仅在选择托管配方时调用预览并应用到草稿。测试用临时 PATH 中的 systemctl/docker/journalctl 桩核对参数与状态映射，并对全部脚本执行 `/bin/sh -n`；未把桩测试当作真实 systemd/Docker 部署验收。

`commands.rs` 在输出实际进入时维护每任务 2 MiB、全部尾部 32 MiB 的预算。淘汰已结束输出时释放队列容量，保留小型防重放记录；慢消费者的待 ACK 消息之后仍收到 reset，即使新尾部为空。`outputBytes` / `discardedBytes` 为后端统计，前端只展示。最多 4096 条请求记录后拒绝新任务，不淘汰请求后重放。

```sh
# Unix/macOS：真实回环 SSH，含至少一分钟输出压力检查与 getrusage 进程峰值
cargo test --manifest-path src-tauri/Cargo.toml --test commands_exec sustained_real_ssh_output -- --nocapture
# 其余迁移、白名单、禁用与模板用既有库测试命令（按前文跳过系统凭据测试）
pnpm test src/features/commands
```

压力测试与服务端夹具运行在同一进程，记录的 RSS 峰值包含两者和分配器，不能当作应用常驻内存承诺；尾部字节预算另逐轮断言。当前完成分钟级持续压力与千次执行，尚未进行小时级运行或 Windows 原生内存验收。手动 QA 必须同时指定 `ORIATUNNEL_TEST_DATA_DIR` 和 `ORIATUNNEL_TEST_SSH_CONFIG` 的隔离路径，不连接用户真实主机。

服务分类为可选 category，目录 ID 清单在 `src/features/commands/service-category-ids.json`，Rust 内嵌校验，前端测试核对与模板分类一致；other 表示明确未分类。模板保存/分享保留分类，旧配置无字段仍可读取。批量删除通过 delete_service_profiles 接收 id/revision 列表，在 workers 锁下核对全部范围/活动任务/修订，克隆配置后一次持久化；任一错误不部分删除，单条接口复用相同事务。
