# DeepSeek Harness Phase 2A — session semantics and provenance / DeepSeek Harness 第二阶段 A —— 会话语义与来源关系

## Status / 状态

- Status: completed and archived after the adapter-local correctness correction passed all local gates, six-artifact real-corpus replay, and the full corrected remote matrix. / 状态：adapter 本地正确性修正通过全部本地门禁、六工件真实语料重放及完整修正版远程矩阵后，计划已完成并归档。
- Branch: `support-dsh` / 分支：`support-dsh`
- Baseline HEAD: `dac66373e3b3dc612c91c5b726cb146540cb6b75` / 基线 HEAD：`dac66373e3b3dc612c91c5b726cb146540cb6b75`
- Accepted implementation/documentation head: `f59dbf5f5549a03f1965c83ce3f183dd33a58baf` / 已接受实现／文档 head：`f59dbf5f5549a03f1965c83ce3f183dd33a58baf`
- Corrected implementation/documentation head: `08e078ecb3bb2cfb0b829af42d121c61c0eee1a1` / 修正版实现／文档 head：`08e078ecb3bb2cfb0b829af42d121c61c0eee1a1`
- Remote CI: historical accepted run `32340719998` at `f59dbf5…` and corrected run `32628383363` at `08e078e…` both completed success for Ubuntu Node 22, Ubuntu Node 24, Windows Node 24, Ubuntu browser, Ubuntu/Windows package smoke, and aggregate `ci`. / 远程 CI：历史验收 run `32340719998`（`f59dbf5…`）与修正版 run `32628383363`（`08e078e…`）的 Ubuntu Node 22、Ubuntu Node 24、Windows Node 24、Ubuntu browser、Ubuntu／Windows package smoke 与聚合 `ci` 均成功。
- Scope: M1 effective preset + lineage + seed ownership; M2 compaction semantics and presentation. Stop after M2. / 范围：M1 生效 preset ＋ lineage ＋ seed ownership；M2 compaction 语义与呈现。M2 后停止。
- Do not start in this session: Code Mode / tool workflows, hooks, approvals, retries, goal/todo, slash commands, schedule/feedback, web-search-llm-request, unknown-plugin rich support, future format inspection. / 本次不得启动：Code Mode／tool workflow、hooks、approvals、retries、goal/todo、slash command、schedule/feedback、web-search-llm-request、未知 plugin 富支持、未来格式检查。

## Objective / 目标

Complete the source-level DeepSeek Harness Session semantics required to answer: / 完成回答以下问题所需的来源级 DeepSeek Harness 会话语义：

- which agent preset a Session actually ran under; / 会话实际运行在哪个 agent preset 下；
- where a Session came from and what history it inherited; / 会话来自哪里、继承了什么历史；
- how compaction changes the model-visible surface without rewriting the human-visible transcript. / compaction 如何改变模型可见 surface，而不改写人类可见 transcript。

Phase 1 is accepted and archived; this plan does not reopen its architecture decisions. / 第一阶段已验收归档；本计划不重新打开其架构决策。

## Evidence baseline / 证据基线

- Repository / 仓库: `/home/joejack/session-analyzer`, branch `support-dsh`, clean at `dac66373e3b3dc612c91c5b726cb146540cb6b75`. / 仓库根目录、分支、HEAD 与工作树均已核验。
- Local upstream reference / 本地上游参考: `./tmp/deepseek-harness` HEAD `47f943859bef60e4160492346772ded9b24f765a`, branch `master`, clean. It is read-only and was not updated. / 只读未更新。
- Writer evidence / writer 证据: `@deepseek-ai/dsh` npm `0.1.0-rc.6` current-writer physical artifacts under `spike/fx-home/sessions/…` remain authoritative for physical bytes. / `0.1.0-rc.6` 当前 writer 物理产物仍是物理字节权威。
- Upstream source evidence / 上游源码证据:
  - `resolveSessionPreset()` at `packages/preset/agent-presets/src/session.ts`: last `agent-preset/selected` wins, header `agentPreset` is creation-time fallback. / 最后一个 `agent-preset/selected` 生效，header `agentPreset` 仅创建时 fallback。
  - `SessionHeader` at `packages/core/session/src/types.ts`: `parentSession` is seed lineage, `origin:"subagent"` is classification, `seedLength` is the durable inherited-prefix boundary, `delegationDepth` is always written by the current writer (0 at top level). / header 字段语义如上。
  - `subagent/descriptor` current version is v2 with `mode`/`provider`/`label` and continuable-specific composition fields. / descriptor 当前版本为 v2。
  - `compaction/*` vocabulary at `packages/compaction/compaction/src/types.ts`: start/summary/replacement/end are a priced standalone lifecycle; replacement is model-only surface material; `compaction/prune` is a separate model-free prune shadow-price event. / compaction 生命周期与 prune 语义如上。

## M1 design / M1 设计

- Effective preset / 生效 preset:
  - Keep the header byte as Raw evidence; do not rewrite the source header. / 不改写来源 header，header 字节留在 Raw。
  - Scan events oldest→newest; each valid `agent-preset/selected` overwrites `agentNickname` (the existing user-visible carried string surface); otherwise the header `agentPreset` wins. / 最后一个有效选择生效；否则 header 生效。
  - `agent-preset/selected` becomes a modeled Protocol event with source-owned preview/search/detail instead of opaque generic Protocol. / 事件建模为 Protocol。
  - No canonical top-level preset field is added. / 不新增 canonical 顶层 preset 字段。
- Lineage and subagent / lineage 与 subagent:
  - `parentSessionId` is set from every child header (`parentSession`) and is never inferred from timestamps or seed presence. / 子会话 header 直接写入 `parentSessionId`。
  - `primarySessionMetaKind` is `subagent` only when `origin:"subagent"`; a normal fork with `parentSession` but no origin is not demoted to subagent. / 仅 `origin:"subagent"` 分类为 subagent。
  - `forkedFromSessionId` is set for non-origin parented forks and for origin-subagent children whose descriptor provider is `fork` or whose header carries a seed boundary. Spawned subagents keep parent-child navigation without pretending to be a fork. / fork 关系按 descriptor provider 或 seed 边界设置；spawn child 不冒充 fork。
  - `subagent/descriptor` v2 contributes bounded `derivedRelationship` provenance and descriptor label as a subagent title fallback. Unsupported descriptor versions remain Protocol/Raw. / descriptor v2 贡献有界 provenance 与标题 fallback。
- Seed ownership / seed ownership:
  - Header `seedLength` is the only durable inherited-history ownership boundary. It keeps the original fork prefix across resume and may exist without any marker at the same seq. / 只有 header `seedLength` 才是持久继承历史 ownership 边界；它会在 resume 后继续保留原始 fork 前缀，也不要求相同 seq 上存在 marker。
  - Every `session/end-seed` marks the end of one replay/fork/resume constructor seed. It remains exact Raw and modeled Protocol lifecycle evidence, may repeat, and neither creates nor moves inherited ownership. A marker later than header `seedLength` is valid continuation evidence. / 每条 `session/end-seed` 都标记一次 replay／fork／resume constructor seed 的结束；它保留为精确 Raw 与建模后的 Protocol 生命周期证据，可以重复，既不创建也不移动继承 ownership。晚于 header `seedLength` 的 marker 是合法 continuation 证据。
  - Seeded physical Raw records remain all inspectable. Raw segment tags are `fork_metadata` (header), `inherited_context` (seqs < boundary), and `continuation` (seqs ≥ boundary). / Raw 全部保留并标记 ownership segment。
  - Inherited logical events are removed from the child Main/Protocol projections and summarized in `inheritedContext`; child counts/titles/analysis therefore never double-attribute parent work. / 继承逻辑事件不计入子会话 counts，摘要进入 `inheritedContext`。
  - Seedless parented forks get no manufactured boundary and no `inheritedContext`. / 无 seed 事实时不制造边界。
- Projection parity / 投影一致性: Indexed carried facts and Materialized reconstructed facts come from the same parser path; query-store projection parity tests remain mandatory. / 同一 parser 路径保证 Indexed／Materialized 一致。

## M2 design / M2 设计

- Compaction lifecycle is projected as one coherent Main-layer `compaction` Logical Event, matching the mature Codex presentation pattern. / compaction 生命周期投影为单个 Main `compaction` 事件，参照 Codex 成熟呈现模式。
- Raw References are the exact ordered lifecycle records: successful `compaction/start` → `compaction/summary` → replacement `user/message` → `compaction/end`; failed `compaction/start` → `compaction/end`. / Raw References 精确有序。
- A replacement `user/message` is never emitted as a human Main prompt. Append-origin `user/message` conversation remains visible in the analyzer timeline and is never deleted/shadowed. / 替换 `user/message` 永不成为人类 Main prompt，append 来源历史保持可见。
- `compaction/prune` remains recognized/deferred Protocol because no current-writer physical fixture exists; no semantics are manufactured from the event name alone. / 无 writer 证据，prune 继续识别但推迟，不臆造语义。
- Structured Detail assigns `content`/`result`/`context`/`traceability` from source evidence; primary detail carries the summary/status needed to follow history, supplemental detail carries usage/model/range/traceability. Full replacement payload is never copied inline. / Detail 按来源语义分配 purpose 与责任。

## M1 checkpoint gate / M1 检查点

- [x] Effective preset is last-selection-wins with header fallback.
- [x] Parent-child navigation works from child headers; no parent body hydration is needed.
- [x] Subagent classification uses `origin:"subagent"`, never seed presence.
- [x] Seeded vs seedless derived sessions are distinguished by header `seedLength`; constructor seed markers never manufacture inherited ownership.
- [x] Inherited prefix stays inspectable in Raw and is not double-counted as child work.
- [x] Indexed/Materialized projection parity and Raw/Detail source freshness remain green.
- [x] No DeepSeek-specific browser runtime branch is added.
- [x] Codex and Claude focused behavior remains green.
- [x] Architecture-pressure findings recorded.

## Known but unmodeled inventory / 已知但未建模清单

| Family / family | Phase 1 status / 第一阶段状态 | Phase 2A target / Phase 2A 目标 |
| --- | --- | --- |
| `agent-preset/selected` | recognized deferred | modeled Protocol + effective preset |
| `session/end-seed` | recognized deferred | modeled constructor-seed lifecycle Protocol; no ownership inference |
| `subagent/descriptor` | recognized deferred | modeled v2 provenance + title |
| SessionHeader `parentSession` / `seedLength` / `origin` / `agentPreset` / `delegationDepth` | header discovery only | modeled lineage/seed/preset facts |
| `compaction/start` | recognized deferred | modeled in one compaction projection |
| `compaction/summary` | recognized deferred | modeled in one compaction projection |
| `compaction/end` | recognized deferred | modeled in one compaction projection |
| `compaction/prune` | recognized deferred | remains deferred Protocol (no physical writer fixture) |
| `tool/code-dispatch*`, `tool-workflow/*`, hooks, approvals, retries, goal/change, todo/write, command/run+done, schedule/change, feedback/record, web search LLM request, unknown plugin events, future format versions | deferred | remain deferred |

## Architecture pressure log / 架构压力记录

1. **No canonical effective-preset surface / 没有 canonical 生效 preset 字段**
   - Evidence / 证据: DSH durable facts distinguish creation-time `SessionHeader.agentPreset` from the effective last `agent-preset/selected`; `resolveSessionPreset` is upstream normative. / 上游 `resolveSessionPreset` 规范区分两者。
   - Current abstraction / 当前抽象: canonical Session has `agentNickname` as the only user-visible carried name string; no top-level preset field. / canonical 只有 `agentNickname` 可用作可见名称。
   - Mismatch / 不匹配: the actual useful list/detail fact is the effective preset, while the creation-time value must remain Raw evidence. / 有用的可见事实是生效值，创建值仅作 Raw 证据。
   - Adapter-local solution / adapter 本地方案: `agentNickname` carries the effective preset; creation header is preserved exactly in Raw readback/search text and in `agent-preset/selected` Protocol detail. / `agentNickname` 承载生效值，创建值在 Raw 与 Protocol 详情保留。
   - Shared change / 共享修改: none. Adding a canonical preset field would be presentation convenience and is rejected. / 无。
   - Severity / 严重性: non-blocking / 不阻断。
   - Disposition / 处置: accepted for Phase 2A; revisit only if a second source needs the same distinction. / Phase 2A 接受；仅在第二个来源需要相同区分时重新审视。

2. **`parentSession` is lineage, not subagent classification / `parentSession` 是 lineage 而非 subagent 分类**
   - Evidence / 证据: current-writer fork children carry `parentSession` with and without `origin:"subagent"`; seedless fork children prove `parentSession` does not imply seed. / writer fork child 证明。
   - Current abstraction / 当前抽象: `session-query.defaultDerivedSessionKind()` treats any `parentSessionId` as subagent unless the adapter overrides it. / 共享默认会把 `parentSessionId` 当 subagent。
   - Adapter-local solution / adapter 本地方案: DeepSeek supplies a source-owned `derivedSessionKind` that only consults `primarySessionMetaKind`. No shared change needed. / DeepSeek 自定义 `derivedSessionKind`。
   - Shared change / 共享修改: none. / 无。
   - Severity / 严重性: non-blocking / 不阻断。
   - Disposition / 处置: accepted; this is the existing adapter hook working as designed. / 接受，现有 hook 按设计工作。

3. **Seeded DSH Raw ownership is physical, while `seedLength` is logical / DSH seed 的 Raw ownership 是物理记录，`seedLength` 是逻辑 seq**
   - Evidence / 证据: packed storage rows mean one physical Raw Record can own a seq range; the inherited prefix boundary is a logical event count (`seedLength`), so Raw segment assignment must use per-record `seq0..seqEnd` and must reject a packed row crossing the boundary. / 打包行导致物理与逻辑边界不同。
   - Current abstraction / 当前抽象: Codex materialized-fork raw segments use raw ordinals; DSH needs the same UI but derives ordinals from seq ranges. / 可复用同一 UI 契约。
   - Adapter-local solution / adapter 本地方案: adapter-owned `_forkSegmentsByRawId` private Materialized field plus raw `forkSegment` facts; no shared contract change. / adapter 私有 Map。
   - Shared change / 共享修改: none. / 无。
   - Severity / 严重性: non-blocking / 不阻断。
   - Disposition / 处置: implemented. / 已实现。

4. **`compaction/prune` vocabulary has no current-writer physical evidence / `compaction/prune` 无当前 writer 物理证据**
   - Evidence / 证据: upstream `compaction-tool-result-pruner` defines it; the curated writer artifacts never fired the pruner. / 上游定义存在，writer fixture 未触发。
   - Adapter-local solution / adapter 本地方案: keep it recognized as generic Protocol with bounded preview; never fabricate a replacement projection from the name alone. / 保持通用 Protocol。
   - Shared change / 共享修改: none. / 无。
   - Severity / 严重性: evidence gap, non-blocking / 证据缺口，不阻断。
   - Disposition / 处置: remains deferred until a physical writer fixture exists. / 推迟。

## Progress log / 进展记录

- 2026-08-20 (Checkpoint A): verified baseline `dac6637…`, clean `support-dsh`, upstream clone `47f9438…`, located current-writer spike artifacts (subagent, subagent-fork, fork-seed, compaction-ok/failed). Created this plan. No production code changed yet. / 核验基线、上游与 writer 证据并创建本计划，尚未改生产代码。
- 2026-08-20 (M1 implementation): header validation for `parentSession`/`seedLength`/`origin`/`agentPreset`; effective preset via last valid `agent-preset/selected` with header fallback; modeled `agent-preset/selected`, `subagent/descriptor`, and `session/end-seed` Protocol events; child-owned `parentSessionId` for all parented children plus source-owned `derivedSessionKind`; seeded `forkStorageMode:"materialized"` with `_forkSegmentsByRawId` Raw ownership and `inheritedContext`; inherited logical events filtered before counts/analysis. Curated 6 physical writer lineage fixtures plus 3 preset fixtures serialized through the `0.1.0-rc.6` JSONL persistence backend. / 实现 M1：header 校验、生效 preset、Protocol 建模、seed ownership 与 fixture。
- 2026-08-20 (M2 implementation): successful/failed compaction projected as one Main `compaction` event with exact ordered Raw References; replacement `user/message` is paired only as model-only surface evidence; append-origin human conversation stays visible; `compaction/prune` remains recognized/deferred Protocol. Added compaction-ok/failed physical writer fixtures and focused tests. / 实现 M2：compaction 单事件投影、模型专属替换、fixture 与测试。
- 2026-08-20 (Validation): focused DeepSeek 29/29, source-adapter conformance 41/41, full Node 640/640, `build:check`, package smoke, and browser 117/117 (local WSL launch shim) PASS under local Node v24.18.1/npm 12.0.2. / 验证：DeepSeek 聚焦 29/29、conformance 41/41、完整 Node 640/640、build:check、package smoke 与浏览器 117/117（本地 WSL 启动 shim）通过。
- 2026-08-23 (remote acceptance verification): GitHub Actions run `32340719998` at `f59dbf5f5549a03f1965c83ce3f183dd33a58baf` was independently rechecked through the GitHub Checks API; all seven required jobs concluded `success`. / 远程验收复核：通过 GitHub Checks API 独立复核 `f59dbf5f5549a03f1965c83ce3f183dd33a58baf` 的 GitHub Actions run `32340719998`，七个必需 job 均为 `success`。
- 2026-08-23 (post-acceptance empirical closeout gate): a read-only replay of the six copied real DSH artifacts found five top-level Sessions with no header `parentSession` and no header `seedLength`, but with one or more trailing `session/end-seed` records. Historical source at `47f9438…` and current source at `b150a55…` both define that event as the end of the constructor seed used by replay, fork, **or resume**; only header `seedLength` is the durable fork-lineage boundary. The current adapter instead uses the last marker as an inherited-prefix boundary when the header field is absent. Replaying those five artifacts through the accepted adapter therefore yields `forkStorageMode:"materialized"`, zero Main events, and only the marker Protocol event; one real Session contains two such markers, proving repeated resume boundaries. This is direct writer/source evidence, not a historical intermediate decision. The plan remains active until a separate correction makes `session/end-seed` Protocol/resume evidence unless header `seedLength` independently proves inherited ownership, adds ordinary-resume and resumed-fork fixtures, and restores the real-corpus structural counts. / 验收后经验收尾门槛：以只读方式重放六份复制的真实 DSH 工件后发现，其中五个顶层会话的 header 既没有 `parentSession`，也没有 `seedLength`，但末尾存在一条或多条 `session/end-seed`。历史源码 `47f9438…` 与当前源码 `b150a55…` 都把该事件定义为 replay、fork **或 resume** 使用的 constructor seed 结束标记；只有 header `seedLength` 才是持久化的 fork-lineage 边界。当前 adapter 却会在 header 字段缺失时把最后一个 marker 当作继承前缀边界。于是，这五份真实工件通过已接受 adapter 重放后都得到 `forkStorageMode:"materialized"`、Main 事件为零、仅保留 marker Protocol 事件；其中一个真实会话含两个 marker，证明 resume boundary 可以重复出现。这是直接 writer／源码证据，而不是历史中间决定。本计划继续保持 active，直到独立修正让 `session/end-seed` 在没有 header `seedLength` 独立证明继承 ownership 时只作为 Protocol／resume 证据，补充普通 resume 与 resumed-fork fixture，并恢复真实语料的结构计数。
- 2026-08-23 (corrective implementation): `resolveSeedBoundary()` now returns only a valid header `seedLength`; it has no marker fallback and no marker/header order or equality rule. `session/end-seed` remains one exact Raw-backed Protocol event per row, with constructor-seed lifecycle wording that does not claim parent ownership. Added deterministic synthetic coverage for a top-level resume, repeated resumes with work between markers, a seeded derived Session resumed after its original boundary, header-only and inherited-prefix marker cases, plus the accepted physical seeded-fork regression and query parity. No shared canonical, source-adapter contract, or browser branch changed. / 修正实现：`resolveSeedBoundary()` 现在只返回有效 header `seedLength`；不再 fallback 到 marker，也不再施加 marker／header 顺序或相等规则。每条 `session/end-seed` 继续作为一条具有精确 Raw 引用的 Protocol 事件，并使用不宣称 parent ownership 的 constructor-seed 生命周期文案。新增确定性合成覆盖：顶层 resume、marker 间存在工作量的重复 resume、在原始边界后 resume 的 seeded derived Session、仅 header 与继承前缀内 marker，并保留已接受的物理 seeded-fork 回归及查询等价。共享 canonical、source-adapter contract 与 browser branch 均未改动。
- 2026-08-23 (corrective focused validation): Phase 2A focused file PASS 16/16; combined DeepSeek, source-adapter contract/conformance, Codex fork/review-marker, and Claude derived compatibility PASS 77/77. Read-only replay of all six ignored real artifacts PASS: all five marker-bearing top-level Sessions have empty `forkStorageMode`, null `inheritedContext`, non-zero Main counts (39, 841, 835, 214, 592), and matching Protocol marker counts (1, 1, 1, 2, 1); the repeated-marker Session retains six Main events between seq 18,795 and 20,244. / 修正聚焦验证：Phase 2A 聚焦文件 16/16 通过；DeepSeek、source-adapter contract／conformance、Codex fork／review-marker 与 Claude derived compatibility 合并套件 77/77 通过。六份 ignored 真实工件只读重放全部通过：五个含 marker 的顶层会话均为 `forkStorageMode` 空、`inheritedContext` null、Main 计数非零（39、841、835、214、592），Protocol marker 数量一致（1、1、1、2、1）；重复 marker 会话在 seq 18,795 与 20,244 之间保留六个 Main 事件。
- 2026-08-23 (corrective full local validation): full Node PASS 682/682; `release:check` PASS, including current generated assets, a second 682/682 Node run, and Codex/Claude/DeepSeek package smoke; browser PASS 121/121; `git diff --check` PASS. All gates ran on Windows Node v24.18.1/npm 12.0.2. / 修正版完整本地验证：完整 Node 682/682 通过；`release:check` 通过，其中包括生成资产一致、第二次 Node 682/682 及 Codex／Claude／DeepSeek package smoke；browser 121/121 通过；`git diff --check` 通过。全部门禁运行于 Windows Node v24.18.1／npm 12.0.2。
- 2026-08-23 (corrected remote acceptance and archival): pushed corrected head `08e078ecb3bb2cfb0b829af42d121c61c0eee1a1`; GitHub Actions run `32628383363` completed with all seven required jobs successful. The previously CI-green but semantically wrong `f59dbf5…` history remains recorded above. Phase 2A is now complete; Phase 2B may resume from its existing M0 plan. / 修正版远程验收与归档：已推送修正版 head `08e078ecb3bb2cfb0b829af42d121c61c0eee1a1`；GitHub Actions run `32628383363` 的七个必需 job 全部成功。上文继续保留此前 `f59dbf5…` 虽 CI 通过但语义错误的历史。Phase 2A 现已完成；Phase 2B 可从既有 M0 计划继续。
