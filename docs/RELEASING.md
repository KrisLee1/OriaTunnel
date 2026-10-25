# 构建与发布

从仓库根目录操作。应用版本当前由 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 共同确定；发布标签必须为对应的 `vX.Y.Z` 正式版本。CI 使用 Node 24.19.0、pnpm 11.24.0、Rust 1.98.0，依赖按锁文件安装，Actions 固定到提交 SHA。

## 工作流

| 工作流 | 入口 | 结果 |
| --- | --- | --- |
| `Quality gates` | master 更新、PR、手动 | 前端全量测试/构建、发布脚本测试；四个平台的 Rust 格式、Clippy、库测试及隔离回环集成测试 |
| `Check updater signing secrets` | 预检脚本更新、手动 | 对公开随机探针签名，再用应用内公钥验签和检查版本绑定；不创建 Release |
| `Build release draft` | `v*` 标签、手动 | `validate` 仅生成 Actions 产物；`draft` 或版本标签汇总完整 Release 草稿；不自动公开 |
| `Publish verified release` | 在 master 手动输入已有草稿标签 | 重新下载草稿全部资产，核对哈希、目标、源提交、版本与签名，再发布并设为 Latest |

普通 master 更新不会发布版本。发布构建不接收其他分支的手动执行；外部 PR 的质量检查不读取发布密钥。构建任务只有 `contents: read`，创建草稿和正式发布任务单独使用 `contents: write`。

## 配置 GitHub Secrets

在仓库 Settings → Secrets and variables → Actions 添加以下仓库 Secrets。密钥和口令不要写进源码、命令参数、工作流文本或聊天；此表只列名称与用途。

| Secret | 内容 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 更新私钥 `.key` 文件的完整内容；不是文件路径，也不是 `.pub` 文件 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 创建这把更新私钥时的原口令；只有确定创建时为空才可留空 |
| `APPLE_CERTIFICATE` | Developer ID Application 证书及私钥导出的 `.p12` 文件的 Base64 内容 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出该 `.p12` 文件时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | 对应的完整 Developer ID Application 签名身份名称 |
| `APPLE_ID` | 该 Apple Developer 账号的登录邮箱 |
| `APPLE_PASSWORD` | Apple 账户生成的应用专用密码，用于提交公证 |
| `APPLE_TEAM_ID` | 证书所属的 10 位 Apple Team ID |

`APPLE_PASSWORD` 与 `.p12` 密码、更新私钥口令各不相同。忘记 Apple 应用专用密码时，可在 [Apple 账户](https://account.apple.com/) 的「登录和安全 → 应用专用密码」生成新的密码；更新 GitHub Secret 即可。`.p12` 密码可通过重新导出证书重新设置。更新私钥的原口令无法据公钥恢复；更换更新密钥必须同步应用公钥，并考虑旧客户端的手动安装路径。

macOS 工作流创建临时钥匙串和 notarytool 配置，结束后删除证书临时文件及钥匙串并恢复原搜索列表。无需配置额外的钥匙串密码 Secret。仅更新产物签名步骤得到 Tauri 更新私钥；Cargo、图标脚本和平台构建不接收该私钥。

## 构建及检查

1. 先运行 `Check updater signing secrets`。成功结果必须包含版本绑定签名已通过应用公钥验证；Secret 名称存在不代表密钥可用。
2. 在 master 运行 `Build release draft`，首次选 `validate`。可留空 `tag` 以使用源码版本，或输入一致的 `vX.Y.Z`。
3. 等待 Windows x64/ARM64、macOS Apple Silicon/Intel 四个平台全部通过。任一目标缺失或检查失败，不生成可发布草稿。
4. 检查 `release-*` Actions 产物与各平台安装包；产物保存 7 天。完成首次欢迎设置和应用图标验收，并记录实际平台及设备范围。
5. 再运行 `Build release draft` 的 `draft` 模式，或推送一致版本标签以自动创建草稿。

```sh
# 先完成各版本文件更新并提交；示例标签须替换为实际源码版本。
git tag v0.1.0
git push origin v0.1.0
```

不要移动已有正式版本标签，也不要覆盖已公开的同版本资产。失败的同源提交草稿允许重新构建并替换资产；已公开版本只能通过更高版本修复。

## 产物与更新清单

| 目标 | 安装包 | 更新包 | latest.json 平台键 |
| --- | --- | --- | --- |
| Windows x64 | `OriaTunnel_X.Y.Z_x64-setup.exe` | 同一 NSIS 安装器及 `.sig` | `windows-x86_64-nsis` |
| Windows ARM64 | `OriaTunnel_X.Y.Z_arm64-setup.exe` | 同一 NSIS 安装器及 `.sig` | `windows-aarch64-nsis` |
| macOS Apple Silicon | `OriaTunnel_X.Y.Z_aarch64.dmg` 及同名 DMG ZIP | `OriaTunnel_X.Y.Z_aarch64.app.tar.gz` 及 `.sig` | `darwin-aarch64` |
| macOS Intel | `OriaTunnel_X.Y.Z_x64.dmg` 及同名 DMG ZIP | `OriaTunnel_X.Y.Z_x86_64.app.tar.gz` 及 `.sig` | `darwin-x86_64` |

macOS 沿用 `scripts/package-mac.sh --signed --target ...`：App 签名、公证及装订后放进 DMG；保留卷/Finder 文件图标后，对最终 DMG 签名、公证、装订并生成 DMG ZIP。更新 TAR 从最终带票据的 App 生成，禁用 AppleDouble 旁车文件，并重新解包核对单一 App 根目录、签名和装订票据；架构名称在签名前确定；DMG ZIP 不是应用内更新包。

Windows 检查应用二进制的 PE 架构和 GUI 子系统；NSIS 自身的引导程序架构不能用来判断包内应用架构。当前流水线提供 Tauri 更新签名，未接入 Windows Authenticode 证书。

每个平台生成包含版本、目标、提交及所有资产 SHA-256 的 receipt。汇总任务逐一验证四套 receipt、文件、哈希及 Minisign 版本/文件名绑定，然后生成唯一 `latest.json`。清单下载 URL 固定到版本标签；`.sig` 正文写入 `signature` 字段。草稿重试不会并发覆盖另一平台的清单。

## 正式发布

确认草稿及安装体验后，在 master 运行 `Publish verified release`，输入草稿的 `vX.Y.Z`。工作流会拒绝同版/旧版发布、源提交不一致、清单与资产不一致、签名不符及缺失平台；不会修改已公开版本的资产。

成功后客户端入口为：

```text
https://github.com/KrisLee1/OriaTunnel/releases/latest/download/latest.json
```

Release 草稿尚未公开时，该地址可以返回 404。第一份正式清单的版本若与已安装客户端相同，不会提示更新；客户端只接受更高的稳定版本。首次不含 Updater 或使用旧公钥的构建，需要手动安装兼容版本一次。

真实的连续版本下载、安装替换、重启和会话清理验收应使用隔离数据；不得连接用户真实 SSH 主机来测试更新。

## 首次欢迎与图标验收

欢迎界面应等待初始快照，语言、主题、外观、图标及窗口控制选择即时生效；完成或关闭后重启不再弹出，原选择继续保留。首次偏好的完成标记与各偏好独立保存。

Windows 图标需要核对运行中任务栏大小图标、重启后偏好，以及只更新指向本应用的快捷方式，不影响其他程序或启动参数。macOS 签名 `.app` 保留原 Finder 图标，运行中使用所选 Dock 图标，重启恢复保存的图标选择；不会把 Finder 自定义图标元数据写入签名包。Mac 回归会对独立 ad-hoc 签名 App 逐次运行严格 `codesign` 验证。

检查入口：

```sh
pnpm test
node --test scripts/check-update-secrets.node-test.mjs scripts/release/release.node-test.mjs
cargo test --locked --manifest-path tools/update-verifier/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib application_icon::platform::tests
```

参考：[Tauri 更新签名与静态清单](https://v2.tauri.app/plugin/updater/)、[Tauri Action](https://github.com/tauri-apps/tauri-action)、[macOS CI 签名](https://v2.tauri.app/distribute/sign/macos/)、[Apple 应用专用密码](https://support.apple.com/en-us/102654)。
