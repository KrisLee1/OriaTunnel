# 组件索引

| 能力 | 路径 | 使用边界 |
| --- | --- | --- |
| 窗口五区 | `src/components/window/window-header.tsx` | 顶层统一挂载，不新增独立占位顶栏；空动作区（含空 Fragment）不显示胶囊 |
| 系统控件 | `src/components/window/window-control.tsx` | 平台样式、左右顺序、焦点淡化、原生动作 |
| 主题 | `src/components/theme/theme-select.tsx` | ORIA 预设及导入主题 |
| 外观模式 | `src/components/theme/theme-mode-toggle.tsx` | 系统/浅色/深色，原版过渡 |
| 添加及管理主题 | `src/components/theme/theme-import-setting.tsx` | ThemeImportSetting 导入；CustomThemeList 列表、当前标记与删除 |
| 设置卡片分组 | `src/components/settings/appearance-settings.tsx` | AppearanceSettings / WindowSettings，原版左标题右控件布局及编辑器入口 |
| 语言 | `src/components/language/language-select.tsx` | 原版语言列表及持久选择 |
| 窗口外观 | `src/components/settings/window-appearance-setting.tsx` | Windows opacityOnly；其他平台按适配能力显示 |
| 控件偏好 | `src/components/settings/window-control-setting.tsx` | 样式与位置 |
| 表单 | `src/components/ui/input.tsx`、`field.tsx`、`label.tsx`、`select.tsx`、`switch.tsx` | 输入、shadcn/Base UI Select 与 Switch；业务选择器不使用原生 select，持续设置用 Switch，批量选择保留复选框 |
| 搜索选择与多选标签 | `src/components/ui/combobox.tsx` | shadcn/Base UI Combobox：分组、即时过滤、Chips 多选、Portal 与键盘交互；空状态无内容时不占位 |
| 动作/导航 | `src/components/ui/button.tsx`、`tabs.tsx` | 原版尺寸、状态与键盘交互；primary-soft 主题色半透明动作、destructive 危险色动作 |
| 弹层 | `src/components/ui/responsive-modal.tsx`、`dialog.tsx`、`drawer.tsx`、`dropdown-menu.tsx`、`tooltip.tsx` | 焦点、Portal 与透明材质由共享组件负责；ResponsiveModalHeader 只放标题，Description 放在 Body，正文统一滚动并渐隐 |
| 内容 | `src/components/ui/item.tsx`、`badge.tsx`、`scroll-area.tsx` | 通用信息分组、标签；ScrollArea 双轴覆盖轨道不挤压内容，Viewport/Content 分别支持布局与内容间距，内容尺寸变化自动更新滑块 |
| 分割 | `src/components/ui/separator.tsx` | 主题边框色水平/竖直分割；主机与日志工具栏用竖线分隔筛选和分组，随分组控件整体换行 |
| 外链与说明 | `src/components/ui/external-link.tsx`、`info-tooltip.tsx` | 桌面外链交给系统浏览器；Tooltip 支持悬停/焦点和点击固定，再次点击、Escape 或点外部关闭，可传入图标 |
| 弹层材质与遮罩 | `src/styles/globals.css`、`dialog.tsx`、`drawer.tsx` | OriaAide 原版半透明弹层与遮罩 CSS 模糊；嵌套弹窗独立显示遮罩 |
| 业务表单组合 | `src/components/tunnel-form.tsx` | Modal 复用 ResponsiveModal；Field 为关联标签；转发与主机表单共用 |
| 参数设置行 | `src/components/parameter-field.tsx` | ParameterTitle/Field/Switch：独立标签与 circle-question-mark 提示，只有实际 SSH 参数才加括号标注；数字输入行 80px 宽，支持单位关联，不把提示按钮嵌入 label |
| 转发编辑 | `src/features/tunnels/rule-editor.tsx` | L/R/D、主机选择/草稿、高级参数与访问侧；ConnectionFields 由主机与转发复用 |
| 连接颜色 | `src/features/tunnels/connection-color.tsx` | ConnectionColorPicker 主题/预设/自定义圆形色板；ConnectionColorDot 列表名称前的颜色标识 |
| 来源设置 | `src/features/hosts/source-settings.tsx` | 沿用设置 ItemGroup 卡片与 Item 行，附加来源复用 FilePathsEditor、右侧自动检测开关、卡片底部保存；标题由设置弹窗组合，不在组件内连接 SSH |
| 主机选择与标签 | `src/features/hosts/host-picker.tsx`、`host-tags.tsx` | 仅从已添加主机按标签分组选择稳定 ID、标识认证方式；标签多选及创建，去除首尾空格和重复项，保存前只修改草稿 |
| 主机发现与已添加集合 | `src/features/hosts/host-discovery.tsx`、`host-collection.ts` | 添加弹窗搜索配置候选、刷新或手动添加；已添加集合包含明确选择、手动主机、规则及跳板依赖，不自动测试或连接 |
| 文件路径列表 | `src/features/hosts/file-paths-editor.tsx` | 附加 SSH 配置与私钥候选共用，标题右侧添加、逐行输入/原生选文件/危险色移除，允许空列表；路径标签、说明与选择器由调用方提供，选择期间锁定列表、取消保持原值、卸载不回填 |
| 私钥候选路径 | `src/features/hosts/identity-files-editor.tsx` | 组合 FilePathsEditor，提供私钥标签与选择器错误文案；只修改路径草稿，不读取密钥正文 |
| 运行诊断与日志 | `src/features/tunnels/runtime-details.tsx`、`activity-view.tsx` | Rust 指标、目标 TCP 证据及采样图；日志配合 `activity-model.ts` 按主机/转发/历史事件状态筛选与分组，不模拟状态或应用健康 |
| 工作区全部启停 | `src/features/tunnels/workspace-actions.tsx` | 顶栏全部开启/全部停止，标明规则数量与工作区范围，沿用批量认证和 Rust 取消 |
| 配置包导入 | `src/features/tunnels/import-config.tsx` | 主题导入式单文件上传/拖放、2 MiB 限制，Rust 白名单预览、替换与取消、规则选择、主机复用与明确转为 -N；不恢复运行态 |
| 主机工具栏 | `src/features/hosts/host-toolbar.tsx` | 紧凑搜索、未测试/通过/具体失败筛选与 shadcn Select 分组，按组换行；不把测试中作为持久筛选类别，不建立连接 |
| 主机列表与分组 | `src/features/hosts/host-groups.tsx` | 两行名称/状态及端点/认证方式；状态使用 Rust 分类与色调，右侧详情/编辑/删除/测试，详情由 App 的业务 Modal 展示。标签/认证方式/持久状态分组，原生键盘折叠 |
| 跳板路线 | `src/features/hosts/jump-route-editor.tsx` | 有序稳定主机引用、最多 8 跳；标题右侧添加，逐行选择与移除 |
| 连接主机分组 | `src/features/tunnels/rule-groups.ts` | 列表与预览共用稳定主机身份分组；同主机 L/R/D 独立状态、连线与操作，主机布局 |

画布、主机页及主机编辑仍为 `src/App.tsx` 的领域组合，不属于公共组件 API。
