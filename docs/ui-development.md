# UI 开发入口

React 19、TypeScript、Vite、Tailwind 4、ORIA THEME、shadcn/ui/Base UI、Lucide、i18next 与 React Flow。实际版本以 lockfile 为准。

## 可复用能力

- 顶栏功能区只在 Base UI 弹窗带 `data-open` 时锁定；退场节点不继续禁用顶栏，关闭态遮罩及弹窗不拦截指针，终端焦点恢复也只判断已打开弹窗。窗口关闭/最小化/最大化与拖动保持原有独立行为。
- 顶栏中部与两侧胶囊统一使用 `--oria-shadow-sm`，弱于弹窗的 `--oria-shadow-md`；导航外层允许阴影溢出，只在内部 TabsList 约束内容，防止裁掉外阴影。终端顶部安全边界不得小于顶栏自身下沿扣除透明底部 padding，并在展开前同步重新测量。

- `FirstUsePreferences` 在首个 Rust 快照就绪后显示首次偏好弹窗，组合 `InitialPreferenceSettings`，与设置页共用语言、主题、颜色模式、应用图标及窗口按钮风格/位置控件；不重复实现偏好状态，不包含主题导入或高级窗口材质。选择即时保存/预览；开始使用、关闭或 Escape 都保存 `oria-tunnel.initial-preferences.v1` 完成标记，后续启动不再显示。已有设置原样呈现，不重置偏好；存储不可用时允许关闭并提示下次可能再显示。
- 应用图标偏好持久保存并在启动时恢复；Windows 同步运行中大小图标及精确指向当前 EXE 的开始菜单/固定任务栏/Known Folder 桌面快捷方式，保留启动参数。macOS 签名 App 仅更新运行中 Dock 图标，Finder 保留原图标，避免 FinderInfo/ResourceFork 破坏严格签名验证；只有未签名开发包可写 Finder 自定义图标。切换失败复用图标错误 Toast。

- 服务检查与组合 UI 在 `src/features/commands/service-controls.tsx`：ControlEditor 以三列概览（窄屏单列）和左右对齐的开关配置状态动作、退出码/严格 JSON、远程健康命令、明确重复授权和等待预算；ServiceState 只显示 Rust 事实/时间/过期，不从成功退出推断服务运行；ServiceOperations 支持直接主机检查；启动并连接必须有真实关联转发。CommandResult 复用步骤与输出，保留原动作和后检查结果，提供本次新建转发的停止入口。CredentialRetry 只允许尚未提交任何 exec 的认证失败重试，提交后不重放整个组合。本次明确执行的命令遇到该失败时自动打开现有认证弹窗，按运行 ID 消费提示；取消、结果重挂载或重复事件不会再次自动打开。历史结果仍可手动重试，当前服务修订、执行许可及对应主机/转发关联须继续有效，纯 Agent 路线不提示密码。
- 服务状态通过 `service://observations` 和只读 IPC 获取，连接图及结果弹层每秒刷新 Rust 内存以显示有效期；此定时器不执行网络探针。等待进度沿用低频 polite 状态，步骤次数与输出不额外创建 live region，避免连续打断读屏。八语言扩展现有 commands 命名空间，表单复用既有组件与 Token；不新增顶层页面。

- 原生托盘在 desktop.rs 中按显示窗口、服务/终端、转发启停、退出以分割线分组。「服务命令」先按服务名称展开，再以分割线区分关联转发/主机的动作；未绑定服务禁用。命令 ID 携带当前服务修订和精确转发/动作引用，点击时 Rust 重验最新可用状态，前端 service-target.resolveTrayServiceRequest 从最新保存配置解析，再经现有 execute/确认/认证或前台终端停止。服务生命周期只在忙碌/服务终端引用集合变化时刷新托盘，输出与尺寸变化不重建。SSH 子菜单仅打开面板与已添加主机，不设新建菜单项；隐藏/未添加不列出，诊断阻塞禁用。Provider 的 layout ref 始终读取最新入口，卸载释放事件，打开面板自身不执行/连接。
- SSH 终端由 App 根部 `TerminalWorkspaceProvider` 管理，`OpenTerminalButton` 供顶栏、主机与转发入口复用；主导航依次为连接图、转发、服务、主机、活动。复用 Base UI Tabs（终端 keepMounted）、Modal/AnimatePresence、HostPicker、AuthenticationField 和 ORIA Token。折叠/切页不卸载终端；窗口重载取消旧会话；活动标签关闭需确认，关闭普通命令输出不取消任务。
- 工作面板支持靠下/靠左/靠右，通过共享 DropdownMenu RadioGroup 选择；底部调整高度，左右在朝向内容的一侧调整宽度。窗口左右/底部与顶栏胶囊读取同一间距（默认 4px），顶部从可见胶囊下沿再留同一间距，不重复计入顶栏透明底部内边距；默认不因窄窗口自动最大化。可见手柄使用 Pointer Capture，鼠标与对应轴方向键及 Home/End 共用边界，最大化时仍可拉回自定义尺寸。`workspace-layout.ts` 校验位置和三方向独立尺寸，保存在 `oria-tunnel.terminal-layout.v1`；拖动结束才写入，视口缩小只限制呈现、不覆盖原尺寸，切换位置不卸载终端或重新连接。
- 终端内部统一由 --terminal-content-inset: 8px 管理水平内边距，供标题、标签栏、地址行、搜索、xterm 屏幕、命令输出、错误及空状态共用；顶栏顶部与标签栏底部各留 4px，两行交界处不再叠加上下 padding，标签栏最小高度 32px；屏幕右侧为滚动条单独留 4px，手柄宽/高为 8px，地址行仍固定 28px。
- 工作面板新建使用 SquarePlus，主机/转发入口打开对应主机使用 SquareTerminal；顶栏恢复工作面板保留 Terminal 图标，入口位于设置/关于所在外侧胶囊，随窗口控件位置镜像；固定右侧胶囊只放全部启停。面板收起与标签关闭均使用 X，展开/还原使用 ChevronFirst/Last 并随方向旋转。面板顶栏操作顺序为展开/还原、面板位置、新建终端、收起，DOM 与键盘焦点顺序一致。普通 Shell 固定请求 `noLocalEnvironment=true`，仅检测到 `SendEnv` 时显示忽略说明；专用预设继续使用已保存的服务策略。
- terminal 启动服务的运行时停止复用 TerminalWorkspaceProvider 的 foregroundSession/stopService 与现有关闭/忘记流程；terminal-model.ts 只按当前 client、服务、转发、启动动作及 Rust 活动状态匹配。服务菜单/命令面板保留可用停止，其余动作沿用互斥；活动前台会话存在时替代原生停止，无会话则恢复原操作。关闭失败保留标签并展开错误，不产生远端已停止的假状态。此入口是运行时控制，不写成命令模板或导出脚本。
- 明确 hostId 的终端入口直接调用 Rust，以空凭据尝试已有认证配置/已保存密码，不先显示主机选择。仅未提交 Shell/服务命令的认证失败且路线含非纯代理主机时弹出锁定主机的补充认证；服务终端仅处理当前 client 的明确请求，并重验请求时的服务修订、执行许可和关联转发。提示按请求与会话去重，取消不重复自动打开；指纹仍独立核对，网络/配置错误不触发密码提示。重连以 requestId 绑定原结束会话，标签保留 React key 和位置；新 SSH 代次拥有独立 session ID 与新 xterm，旧记录退订/忘记且迟到事件不恢复旧标签。
- 面板使用现有 Motion 与 interactionSpring 对数值化位置/尺寸、沿停靠侧的滑入/滑出和透明度做可中断过渡；不从 auto 尺寸硬切。关闭立即 inert/aria-hidden，动画完成才隐藏，终端保持挂载；拖动时过渡为 0，减少动态效果时位置/尺寸立即切换、仅短淡入淡出。几何由 workspace-layout.ts 统一计算，基于顶栏两侧可见控件组/中部胶囊下缘的最大值，以及顶栏胶囊实际窗口内边距；无可测控件时使用顶栏下缘扣除透明底部内边距。
- 终端移除常驻四按钮工具栏；复制/粘贴/查找/清屏使用共享 Base UI ContextMenu（复用 Menu Item 样式），清屏使用 BroomSparkles。菜单支持指针/长按、键盘菜单键/Shift+F10、方向键/Enter/Escape、快捷键提示和关闭后的焦点恢复；无选区禁用复制、非 running 禁用粘贴。查找栏仅主动打开时显示。Ctrl+C/D/Z/U/L/K 保留远端语义；本地清屏 Cmd+K/Ctrl+Shift+K，粘贴继续经过现有审核，不解锁 OSC52。
- 标签栏在确有横向溢出的一侧显示 16px 遮罩渐隐；被动 scroll 监听及 ResizeObserver 检测列表/标签尺寸，新增/关闭标签与展开后重新测量，完整可见/抵达边界时取消对应侧渐隐。使用标准及 -webkit-mask-image，强制颜色模式关闭遮罩；不改变原标签/关闭按钮的指针与键盘交互，卸载时清理监听/观察。
- 标签以 1px 竖分割线隔开，线两侧各留 4px，gap 与伪元素偏移共用 --terminal-tab-separator-space，避免右侧少 1px；未选中项无背景/边框，选中项使用中性背景和加粗标题，不使用描边或底部横线；样式读取 Base UI 的 data-active，保留原键盘焦点与 ARIA，强制颜色模式使用系统选中背景。标签状态使用标题前彩色圆点，颜色仅由 Rust phase/finishedAt 决定；title 保留端点和文字状态，aria-label/读屏状态保留文字。地址行固定 28px 高、上下内边距各 2px，重连使用 24px 的 icon-xs 按钮，显示/隐藏不改变行高；去掉重复状态、重连改为命名图标，远端未知状态只显示短提示（完整信息在 title），不再渲染 WebView 重载说明。
- `src/features/terminal/terminal-view.tsx` 懒加载官方 xterm.js/Fit/Search，解析 ANSI 字节流，单独处理 UTF-8/二进制输入与 PTY 尺寸变化；不可用纯文本日志替代。Rust 最多一个待 ACK 输出帧，xterm write 回调后才 ACK；输入串行编号，交付不明即停止该连接，不盲目重发。尺寸使用 latest-value 通道合并。
- 终端屏幕、结束占位与面板内命令输出共用工作面板的透明材质，跟随现有窗口透明度、模糊与减少透明度偏好；xterm 在 open 前启用 allowTransparency，主题背景保留 RGB 并将 alpha 设为 0，避免不透明画布盖住面板；局部选择器覆盖 xterm 默认黑色 viewport，IME 组合输入层使用主题前景/背景。文字、光标与 ANSI 调色板保持清晰并按 ORIA 深浅色切换，不对整个终端设置 opacity。仅终端输入路径放行 Ctrl+U/Ctrl+Shift+C 与应用菜单键；终端菜单只放行实际应用动作，保留源码/调试守卫。多行/控制字符粘贴使用共享确认弹窗，OSC52 不能修改本机剪贴板；外链需主动操作并经 HTTP/S 校验。输入框与图标按钮有可访问名称；弹窗存在时不抢终端焦点，关闭动画后恢复；ResizeObserver、主题/偏好监听与 RAF 随卸载清理。

- 服务页位于中部导航「转发」后，删除顶栏常驻远程命令按钮；`ServicesPage` 与主机/转发页共用顶部避让、标题/计数、搜索/分类筛选工具栏与 SSH 主机分组（共享服务重复显示，未关联主机独立分组）、列表间距与材质。服务页顶栏加号/空状态可添加服务；执行许可使用直接审核/禁用按钮，移除服务卡片更多菜单及单项导出；禁用状态紧跟名称，复选框复用转发 rule-select 跨两行居中，卡片同用 16px 列/12px 间距及内边距。服务页是纯模板管理，不选择主机/转发或执行命令；服务工具栏直接复用主机页的左右分组：左侧搜索，右侧分类、选择/计数、删除及导入/导出紧凑成组，组内固定间距；保留 host-toolbar-controls 的 flex 容器，不使用 display: contents 将控件拆散分布，也不拆成上下两条工具栏；卡片命令计数与标签单行，复选框多选/筛选内全选、保留跨筛选选择，导出所选或当前结果，批量删除使用固定范围确认及 Rust 原子接口。服务 category 随模板导入/保存/分享，旧数据按默认名称或唯一图标分类回填，未识别为 other，编辑器可明确调整。转发卡片的服务 DropdownMenu 直接列出引用模板的动作；空绑定不显示入口，确认/认证沿用原流程。
- 转发编辑复用 `service-picker.tsx` 的 Combobox/Chips，只列当前主机关联的服务。L/R 单选且服务端端口只读，从服务独立 port 读取；修改服务端口由 Rust 原子同步所关联 L 的 targetPort、R 的 bindPort。D 可多选，SOCKS bindPort 始终独立；D 图标选择浏览器并打开该服务回环端口，不执行启停。活动转发不自动重连，快照持续标记实际冻结规则与保存配置差异。
- 服务颜色与图标复用 ConnectionColorPicker/ConnectionIconPicker，通过 fieldLabel 显示服务专用名称，其他调用默认文案保持；HostPicker 与 ServicePicker 的 actions 插槽把管理动作放在各自标题右侧，不跨字段堆叠。保存为可选 color/icon（旧服务默认空）；动作可选 invocation（可执行文件、参数名/值及环境变量名称/值）；值留空表示无参数值，保存时去除全空参数行，脚本与结构化参数同步规范化。CommandInvocationEditor 只编辑命令/参数，独立 CommandEnvironmentEditor 置于动作正文后、由两种模式共用，在 fieldset 中管理每命令最多 64 个显式环境变量；值允许为空、全空行省略、名称使用 POSIX 标识，Rust 拒绝重复及越界。普通结构化命令用引用后的赋值前缀，systemd-run 用 --setenv 传到服务进程；脚本模式在 invocation.script 保留原正文、执行编译为 export 前缀加原脚本，不把前缀写回正文，移除变量与切换模式不丢数据；不读取本机变量，旧数据缺省为空，保存/分享保持同一结构。专用终端超时允许 0（不限时），切回非交互将 0 恢复为 60 秒，普通命令最小 1 秒；详情将终端 0 显示为不限时。命令块与参数行均用垃圾桶删除；操作类型有可见标签，切换时同步默认名称及块标题、保留自定义名称且不改脚本。`command-invocation.tsx` 编译字面 POSIX 命令，Rust 校验结构/边界和 command 完全一致，原脚本路径保持兼容。`service-template-catalog.ts` 提供常用服务/推理框架与官方文档来源，从模板选择器导入后整体填入草稿；systemd 启动模板对美元符号额外转义，不需要 254 版的 expand-environment 选项。
- 服务领域在 `src/features/commands/preset-commands.tsx`：PresetCommandProvider 管理编辑、认证与确认，ServiceCommandsButton 复用实际服务图标和颜色，仅 Rust 当前未过期 running 事实或实际运行的前台终端显示服务色，其余灰色。菜单标题图标与名称使用 flex 居中。HostServices 和 D 转发卡片的 ProxyServiceButtons 复用 service-icon-strip.tsx；D 卡片服务位于 IP 下方，转发列表的 D 服务位于原操作按钮下方（单行滚动）。各服务滚动区依 Base UI 的实际溢出属性显示左右 16px 渐隐，贴边及展开时清除对应渐隐，不增加 React 滚动状态；滚动条仅在悬停或键盘聚焦时显示，无悬停设备保留入口。HostServices 位于主机信息下方，左侧图标默认单行横向 ScrollArea，可向下展开换行；服务行使用 inline-size containment，滚动区采用零基准 flex，避免图标的 max-content 宽度撑大主机卡片；右侧固定展开/收起与 Boxes 管理按钮。ServiceHostPicker 维护 hostIds，主机关联通过修订校验的事务保存。服务可携带显式 hostId 独立执行，无需转发；普通命令、PTY、探针均校验当前服务修订、关联主机与冻结路线，旧 executionHostId 不授权执行。有 ruleId 时仍校验引用和冻结规则。事实按服务修订与路线隔离，响应包含 hostId/ruleId；命令结果复用工作面板。
- 命令输出使用专用 Tauri Channel，前端显示提交后再 ACK，Rust 每个订阅最多一个待确认消息；弹窗关闭即退订但不取消任务，可从内存尾部重新附着。状态由 Rust 决定，退出码成功不显示服务就绪；不将输出解析成 HTML/终端控制指令。取消/超时显示远端状态未知。输出不落盘，不加入已有转发活动日志或配置包；PTY 终端与 E3 服务探针分别由各自功能组件处理。

- 关于应用在 `src/components/settings/about-dialog.tsx`：顶栏设置按钮外侧放置透明 SVG Avatar，复用 `ui/avatar.tsx` 的 Avatar/Image/Fallback/Badge，有更新时显示右上角 8px 纯色圆点，无文字，随既有 WindowHeader 左右控件位置镜像。SVG 在 `src/assets/oria-tunnel-logo.svg`，复用透明图标母版；关于弹窗标题仅显示「关于」，内容放大应用名称，版本和 KrisLee 版权同行且可换行；显示包内应用图标，外链依次为官网、GitHub、KrisLee、问题反馈；问题反馈沿用同样式按钮并指向项目 Issues。macOS 默认应用菜单仅替换原生 About 项，保留系统本地化名称与其他菜单行为；点击恢复主窗口并通过 `tunnel://open-about` 打开同一弹窗。三个入口使用真实 SVG 标识：项目 Logo、GitHub 官方黑/白 Invertocat 和用户提供的 KrisLee Logo，来源见 `src/assets/README.md`。
- 版本更新在关于弹窗内，`src/components/settings/application-update-setting.tsx` 复用 ItemGroup/Item、Button、Switch、业务 Modal/ModalActions 与共享 Progress（shadcn/Base UI）。`src/lib/application-update.ts` 在 App 根部先订阅 `tunnel://update` 再读取快照，按 revision 丢弃旧进度；检查、下载、验签、偏好与安装由 Rust `updater.rs` 管理。安装确认从 Rust 获取活动任务集合，提交时再次核对；界面不直接调用插件安装。新文案位于八语言 `updater.json`，在 `src/i18n.ts` 注册独立命名空间。开发构建禁用更新，隔离 UI 夹具只验证显示与交互，不作为下载验签或安装成功的证据。
- 更新状态直接显示实际结果及目标版本，未检查时显示当前版本，不显示「可以检查更新」或泛化状态标题；自动检查开关不加操作解释。首行主按钮按 Rust 能力切换检查/下载/安装，详情下不重复放置下载或安装按钮。状态区域保持挂载并使用 polite/atomic 播报，下载进度不逐块打断播报；Progress 下方左侧显示下载量，右侧以 ProgressValue 显示本地化百分比，未知总量时隐藏百分比。
- 新版本通知复用 Toast，使用透明应用 Logo、Badge 版本号及「去更新」按钮；按钮关闭通知并打开同一个关于弹窗。通知按版本去重，八语言通过 Trans 插入 Badge；共享 Toast 支持 `data.icon` 自定义图标和既有 `actionProps`，其他业务保留原状态图标。
- 窗口设置末尾的「全部恢复跟随主题」复用 ItemActions 右对齐与小尺寸描边按钮，不占满整行；各字段旁的单项恢复仍使用原有图标按钮。
- 关于弹窗底部的「更多应用」由 `about-dialog.tsx` 中的已发布应用数组维护，当前仅包含 OriaTheme 与 OriaTab，复用 Item/ItemMedia 和 ExternalLink，使用各自原始 SVG。区域以自身宽度切换单/双列，未来新增已发布应用只需追加条目；不显示未发布占位。

- 应用图标使用 `src/components/settings/application-icon-setting.tsx` 与根部 `ApplicationIconSync`：跟随系统 / Light / Dark / Mono，独立于应用主题；偏好保存在 `oria-tunnel.application-icon.v1`，按顺序调用 Rust `set_application_icon`，失败使用 Toast。设置中的 Tabs 只显示图标，名称由 title 与 aria-label 保留。母版为 `src-tauri/icons/OriaTunnelIconExports`，`pnpm icons` 生成桌面 ICO/ICNS、Windows 任务栏和带 Dock 边距的 macOS 运行图标；`src-tauri/icons/tray-source.svg` 为透明托盘母版，另生成 Windows 彩色托盘与 macOS 单色模板。安装包另用 `OriaTunnelInstaller.svg` 中心球蓝色的亚克力盒母版；`pnpm package:mac` 自动替换卷/文件图标并输出保留元数据的 ZIP，`pnpm package:win` 使用独立 NSIS 安装器 ICO。

- 桌面界面默认禁止普通文本选择（含弹窗/Drawer），输入框、文本域、可编辑区域和显式 `data-selectable="true"` 区域保留选字；主机指纹继续可复制。发布前端由 `src/lib/webview-guards.ts` 禁用 WebView 原生右键菜单、F12、Windows/Linux Ctrl+Shift+I/J/C 及 macOS ⌘⌥I/J/C 等调试/源码入口，普通选字、复制粘贴和应用快捷键保留；开发前端不安装这些事件拦截。Rust 创建窗口前将 release 窗口的 devtools 显式设为 false，避免仅靠前端拦截。

- 交互动画使用现有 Motion（`motion/react`），根节点 `MotionConfig reducedMotion="user"`；`src/components/ui/motion.tsx` 提供统一无明显回弹的交互弹簧、仅挂载入场的 `useEntranceMotion` 和 `PageTransition`。页面切换淡入并上移 8px，转发/主机列表仅首次挂载入场，运行快照更新不重播；虚拟日志行不添加逐项动画，React Flow 节点仅淡入，避免影响拖动、端口坐标与测量。减少动态效果时新增位移、缩放及入场动画立即完成。
- TabsList soft 通过 Base UI Indicator 测量选中项，再由 Motion layout 平滑移动和调整宽度；文字、键盘焦点、禁用态仍归 Base UI。Button 默认按压缩至 96%，不改点击回调；外部自定义 render 保留优先级。业务弹窗外层用带稳定 key 的 AnimatePresence 保留退出节点，ResponsiveModal 通过 usePresence 将 Dialog/Drawer 切至关闭态，收到 Base UI onOpenChangeComplete 后才卸载，不使用超时器延迟业务回调；保留原弹窗/遮罩淡出与抽屉手势。

- [组件索引](ui/components/index.md)。通用组件从 `src/components/ui` 引用，不能在页面重建菜单/模态框等基础行为。
- 原版窗口壳在 `src/components/window`，外观/主题在 `src/components/theme`。样式基础在 `src/styles/globals.css`，SSH 专属布局在 `src/styles/tunnel.css`。
- WindowHeader 外侧两组随设置交换并镜像；fixedLeftActions/fixedRightActions 保持物理位置；centerContent 可交互并相对窗口居中。
- 主导航与设置中的外观模式、窗口控件样式/位置统一复用 TabsList 的 soft 变体，使用和两侧操作相同的 overlay 胶囊（默认 34px）与 28px 按钮高度；隐藏下划线，各项按文字内容自然宽度排列、不均分；选中项参照启动按钮 primary-soft，使用半透明 primary 底色和 primary 文字（浅色 10%/深色 20%，悬停 20%/30%）、无可见边框；内圆角按外圆角减去 2px 内边距和外框宽度计算，顶栏操作胶囊内按钮使用相同规则，不叠加普通 Tabs 的实色背景。样式集中在 globals.css，保留 Base UI 键盘导航、焦点与禁用状态。底部运行状态和应用名作为整组水平居中。
- 主机页与日志页的工具栏用共享 Separator 竖线区分筛选与分组；日志「仅警告」属于筛选侧，分割线随分组控件整体换行，避免单独悬空。
- 日志列表由 `activity-list.tsx`/`activity-window.ts` 在既有 ScrollArea 中窗口化：分组标题 40px、两行记录含间距 84px，视口上下各预渲染 3 屏，不延迟滚动范围更新。当前 Rust 最近 1,000 条记录先完整筛选再分组，前端按 120 项分批展开，距底部 2 屏通过滚动与 IntersectionObserver 提前触发；保留已展开批次及手动加载入口。此为当前内存窗口的渐进展示，不新增磁盘历史查询。分组使用可折叠、可聚焦按钮，筛选/分组变化重置范围和滚动位置。
- 页面添加放在 fixedLeftActions；fixedRightActions 只放工作区全部启停。添加主机使用 ServerPlus，添加转发使用 GitPullRequestCreateArrow；连接图页同时显示两者，主机页只显示添加主机，转发页只显示添加转发，日志页不显示添加控件。刷新仅在添加发现弹窗中。左侧资源面板及开关已移除，主内容不留侧栏占位。WindowHeader 对空节点或仅含空 Fragment 的动作区不渲染胶囊。
- 转发页不重复显示新建按钮；标题与工作区名称同行，页面顶部留白 64px。批量工具栏由 `rule-toolbar.tsx` 组合共享 Button：左侧全选/已选数量/所选启停，右侧导入/导出/撤销，窄宽按组换行；部分选择显示混合状态，导出明确所选或全部范围。转发列表的「从此转发新建」使用 CopyPlus 图标，打开无 ID、待填写监听端口且自动连接关闭的新草稿。画布缩放使用 ZoomIn/ZoomOut 图标。
- Windows 原生材质在 `src-tauri/src/window.rs`，保持 Acrylic 开关与直角行为。macOS 原版圆角/背景模糊叶函数在 `src-tauri/src/macos_material.rs`，IPC 等待 AppKit 主线程执行结果，初始化失败时返回错误；设备编译和原生界面证据见项目状态。
- 空画布说明保留原位置，canvas-hint 在第 0 层，包含卡片及连线的 canvas-mask 在第 1 层，画布工具条在第 2 层；说明不接收指针事件，卡片重叠时位于说明前方。
- 单一 ORIA Token 体系；窗口与卡片保持 OriaAide 原版半透明组合，内容卡片复用 themed-surface。页面和画布渐隐上 80px、下 48px；顶栏使用一个 spacing（默认 4px）边距；底部状态栏距底部两个 spacing（默认 8px），画布缩放工具栏距底部九个 spacing（默认 36px），默认与状态栏保持约 13px 纵向间距。弹窗正文独立使用 scroll-fade。
- 主题/模式/语言/主题导入/窗口外观组件来自 OriaAide；迁移清单和原文件 SHA256 见 `shell-migration.json`。`scripts/migrate-shell.mjs` 仅用于首次迁移，不要重跑覆盖本项目后续修改。
- 设置由 `appearance-settings.tsx` 组合原版 Item 卡片分组，左侧标题、右侧控件。外观组包含语言、模式、主题、编辑器外链及自定义主题列表；窗口组按样式、位置、不透明度、模糊排列。编辑器沿用原版地址与原生 HTTP/HTTPS 外链打开方式。
- 本机 SSH 配置、托盘与启动沿用同一 ItemGroup 卡片、Item 行与细分隔，统一 px-3/py-2.5 内边距及右侧控件对齐；路径说明紧随对应标题，限制/错误说明位于对应开关标题下。保存与退出采用卡片底部右对齐的小尺寸按钮，不使用满宽退出或额外 form-actions 间距；设置标题统一由弹窗组合层负责。
- 主题/模式/语言只在设置中显示；不透明度为单行，重置紧随标题。窗口不透明度直接读取 `--oria-opacity-overlay`，模糊半径直接读取 `--oria-backdrop-blur-2xl`（转换为 px，限制 0–64），不再按组件 surface 的透明度强制变为 100%/0px。手动覆盖优先，减少透明效果仍覆盖为 100%/0px；三个滑块不显示「主题」徽标，保留数值与单项/全部重置。控件描边使用主题 border，避免 dark:border-input 造成黑色轮廓。
- 容器边框由本体统一负责：themed-surface 背景伪元素不再额外画 highlight；连接图卡片按用户要求使用主题 shadow-md 增加柔和层次，顶栏胶囊继续使用 shadow-2xs，避免默认主题 shadow-sm/xs 内描边与 border 叠加。浮层继续由 floating-surface 负责 border 与 shadow-md；Glass 等主题自身定义的材质高光保留。
- ResponsiveModal 统一保留左右 16px 视口边距；正文是唯一滚动容器，分组禁止压缩。标题占据独立固定顶部区域，不覆盖正文，关闭按钮与标题对齐；描述放在正文中；复用 shadcn scroll-fade，上下缘均为 16px，24px 滚动范围内渐进显现。标题栏最小 56px 高度，正文上内边距 8px，键盘滚动预留 16px。
- Dialog 在 `--aide-chrome-top` 下方的内容区居中，弹窗最大高度避开顶栏，Dialog/Drawer 遮罩恢复覆盖整个窗口。WindowHeader Portal 到 body，脱离 app-shell 的隔离堆叠层；全窗口遮罩位于顶栏上方绘制，但由下方伪元素接收正文区域的指针，顶栏仍可拖动和操作系统控件；顶栏业务动作和导航阻止指针交互，键盘焦点仍由 Base UI 弹窗管理。
- 页面与弹窗使用共享 ScrollArea 覆盖式滚动条，不为轨道占用内容宽度；Viewport 明确隐藏原生滚动条，避免全局原生样式重新引入 8px gutter。Content 负责内容尺寸变化观测，筛选或展开内容时更新滑块；页面的 padding/scroll-fade 在 Viewport，弹窗的内容间距类在 Content，保留正文渐隐和自然高度。其他原生滚动区域仍使用透明轨道、圆角滑块与主题 muted-fg/accent 颜色。
- 弹层材质及遮罩直接对照 OriaAide：Dialog/Drawer 遮罩使用原版 bg-scrim/20 和 supports-backdrop-filter:backdrop-blur-xs；弹层保留原版 floating-surface 的主题透明度、blur-md 与饱和度。选择器、菜单和 Tooltip 的 Positioner 沿用原版 isolate。用户已明确恢复遮罩模糊，此要求取代此前的仅变暗方案；不再添加自定义 SVG 滤镜、实底或其他材质替代方案。
- 顶栏失焦透明度沿用 OriaAide 原版。开发服务忽略 outputs，防止原生验证缓存的临时文件造成 Vite 监听错误。
- 语言资源在 `src/public/locales/{语言}/`，由 `src/i18n-resources.ts` 统一注册：`common.json` 为共享外壳、主题及设置，`tunnel.json` 为 SSH 业务，`icons.json` 为图标名称，`native.json` 为原生错误、来源诊断、运行正文、文件对话框和托盘；`commands.json`、`terminal.json`、`updater.json` 分别覆盖服务命令、终端和应用更新。简中、繁中、英、日、韩、德、法、俄均有完整翻译；数量使用 i18next 复数变体，日期/时间跟随语言。新增或删除文案时同步 8 语，`src/i18n.test.ts` 检查关闭回退后的键集、插值、Rust 消息标识、原生状态与动态图标覆盖；`src/lib/ui-message.ts` 负责在渲染时翻译保留在状态中的错误标识，避免切换语言后继续显示旧文案。
- 原生消息由 `src-tauri/src/native_message.rs` 在现有字符串字段中携带 `oria-message:` 前缀和版本 1 JSON（key、args、fallback；组合为 messages、separator、fallback）；仅显式信封参与解析，普通外部错误保持原文。args 中普通字符串/数字保持原文，仅显式 `{message: "..."}` 递归翻译，不能把路径、主机名或系统错误当作消息解析。前端状态保留原始消息，所有可见正文和 title 在渲染时调用 `src/lib/native-message.ts` 的 `formatNativeMessage`；业务判断使用消息标识，不匹配翻译正文。未知或超过 24 层 / 20,000 条渲染预算的已解析消息保留可读 fallback；组合信封使用 messages 数组，不约定消息流头。根部 `NativeLanguageSync`（`src/components/language/native-language-sync.tsx`）按顺序同步所选语言，Rust 使用同一份 native.json 更新原生菜单、提示和后续文件对话框标题；应用数据目录独立的 `native-language.json` 原子保存原生语言，用于 WebView 加载前的启动错误，首次默认简中。切换语言不改 Rust 运行快照、不触发重连。
- 浏览器预览明确缺少桌面能力，不提供伪造主机或连接。
- 转发表单在 `src/features/tunnels/rule-editor.tsx`，空主机也保持转发草稿，嵌套添加主机后返回选择；L/R/D 的访问侧与 DNS 语义统一由 `rule-model.ts` 生成。`src/components/tunnel-form.tsx` 组合原 ResponsiveModal 与字段标签，不另建模态行为。
- SSH 主机选择复用 `HostPicker` 与共享 Base UI `Combobox`，输入即按名称/地址/用户/端口/标签过滤，按已有标签分组，多标签主机可出现在多个组，选择仍使用稳定 ID；只提供已添加的主机，以认证方式标识。「转发方式」位于主机选择及其操作之后。`HostTags` 使用 multiple/Chips 选择已有标签或创建新标签，修改草稿、不触发连接；空状态组件清空时隐藏，避免列表顶部额外占位。
- 主机来源设置在 `src/features/hosts/source-settings.tsx`；附加来源与私钥候选共用 `file-paths-editor.tsx`，标题右侧添加，每行输入/选文件/危险色移除，可清空全部路径，不使用文本域。附加来源以路径数组保存，支持绝对或 ~/ 路径；pick_ssh_config_file 仅返回原生文件选择路径，保存时才沿用现有解析流程。主机页与手动/元数据编辑由 App 组合。配置连接字段只读；主机测试只有用户主动提交后调用，来源同步仅解析文本。超时/保活等字段由 Rust 校验与执行，禁止前端模拟成功。
- 主机编辑的私钥候选使用 `identity-files-editor.tsx`，为共享 `file-paths-editor.tsx` 提供私钥文案和选择器：标题行右侧添加，每行手动输入、原生文件选择及危险色移除，可以清空全部；选择器仅返回路径，不读取密钥正文。取消保持原值，选择期间锁定路径行防止索引错位，卸载后不回填旧草稿。配置来源只读。JumpRouteEditor 的 -J 标题、直连提示及添加按钮同一行，添加在最右侧；路线行可选择和移除。认证选择器的自动选项仅显示「自动 / Automatic」。
- 窗口关闭默认收起托盘，所有转发继续运行，仅取消进行中的主机测试；设置提供明确退出并清理全部会话。规则不提供后台开关，当前传输格式中的 background 字段不参与收起策略。内置 SSH 任务不需要命令行客户端的 -f 开关。每用户文件锁及恢复窗口 IPC 在 `src-tauri/src/desktop.rs`，保持 Windows 原版材质与窗口控制样式。
- 高级参数复用 `ParameterField`/`ParameterSwitch`：标题后使用 circle-question-mark 查看说明，支持悬停/焦点与点击固定、Escape/外部关闭；只为实际 SSH 选项标注 `-N`、`-o ConnectTimeout`、`-o ServerAliveInterval`、`-o ServerAliveCountMax`、`-o RemoteCommand`、`-J`、`-o IdentityAgent` 和 `-o IdentitiesOnly`。应用重连等选项仅标题与说明。数字行左标题右 80px 输入框及单位，组内 10px、组间 12px；布尔设置使用 shadcn Switch，批量选择保留复选框。转发类型、认证方式、跳板路线及导入去向均复用共享 Select；静态举例与实际路径均为单箭头。
- 运行诊断在 `src/features/tunnels/runtime-details.tsx`，日志在同目录 `activity-view.tsx`，`activity-model.ts` 负责主机/转发/事件状态的筛选与分组；紧凑工具栏复用共享 Input/Select/Button，支持搜索及仅警告。日志状态来自每条历史事件而非当前运行状态；同名实体仍按稳定 ID 分组，删除后的记录保留 ID。日志只存白名单 ID，主机归属按当前转发配置解析，界面提供该说明。诊断复用业务 Modal。指标、采样时间、目标 TCP 证据和日志来自 Rust，不用前端计时器补出成功或速率；未测量显示破折号。转发页的批量动作以规则 ID 为范围，逐项受理结果不表示监听成功。导出调用 Rust 原生文件对话框。
- 详情流量图为 64px 高、主题淡网格与不随缩放增粗的细线，无额外底边框和可见颜色说明；不足两个采样显示等待采样，已有采样全零时显示「近期暂无流量」。`runtime-format.ts` 统一总量/速率的 IEC 单位转换、舍入进位与亚字节速率，时长按本地化天/小时/分/秒显示；不改动原始 Rust 指标。
- `src-tauri/src/supervisor.rs` 管理期望运行、退避和运行代次；`activity.rs` 只记录白名单事件；`long_running.rs` 管理 Windows 唤醒与登录启动，macOS 适配位于 `macos_lifecycle.rs`。macOS 监听 NSWorkspace 唤醒，登录启动只在用户开启时写入自己的 LaunchAgent；设置与规则自动连接独立、默认关闭，依赖 Vite 的开发模式禁用登录启动。macOS 菜单栏使用模板图标，左键打开菜单，Dock Reopen 与二次启动恢复主窗口。
- 原生托盘菜单在 `src-tauri/src/desktop.rs`：显示主窗口、启动转发、停止转发及退出。两个启停子菜单顶部提供全部操作，后续按稳定主机 ID 分组（名称与端点标题），仅列出对应可操作的规则；连接中、指纹确认与重连归入停止，停止/失败/需处理归入启动。Rust 快照驱动菜单更新，流量变化不重建菜单；点击时重新核对范围，停止不影响主机测试。托盘启动通过 `tunnel://tray-start` 复用 App 批量认证，凭据或指纹确认需要输入时唤起主窗口；仅传规则 ID，凭据不进入菜单或事件。
- 主导航画布标签显示为「连接图 / Connection Map」，内部画布模型与保存键保持原名。顶栏 `WorkspaceActions` 在所有页面提供当前工作区全部转发的开启/停止，开启复用批量认证，停止调用 Rust 批量取消；空工作区、浏览器预览或请求中禁用。批量启停（含所选范围）使用共享 shadcn/Base UI Toast 简要显示请求提交数量，部分失败显示未提交数量及首条错误；普通提示 4 秒、失败提示 6 秒后消失，支持手动关闭。Toast 在右下角显示，沿用 Base UI 堆叠、悬停/聚焦暂停计时和滑动关闭，进入/退出使用位移与淡入淡出，减少动态效果时不播放过渡；通用错误也使用该组件并保留手动关闭。页面、认证弹窗及页脚不显示受理解释或逐项受理列表；Toast 不代表连接成功，运行状态仍来自 Rust。
- 操作结果统一调用 `ui/toast.tsx` 的 `toast.add`：配置导出成功（附路径）、SSH 来源设置保存成功、文件选择失败、清除已存密码失败与主题读取/导入失败均不再占据行内区域。取消导出或保存未成功时不发成功提示；表单校验、配置/来源诊断、凭据存储当前状态及实时连接状态保留就地呈现。成功 4 秒、局部操作失败 6 秒，通用错误保留手动关闭。
- 配置包导入在 `src/features/tunnels/import-config.tsx`：沿用 Modal/Field/Button 与主题导入的上传/原生拖放模式，接受单个 .json 文件、最大 2 MiB；Rust 统一读取和严格校验，保管待确认包，前端仅保留白名单预览与一次性令牌。重新选择及取消使旧预览失效。确认时选择规则、新建/复用主机，省略命令须明确改为仅转发；保存失败保留表单，成功后关闭。导出按钮为保存配置文件，使用原生保存对话框，界面不提供包含本机私钥路径的选项。
- 运行状态文案与色调由 `runtime-status.ts` 映射 Rust errorKind：认证失败为警告橙色，地址解析失败、连接超时、网络错误和端口监听失败为危险红色；列表、画布状态与详情沿用同一分类。中文 SSH Agent 显示为系统代理，SSH 参数名 IdentityAgent 保持原样。
- SSH 主机页与转发页共用 64px 顶部留白及紧凑标题，添加入口仅在顶栏。`host-toolbar.tsx` 组合搜索、持久测试结果筛选及共享 Select 分组；筛选包括未测试、通过及具体失败类别，不把测试中作为持久筛选类别。名称后显示真实测试状态与颜色，下行端点/认证方式，右侧详情、编辑、危险色删除及测试。`host-test-button.tsx` 默认及测试中均使用 primary-soft 主题色；根据 Rust 非终态显示 spinner/测试中...，仍可点击停止；新一轮真实 tested 后成功色对勾/测试成功显示 2 秒，不更改测试结果。详情使用业务 Modal，保留参数、诊断、引用、创建可编辑副本及转发，不再提供隐藏分类。关联转发通过确认弹窗连带删除；被其他已添加主机用作跳板或正在测试的主机保留删除保护。删除已添加的配置主机不修改 SSH 源文件。
- `host-discovery.tsx` 在添加弹窗中显示尚未添加的配置候选，支持搜索、刷新及转入手动表单；发现只解析配置，选择添加不自动测试或连接，嵌套添加保留转发草稿。`host-collection.ts` 统一已添加集合：Rust `addedHostIds` 从手动主机、明确添加的元数据、已有规则与跳板依赖推导；配置元数据与最后解析快照原子保存，来源丢失仍保留已添加项及诊断。主页和选择器不展示全部发现候选，也不再按手动/本机配置分类。
- `globals.css` 为页面、弹窗和下拉统一主题滚动条：8px 轨道内留 2px 透明边形成细圆角滑块，透明轨道、悬停加深、拖动主题色；不支持 WebKit 伪元素时使用标准 thin 样式，高对比模式跟随系统。共享 ScrollArea 滑块使用对应主题色及交互状态。
- 主机分组在 `src/features/hosts/host-groups.tsx`，按标签、认证方式或持久状态分组，搜索/状态筛选先应用，再组织分组；测试进行中的项不建立测试中分组。同一主机可出现在多个标签组，组内去重，原生 details/summary 提供键盘折叠。多跳编辑在 `jump-route-editor.tsx`，逐行选择有序、稳定主机 ID，不让显示名承担连接身份。
- 转发列表与连接图按 `rule-groups.ts` 中的稳定 hostId 分组，同名或同地址的不同配置不会合并。连接图每台主机一张卡片，组内保留逐连接状态、启停、编辑与语义连线；R 箭头反向。主机节点布局仅以 host ID 保存位置；保存连接后聚焦其主机卡片。未发布版不维护旧布局或旧配置包的兼容与迁移。
- 连接图受控节点通过 applyNodeChanges 接收全部 React Flow 变更，`canvas-state.ts` 合并领域快照时保留 measured、选中与拖动状态；拖动中的实时位置不被旧布局覆盖。仅完成移动（含键盘移动）时保存所有当前节点坐标，避免移动本机卡片重排尚未保存的主机卡片。端口 ID 不含左右方向，拖动时保留原端口朝向、完成后调整；仅端口结构变化触发显式测量，节点大小变化交给 ResizeObserver，避免每个拖动帧重置测量并短暂隐藏卡片。
- 启动使用 Button `primary-soft`、停止使用 `destructive`：半透明底色与实色图标/文字；顶栏工作区启停默认透明，仅 hover 显示底色。连接颜色在转发编辑器设置为 `#RRGGBB` 或跟随主题，由 Rust 持久化，导入导出保留，单独改色不触发重连。
- 图标选择及显示复用 `src/features/tunnels/connection-icon.tsx`：字段名默认「图标 / Icon」，服务传入「服务图标」与默认服务分页；可展开的通用/服务品牌/Emoji 分页，双语搜索、默认色点及单个自定义 emoji/符号；76 个 Lucide 通用图标、27 个本地服务品牌图标与 72 个 emoji 的名称和标识由 `connection-icon-catalog.json` 统一维护，Rust 内嵌同一清单校验。展开和收起均有 220ms 高度/透明度过渡，减少动态效果时立即完成。品牌 path 固定来源与许可见 `src/assets/README.md`，无运行时网络加载；列表与连接图共用 ConnectionIcon，内置图标跟随指定连接色（默认主题 primary），emoji 保留原色；配置持久化/导入导出保留 icon，仅改图标不重连。
- 业务弹窗的 `ModalTitleActions` 将就地声明的动作放入标题后的独立插槽，按钮不进入可访问标题文本；窄屏可换行。操作区使用 `ModalActions`，经 Modal 内部 footer 插槽置于滚动正文之外；取消/保存、主机编辑、导入导出、删除确认、批量认证和指纹操作均固定底部。提交按钮必须通过 `form` 关联正文表单 ID，保留原生校验及 Enter 提交；单主机认证的记住密码与连接按钮一起固定，跳板逐主机选项仍在正文。独立渲染无 Modal 时操作区保持原地，设置卡片内的就地保存操作不迁出所属分组。
- 连接色板与列表色点复用 `src/features/tunnels/connection-color.tsx`：依次为主题色、蓝/绿/粉/橙/紫/青/红/灰八种预设、原生自定义颜色入口；选中色有外圈，所有色块支持键盘焦点与可访问名称，窄屏自动换行。列表名称前的色点始终显示规则颜色，跟随主题时使用 accent；运行状态仍由独立状态文字表示。
- 服务协议选择复用 `ui/toggle.tsx` 的 Base UI Toggle/ToggleGroup，HTTP/HTTPS/VNC 默认不选、单选且再次点击取消，按内容自然宽度；D 禁用。`service-protocol.tsx` 组合选择器与打开服务按钮，打开图标置于卡片 IP 路径行末靠右。Rust 根据保存的协议、运行中规则快照及监听状态生成固定协议 URL，HTTP/S 交给系统浏览器、VNC 交给系统客户端；协议只作元数据，配置导入导出保留且不触发重连。
- D 转发的 `proxy-browser.tsx` 复用 Button/DropdownMenu 提供「打开代理浏览器」菜单，在连接图路径行及转发列表操作组选择 Edge/Chrome/Firefox；三个浏览器均显示本地打包的 16px 彩色品牌 SVG，原色不随主题变化，文字沿用菜单主题色。仅 Rust 监听状态且配置未变化时可用。`open_proxy_browser` 只接收规则 ID 与浏览器枚举，Rust 重验工作会话并在 Windows/macOS 的固定安装路径查找浏览器。Edge/Chrome 按浏览器/规则/运行代次隔离目录并传递 SOCKS5/回环代理参数；Firefox 每次启动再独立建目录，写入专用 user.js，配置 SOCKS5、远端 DNS、空绕过列表、允许回环代理及禁止代理失败直连，使用 no-remote/profile 打开空白窗口。均不显示终端、不改系统代理或日常浏览器配置。不支持 Safari，不读写系统网络代理。
- 转发列表项统一为两行 Grid：上行名称/状态与实时指标，下行路径；标题区不占满剩余宽度，实时指标以固定 12px 间距紧随状态，长名称仍可收缩省略；右侧操作按钮组与复选框均跨两行垂直居中。12px 内边距，操作均为 28px，详情/编辑/复制/删除用带名称和提示的图标按钮。长名称与路径省略显示并保留完整 title，指标与操作对齐，不按运行态额外增加第三行。
- 连接图卡片中的每条转发与列表共用 `rule-actions.tsx`（不内置服务或终端入口）：详情、编辑、CopyPlus 从此转发新建、危险色删除及原有启停。连接图服务命令入口位于端点路径行右侧，在打开服务图标之前，底部操作组不重复显示；列表通过 serviceActions 插槽将服务入口放在删除之前（详情、编辑、从此转发新建、服务、删除、启停），DOM 与键盘焦点顺序一致。地址行操作组共用 nodrag/nopan，空组隐藏。转发方式左对齐、收发累计流量在同一行右对齐，下方端点路径，再下方独立操作组；流量不额外占行。所有按钮置于 nodrag/nopan 区域，沿用 App 的详情、草稿和删除确认流程；复制仍清空 ID/监听端口并关闭自动连接。
- SSH 主机卡片不显示远程命令按钮；终端按钮位于转发数量之后，与主机名称/转发数量同一行，使用 SquareTerminal 且不压缩按钮；头部为图标加两行内容：首行 SSH HOST 与右侧用户/地址/端口，次行主机名与转发数量。长地址/名称省略并提供完整 title；移除原来独占一行的地址与对应留白。转发区无独立外框；主机信息与首条转发之间、相邻转发之间均保留主题边框色的 1px 分割线，保留主机卡片本身的圆角边框。主机卡片四边内容留白均为 12px，转发内部各行间距 8px，打开服务图标在 IP 路径行末靠右。卡片宽度按内容自适应、最小 360px；IP 端点禁止换行或压缩，长 IPv6/域名扩宽卡片，由 React Flow 重新测量尺寸，超出视口时使用画布缩放/平移。
- 转发工具栏在有选中项时显示危险色批量删除，确认弹窗列出名称和数量。Rust delete_rules 一次保存整组删除后才取消会话，并清理运行代次、待确认指纹与运行态；缺失规则或保存失败不部分删除。删除主机不因关联转发而禁用，确认列出受影响转发，后端核对确认集合再同事务移除主机和规则，SSH 源文件不变；其他已添加主机的跳板依赖和进行中的主机测试仍受保护。最近 20 次删除操作可整组撤销，主机级撤销恢复必要的主机元数据/快照与规则，但不恢复自动连接或会话。
- 本机端口标识使用对应连接色文字和 14% 同色半透明背景；SSH 主机卡片仅强调主机一侧端口（L 目标、R 监听、D SSH），其余端口为普通文字。停止后保留端口颜色；连接点也使用规则颜色，连线本身仍按运行状态决定颜色与样式。
- 本机端口由 `local-port-handle.tsx` 支持沿四边拖动，Pointer Capture 保持快速/越界拖动，按卡片坐标换算缩放/平移后的指针位置，拖动期间固定卡片尺寸；nodrag/nopan 与关闭连接创建防止误拖卡片或新建连接。`port-placement.ts` 将边和归一化位置按规则 ID 保存至 oria-tunnel-local-ports，释放才写入本地偏好，取消恢复起点；保存值需校验，不影响 Rust 运行状态。双击/Delete 恢复自动，方向键微调，Shift+方向键换边，Escape 取消拖动。端口 ID 保持不变，位置变化重测以更新原有连线。SSH 主机与本机端点统一为 12px，只有本机端点可拖动。
- 连接图只为已有连接绘制独立端点；本机卡片为紧凑的电脑图标与屏幕内数量，仅保留此电脑标题，无英文眉题/说明/底部新建按钮。已有端口按主机相对位置的主轴分布在上/下/左/右，标签朝卡片内侧，水平槽位至少 64px、垂直槽位至少 30px，基础尺寸 200×164px，端口较多时自动扩展；方向选择和尺寸在 canvas-state.ts，保留稳定端口 ID 与拖动测量状态。远端端口复用现有地址路径行并轻量突出，对齐该行的连接点，不另占端口行。L 为本机监听/远端目标，R 为本机目标/远端监听，D 为本机 SOCKS 监听/远端 SSH 端口，不虚构固定目标端口。`connection-visual.ts` 映射 Rust 状态与端口，`connection-edge.tsx` 绘制无文字标签的连线：停止/失败/需处理为中性色静止虚线，建立/重连为连接色流动虚线，listening 为连接色实线叠加流动光晕；减少动态效果时停止动画。
- 实线光晕复用原始曲线路径的双层描边，不使用独立运动物体或位移滤镜；光段为路径的 18%，限制 14–36px，行程包含完整进入与离开两端。直接对描边使用 Web Animations，并以 document 时间线保持刷新/重建后的进度，防止运行快照刷新时反复从起点播放。减少动态时隐藏光晕并取消动画，保留基础实线。

## 服务分享与模板 UI

- 动作编辑器以网格排列类型、按钮名称、执行方式及删除，窄屏保持 DOM 顺序；编辑格式使用共享 ToggleGroup。环境变量使用独立 fieldset，标题和添加按钮同一行；执行选项使用等宽网格及统一控制高度。
- 服务卡片动作依次为详情、设置、CopyPlus 新建副本、删除与执行许可。详情复用 ServiceReview，只读展开脚本和检查设置；副本清空服务身份与转发引用、重新映射动作 ID，保留命令与许可，保存后才新增。

- `config-export.tsx` 为转发页与服务页共用导出弹窗；转发导出默认不含服务，通过开关附加；服务页已明确选择范围则直接展示并选中这些服务。只显示实际数量和可展开的命令详情，移除长段说明、零转发及版本标签；后端仍使用原版本与字段白名单。
- `import-config.tsx` 复用文件预览/替换/主机复用组件，增加默认不选中的服务集合；显示实际复用端点与导入后禁用说明。提交失败就地保留预览，取消不执行命令。
- `service-review.tsx` 供导入、导出、启用审核和模板预览复用；按可展开命令列表及检查设置展示全部脚本；默认展开第一项，超时/成功码/确认使用简短标签与 dl 对齐，控制/双向字符保持纯文本可见转义。ServiceEnableDialog 直接用启用按钮提交当前修订的明确确认，不再增加审核勾选。
- `service-template.tsx` 复用 Modal、Button、ConnectionIcon 与原生 radio/fieldset：从服务弹窗标题旁的「模板导入」按十一类分组选择或搜索完整服务模板（开发与协作、模型类、远程桌面、通用模板优先，其余分类顺序保留），各组固定三列等宽，末行/搜索结果不足三项仍保留列宽；长名称换行，组内网格行等高且卡片保留统一最小高度，DSH 位于模型类；Docker 容器只有一个本地化入口、位于容器与基础设施，systemd 用户/系统通用模板与各服务托管版本统一显示在末尾「systemd 托管」分组，不混入直接命令分类；选择器 serviceTemplateGroups 与持久化 serviceTemplateCategories 分离，不改服务实际分类。模板选项与分类统一来自 service-template-catalog.ts，不在选择器中另行附加目录。30 种普通名称模板均使用 direct-service-templates.ts 的原生命令，常驻前台动作为专用终端且超时 0；同类「· systemd」为独立可选项，保留原托管行为。默认命令仅提供 CLI 实际支持的动作，不继承 systemd 状态映射；搜索同时匹配名称/标识/资源名/本地化分类，隐藏的选中项不可提交。直接命令在前端构建本地草稿，systemd 版本调用 Rust 预览；整体填入名称、颜色、图标、全部命令和检查设置，保留服务身份/引用/许可；可继续编辑后保存，不再单独预览脚本或编辑模板生成参数，关闭选择器不改草稿。
- 服务卡片显示执行许可，导入服务须另行逐项审核当前修订；命令、探针和组合按钮禁用，普通编辑不能解锁。状态与容量数字来自 Rust，不用前端计时模拟成功；凭据重试也尊重当前服务许可。

## 数据与检查

此电脑卡片的 `local-add-forward.tsx` 提供边缘接近添加转发：按最近边缘定位，按钮保持屏幕 40px 与约 4px 间距，外侧触发距离与按钮中心同为 24px；内侧仅在边缘 4px 内触发，按钮命中区回延 8px 覆盖触发位置与间隙，停在触发点即可点击。角落因安全留白而无法直接点击的位置不触发。Motion 弹簧允许进出反向，SVG 将卡片背景、拉伸颈和按钮合成为一个轮廓并统一描边，卡片文字/端口与窗口材质保持独立；卡片/端口拖动期间隐藏。按钮可用 Tab、Enter/Space、Escape；减少动态效果时直接显隐，粗指针保持入口可见。几何与通道判断位于 `local-add-geometry.ts`，监听器、RAF 和 ResizeObserver 随画布卸载清理。

融球进度使用独立慢弹簧，指针位置跟随仍用共享交互弹簧；连接颈在分离前保留更久。填充与透明度复用卡片背景公式和 surface Token，按钮前景跟随卡片，轮廓使用中性边框，并去掉此电脑选中态的蓝色外框。

边缘创建位置随草稿保留到保存成功：`canvas-creation.ts` 按点击侧及偏移安置新主机卡片，并保存本机端点位置；已有卡片保持位置，新卡片按真实测量尺寸避让。上下端点挂在主机卡片边缘，左右端点保留来源路径行；连接箭头仍遵循 L/R/D 语义。创建或取消后，弹窗恢复焦点转给此电脑节点并完成收回，新的指针移动或键盘聚焦才再次显示。

转发列表与主机列表为空时，在空状态说明下显示对应的「图标 + 文字」添加按钮，复用顶栏的新建转发/主机发现入口。主机搜索或筛选无结果时不显示此添加动作；浏览器预览和请求处理中禁用按钮。

主机发现弹窗使用原生复选框多选，搜索保留已选项，全选只作用于当前筛选结果；通过 `add_discovered_hosts` 一次保存整组选中项，添加后回到列表，不自动打开详情。从转发表单进入时将第一台所选主机回填到草稿，其他所选主机同样加入已添加集合。

连接测试、单条及批量启动对自动/私钥/代理认证先提交空凭据，由 Rust 尝试私钥、代理及已保存密码；只有显式密码路线才预先询问。Rust 新运行代次返回认证失败后才请求补充密码/私钥口令，网络、配置和指纹错误不会触发凭据弹窗，纯代理路线保留原错误。主机认证标签优先采用 Rust `authMethodUsed`，未认证时用已配置的私钥/代理显示偏好，不修改 Auto 的后端回退策略。

登录启动不可用时仅禁用开关，界面不解释发布/开发构建或本地开发服务器；实际操作错误仍就地显示。

`src/lib/bridge.ts` 为类型化 IPC 入口，`src/types.ts` 为前端传输类型；Rust 权威类型在 `src-tauri/src/model.rs`。先订阅事件再读快照，按 revision 合并。新输入的密码只在提交前短暂存在于表单。`authentication-field.tsx` 统一目标、跳板及批量认证输入，使用 tunnel 翻译命名空间；记住密码使用默认未勾选的原生复选框，不附加说明。输入框右侧按钮切换显示状态，隐藏时用 EyeClosed、显示时用 Eye，切换主机身份后恢复隐藏；全局 CSS 隐藏 Edge/WebView2 的 ::-ms-reveal，避免 Windows 同时出现原生和自定义两个显示按钮。单主机认证标题带主机名，目标输入框通过 hideLabel 隐藏重复的可见标签但保留关联 Label；跳板和批量字段仍显示标签。actions 插槽让连接按钮与目标主机的记住密码复选框同行（无钥匙图标），不支持保存密码时仍保留连接按钮；跳板及批量认证各自保留按主机同意。保留已保存状态和清除动作；仅密码/自动认证显示存储控件，前端只读取 supported/saved/error，不获取保存值。Windows 凭据在实际密码认证成功后由 Rust 写入，保存失败独立反馈，不把认证成功改写成连接失败。私钥口令不保存，密码不进入配置、前端持久化、日志或导出。

运行 `pnpm typecheck`、`pnpm build`；原生运行 `pnpm tauri dev`。变更交互需检查键盘焦点、弹层、深浅模式、最小窗口和减少动态效果。SSH 原生测试见项目状态中的实测命令。

主机列表项不显示服务按钮，从此主机添加放在设置之后（详情、设置、CopyPlus 从此主机添加、终端、删除、测试）。从此主机添加复用手动副本草稿，保存后新增，不自动连接。主机、转发、服务管理列表的操作按钮组统一按整项垂直居中；转发与服务组跨两行，服务使用独立动作包装，删除图标复用转发相同的危险色 ghost 样式。

画布 Card 仅向 memo 化内容层传入 id、稳定 data 和本机拖动标记；React Flow 坐标更新不重建主机内容及服务菜单。服务事实内容相同时保留原数组引用，仍由 Rust 计算过期与运行状态。

ServiceIconStrip 内的代理服务按钮不继承 IP 路径行的自动边距；无高度差时收起必须直接退出换行状态，不能仅依赖 Motion 完成回调。

本机 LocalAddForward 的 size 必须与父卡片使用同一布局尺寸；背景与隐藏液滴的首帧几何从 size 初始化，随后保留 DOM ResizeObserver，隐藏时的零尺寸不作为有效测量。

运行快照通过 `src/lib/snapshot-state.ts` 复用内容相同的配置对象及未变化运行项；画布几何投影与运行指标分离，只给各主机传对应转发的运行项。卡片动作保持引用稳定并在提交后读取最新回调，服务/终端 Context 不因无关指标改变而广播；服务状态和执行许可仍来自 Rust。ConnectionEdge 由 `connection-sweep.ts` 对 React Flow 三次贝塞尔曲线采样估长，避免拖动时的 SVG 强制布局；几何更新只改已有动画关键帧，停止/减少动态效果仍取消光晕动画。
`canvas-runtime.ts` 将卡片使用的原生状态、错误、流量与配置标记投影为稳定对象；时长/历史采样不触发卡片更新，完整运行信息继续保留在 Snapshot。连线仅在视觉状态、颜色或端点改变时重建，指标刷新复用整个集合；React Flow 事件回调、选项与背景须保持引用稳定，避免绕过节点/连线缓存。IPC JSON 比较使用 `json-equal.ts` 逐字段退出，不能用不完整的修订或字段比较跳过权威状态。
服务选择器位于转发方式及示例说明下方；选择范围和 L/R/D 端口约束保持原逻辑。

服务前台终端按服务 ID 与已解析主机共享识别：主机入口及该主机已关联转发使用同一活动启动终端与停止入口，保留当前 clientId 所有权、动作和结束状态检查，不跨主机复用。D 服务图标通过 service-running-context.ts 读取同一运行证据；代理监听状态独立控制浏览器启动可用性。
