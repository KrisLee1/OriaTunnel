# UI 开发入口

React 19、TypeScript、Vite、Tailwind 4、ORIA THEME、shadcn/ui/Base UI、Lucide、i18next 与 React Flow。实际版本以 lockfile 为准。

## 可复用能力

- [组件索引](ui/components/index.md)。通用组件从 `src/components/ui` 引用，不能在页面重建菜单/模态框等基础行为。
- 原版窗口壳在 `src/components/window`，外观/主题在 `src/components/theme`。样式基础在 `src/styles/globals.css`，SSH 专属布局在 `src/styles/tunnel.css`。
- WindowHeader 外侧两组随设置交换并镜像；fixedLeftActions/fixedRightActions 保持物理位置；centerContent 可交互并相对窗口居中。
- 主机页与日志页的工具栏用共享 Separator 竖线区分筛选与分组；日志「仅警告」属于筛选侧，分割线随分组控件整体换行，避免单独悬空。
- 日志列表由 `activity-list.tsx`/`activity-window.ts` 在既有 ScrollArea 中窗口化：分组标题 40px、两行记录含间距 84px，视口上下各预渲染 3 屏，不延迟滚动范围更新。当前 Rust 最近 1,000 条记录先完整筛选再分组，前端按 120 项分批展开，距底部 2 屏通过滚动与 IntersectionObserver 提前触发；保留已展开批次及手动加载入口。此为当前内存窗口的渐进展示，不新增磁盘历史查询。分组使用可折叠、可聚焦按钮，筛选/分组变化重置范围和滚动位置。
- 页面添加放在 fixedLeftActions；fixedRightActions 只放工作区全部启停。添加主机使用 ServerPlus，添加转发使用 GitPullRequestCreateArrow；连接图页同时显示两者，主机页只显示添加主机，转发页只显示添加转发，日志页不显示添加控件。刷新仅在添加发现弹窗中。左侧资源面板及开关已移除，主内容不留侧栏占位。WindowHeader 对空节点或仅含空 Fragment 的动作区不渲染胶囊。
- 转发页不重复显示新建按钮；标题与工作区名称同行，页面顶部留白 64px。批量工具栏由 `rule-toolbar.tsx` 组合共享 Button：左侧全选/已选数量/所选启停，右侧导入/导出/撤销，窄宽按组换行；部分选择显示混合状态，导出明确所选或全部范围。转发列表的「从此转发新建」使用 CopyPlus 图标，打开无 ID、待填写监听端口且自动连接关闭的新草稿。画布缩放使用 ZoomIn/ZoomOut 图标。
- Windows 原生材质在 `src-tauri/src/window.rs`，保持 Acrylic 开关与直角行为。macOS 原版圆角/背景模糊叶函数在 `src-tauri/src/macos_material.rs`，已核对来源，尚待设备编译与视觉验证。
- 单一 ORIA Token 体系；窗口与卡片保持 OriaAide 原版半透明组合，内容卡片复用 themed-surface。页面和画布渐隐上 80px、下 48px；底部状态栏与顶栏均使用一个 spacing（默认 4px）边距。弹窗正文独立使用 scroll-fade。
- 主题/模式/语言/主题导入/窗口外观组件来自 OriaAide；迁移清单和原文件 SHA256 见 `shell-migration.json`。`scripts/migrate-shell.mjs` 仅用于首次迁移，不要重跑覆盖本项目后续修改。
- 设置由 `appearance-settings.tsx` 组合原版 Item 卡片分组，左侧标题、右侧控件。外观组包含语言、模式、主题、编辑器外链及自定义主题列表；窗口组按样式、位置、不透明度、模糊排列。编辑器沿用原版地址与原生 HTTP/HTTPS 外链打开方式。
- 本机 SSH 配置、托盘与启动沿用同一 ItemGroup 卡片、Item 行与细分隔，统一 px-3/py-2.5 内边距及右侧控件对齐；路径说明紧随对应标题，限制/错误说明位于对应开关标题下。保存与退出采用卡片底部右对齐的小尺寸按钮，不使用满宽退出或额外 form-actions 间距；设置标题统一由弹窗组合层负责。
- 主题/模式/语言只在设置中显示；不透明度为单行，重置紧随标题。控件描边使用主题 border，避免 dark:border-input 造成黑色轮廓。
- 容器边框由本体统一负责：themed-surface 背景伪元素不再额外画 highlight；连接图卡片按用户要求使用主题 shadow-md 增加柔和层次，顶栏胶囊继续使用 shadow-2xs，避免默认主题 shadow-sm/xs 内描边与 border 叠加。浮层继续由 floating-surface 负责 border 与 shadow-md；Glass 等主题自身定义的材质高光保留。
- ResponsiveModal 统一保留左右 16px 视口边距；正文是唯一滚动容器，分组禁止压缩。标题与关闭按钮悬浮在正文上方，描述放在正文中；复用 shadcn scroll-fade，上缘 72px、下缘 20px，按滚动位置自动消退。标题栏保留 56px 高度，键盘滚动留出顶部安全距离。
- 页面与弹窗使用共享 ScrollArea 覆盖式滚动条，不为轨道占用内容宽度；Viewport 明确隐藏原生滚动条，避免全局原生样式重新引入 8px gutter。Content 负责内容尺寸变化观测，筛选或展开内容时更新滑块；页面的 padding/scroll-fade 在 Viewport，弹窗的内容间距类在 Content，保留正文渐隐和自然高度。其他原生滚动区域仍使用透明轨道、圆角滑块与主题 muted-fg/accent 颜色。
- 弹层材质及遮罩直接对照 OriaAide：Dialog/Drawer 遮罩使用原版 bg-scrim/20 和 supports-backdrop-filter:backdrop-blur-xs；弹层保留原版 floating-surface 的主题透明度、blur-md 与饱和度。选择器、菜单和 Tooltip 的 Positioner 沿用原版 isolate。用户已明确恢复遮罩模糊，此要求取代此前的仅变暗方案；不再添加自定义 SVG 滤镜、实底或其他材质替代方案。
- 顶栏失焦透明度沿用 OriaAide 原版。开发服务忽略 outputs，防止原生验证缓存的临时文件造成 Vite 监听错误。
- 业务翻译在 `src/tunnel-i18n.ts`，共享翻译在 `src/public/locales`。业务支持中英；其余语言暂回退英文。
- 浏览器预览明确缺少桌面能力，不提供伪造主机或连接。
- 转发表单在 `src/features/tunnels/rule-editor.tsx`，空主机也保持转发草稿，嵌套添加主机后返回选择；L/R/D 的访问侧与 DNS 语义统一由 `rule-model.ts` 生成。`src/components/tunnel-form.tsx` 组合原 ResponsiveModal 与字段标签，不另建模态行为。
- SSH 主机选择复用 `HostPicker` 与共享 Base UI `Combobox`，输入即按名称/地址/用户/端口/标签过滤，按已有标签分组，多标签主机可出现在多个组，选择仍使用稳定 ID；只提供已添加的主机，以认证方式标识。「转发方式」位于主机选择及其操作之后。`HostTags` 使用 multiple/Chips 选择已有标签或创建新标签，修改草稿、不触发连接；空状态组件清空时隐藏，避免列表顶部额外占位。
- 主机来源设置在 `src/features/hosts/source-settings.tsx`；附加来源与私钥候选共用 `file-paths-editor.tsx`，标题右侧添加，每行输入/选文件/危险色移除，可清空全部路径，不使用文本域。附加来源以路径数组保存，支持绝对或 ~/ 路径；pick_ssh_config_file 仅返回原生文件选择路径，保存时才沿用现有解析流程。主机页与手动/元数据编辑由 App 组合。配置连接字段只读；主机测试只有用户主动提交后调用，来源同步仅解析文本。超时/保活等字段由 Rust 校验与执行，禁止前端模拟成功。
- 主机编辑的私钥候选使用 `identity-files-editor.tsx`，为共享 `file-paths-editor.tsx` 提供私钥文案和选择器：标题行右侧添加，每行手动输入、原生文件选择及危险色移除，可以清空全部；选择器仅返回路径，不读取密钥正文。取消保持原值，选择期间锁定路径行防止索引错位，卸载后不回填旧草稿。配置来源只读。JumpRouteEditor 的 -J 标题、直连提示及添加按钮同一行，添加在最右侧；路线行可选择和移除。认证选择器的自动选项仅显示「自动 / Automatic」。
- 窗口关闭默认收起托盘，所有转发继续运行，仅取消进行中的主机测试；设置提供明确退出并清理全部会话。规则不提供后台开关，当前传输格式中的 background 字段不参与收起策略。内置 SSH 任务不需要命令行客户端的 -f 开关。每用户文件锁及恢复窗口 IPC 在 `src-tauri/src/desktop.rs`，保持 Windows 原版材质与窗口控制样式。
- 高级参数复用 `ParameterField`/`ParameterSwitch`：标题后使用 circle-question-mark 查看说明，支持悬停/焦点与点击固定、Escape/外部关闭；只为实际 SSH 选项标注 `-N`、`-o ConnectTimeout`、`-o ServerAliveInterval`、`-o ServerAliveCountMax`、`-o RemoteCommand`、`-J`、`-o IdentityAgent` 和 `-o IdentitiesOnly`。应用重连等选项仅标题与说明。数字行左标题右 80px 输入框及单位，组内 10px、组间 12px；布尔设置使用 shadcn Switch，批量选择保留复选框。转发类型、认证方式、跳板路线及导入去向均复用共享 Select；静态举例与实际路径均为单箭头。
- 运行诊断在 `src/features/tunnels/runtime-details.tsx`，日志在同目录 `activity-view.tsx`，`activity-model.ts` 负责主机/转发/事件状态的筛选与分组；紧凑工具栏复用共享 Input/Select/Button，支持搜索及仅警告。日志状态来自每条历史事件而非当前运行状态；同名实体仍按稳定 ID 分组，删除后的记录保留 ID。日志只存白名单 ID，主机归属按当前转发配置解析，界面提供该说明。诊断复用业务 Modal。指标、采样时间、目标 TCP 证据和日志来自 Rust，不用前端计时器补出成功或速率；未测量显示破折号。转发页的批量动作以规则 ID 为范围，逐项受理结果不表示监听成功。导出调用 Rust 原生文件对话框。
- 详情流量图为 64px 高、主题淡网格与不随缩放增粗的细线，无额外底边框和可见颜色说明；不足两个采样显示等待采样，已有采样全零时显示「近期暂无流量」。`runtime-format.ts` 统一总量/速率的 IEC 单位转换、舍入进位与亚字节速率，时长按本地化天/小时/分/秒显示；不改动原始 Rust 指标。
- `src-tauri/src/supervisor.rs` 管理期望运行、退避和运行代次；`activity.rs` 只记录白名单事件；`long_running.rs` 管理 Windows 唤醒与用户明确操作的登录启动。设置中的登录启动与规则自动连接独立、默认关闭，开发构建禁用登录启动。
- 主导航画布标签显示为「连接图 / Connection Map」，内部画布模型与保存键保持原名。顶栏 `WorkspaceActions` 在所有页面提供当前工作区全部转发的开启/停止，开启复用批量认证，停止调用 Rust 批量取消；空工作区、浏览器预览或请求中禁用。页脚的批量结果入口返回转发页查看逐项结果。
- 配置包导入在 `src/features/tunnels/import-config.tsx`：沿用 Modal/Field/Button 与主题导入的上传/原生拖放模式，接受单个 .json 文件、最大 2 MiB；Rust 统一读取和严格校验，保管待确认包，前端仅保留白名单预览与一次性令牌。重新选择及取消使旧预览失效。确认时选择规则、新建/复用主机，省略命令须明确改为仅转发；保存失败保留表单，成功后关闭。导出按钮为保存配置文件，使用原生保存对话框，界面不提供包含本机私钥路径的选项。
- 运行状态文案与色调由 `runtime-status.ts` 映射 Rust errorKind：认证失败为警告橙色，地址解析失败、连接超时、网络错误和端口监听失败为危险红色；列表、画布状态与详情沿用同一分类。中文 SSH Agent 显示为系统代理，SSH 参数名 IdentityAgent 保持原样。
- SSH 主机页与转发页共用 64px 顶部留白及紧凑标题，添加入口仅在顶栏。`host-toolbar.tsx` 组合搜索、持久测试结果筛选及共享 Select 分组；筛选包括未测试、通过及具体失败类别，不把测试中作为持久筛选类别。名称后显示真实测试状态与颜色，下行端点/认证方式，右侧详情、编辑、危险色删除及测试。`host-test-button.tsx` 根据 Rust 非终态显示 spinner/测试中...，仍可点击停止；新一轮真实 tested 后成功色对勾/测试成功显示 2 秒，不更改测试结果。详情使用业务 Modal，保留参数、诊断、引用、创建可编辑副本及转发，不再提供隐藏分类。关联转发通过确认弹窗连带删除；被其他已添加主机用作跳板或正在测试的主机保留删除保护。删除已添加的配置主机不修改 SSH 源文件。
- `host-discovery.tsx` 在添加弹窗中显示尚未添加的配置候选，支持搜索、刷新及转入手动表单；发现只解析配置，选择添加不自动测试或连接，嵌套添加保留转发草稿。`host-collection.ts` 统一已添加集合：Rust `addedHostIds` 从手动主机、明确添加的元数据、已有规则与跳板依赖推导；配置元数据与最后解析快照原子保存，来源丢失仍保留已添加项及诊断。主页和选择器不展示全部发现候选，也不再按手动/本机配置分类。
- `globals.css` 为页面、弹窗和下拉统一主题滚动条：8px 轨道内留 2px 透明边形成细圆角滑块，透明轨道、悬停加深、拖动主题色；不支持 WebKit 伪元素时使用标准 thin 样式，高对比模式跟随系统。共享 ScrollArea 滑块使用对应主题色及交互状态。
- 主机分组在 `src/features/hosts/host-groups.tsx`，按标签、认证方式或持久状态分组，搜索/状态筛选先应用，再组织分组；测试进行中的项不建立测试中分组。同一主机可出现在多个标签组，组内去重，原生 details/summary 提供键盘折叠。多跳编辑在 `jump-route-editor.tsx`，逐行选择有序、稳定主机 ID，不让显示名承担连接身份。
- 转发列表与连接图按 `rule-groups.ts` 中的稳定 hostId 分组，同名或同地址的不同配置不会合并。连接图每台主机一张卡片，组内保留逐连接状态、启停、编辑与语义连线；R 箭头反向。主机节点布局仅以 host ID 保存位置；保存连接后聚焦其主机卡片。未发布版不维护旧布局或旧配置包的兼容与迁移。
- 连接图受控节点通过 applyNodeChanges 接收全部 React Flow 变更，`canvas-state.ts` 合并领域快照时保留 measured、选中与拖动状态；拖动中的实时位置不被旧布局覆盖。仅完成移动（含键盘移动）时保存所有当前节点坐标，避免移动本机卡片重排尚未保存的主机卡片。端口 ID 不含左右方向，拖动时保留原端口朝向、完成后调整；仅端口结构变化触发显式测量，节点大小变化交给 ResizeObserver，避免每个拖动帧重置测量并短暂隐藏卡片。
- 启动使用 Button `primary-soft`、停止使用 `destructive`：半透明底色与实色图标/文字；顶栏工作区启停默认透明，仅 hover 显示底色。连接颜色在转发编辑器设置为 `#RRGGBB` 或跟随主题，由 Rust 持久化，导入导出保留，单独改色不触发重连。
- 连接色板与列表色点复用 `src/features/tunnels/connection-color.tsx`：依次为主题色、蓝/绿/粉/橙/紫/青/红/灰八种预设、原生自定义颜色入口；选中色有外圈，所有色块支持键盘焦点与可访问名称，窄屏自动换行。列表名称前的色点始终显示规则颜色，跟随主题时使用 accent；运行状态仍由独立状态文字表示。
- 转发列表项统一为两行 Grid：上行名称/状态与实时指标，下行路径与操作；复选框跨两行。12px 内边距，操作均为 28px，详情/编辑/复制/删除用带名称和提示的图标按钮。长名称与路径省略显示并保留完整 title，指标与操作对齐，不按运行态额外增加第三行。
- 连接图卡片中的每条转发与列表共用 `rule-actions.tsx`：详情、编辑、CopyPlus 从此转发新建、危险色删除及原有启停。转发方式左对齐、收发累计流量在同一行右对齐，下方端点路径，再下方独立操作组；流量不额外占行。所有按钮置于 nodrag/nopan 区域，沿用 App 的详情、草稿和删除确认流程；复制仍清空 ID/监听端口并关闭自动连接。
- SSH 主机卡片头部为图标加两行内容：首行 SSH HOST 与右侧用户/地址/端口，次行主机名与转发数量。长地址/名称省略并提供完整 title；移除原来独占一行的地址与对应留白。转发区无独立外框；主机信息与首条转发之间、相邻转发之间均保留主题边框色的 1px 分割线，保留主机卡片本身的圆角边框。
- 转发工具栏在有选中项时显示危险色批量删除，确认弹窗列出名称和数量。Rust delete_rules 一次保存整组删除后才取消会话，并清理运行代次、待确认指纹与运行态；缺失规则或保存失败不部分删除。删除主机不因关联转发而禁用，确认列出受影响转发，后端核对确认集合再同事务移除主机和规则，SSH 源文件不变；其他已添加主机的跳板依赖和进行中的主机测试仍受保护。最近 20 次删除操作可整组撤销，主机级撤销恢复必要的主机元数据/快照与规则，但不恢复自动连接或会话。
- 本机端口标识使用对应连接色文字和 14% 同色半透明背景；SSH 主机卡片仅强调主机一侧端口（L 目标、R 监听、D SSH），其余端口为普通文字。停止后保留端口颜色；连接点也使用规则颜色，连线本身仍按运行状态决定颜色与样式。
- 本机端口由 `local-port-handle.tsx` 支持沿四边拖动，Pointer Capture 保持快速/越界拖动，按卡片坐标换算缩放/平移后的指针位置，拖动期间固定卡片尺寸；nodrag/nopan 与关闭连接创建防止误拖卡片或新建连接。`port-placement.ts` 将边和归一化位置按规则 ID 保存至 oria-tunnel-local-ports，释放才写入本地偏好，取消恢复起点；保存值需校验，不影响 Rust 运行状态。双击/Delete 恢复自动，方向键微调，Shift+方向键换边，Escape 取消拖动。端口 ID 保持不变，位置变化重测以更新原有连线。SSH 主机与本机端点统一为 12px，只有本机端点可拖动。
- 连接图只为已有连接绘制独立端点；本机卡片为紧凑的电脑图标与屏幕内数量，仅保留此电脑标题，无英文眉题/说明/底部新建按钮。已有端口按主机相对位置的主轴分布在上/下/左/右，标签朝卡片内侧，水平槽位至少 64px、垂直槽位至少 30px，基础尺寸 200×164px，端口较多时自动扩展；方向选择和尺寸在 canvas-state.ts，保留稳定端口 ID 与拖动测量状态。远端端口复用现有地址路径行并轻量突出，对齐该行的连接点，不另占端口行。L 为本机监听/远端目标，R 为本机目标/远端监听，D 为本机 SOCKS 监听/远端 SSH 端口，不虚构固定目标端口。`connection-visual.ts` 映射 Rust 状态与端口，`connection-edge.tsx` 绘制无文字标签的连线：停止/失败/需处理为中性色静止虚线，建立/重连为连接色流动虚线，listening 为连接色实线叠加流动光晕；减少动态效果时停止动画。
- 实线光晕复用原始曲线路径的双层描边，不使用独立运动物体或位移滤镜；光段为路径的 18%，限制 14–36px，行程包含完整进入与离开两端。直接对描边使用 Web Animations，并以 document 时间线保持刷新/重建后的进度，防止运行快照刷新时反复从起点播放。减少动态时隐藏光晕并取消动画，保留基础实线。

## 数据与检查

`src/lib/bridge.ts` 为类型化 IPC 入口，`src/types.ts` 为前端传输类型；Rust 权威类型在 `src-tauri/src/model.rs`。先订阅事件再读快照，按 revision 合并。新输入的密码只在提交前短暂存在于表单。`authentication-field.tsx` 统一目标、跳板及批量认证输入、默认关闭的记住开关、已保存状态和清除动作；仅密码/自动认证显示存储控件，前端只读取 supported/saved/error，不获取保存值。Windows 凭据在实际密码认证成功后由 Rust 写入，保存失败独立反馈，不把认证成功改写成连接失败。私钥口令不保存，密码不进入配置、前端持久化、日志或导出。

运行 `pnpm typecheck`、`pnpm build`；原生运行 `pnpm tauri dev`。变更交互需检查键盘焦点、弹层、深浅模式、最小窗口和减少动态效果。SSH 原生测试见项目状态中的实测命令。
