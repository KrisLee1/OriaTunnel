# OriaTunnel

使用无限画布管理 SSH 端口转发的桌面应用。窗口、主题和基础组件迁移自 OriaAide。

当前为 Windows/macOS 开发版，支持 L/R/D 三种 TCP 转发、主机管理、系统 SSH Agent、有序多跳 ProxyJump、托盘/菜单栏、每用户单实例，以及重连、运行诊断、批量启停和配置导入导出。尚未发布安装包，验证范围与限制见 [项目状态](docs/PROJECT_STATUS.md)。

首次使用请阅读 [使用指南](docs/USAGE.md)：从添加和测试 SSH 主机、创建转发，到配置导入导出、后台运行与问题排查。指南包含 L/R/D 的具体配置，以及「共享 IP、只有一个 SSH 端口」时访问多个服务的完整示例。

## 启动

需要 Node.js 22.12+、pnpm 和 Rust。Windows 另需 MSVC C++ 构建工具及 WebView2 Runtime；macOS 需 Xcode Command Line Tools，或已完成许可和首次配置的 Xcode。macOS 应用最低系统版本配置为 11.0，设备验证范围见项目状态。

在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` 仅启动浏览器预览；SSH、配置发现与保存需要 Tauri 桌面应用。开发服务器使用本机 1420 端口。

构建无需开发服务器的 Windows 独立 EXE（不生成安装包）：

```powershell
pnpm tauri build --no-bundle
```

输出为 `src-tauri/target/release/oria-tunnel.exe`。普通 `cargo build --release` 不保证启用 Tauri 的嵌入前端协议，请使用上述命令。

## macOS 构建与运行

在项目根目录执行同样的安装和开发命令。构建独立应用：

```sh
pnpm tauri build
```

输出为 `src-tauri/target/release/bundle/macos/OriaTunnel.app`，包含前端，不依赖 Vite。`tauri.macos.conf.json` 仅在 macOS 启用 app 打包；Windows 继续保持原构建方式。当前没有 Developer ID 签名、公证或发布安装包。`pnpm tauri build --debug` 可生成支持隔离配置的调试 app。

若默认选中了尚未接受许可的 Xcode，而 Command Line Tools 已安装，可仅为当前命令指定 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`，例如 `DEVELOPER_DIR=/Library/Developer/CommandLineTools pnpm tauri dev`，不必更改系统的开发工具选择。

macOS 保留原版圆角、背景模糊及左侧交通灯风格控件，菜单栏图标在深浅外观下使用系统模板着色。关闭窗口后可从菜单栏或 Dock 恢复；⌘Q 和应用菜单退出共用会话清理流程。配置目录为 `~/Library/Application Support/com.oria-tunnel`。

窗口不透明度与模糊半径直接跟随主题 Token，Default 为 82%/40px，Glass 为 78%/60px，Line Art 为 100%/0px；不再因组件表面为实色就强制关闭窗口模糊。可手动覆盖各项，重置恢复当前主题；减少透明效果仍强制不透明并关闭模糊。

默认读取 `~/.ssh/config` 和 `/etc/ssh/ssh_config`，跟随 Include。系统默认的 `SendEnv` 不影响纯转发和主机测试；主机详情显示限制，若启用远程命令则在连接前拒绝，以免静默省略命令环境。`UseKeychain`、`AddKeysToAgent` 等系统 OpenSSH 扩展仍显示不支持；应用不会读取 OpenSSH 保存的私钥口令或自动向系统 Agent 添加身份。

## 创建转发

1. 点击「新建转发」选择转发方式：L 访问远端服务，R 让远端访问本机服务，D 通过远端提供 SOCKS5 代理。
2. 选择已添加的 SSH 主机。「添加主机」先展示配置中自动发现的候选，可搜索后选择，也可转入手动添加；添加后返回并保留转发草稿。自动发现只解析配置，不连接主机；仅添加主机不会创建转发。
3. 填写监听端点；L/R 还需填写目标。L 与 D 的目标由 SSH 服务端连接，R 的目标由此电脑连接；路径预览说明 localhost 和 DNS 所在的一侧。
4. 「高级参数」默认不运行远程命令（-N），可明确启用无交互命令；支持按规则覆盖主机的 连接与初始握手超时（不含用户核对指纹的时间）、SSH 保活间隔（0 关闭）及未响应次数。命令随规则保存，请勿填写秘密。
5. 保存或「保存并启动」。启动时输入本次密码/私钥口令；已保存密码、私钥或系统代理可留空。每一跳首次连接都需核对指纹，指纹变化会拒绝连接。默认仅在该运行会话的 Rust 内存中保留本次输入以供重连，停止或退出后清除；Windows/macOS 可单独开启「记住密码」，仅在密码认证成功后保存。
6. 监听成功后访问相应端口。停止会关闭监听和已有连接。编辑运行中规则的网络参数会明确要求保存并重新连接；名称、颜色和服务协议的修改不重连。

可选服务协议为 HTTP、HTTPS、VNC，默认未选择，单选且再次点击可取消。HTTP/HTTPS 可用于网页管理台、Jupyter、noVNC 等已有网页入口；VNC 调用系统注册的客户端。选择后，连接图中每条转发 IP 路径右侧显示「打开服务」按钮，监听就绪后才可用。L 使用本机监听端口；R 使用远端监听地址（通配监听使用 SSH 主机地址），远端回环监听不能从此电脑直达；D 没有固定入口。协议随配置保存、导出与导入，不改端口或自动重连。

SOCKS5 仅允许绑定 `127.0.0.1` 或 `::1`，支持 TCP CONNECT，暂不提供 SOCKS 用户认证和 UDP。L/R 可指定监听地址；R 的外部访问同时受 SSH 服务端策略及防火墙约束，监听成功不代表公网可达。

窗口默认关闭到托盘，所有转发保持运行，可从托盘恢复、停止全部转发或退出。设置中可关闭「关闭窗口时收起到托盘」，使关闭窗口直接退出；「退出 OriaTunnel」始终清理全部会话。当前用户再次启动会唤起已有窗口。

连接图与转发列表按 SSH 主机分组，同一主机的连接保留独立状态、编辑和启停；连接图每台主机一张卡片，连线可打开对应连接。主机页仅展示已添加或被已有转发引用的主机，按未测试、通过及具体失败筛选，可按标签、认证方式或状态分组。添加控件位于顶栏左侧，发现与刷新在添加弹窗中；日志页不提供添加连接。页面使用完整可用宽度，不提供重复的左侧资源面板。

主题、深浅模式、语言及窗口外观在顶栏工具和设置中调整。窗口按钮支持原版位置和样式设置；Windows 保持原版直角与 Acrylic 开关。

## 长期使用

规则高级参数默认允许网络故障后自动重连：初始延时 2 秒、指数退避至最多 60 秒，每轮最多 8 次，均可调整或关闭。稳定监听 60 秒后重新计算连续失败预算。认证、指纹、监听及远程命令错误等待人工处理；来源或连接配置变化时不静默重连旧路线。停止、删除或退出会取消运行和重试，关闭监听并终止已有连接。

Windows/macOS 系统唤醒通知触发活动会话重新建立，使用新的运行代次；已有业务 TCP 连接需要重新建立。关闭自动重连的规则会等待人工启动。带远程命令的规则还需明确允许「每次重连时重新执行远程命令」，默认关闭，避免旧规则的命令意外重复执行。

转发页的「详情」显示实际状态、期望状态、当前监听路径、实际认证方式、累计字节、速率、启动时长、活动连接、重试和最多 120 个流量采样。目标可达性依据真实目标 TCP 请求独立显示；D 只代表最近一次目标请求。未发生检测时显示未测量；TCP 可达不代表应用协议健康。

「日志」支持搜索、仅警告，以及按主机、转发和事件状态筛选或分组，保留最近 1,000 条事件。列表按每批 120 项逐步展开，接近底部时自动加载，虚拟化预渲染视口上下各 3 屏；暂不查询该窗口以外的磁盘历史。历史状态取自对应事件；主机归属按当前转发配置解析，已删除对象的记录仍保留标识。应用数据目录 `logs/activity-0.jsonl` 至 `activity-2.jsonl` 按每份约 1 MiB 轮转，只记录事件、错误类别和运行标识，不记录凭据、错误正文、远程命令或转发内容。日志写入失败会显示诊断，不停止网络会话。

顶栏提供「全部开启／全部停止」，范围是当前默认工作区全部转发，悬停提示显示数量；全部开启仍需经过批量认证。转发页还可选择部分规则批量启动或停止，并逐项显示请求是否受理；在其他页面可从页脚结果入口查看逐项反馈，实际连接结果仍看各规则状态。部分失败不阻塞其他规则。选择转发后可批量删除，确认弹窗列出范围并停止对应连接。删除可撤销本次应用运行内最近 20 次操作，批量删除整组恢复；删除主机的撤销也恢复主机和关联转发，均保持停止且关闭启动后自动连接。

「导出配置」导出所选规则（未选择时为当前工作区全部规则）及所需跳板主机，点击「保存配置文件」通过原生保存对话框写入 JSON。省略本机私钥路径，不包含凭据、信任记录、配置源正文、远程命令、日志或运行态；导出包关闭自动连接。转发页的「导入配置」弹窗可上传或拖入单个 OriaTunnel v1 JSON 包，先预览冲突、缺失私钥路径及省略命令，再选择规则和新建/复用主机。新建项使用全新 ID，同名自动编号；不覆盖现有项。省略命令的规则须跳过或明确改为仅转发（-N）。导入保持停止，关闭自动连接和命令重执行，不恢复信任或凭据。来源被标记为不兼容的主机须跳过相关规则或明确复用现有可连接主机。仅接受当前导出格式；上限 2 MiB、500 台主机、1,000 条规则。

登录启动与自动连接分别控制且默认关闭。Windows/macOS 独立构建的设置可注册当前用户的登录启动，在托盘/菜单栏启动应用；开发模式依赖本地服务器，因此禁用该开关。macOS 仅在用户开启时写入 `~/Library/LaunchAgents/com.oria-tunnel.startup.plist`，供下次登录启动；关闭时移除文件，不立即启动第二个实例、不设置持续拉起。移动应用后需重新开启。每条规则可单独允许应用启动后连接，但所有跳板和目标均须已有信任且能使用私钥或 Agent；需要密码/口令或指纹确认时停在「需处理」，由用户手动启动。

## 配置与限制

Windows 默认读取 `%USERPROFILE%/.ssh/config` 以及可访问的系统客户端配置，跟随 Include。支持具体别名、继承/首值、IdentityFile 多候选、IdentitiesOnly、IdentityAgent、ConnectTimeout、ServerAliveInterval、ServerAliveCountMax 和有序 ProxyJump（最多 8 跳，可用具体别名、内联 `user@host:port`、`ssh://user@host:port` 或方括号 IPv6）。条件支持 `Match host/originalhost/user/localuser/tagged/all/final`，按首值及 final 遍解析条件 Include；仅接受 `CanonicalizeHostname no`，因此 canonical 条件为 false。可能匹配的 exec、localnetwork 和未知条件显示诊断并阻止连接；不执行这些条件，也不调用系统 SSH 发现用户配置。未支持的命令、路由或信任选项会显示诊断并阻止错误降级连接；来源中的转发指令只展示，发现与同步均不执行命令或建立连接。

设置支持附加配置文件及自动同步开关；自动同步每 2 秒及恢复焦点时检查，关闭后仍可启动时加载与手动刷新。运行会话保留本次配置快照，更新在重新连接后生效。来源失效会保留已添加主机、关联规则和最后解析信息，读取失败则显示同步诊断。配置主机的显示名称与标签只保存在应用内；连接字段保持源文件只读。删除有关联转发的主机会提示并一并删除对应转发；被其他已添加主机用作跳板的主机须先修改对应路线，进行中的主机测试须先停止。删除已添加的配置主机只移除应用内引用，不修改 SSH 配置文件，可再次从添加弹窗选择。

主机详情的「测试连接」和编辑器的「保存并测试」仅在用户主动点击、提交本次认证后执行，核对 SSH 身份与主机密钥，不创建转发或执行远程命令。成功不代表目标业务服务健康。

配置保存在 Tauri 应用数据目录的 `connections.json`，采用临时文件替换写入；配置与导出包均不包含密码、私钥正文或私钥口令。「记住密码」默认关闭，认证成功后写入当前用户的 Windows 凭据管理器或 macOS 钥匙串（不启用 iCloud 同步），按应用数据目录、主机 ID 和连接身份隔离；地址、端口、用户名或认证方式变化后不再复用旧密码。认证弹窗显示保存状态并支持清除；留空复用，输入新密码并开启开关可在成功后替换，关闭开关不会删除已有密码。跳板及批量启动按主机分别设置；不保存私钥口令。已保存密码只由 Rust 读取，不返回前端，清除不会终止现有会话或清除其重连内存。重启不恢复旧运行态，仅明确开启自动连接的规则会尝试建立新会话；保存密码不会开启或放宽启动自动连接。窗口/主题/语言与节点布局使用应用独立的 WebView 偏好存储。

Windows Agent 使用系统 OpenSSH 命名管道或指定的 IdentityAgent；macOS 使用 `SSH_AUTH_SOCK` 或指定的 Unix 套接字，遵循 IdentitiesOnly。不启用远端 Agent forwarding。跳板支持已有主机的逐行有序引用和配置中的逗号列表，每跳独立认证/校验，拒绝循环、重复和缺失引用。内联覆盖会生成独立稳定身份，不继承目标主机的配置。不支持 ProxyCommand、动态条件、路由中的百分号 Token 或完整 OpenSSH 选项集合。业务文案支持中英文，其余语言回退英文。

## 开发验证

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Rust 集成测试在回环地址启动临时 SSH 服务和目标服务，验证 L/R/D、IPv4/IPv6、DNS 访问侧、半关闭、字节统计、指纹/认证/端口失败、取消清理、逐跳认证及隔离的 Windows 管道/macOS Unix 套接字 Agent。C 测试另覆盖主动断线/恢复、注入唤醒、退避取消/上限、真实速率与信任缓存、目标拒绝及批量部分失败；单元测试覆盖日志、导入导出白名单、依赖重映射/冲突/回滚、静态/final 条件、撤销和隔离注册表适配。多跳测试通过三台回环 SSH 服务验证两跳内联/URI 路线；另用生成的无执行配置与系统 OpenSSH `-G -F` 对照静态结果。私钥只生成临时身份，不使用本机真实主机或密钥；不会为测试实际休眠电脑或修改真实登录启动项；macOS 钥匙串测试仅创建 UUID 隔离条目并清除。运行测试前从托盘退出调试应用，避免 Windows 锁定正在重新链接的 EXE。测试环境须允许本机回环套接字和测试命名管道。

原生界面联合验证可用 `cargo run --manifest-path src-tauri/Cargo.toml --example loopback` 启动仅限本机的 SSH/HTTP 夹具，其端口和测试 SSH 配置写入 `outputs/validation`。调试版本支持 `ORIATUNNEL_TEST_DATA_DIR` 与 `ORIATUNNEL_TEST_SSH_CONFIG` 两个环境变量，以指定隔离的数据目录和测试配置文件；发布构建不读取这两个变量。

架构方向见 [设计方案](docs/ORIA_TUNNEL_DESIGN.md)，实测证据和后续事项见 [项目状态](docs/PROJECT_STATUS.md)，界面复用入口见 [UI 开发说明](docs/ui-development.md)。

### 应用图标资源

`src-tauri/icons/OriaTunnelIconExports` 中的 Default、Dark、ClearDark PNG 分别作为 Light、Dark、Mono 母版。替换母版后运行 `pnpm icons`，生成桌面尺寸、ICO/ICNS、Windows 任务栏图标与 macOS 运行图标；托盘使用 `src-tauri/icons/tray-source.svg` 透明母版，Windows 保留彩色，macOS 使用自动适配明暗菜单栏的单色模板。脚本只使用项目已有的 Tauri CLI。设置中的图标样式独立于应用主题，支持跟随系统。

### 安装包图标与打包

安装包母版为 `src-tauri/icons/OriaTunnelInstaller.svg`，使用与中心球一致的蓝色（#1268FF）亚克力盒，并收紧外圈留白，内部为六节点标识；与应用图标及托盘母版独立。`pnpm icons` 同时生成 `installer-icon.png`、`installer-icon.ico`、`installer-icon.icns`。

- macOS：运行 `pnpm package:mac`，生成 `.app`、DMG 及同名 ZIP。脚本依次替换 DMG 挂载卷图标和 Finder 文件图标；ZIP 使用 `ditto --sequesterRsrc` 保留自定义图标元数据。分发时优先使用该 ZIP，以免普通文件传输丢失 Finder 图标。需要 macOS、Command Line Tools（Swift / SetFile）及本地 Rust / Node 构建环境；支持在命令后追加 Tauri 构建参数。
- Windows：运行 `pnpm package:win`，使用 NSIS 和独立的安装器 ICO，安装后的应用继续使用应用图标。需要对应 Windows 构建环境；macOS 不提供该安装器的运行验收。

两个打包命令均先重新生成图标资源。DMG 图标替换脚本只接受本项目 `src-tauri/target/release/bundle/dmg` 内的现有 DMG，不修改包内应用的图标。
