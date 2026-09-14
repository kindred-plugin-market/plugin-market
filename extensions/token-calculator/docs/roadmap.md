# Token 计算器 · Roadmap

> 仅记录当前约束、未完成项与验收条件；设计 / 产品规格仅在确有独有信息时才补（本插件按源码描述，不虚构功能、平台或精确 tokenizer）。

## 当前约束 / 边界
- **Token 估算为启发式**：CJK 字符 ÷ 1.5 + 其它字符 ÷ 4，结果最小 1；单位支持 个 / 千 / 万 / 百万 / 亿。与具体厂商 tokenizer（如 cl100k_base）存在量级差异，仅供预算参考。
- **汇率为 USD↔CNY 启发式**：Frankfurter 公共行情（无 key），非实时金融数据；缓存 1 小时；离线 / 接口异常回退默认 `7` 并标记 `stale`。
- **数据归属宿主**：计费标准经 4 条 ACL 命令读写，持久化在宿主 `pricing_standard` 存储；插件不持有后端。

## 未完成 / 待办
- 文档：本 README / roadmap 为首次补齐（DOC-03）；design / product-spec 暂无独有信息，暂不补。
- 汇率币种仅 USD / CNY，未支持其它币种。

## 验收条件
1. 三 Tab 在真实宿主 WebView 打开无白屏（入口已自带 `TooltipProvider`）。
2. 4 条 ACL 命令已加入宿主 `EXTENSION_ALLOWED_COMMANDS` 白名单（`engines.bench >= 1.30.0` 对应宿主版本）。
3. i18n 自包含审计通过（zh / en 齐全）。
4. 汇率失败路径（离线 / 5xx）回退正确且标记 `stale`。

## 不在范围
精确 tokenizer、汇率金融级精度、除 USD / CNY 外的外币种。
