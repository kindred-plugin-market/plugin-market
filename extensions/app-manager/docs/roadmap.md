# App Manager Roadmap

> 未完成项（发布前 smoke / 清单快照持久化 D-019 / 远期）已汇总至 [roadmap.md](./roadmap.md)。
> 已完成功能与详情见 [design.md](./design.md)。
> 当前约束见 [design.md](./design.md)；执行顺序见全局路线图 [R02](https://github.com/indredK/bench/blob/HEAD/docs/roadmap/ROADMAP.md#r02-app-manager-与-quick-launch)。

红线：未完成平台 smoke 前，不得将 macOS/Windows 能力标记为发布对等。

## 已验证的单包操作取消

- 2026-10-16，隔离 macOS QA bundle 分别验证单包升级和卸载的 UI→IPC→确定性子进程终止→idle 全链路，未对真实应用执行升级或卸载。自动化覆盖状态订阅、取消失败恢复、取消结果清理和 stale timer 防护；Windows 取消及进程树回收仍待 Windows 环境验证。
