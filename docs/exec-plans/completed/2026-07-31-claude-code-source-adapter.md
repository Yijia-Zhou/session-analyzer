# Claude Code transcript source adapter / Claude Code 转录来源适配器

## Objective / 目标

Add explicit, local-only Claude Code transcript support for `0.1.3` without translating Claude records into synthetic Codex protocol rows. Introduce a source-neutral dispatch and Raw Record boundary, preserve Codex as the default source, and map Claude messages, tools, compaction, subagents, and forks into the existing Session, Logical Event, Protocol, Raw, search, detail, and browser contracts. / 为 `0.1.3` 增加显式、本地限定的 Claude Code 转录支持，不把 Claude 记录翻译成合成 Codex 协议行。引入来源中立的分派与原始记录边界，保持 Codex 为默认来源，并把 Claude 消息、工具、compaction、subagent 与 fork 映射到既有会话、逻辑事件、协议层、原始层、搜索、详情和浏览器契约。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-07-31 / 开始日期：2026-07-31
- Completed: 2026-07-31 / 完成日期：2026-07-31
- Target release: `0.1.3` / 目标版本：`0.1.3`
- Related context: `CONTEXT.md` / 相关上下文：`CONTEXT.md`
- Related product spec: `docs/product-specs/session-transcript-analyzer.md` / 相关产品规格：`docs/product-specs/session-transcript-analyzer.md`
- Related design: `docs/design-docs/transcript-source-adapters.md` / 相关设计：`docs/design-docs/transcript-source-adapters.md`
- Research input: local `tmp/codex-0.146-claude-session-import-analysis.md` and real, uncommitted Claude Code samples / 研究输入：本地 `tmp/codex-0.146-claude-session-import-analysis.md` 与未提交的真实 Claude Code 样本

## Scope / 范围

Included: / 包含：

1. source selection and source-specific home paths on the CLI / CLI 上的来源选择与来源专属 home path；
2. layout-aware Claude project, primary Session, subagent, and fork discovery / 感知布局的 Claude 项目、主要会话、subagent 与 fork 发现；
3. one-line-per-Raw-Record parsing with source-native identity and typed locators / 每行一个原始记录的解析，以及来源原生 identity 与 typed locator；
4. message, reasoning, exact tool-pair, compaction, error, warning, Protocol, and Raw mapping / 消息、推理、精确工具配对、compaction、错误、警告、协议层与原始层映射；
5. shared search, timeline, detail, browser, and indexed Raw Record routes / 共享搜索、时间线、详情、浏览器与索引原始记录 route；
6. synthetic committed tests and read-only real-corpus pressure verification / 已提交的合成测试与只读真实语料压力验证。

Deferred: / 推迟：

- mixed Codex-and-Claude indexing in one process / 单进程 Codex 与 Claude 混合索引；
- persistent adapter caches or import ledgers / 持久 adapter cache 或 import ledger；
- loading or searching Claude `tool-results/*` external payloads / 加载或搜索 Claude `tool-results/*` 外置 payload；
- exhaustive historical Claude schema support / 穷尽支持历史 Claude schema。

## Evidence baseline / 证据基线

The implementation was pressure-tested against a local, uncommitted Claude Code 2.1.220 corpus containing 39 primary JSONL files and 2 subagent JSONL files. The frozen read-only pass observed 662 physical Raw Records, 79 exact tool-use/result pairs, 107 unique assistant response IDs, 2 Derived Sessions, and 1 lineage-backed Fork Session. Tool outcome classification produced 62 successes, 12 declines, and 5 failures. No real transcript content is copied into committed fixtures or package files. / 实现使用本地未提交的 Claude Code 2.1.220 语料进行了压力验证，包含 39 个主要 JSONL 与 2 个 subagent JSONL。固定的只读检查观察到 662 条物理原始记录、79 组精确工具调用/结果配对、107 个唯一 assistant response ID、2 个派生会话，以及 1 个具有 lineage 依据的 fork 会话。工具结果分类得到 62 个成功、12 个拒绝和 5 个失败。没有真实转录内容复制进已提交 fixture 或 package 文件。

## Implementation phases / 实施阶段

### Phase 1: source-neutral boundary / 第一阶段：来源中立边界

- Extract cross-platform path helpers and make Codex Raw References carry explicit source kind and typed locators. / 提取跨平台 path helper，让 Codex 原始引用携带显式来源类型与 typed locator。
- Add the adapter registry and dispatch project discovery, indexing, detail, image, and Raw Record reads by selected source. / 增加适配器 registry，并按已选来源分派项目发现、索引、详情、图片与原始记录读取。
- Keep existing Codex public behavior and legacy Raw endpoint compatibility. / 保持既有 Codex 公开行为与 legacy Raw endpoint 兼容。

### Phase 2: Claude source interpretation / 第二阶段：Claude 来源解释

- Discover only layout-valid primary and evidence-correlated subagent candidates; derive nested storage from the primary filename and treat project-container names and record-provided IDs as data rather than authoritative paths. / 只发现符合布局的主要候选与通过证据关联的 subagent 候选；嵌套存储由主要文件名派生，并把 project-container 名称和记录提供的 ID 视为数据，而不是权威 path。
- Preserve physical line order, source UUID ancestry, response grouping, exact tool correlation, and client-version metadata. / 保留物理行顺序、来源 UUID ancestry、response grouping、精确工具关联与客户端版本 metadata。
- Build source-native Logical Events, keep exact local-command envelopes out of human activity, and retain unknown, meta, queue, synthetic, and unmatched records through Protocol/Raw fallback. / 构建来源原生逻辑事件，把精确 local-command envelope 排除于人类活动之外，并通过协议层／原始层兜底保留未知、meta、queue、synthetic 与未匹配记录。

### Phase 3: shared product surface / 第三阶段：共享产品表面

- Add source identity to project/session DTOs and browser labels. / 为项目／会话 DTO 与浏览器标签增加来源 identity。
- Resolve Raw References through an indexed session/raw identity route, preserve malformed source text in drill-down, and validate Claude lexical plus real-path containment before every nested enumeration/read. / 通过索引会话／原始记录 identity route 解析原始引用，在下钻中保留 malformed 来源文本，并在每次嵌套枚举／读取前校验 Claude 的词法路径与 real path containment。
- Update bilingual domain language, product specification, adapter design, README, changelog, and package manifest. / 更新双语领域语言、产品规格、适配器设计、README、变更日志与 package manifest。

### Phase 4: validation and closeout / 第四阶段：验证与收尾

- Run syntax checks, focused Claude/Codex coverage, the full Node suite, browser tests, generated-asset checks, package smoke, and `git diff --check`. / 运行语法检查、聚焦 Claude/Codex 覆盖、完整 Node suite、browser tests、生成资产检查、package smoke 与 `git diff --check`。
- Confirm that the parent worktree remains untouched and all implementation files stay in the `tmp/v0.1.3` worktree. / 确认父 worktree 未受影响，全部实现文件都留在 `tmp/v0.1.3` worktree。

## Acceptance criteria / 验收标准

1. Default invocation scans Codex only; Claude Code requires `--source claude-code` or its documented alias. / 默认调用只扫描 Codex；Claude Code 必须通过 `--source claude-code` 或文档化 alias 启用。
2. Real sample totals are represented without JSON parse loss, and physical source order is not replaced by timestamp sorting. / 真实样本总量在没有 JSON parse 丢失的情况下被表示，且物理来源顺序不会被 timestamp 排序取代。
3. Claude tools pair only by exact session-local identities and apply denial, failure, success, and incomplete precedence deterministically. / Claude 工具只按精确会话内 identity 配对，并确定性应用拒绝、失败、成功与未完成优先级。
4. Subagents remain independently selectable Derived Sessions only when file/record identity and one parent Agent result agree; forks require foreign source identity plus shared lineage evidence. / 只有文件／记录 identity 与一个父 Agent result 一致时，subagent 才保持为可独立选择的派生会话；fork 必须同时具有 foreign 来源 identity 与共享 lineage 依据。
5. Unknown and malformed shapes remain recoverable in Protocol/Raw, and neither nested discovery nor Raw re-reading can escape the configured source root lexically or through real paths. / 未知与 malformed 形态继续可在协议层／原始层恢复，嵌套发现与原始记录重读在词法路径或 real path 上都不能逃逸配置的来源根目录。
6. Codex regression coverage, browser coverage, generated assets, package smoke, and repository hygiene checks pass. / Codex 回归覆盖、browser coverage、生成资产、package smoke 与仓库卫生检查全部通过。

## Progress log / 进度日志

- 2026-07-31: Completed local source-shape inventory and chose direct source interpretation over Codex-rollout emulation. / 2026-07-31：完成本地来源形态盘点，并选择直接解释来源，而不是模拟 Codex rollout。
- 2026-07-31: Added the source adapter boundary, Claude discovery/parser/logical/detail/index modules, namespaced identities, and indexed Raw Record endpoint. / 2026-07-31：增加来源适配器边界、Claude 发现／解析／逻辑／详情／索引模块、带命名空间 identity 与索引原始记录 endpoint。
- 2026-07-31: Added synthetic Claude tests and confirmed the full Node suite passed before documentation and generated-asset closeout. / 2026-07-31：增加合成 Claude 测试，并在文档与生成资产收尾前确认完整 Node suite 通过。
- 2026-07-31: Completed bilingual documentation and generated-asset convergence. The full Node suite passed 330/330, browser coverage passed 83/83, `release:check` passed with package smoke, and `git diff --check` reported no whitespace errors. A final real-corpus read-only pass reproduced 39 primary candidates, 41 indexed Sessions, 662 Raw Records, 79 tool operations with the expected 62/12/5 success/decline/failure split, 107 response groups, 2 Derived Sessions, and 1 Fork Session. / 2026-07-31：完成双语文档与生成资产收敛。完整 Node suite 330/330 通过，browser coverage 83/83 通过，包含 package smoke 的 `release:check` 通过，`git diff --check` 未报告空白错误。最终真实语料只读检查复现了 39 个主要候选、41 个已索引会话、662 条原始记录、79 个工具 operation（成功／拒绝／失败为预期的 62/12/5）、107 个 response group、2 个派生会话和 1 个 fork 会话。
- 2026-08-01: Closed independent-review findings with source-root containment for nested discovery, fail-closed subagent evidence correlation, Protocol classification for local-command envelopes, exact malformed-Raw display, and source-neutral chooser copy. `release:check` passed with 337/337 Node tests and package smoke; browser coverage passed 85/85. The real corpus still yields 39 primary candidates, 41 Sessions, 579 Logical Events, 662 Raw Records, and 2 evidence-correlated Derived Sessions. / 2026-08-01：完成独立审查后续：嵌套发现受来源根目录 containment 约束，subagent 证据关联 fail closed，local-command envelope 归入 Protocol，malformed Raw 精确显示，项目选择文案来源中立。`release:check` 通过，其中 Node 测试 337/337 并通过 package smoke；browser coverage 85/85 通过。真实语料仍得到 39 个主要候选、41 个会话、579 个逻辑事件、662 条原始记录，以及 2 个通过证据关联的派生会话。
