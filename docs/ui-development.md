# UI 开发入口

React 19、TypeScript、Vite、Tailwind 4、ORIA THEME、shadcn/ui/Base UI、Lucide、i18next 与 React Flow。实际版本以 lockfile 为准。

## 可复用能力

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
- 页面与弹窗使用共享 ScrollArea 覆盖式滚动条，不为轨道占用内容宽度；Viewport 明确隐藏原生滚动条，避免全局原生样式重新引入 8px gutter。Content 负责内容尺寸变化观测，筛选或展开内容时更新滑块；页面的 padding/scroll-fade 在 Viewport，弹窗的内容间距类在 Content，保留正文渐隐和自然高度。其他原生滚动区域仍使用透明轨道、圆角滑块与主题 muted-fg/accent 颜色。
- 弹层材质及遮罩直接对照 OriaAide：Dialog/Drawer 遮罩使用原版 bg-scrim/20 和 supports-backdrop-filter:backdrop-blur-xs；弹层保留原版 floating-surface 的主题透明度、blur-md 与饱和度。选择器、菜单和 Tooltip 的 Positioner 沿用原版 isolate。用户已明确恢复遮罩模糊，此要求取代此前的仅变暗方案；不再添加自定义 SVG 滤镜、实底或其他材质替代方案。
- 顶栏失焦透明度沿用 OriaAide 原版。开发服务忽略 outputs，防止原生验证缓存的临时文件造成 Vite 监听错误。
- 语言资源在 `src/public/locales/{语言}/`，由 `src/i18n-resources.ts` 统一注册：`common.json` 为共享外壳、主题及设置，`tunnel.json` 为 SSH 业务，`icons.json` 为图标名称，`native.json` 为原生错误、来源诊断、运行正文、文件对话框和托盘。简中、繁中、英、日、韩、德、法、俄均有完整翻译；数量使用 i18next 复数变体，日期/时间跟随语言。新增或删除文案时同步 8 语，`src/i18n.test.ts` 检查键集、插值、Rust 消息标识、原生状态与动态图标覆盖。
- 原生消息由 `src-tauri/src/native_message.rs` 在现有字符串字段中携带 `oria-message:` 前缀和版本 1 JSON（key、args、fallback；组合为 messages、separator、fallback），大诊断集合使用显式 `oria-message-stream:1\n` 头和逐行有界信封，普通多行外部错误不按消息流猜测解析。args 中普通字符串/数字保持原文，仅显式 `{message: "..."}` 递归翻译，不能把路径、主机名或系统错误当作消息解析。前端状态保留原始消息，所有可见正文和 title 在渲染时调用 `src/lib/native-message.ts` 的 `formatNativeMessage`；业务判断使用消息标识，不匹配翻译正文。未知或超过渲染预算的已解析消息保留可读 fallback。根部 `NativeLanguageSync` 按顺序同步所选语言，Rust 使用同一份 native.json 更新原生菜单、提示和后续文件对话框标题；应用数据目录独立的 `native-language.json` 原子保存原生语言，用于 WebView 加载前的启动错误，首次默认简中。切换语言不改 Rust 运行快照、不触发重连。
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
- 图标选择及显示复用 `src/features/tunnels/connection-icon.tsx`：字段名为「图标 / Icon」，可展开的内置图标/Emoji 分页，双语搜索、默认色点及单个自定义 emoji/符号；56 个 Lucide 图标与 72 个 emoji 的名称和标识由 `connection-icon-catalog.json` 统一维护，Rust 内嵌同一清单校验。展开和收起均有 220ms 高度/透明度过渡，减少动态效果时立即完成。列表与连接图共用 ConnectionIcon，内置图标跟随指定连接色（默认主题 primary），emoji 保留原色；配置持久化/导入导出保留 icon，仅改图标不重连。
- 业务弹窗操作区使用 `ModalActions`，经 Modal 内部 footer 插槽置于滚动正文之外；取消/保存、主机编辑、导入导出、删除确认、批量认证和指纹操作均固定底部。提交按钮必须通过 `form` 关联正文表单 ID，保留原生校验及 Enter 提交；单主机认证的记住密码与连接按钮一起固定，跳板逐主机选项仍在正文。独立渲染无 Modal 时操作区保持原地，设置卡片内的就地保存操作不迁出所属分组。
- 连接色板与列表色点复用 `src/features/tunnels/connection-color.tsx`：依次为主题色、蓝/绿/粉/橙/紫/青/红/灰八种预设、原生自定义颜色入口；选中色有外圈，所有色块支持键盘焦点与可访问名称，窄屏自动换行。列表名称前的色点始终显示规则颜色，跟随主题时使用 accent；运行状态仍由独立状态文字表示。
- 服务协议选择复用 `ui/toggle.tsx` 的 Base UI Toggle/ToggleGroup，HTTP/HTTPS/VNC 默认不选、单选且再次点击取消，按内容自然宽度；D 禁用。`service-protocol.tsx` 组合选择器与打开服务按钮，打开图标置于卡片 IP 路径行末靠右。Rust 根据保存的协议、运行中规则快照及监听状态生成固定协议 URL，HTTP/S 交给系统浏览器、VNC 交给系统客户端；协议只作元数据，配置导入导出保留且不触发重连。
- 转发列表项统一为两行 Grid：上行名称/状态与实时指标，下行路径与操作；复选框跨两行。12px 内边距，操作均为 28px，详情/编辑/复制/删除用带名称和提示的图标按钮。长名称与路径省略显示并保留完整 title，指标与操作对齐，不按运行态额外增加第三行。
- 连接图卡片中的每条转发与列表共用 `rule-actions.tsx`：详情、编辑、CopyPlus 从此转发新建、危险色删除及原有启停。转发方式左对齐、收发累计流量在同一行右对齐，下方端点路径，再下方独立操作组；流量不额外占行。所有按钮置于 nodrag/nopan 区域，沿用 App 的详情、草稿和删除确认流程；复制仍清空 ID/监听端口并关闭自动连接。
- SSH 主机卡片头部为图标加两行内容：首行 SSH HOST 与右侧用户/地址/端口，次行主机名与转发数量。长地址/名称省略并提供完整 title；移除原来独占一行的地址与对应留白。转发区无独立外框；主机信息与首条转发之间、相邻转发之间均保留主题边框色的 1px 分割线，保留主机卡片本身的圆角边框。主机卡片四边内容留白均为 12px，转发内部各行间距 8px，打开服务图标在 IP 路径行末靠右。卡片宽度按内容自适应、最小 360px；IP 端点禁止换行或压缩，长 IPv6/域名扩宽卡片，由 React Flow 重新测量尺寸，超出视口时使用画布缩放/平移。
- 转发工具栏在有选中项时显示危险色批量删除，确认弹窗列出名称和数量。Rust delete_rules 一次保存整组删除后才取消会话，并清理运行代次、待确认指纹与运行态；缺失规则或保存失败不部分删除。删除主机不因关联转发而禁用，确认列出受影响转发，后端核对确认集合再同事务移除主机和规则，SSH 源文件不变；其他已添加主机的跳板依赖和进行中的主机测试仍受保护。最近 20 次删除操作可整组撤销，主机级撤销恢复必要的主机元数据/快照与规则，但不恢复自动连接或会话。
- 本机端口标识使用对应连接色文字和 14% 同色半透明背景；SSH 主机卡片仅强调主机一侧端口（L 目标、R 监听、D SSH），其余端口为普通文字。停止后保留端口颜色；连接点也使用规则颜色，连线本身仍按运行状态决定颜色与样式。
- 本机端口由 `local-port-handle.tsx` 支持沿四边拖动，Pointer Capture 保持快速/越界拖动，按卡片坐标换算缩放/平移后的指针位置，拖动期间固定卡片尺寸；nodrag/nopan 与关闭连接创建防止误拖卡片或新建连接。`port-placement.ts` 将边和归一化位置按规则 ID 保存至 oria-tunnel-local-ports，释放才写入本地偏好，取消恢复起点；保存值需校验，不影响 Rust 运行状态。双击/Delete 恢复自动，方向键微调，Shift+方向键换边，Escape 取消拖动。端口 ID 保持不变，位置变化重测以更新原有连线。SSH 主机与本机端点统一为 12px，只有本机端点可拖动。
- 连接图只为已有连接绘制独立端点；本机卡片为紧凑的电脑图标与屏幕内数量，仅保留此电脑标题，无英文眉题/说明/底部新建按钮。已有端口按主机相对位置的主轴分布在上/下/左/右，标签朝卡片内侧，水平槽位至少 64px、垂直槽位至少 30px，基础尺寸 200×164px，端口较多时自动扩展；方向选择和尺寸在 canvas-state.ts，保留稳定端口 ID 与拖动测量状态。远端端口复用现有地址路径行并轻量突出，对齐该行的连接点，不另占端口行。L 为本机监听/远端目标，R 为本机目标/远端监听，D 为本机 SOCKS 监听/远端 SSH 端口，不虚构固定目标端口。`connection-visual.ts` 映射 Rust 状态与端口，`connection-edge.tsx` 绘制无文字标签的连线：停止/失败/需处理为中性色静止虚线，建立/重连为连接色流动虚线，listening 为连接色实线叠加流动光晕；减少动态效果时停止动画。
- 实线光晕复用原始曲线路径的双层描边，不使用独立运动物体或位移滤镜；光段为路径的 18%，限制 14–36px，行程包含完整进入与离开两端。直接对描边使用 Web Animations，并以 document 时间线保持刷新/重建后的进度，防止运行快照刷新时反复从起点播放。减少动态时隐藏光晕并取消动画，保留基础实线。

## 数据与检查

登录启动不可用时仅禁用开关，界面不解释发布/开发构建或本地开发服务器；实际操作错误仍就地显示。

`src/lib/bridge.ts` 为类型化 IPC 入口，`src/types.ts` 为前端传输类型；Rust 权威类型在 `src-tauri/src/model.rs`。先订阅事件再读快照，按 revision 合并。新输入的密码只在提交前短暂存在于表单。`authentication-field.tsx` 统一目标、跳板及批量认证输入，使用 tunnel 翻译命名空间；记住密码使用默认未勾选的原生复选框，不附加说明。输入框右侧按钮切换显示状态，隐藏时用 EyeClosed、显示时用 Eye，切换主机身份后恢复隐藏。单主机认证标题带主机名，目标输入框通过 hideLabel 隐藏重复的可见标签但保留关联 Label；跳板和批量字段仍显示标签。actions 插槽让连接按钮与目标主机的记住密码复选框同行（无钥匙图标），不支持保存密码时仍保留连接按钮；跳板及批量认证各自保留按主机同意。保留已保存状态和清除动作；仅密码/自动认证显示存储控件，前端只读取 supported/saved/error，不获取保存值。Windows 凭据在实际密码认证成功后由 Rust 写入，保存失败独立反馈，不把认证成功改写成连接失败。私钥口令不保存，密码不进入配置、前端持久化、日志或导出。

运行 `pnpm typecheck`、`pnpm build`；原生运行 `pnpm tauri dev`。变更交互需检查键盘焦点、弹层、深浅模式、最小窗口和减少动态效果。SSH 原生测试见项目状态中的实测命令。
