# OriaTunnel 工作规则

- 先读 `docs/PROJECT_STATUS.md`；换设备或配置开发环境时读 `docs/DEVELOPMENT.md`，界面工作再读 `docs/ui-development.md`。
- 产品方向与阶段验收见 `docs/ORIA_TUNNEL_DESIGN.md`，已实现范围以 `docs/PROJECT_STATUS.md` 和源码为准；尚未实施的后续方案不视为自动授权。
- 普通修改直接实现和针对性验证；真实架构、安全或不可逆变更先说明具体影响。不要重复索取本会话已有授权。
- Windows 外壳保持 OriaAide 原版平台行为，不补齐窗口圆角。迁移源清单与摘要见 `docs/shell-migration.json`。
- 主机发现仅解析配置，不执行配置命令或自动连接；不得为测试连接用户的真实 SSH 主机。
- 不把密码、口令、私钥正文放入配置、前端持久状态、日志或测试产物。
- 前端运行状态以 Rust 快照/事件为准；不能用假数据或定时器模拟连接成功。
- 保留用户修改。未经明确要求不提交、推送、增加远程或发布。
- 界面验证优先在本应用或独立本地测试环境进行；保持测试数据隔离。
