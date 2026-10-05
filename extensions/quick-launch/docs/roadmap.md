# Quick Launch Roadmap

本地执行顺序见 [Bench 全局路线图 R02](https://github.com/indredK/bench/blob/main/docs/roadmap/ROADMAP.md#r02-app-manager-与-quick-launch)；本页记录本模块验收状态。

## 已完成

- [x] 展开超过 48 项的场景复用宿主 `VirtualGridView`，只挂载视口及 overscan 内的卡片。
- [x] 自动分类只收录可启动且有可见名称的应用；已保存覆盖不能重新加入不可启动或无可见名称的应用。
- [x] 同名应用在卡片和无障碍名称中通过 bundle ID 区分；截断名称提供完整标题。
- [x] partial 来源告警只包含 partial/failed/timedOut；unsupported 不再被误报，来源名称支持中英文。
- [x] 用户分类覆盖按版本化 schema 持久化，按 inventory revision 更新。
- [x] 0/1/48 项切换门槛，以及 50/500/2000 项大列表 DOM 上限有回归覆盖。

## 真机记录（2026-10-06）

- macOS 27.0.1 arm64：消费 App Manager 的 449 项 inventory，7 个场景可见；Siri 搜索返回 3 项，两个 Siri 通过不同 Bundle ID 区分；在真实清单中滚动至后续场景可正常浏览。
- 重扫后 filesystem、Spotlight、Homebrew provider 状态均为 `ok`，告警消失；App Manager 和 Quick Launch 的页面都显示 449 项。
- 真机只覆盖当前 449 项；500/2000 项 DOM 上限由自动化测试覆盖，真机耗时、图标请求、刷新旧快照和取消仍待测。

## 剩余验收

- [ ] macOS 真机补测 Quick Launch 从列表启动、按需图标和 500/2000 项交互指标。
- [ ] Windows 真机验证 EXE/AUMID 启动、图标和大列表交互；用户安排之后提供目标平台设备。
- [ ] 在目标设备记录 500/2000 项的搜索延迟、滚动体验、按需图标请求数、刷新保留旧快照与取消结果。

红线：未完成目标平台 smoke 前，不得宣称跨平台发布就绪。
