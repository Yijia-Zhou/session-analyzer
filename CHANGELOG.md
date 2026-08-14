# Changelog

## Unreleased / 未发布

### English

- Added empirical capacity guidance for large matching transcript histories, including a stable non-blocking `[SESSION_ANALYZER_LARGE_TRANSCRIPT_HISTORY]` warning at 800 MiB candidate bytes, temporary Node heap recovery instructions specifically for V8 heap exhaustion, and aggregate-only `--log-dir` capacity diagnostics with current and peak process memory.
- Recognized copied-prefix Codex Materialized Fork Sessions, excluded inherited history from continuation-owned titles, Logical metrics, and search while preserving physical Raw records, and folded uniquely inactive sources as Earlier Branches with mixed related-session hierarchy and Raw segment headings.
- Unified inherited-context parent navigation across Codex materialized and Claude pointer forks with Main-first, Raw-fallback fork-point targets; a targetless source keeps the current search, filters, and layer during ordinary parent navigation.
- Promoted direct Claude Code `Read` calls from `other_tool_call` to an independent `read` kind with dedicated filtering, counts, localized labels, structured detail routing, and folding-rule compatibility.
- Added runtime Transcript Source switching: `POST /api/source` changes the active Codex/Claude Code source and optional source home directories without restarting the server; the Select project chooser exposes a source switcher with custom home directories, and stale project discovery is rejected through source revisions.
- Added per-source last-selected repository storage with a one-time migration of the legacy Codex key, and made project-selection copy source-neutral (`sourceHome` instead of `codexHome`).
- Added source-switch and race-regression coverage across backend, browser, and documentation.
- Hardened Claude Code 2.1.220 compatibility for order-independent slash-command envelopes, direct asynchronous Workflow lifecycle evidence and structured detail, fail-closed terminal correlation, forked-skill and workflow-agent Derived Sessions, source-backed Goal lifecycle and `attributionSkill` provenance, and the distinction between Loop wakeups and Cron deletion.
- Moved unwrapped Codex developer messages from the Main timeline to the protocol layer, keeping their `Possible hook output` tag and raw traceability.
- Normalized Codex review lifecycle from both the legacy dedicated `entered_review_mode` / `exited_review_mode` rows and the canonical completed `item_completed` TurnItem envelope (`EnteredReviewMode` / `ExitedReviewMode`), restoring Main timeline review start/end events and structured review detail for current transcripts.
- Review-derived sessions now accept the top-level `parent_thread_id` as explicit parent evidence before temporal inference, so review children group under the correct parent even when parent lifecycle markers use the canonical envelope.

### 中文

- 新增针对大型匹配 transcript 历史的经验性容量指引：在 candidate bytes 达到 800 MiB 时输出稳定、非阻塞的 `[SESSION_ANALYZER_LARGE_TRANSCRIPT_HISTORY]` 警告；仅针对 V8 heap exhaustion 提供临时增大 Node heap 的恢复说明；并通过 `--log-dir` 提供只含聚合数据、包含当前与峰值进程内存的容量诊断。
- 识别复制前缀式 Codex 物化式分叉会话，在保留完整物理 Raw Record 的同时，从续写自有标题、逻辑指标与搜索中排除继承历史，并将唯一且不再活跃的来源会话折叠为较早分支，同时支持混合相关会话层级与 Raw 区段标题。
- 统一 Codex 物化式分叉与 Claude 指针式分叉的继承上下文父会话导航，优先定位 Main 分叉点、否则回退 Raw；若某个来源没有精确 target，普通父会话导航会保留当前搜索、筛选与层级。
- 将 Claude Code 的直接 `Read` 调用从 `other_tool_call` 提升为独立的 `read` kind，并补齐专属筛选、计数、本地化标签、结构化详情路由与折叠规则兼容。
- 新增运行期转录来源切换：`POST /api/source` 可在不重启服务器的情况下切换当前 Codex/Claude Code 来源及可选来源 home 目录；Select project 选择界面提供来源切换与自定义目录入口，并通过 source revision 拒绝过期的项目发现结果。
- 新增按来源区分的“最后选择的仓库”存储，并一次性迁移旧 Codex key；项目选择文案改为来源中立（使用 `sourceHome` 而非 `codexHome`）。
- 新增覆盖后端、浏览器与文档的来源切换及竞态回归测试。
- 加固 Claude Code 2.1.220 兼容性：支持顺序无关的 slash-command envelope、direct 异步 Workflow 生命周期证据与结构化详情、fail-closed 终态关联、forked-skill 与 workflow-agent Derived Session、来源驱动的 Goal 生命周期与 `attributionSkill` provenance，以及 Loop wakeup 与 Cron 删除的区分。
- 将未包装的 Codex developer message 从 Main timeline 移到 protocol 层，保留 `Possible hook output` tag 与原始可追溯性。
- 统一归一化 Codex review 生命周期：旧专用 `entered_review_mode` / `exited_review_mode` 记录与 canonical 的 `item_completed` TurnItem envelope（`EnteredReviewMode` / `ExitedReviewMode`）现在映射为相同的 review 事件，恢复父会话 Main timeline 的 Review 开始/结束与结构化详情。
- 被判定为 review 的子会话现在会在时间推断之前接受顶层 `parent_thread_id` 作为显式父会话证据，即使父会话生命周期标记使用 canonical envelope，也能正确归组到父会话下。

## 0.1.3 - 2026-08-03

### English

- Added an explicit `--source claude-code` adapter with layout-aware Claude Code project, session, subagent, and fork discovery; Codex remains the default and `~/.claude` is never scanned without opt-in.
- Added source-native Claude Code mapping for messages, reasoning, exact tool-use/result pairs, compact summaries, file-history attachments, API errors, and protocol/raw fallback.
- Added namespaced analyzer session identities and a source-neutral indexed Raw Record endpoint with adapter-owned path-containment validation.
- Added exact Claude Code pointer-fork correlation from parent `/fork` command evidence, with corrected fork timestamps, waiting state, bounded parent-owned inherited-context previews, and no duplicated child search, metrics, or Raw ownership.
- Added synthetic Claude coverage, real-corpus pressure-test verification, bilingual source-adapter documentation, and package/runtime inclusion for the new adapter modules.
- Hardened Claude nested discovery with basename-owned paths, lexical and real-path containment, exact subagent identity/parent-Agent correlation, and fail-closed handling of conflicting evidence.
- Kept Claude local-command envelopes in Protocol, preserved malformed JSONL source text in Raw refs, and made shared project-selection copy source-neutral.
- Closed review follow-ups for duplicate parent-Agent identities, Raw-only thinking signatures, searchable prose after embedded base64 data URLs, source-owned unknown-tool names, and localized Claude Raw titles.

### 中文

- 新增显式 `--source claude-code` 适配器，按 Claude Code 布局发现项目、会话、subagent 与 fork；Codex 仍为默认来源，未显式启用时绝不扫描 `~/.claude`。
- 新增来源原生的 Claude Code 映射，覆盖消息、推理、精确工具调用/结果配对、compact 摘要、文件历史附件、API 错误，以及 protocol/raw 兜底。
- 新增带命名空间的分析器会话标识，以及由适配器负责 path containment 校验的来源中立索引 Raw Record 接口。
- 新增基于父会话 `/fork` command 证据的精确 Claude Code 指针式分叉关联，并提供修正后的分叉时间、等待状态、有界且归父会话所有的继承上下文预览，同时不重复 child 搜索、指标或 Raw ownership。
- 新增合成 Claude 覆盖、真实语料压力验证、双语来源适配器文档，以及新适配器模块的 package/runtime 收录。
- 加固 Claude 嵌套发现：目录由主要文件 basename 决定，同时执行词法与 real-path containment，精确关联 subagent identity／父 Agent，并对矛盾证据 fail closed。
- 将 Claude local-command envelope 保留在 Protocol，在 Raw refs 中保留 malformed JSONL 来源原文，并把共享项目选择文案改为来源中立。
- 完成评审后续修复：覆盖重复父 Agent identity、仅限 Raw 的 thinking signature、内嵌 base64 data URL 后可搜索正文、来源拥有的未知工具名，以及本地化 Claude Raw 标题。

## 0.1.2 - 2026-07-31

### English

- First version published to the public npm registry. The earlier `0.1.0` entry records an internal pack-ready milestone; neither `0.1.0` nor `0.1.1` was published to npm.
- Code Mode now groups outer `exec` plus pending/wait lifecycle rows into one neutral operation, adds safe structured nested request projections, and exposes request-aware Main-layer filtering and folding without fabricating nested execution evidence.
- Search now uses explicit current-session and entire-project scopes, a single-line literal-text HUD, stable event-anchor jump targets, structured Kind/Status/Touched-file controls, deterministic detail/navigation convergence, and safe deep-timeline transitions.
- Same-project reindexing now reuses unchanged transcript payloads, reparses files that change after selection, refreshes session-index metadata from transcript-derived baselines, reports bounded progress, and retries transient browser transport failures.
- Main-timeline coverage now includes normalized goal lifecycles, user shell wrappers, image generation, hooks, Agent Coordination, typed Subagent Activity correlation, stronger MCP summaries, and readable fallbacks while retaining exact Raw Reference traceability.
- A shared Plan Event semantic facet now gives Plan Artifacts and Plan Updates one canonical definition for metrics, folding, and inspector navigation while excluding declared-only Code Mode projections.
- Timeline loading, generated-asset ownership, tool lifecycle admission, detail presentation, and large-index behavior now have deterministic contracts, profiling fixtures, and expanded regression coverage.
- Windows and POSIX absolute transcript paths are now interpreted by their own path syntax regardless of the host OS, keeping repository containment and project-file display stable in cross-platform replay.
- The Markdown runtime and esbuild development dependency floors now include upstream complexity-denial-of-service and Windows development-server file-read fixes.
- Direct runtime dependencies are pinned to the versions exercised by the release gates, while the prebuilt Highlight.js vendor asset keeps its build-only package out of consumer installations.
- Dependency installation now uses npm 12.0.2's strict, default-deny `allowScripts` policy: only exact `esbuild@0.28.1` may run an install script, optional `fsevents` is explicitly denied, and every CI job pins the reviewed npm toolchain before a clean install.
- Source setup now documents the required npm 12.0.2 bootstrap before strict installation, redistributed Highlight.js assets retain their complete BSD notice in the package, and final dist-tag evidence is collected through a separately proven anonymous npm configuration.
- The public package requires Node.js 22 or newer, pins publication and package-smoke installation to the public registry, adds a repeatable prepublish release gate, supports both npm 11 and npm 12 pack manifests, and introduces Linux/Windows CI for Node, browser, and installed-package validation.

### 中文

- 首个发布到公共 npm registry 的版本。较早的 `0.1.0` 条目记录内部可打包里程碑；`0.1.0` 与 `0.1.1` 均未发布到 npm。
- Code Mode 现在会把 outer `exec`、pending 与 wait lifecycle 行归并为一个中性 operation，增加安全的结构化嵌套 request 投影，并提供感知 request 的 Main 层筛选与折叠，同时不虚构嵌套执行证据。
- 搜索现在采用明确的当前 session 与整个项目范围、单行字面文本 HUD、稳定的事件锚点跳转目标、结构化的类型/状态/涉及文件控件、确定性的详情与导航收敛，以及安全的深层时间线转换。
- 同一项目重新索引现在会复用未变化的 transcript payload，重新解析选择后发生变化的文件，基于 transcript 派生基线刷新 session-index metadata，报告有界进度，并重试浏览器中的瞬时传输失败。
- 主时间线覆盖现在包括规范化 goal 生命周期、用户 shell wrapper、图片生成、hook、Agent 协调、带类型的 Subagent 活动关联、更清晰的 MCP 摘要与可读兜底，同时保留精确的原始引用可追溯性。
- 共享计划事件语义 facet 现在为计划产物与计划更新提供一套供指标、折叠和检查器导航共同使用的 canonical 定义，同时排除只有声明证据的 Code Mode 投影。
- 时间线加载、生成资产 ownership、工具生命周期准入、详情呈现与大型索引行为现在具有确定性契约、profiling fixture 和更完整的回归覆盖。
- Windows 与 POSIX transcript 绝对路径现在会独立于宿主操作系统，按路径自身的语法解释，使跨平台 replay 中的仓库包含判断与项目文件显示保持稳定。
- Markdown 运行时与 esbuild 开发依赖下限现在包含上游复杂度拒绝服务和 Windows 开发服务器文件读取修复。
- 直接运行时依赖已固定为发布 gate 实际验证的版本；预构建的 Highlight.js vendor asset 则使其仅构建期 package 不再进入用户安装树。
- 依赖安装现在采用 npm 12.0.2 的 strict、默认拒绝 `allowScripts` 策略：只有精确的 `esbuild@0.28.1` 可以运行 install script，可选的 `fsevents` 被明确拒绝，且每个 CI job 都会在干净安装前固定经过审查的 npm 工具链。
- 源码安装现在说明在 strict 安装前 bootstrap 所需 npm 12.0.2；再分发的 Highlight.js 资产会在 package 中保留完整 BSD notice；最终 dist-tag 证据则通过单独证明为匿名的 npm configuration 获取。
- 公共 package 要求 Node.js 22 或更高版本，把发布与 package-smoke 安装固定到公共 registry，增加可重复的 prepublish release gate，兼容 npm 11 与 npm 12 的 pack manifest，并引入覆盖 Linux/Windows 的 Node、browser 与安装后 package CI。

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
