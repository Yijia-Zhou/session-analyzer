# Changelog

## Unreleased / 未发布

No unreleased changes. / 暂无未发布变更。

## 0.1.2 - 2026-07-31

### English

- First version published to the public npm registry. The earlier `0.1.0` entry records an internal pack-ready milestone; neither `0.1.0` nor `0.1.1` was published to npm.
- Code Mode now groups outer `exec` plus pending/wait lifecycle rows into one neutral operation, adds safe structured nested request projections, and exposes request-aware Main-layer filtering and folding without fabricating nested execution evidence.
- Search now uses explicit current-session and entire-project scopes, a single-line literal-text HUD, stable event-anchor jump targets, structured Kind/Status/Touched-file controls, deterministic detail/navigation convergence, and safe deep-timeline transitions.
- Same-project reindexing now reuses unchanged transcript payloads, reparses files that change after selection, refreshes session-index metadata from transcript-derived baselines, reports bounded progress, and retries transient browser transport failures.
- Main-timeline coverage now includes normalized goal lifecycles, user shell wrappers, image generation, hooks, Agent Coordination, typed Subagent Activity correlation, stronger MCP summaries, and readable fallbacks while retaining exact Raw Reference traceability.
- A shared Plan Event semantic facet now gives Plan Artifacts and Plan Updates one canonical definition for metrics, folding, and inspector navigation while excluding declared-only Code Mode projections.
- Timeline loading, generated-asset ownership, tool lifecycle admission, detail presentation, and large-index behavior now have deterministic contracts, profiling fixtures, and expanded regression coverage.
- The Markdown runtime and esbuild development dependency floors now include upstream complexity-denial-of-service and Windows development-server file-read fixes.
- The public package requires Node.js 22 or newer, pins publication to the public registry, adds a repeatable prepublish release gate, supports both npm 11 and npm 12 pack manifests, and introduces Linux/Windows CI for Node, browser, and installed-package validation.

### 中文

- 首个发布到公共 npm registry 的版本。较早的 `0.1.0` 条目记录内部可打包里程碑；`0.1.0` 与 `0.1.1` 均未发布到 npm。
- Code Mode 现在会把 outer `exec`、pending 与 wait lifecycle 行归并为一个中性 operation，增加安全的结构化嵌套 request 投影，并提供感知 request 的 Main 层筛选与折叠，同时不虚构嵌套执行证据。
- 搜索现在采用明确的当前 session 与整个项目范围、单行字面文本 HUD、稳定的事件锚点跳转目标、结构化的类型/状态/涉及文件控件、确定性的详情与导航收敛，以及安全的深层时间线转换。
- 同一项目重新索引现在会复用未变化的 transcript payload，重新解析选择后发生变化的文件，基于 transcript 派生基线刷新 session-index metadata，报告有界进度，并重试浏览器中的瞬时传输失败。
- 主时间线覆盖现在包括规范化 goal 生命周期、用户 shell wrapper、图片生成、hook、Agent 协调、带类型的 Subagent 活动关联、更清晰的 MCP 摘要与可读兜底，同时保留精确的原始引用可追溯性。
- 共享计划事件语义 facet 现在为计划产物与计划更新提供一套供指标、折叠和检查器导航共同使用的 canonical 定义，同时排除只有声明证据的 Code Mode 投影。
- 时间线加载、生成资产 ownership、工具生命周期准入、详情呈现与大型索引行为现在具有确定性契约、profiling fixture 和更完整的回归覆盖。
- Markdown 运行时与 esbuild 开发依赖下限现在包含上游复杂度拒绝服务和 Windows 开发服务器文件读取修复。
- 公共 package 要求 Node.js 22 或更高版本，把发布固定到公共 registry，增加可重复的 prepublish release gate，兼容 npm 11 与 npm 12 的 pack manifest，并引入覆盖 Linux/Windows 的 Node、browser 与安装后 package CI。

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
