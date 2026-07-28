# Changelog

## Unreleased / 未发布

### English

- Same-project reindexing now reuses unchanged transcript payloads to avoid duplicating large in-memory indexes, reparses files that change after selection, reapplies current session-index metadata from transcript-derived baselines, and retries bounded transient browser transport failures.
- Rebuilt search as a single-line scope-aware HUD with entry-specific parameter focus, idle-state progressive disclosure, a compact results-only surface for free-text input, always-visible Kind/Status/Touched-file quick filters, and a shortcut to the canonical global Layer selector.
- Search input now always represents literal free text; operator-like text is no longer parsed into filters or Layer changes. Existing backend search, navigation, and project result contracts are unchanged.

### 中文

- 同一项目重新索引现在会复用未变化的 transcript payload，避免在内存中复制大型索引；对 selecting 后发生变化的文件重新解析，基于 transcript 派生基线重新应用当前 session-index metadata，并对浏览器中的瞬时传输失败进行有界重试。
- 将搜索重建为感知范围的单行 HUD：参数入口会定向聚焦，空闲状态采用渐进披露，自由文本输入只展开紧凑结果表面，同时提供常驻的类型/状态/涉及文件快速筛选及指向唯一全局层级选择器的快捷入口。
- 搜索输入现在始终表示字面自由文本；类似操作符的文本不再解析为筛选或层级切换。现有后端搜索、导航和项目结果契约保持不变。

## 0.1.0 - 2026-06-18

### English

- Post-review hardening completed: Simplified Chinese display catalogs now cover the shipped display namespaces while preserving machine fields such as `kind`, `status`, `layer`, raw refs, and source locators.
- Build and package gates now verify the generated browser bundle path, minified/no-sourcemap output, packaged runtime allowlist, CLI help, root HTML bundle reference, and `/api/state` package smoke shape.
- Source traceability was tightened with normalized `sourceLocator.file` values, legacy raw ref preservation, and grouped detail/logical dependency injection boundaries.
- CLI argument handling now rejects unknown options and positional arguments before server startup while accepting a small set of common option aliases such as `--repos` and `--codexhome`.
- README known limits now clarify Codex-only scope, protocol/raw fallback for future events, targeted fixture coverage, and pending real-data validation for non-empty review findings.
- Programmatic exports from `server.js` remain internal and are not a stable v0.1 API; `require('session-analyzer')` does not start the server because `server.js` is guarded by `require.main === module`.

### 中文

- 外部评审后续加固已完成：简体中文展示 catalog 已覆盖当前发布的展示 namespace，同时保留 `kind`、`status`、`layer`、raw refs、source locators 等机器字段不变。
- 构建和打包 gate 现在会验证生成浏览器 bundle 路径、minified/no-sourcemap 输出、打包 runtime allowlist、CLI help、根 HTML 的 bundle 引用，以及 `/api/state` package smoke 形态。
- Source traceability 已加固：`sourceLocator.file` 归一化、legacy raw ref 保留，以及 detail/logical 的 grouped dependency injection 边界均已落地。
- CLI 参数处理现在会在 server 启动前拒绝未知 option 和位置参数，同时接受少量常见 option 别名，例如 `--repos` 和 `--codexhome`。
- README 已补充已知限制，明确 Codex-only 范围、未来 event 的 protocol/raw 兜底、fixture 覆盖是有重点的，以及非空 review finding 仍需真实数据验证。
- `server.js` 导出的程序接口仍属于内部接口，不是稳定的 v0.1 API；由于 `server.js` 受 `require.main === module` 保护，`require('session-analyzer')` 不会启动服务器。

### English

- First pack-ready npm CLI release for local Codex session transcript viewing.
- Public interface: the `session-analyzer` CLI. Programmatic exports from `server.js` are internal and are not a stable API in v0.1.
- Scope: Codex transcripts only. Non-Codex sources are design pressure tests for future adapters, not supported importers in this release.
- Privacy model: the server binds to `127.0.0.1` by default, reads transcript files from disk, keeps derived indexes in memory, and does not upload transcript content.
- Includes searchable session lists, main/protocol/raw timeline layers, structured event details, raw JSONL drill-down, folding profiles, browser regression coverage, and English/Simplified Chinese display catalogs.
- The npm package does not include real Codex transcripts, test fixtures, or development execution plans.

### 中文

- 第一个可打包验证的 npm CLI 版本，用于本地查看 Codex session transcript。
- 公开接口是 `session-analyzer` CLI。`server.js` 导出的程序接口在 v0.1 中属于内部接口，不承诺稳定。
- 范围仅限 Codex transcript。非 Codex source 只作为未来 adapter 的设计压力测试，本版本不支持导入。
- 隐私模型：服务器默认绑定到 `127.0.0.1`，从磁盘读取 transcript 文件，派生索引只保存在内存中，不上传 transcript 内容。
- 包含可搜索 session 列表、main/protocol/raw 三层 timeline、结构化事件详情、原始 JSONL 下钻、折叠策略、浏览器回归覆盖，以及英文/简体中文展示 catalog。
- npm 包不包含真实 Codex transcript、测试 fixture 或开发执行计划。
