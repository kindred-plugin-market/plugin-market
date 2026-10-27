# App Manager（应用管理）

> **完备功能规格** → [design.md](./design.md)
> **规划功能** → [roadmap.md](./roadmap.md)

插件前端：[extensions/app-manager/src/](../src/)

Bench 宿主提供共享清单、IPC 与平台实现：[App Manager 后端](https://github.com/indredK/bench/tree/main/src-tauri/src/app_manager) · [共享清单](https://github.com/indredK/bench/tree/main/src/shared/app-inventory)

定位：发现本机已装应用并启动 / 定位 / 授权 / 升级 / 卸载，提供推荐应用安装（市场）与多来源软件更新中心；破坏性操作只接受后端解析的稳定 `appId`，升级 / 卸载必须有 exact evidence。

| 文档                     | 说明                           |
| ------------------------ | ------------------------------ |
| [design.md](./design.md) | 跨平台清单、启动和更新安全边界 |
