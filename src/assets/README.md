# 应用标识资源

- `oria-tunnel-logo.svg`：项目透明标识，复制自 `src-tauri/icons/OriaTunnelIcon.icon/Assets/oria-network-transparent 2.svg`，用于顶栏 Avatar 和官网入口。
- `krislee-logo.svg`：用户提供的 KrisLee SVG 原文件，用于作者首页入口，保留原始颜色、比例与透明背景。
- `oria-theme-logo.svg`：用户提供的 `color-swatch-fan.svg` 原文件，用于更多应用中的 OriaTheme。
- `oria-tab-logo.svg`：用户提供的 OriaTab 项目 `public/icon.svg` 原文件，用于更多应用中的 OriaTab。
- `github-black.svg`、`github-white.svg`：GitHub 官方品牌包内的 `GitHub_Invertocat_Black.svg` 和 `GitHub_Invertocat_White.svg`，2026-10-24 获取，分别用于浅色与深色背景的 GitHub 仓库入口。来源：[GitHub Brand Toolkit](https://brand.github.com/foundations/logo)、[官方 SVG 下载包](https://brand.github.com/GitHub_Logos.zip)。GitHub 标识及相关商标属于 GitHub, Inc.。

图像仅作链接的装饰，入口名称由可见文字和按钮的可访问名称提供；不改变原始 SVG 图形或从外部网站运行时加载标识。

关于入口的三个 Logo 使用 16px 视觉尺寸。项目 SVG 的实际图形高度为画布的 656/1024，放在 16px 布局槽内以 25px 画布居中显示；GitHub 与 KrisLee SVG 基本填满画布，直接以 16px 显示。原 SVG 文件保持不变。

服务图标保存在 `service-icons.json`，从 [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/tree/16.0.0/icons) 选取 26 个品牌标识，固定版本、不在运行时联网。只提取原 SVG 的 path 与 24×24 viewBox，通过 currentColor 跟随用户选择的服务颜色；图形路径保持原样。每项记录上游 SVG、品牌来源及已声明的许可；Simple Icons 的 CC0-1.0 正文和 Apache Tomcat/Kafka 的 Apache-2.0 正文位于 `docs/licenses/`，随桌面安装包带入 licenses 目录。品牌标识仅用于识别用户选择的服务。

DSH 另采用官方仓库固定修订 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` 的 [FishLogo.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-primitives/src/FishLogo.tsx) 鲸鱼标识，保留原 path、23.16×17.04 viewBox 与 currentColor 用法，替换通用机器人默认图标。官方 MIT 许可原文见 `docs/licenses/DSH_MIT.txt`，随安装包携带；该标识仅用来识别服务模板，不表示官方背书。服务图标因此合计 27 个，原 26 个 Simple Icons 来源不变。
