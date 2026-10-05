# App Manager Roadmap

本地任务顺序与验收条件见 [Bench 全局路线图 R02](https://github.com/indredK/bench/blob/main/docs/roadmap/ROADMAP.md#r02-app-manager-与-quick-launch)；本页只记录模块内尚未关闭的验收项。

## 剩余验收

- [x] macOS fixture 覆盖外置卷 `Applications` 目录、alias/symlink、损坏 bundle 与不可读目录路径。
- [x] Windows fixture 覆盖 EXE 安装路径、MSI ProductCode、AUMID、32/64 位注册表、CJK 与带空格路径；由 Windows CI 运行解析与契约测试。
- [x] App inventory 的 Homebrew 元数据读取禁止自动更新，避免扫描应用时触发隐式网络刷新并挤占命令超时。
- [x] macOS 27.0.1 arm64 真机：扫描 449 项、搜索 TextEdit、由 App Manager 启动 TextEdit、Finder reveal 到系统应用位置；全程未执行升级或卸载。
- [ ] macOS 真机 smoke：临时签名身份拒绝、ZIP/DMG 取消与安装 journal 恢复。
- [ ] Windows 真机 smoke：EXE/AUMID 启动、图标、winget/MSI timeout、进程树回收、取消和权限拒绝。用户安排稍后提供 Windows 环境，本轮暂不验证。
- [ ] R02 的 0/1/50/500/2000 应用规模自动化门槛已覆盖；仍需记录 500/2000 项真机搜索耗时、滚动、按需图标请求、刷新保留旧快照与取消结果，见 [Quick Launch roadmap](../../quick-launch/docs/roadmap.md)。

红线：目标平台真机 smoke 完成前，不得将 macOS/Windows 能力标记为发布对等。
