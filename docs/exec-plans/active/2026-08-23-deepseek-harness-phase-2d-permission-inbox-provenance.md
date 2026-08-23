# DeepSeek Harness Phase 2D — Permission state and inbox provenance / DeepSeek Harness 第二阶段 D —— 权限状态与 Inbox provenance

## Status / 状态

- Status: active; accepted M0 evidence is complete, production implementation has not started. / 状态：活跃；已接受 M0 证据完整，尚未开始 production 实现。
- Branch: `support-dsh`; clean starting head `dc7bcb354e334dbb0135efd449443ba56ae97f52`, equal to `origin/support-dsh`. / 分支：`support-dsh`；干净起始 head 为 `dc7bcb354e334dbb0135efd449443ba56ae97f52`，与 `origin/support-dsh` 一致。
- Accepted predecessor: Phase 2C is archived at the starting head; Phase 1／2A／2B／2C remain closed. / 已接受前序：Phase 2C 已在起始 head 归档；Phase 1／2A／2B／2C 保持关闭。
- Current upstream: clean `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, package `@deepseek-ai/dsh 0.1.1-rc.2`. / 当前上游：干净 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，package 为 `@deepseek-ai/dsh 0.1.1-rc.2`。

## Objective / 目标

Add adapter-owned structured permission state at the Logical Event／Detail boundary and exact-MessageId Supplemental inbox provenance without widening canonical Session fields, promoting queue bookkeeping to Main, or duplicating Raw ownership. Stop after M2 plus full validation and archival. / 在不扩展 canonical Session field、不把 queue bookkeeping 提升到 Main、也不复制 Raw ownership 的前提下，于 Logical Event／Detail 边界增加 adapter 自有结构化 permission state 与精确 MessageId 的 Supplemental inbox provenance。M2、完整验证与归档后停止。

## Accepted M0 evidence / 已接受 M0 证据

- Ignored evidence report and scanner: `tmp/dsh-phase2d-real-gap-audit.json` and `.js`; no global corpus audit will be repeated. / 已忽略证据报告与扫描器为 `tmp/dsh-phase2d-real-gap-audit.json` 与 `.js`；不重复全局语料审计。
- Six Sessions contain 38 `agent/inbox/spliced` rows: 19 insertion-only plus 19 exact upstream claim deletions; 10 human `next-turn`, nine plugin `next-step`, zero cancellation/replacement, and all queues end empty. / 六个 Session 含 38 条 `agent/inbox/spliced`：19 条纯 insertion 与 19 条精确 upstream claim deletion；10 条人类 `next-turn`、九条 plugin `next-step`，零 cancellation／replacement，全部 queue 最终为空。
- Every queued MessageId later appears exactly once as append-origin `user/message`; role, source, content, and complete message match exactly. / 每个 queued MessageId 随后都恰好一次成为 append-origin `user/message`；role、source、content 与完整 message 全部精确匹配。
- Every Session has seq 0 `permission/preset=workspace-write`, seq 1 `sandbox/mode=workspace-write`, and seq 2 `approval/policy=ask`, before first turn/request/tool; no runtime change is observed. / 每个 Session 都在首个 turn／request／tool 前含 seq 0 `permission/preset=workspace-write`、seq 1 `sandbox/mode=workspace-write` 与 seq 2 `approval/policy=ask`；未观察到 runtime change。
- Interactive approval is absent (`approval/asked` and `approval/decided` 0/6) and remains out of scope. `session/title-llm-request` remains generic Protocol. / Interactive approval 缺席（`approval/asked` 与 `approval/decided` 均为 0／6）并保持范围外；`session/title-llm-request` 继续为 generic Protocol。

## Product/support decisions / 产品／支持决定

1. **Permission rows remain independent Protocol events.** Each valid row owns exactly one Raw record and carries an adapter-owned observed-state snapshot after that row. Missing knobs stay unknown; completeness means only that all three durable facts have appeared. / **Permission row 保持独立 Protocol event。** 每条有效 row 精确拥有一条 Raw record，并携带该 row 后 adapter 自有的 observed-state snapshot。缺失 knob 保持 unknown；completeness 只表示三条持久 fact 均已出现。
2. **No preset-bundle inference.** Preset names are non-empty configured identifiers; deployment tables/defaults are not durable facts. Sandbox and approval use their closed upstream vocabularies. / **不推断 preset bundle。** Preset name 是非空配置标识；deployment table／default 不是持久 fact。Sandbox 与 approval 使用上游封闭 vocabulary。
3. **Inbox correlation is a relation, not ownership.** Splice Protocol rows keep their own Raw refs; `user/message` keeps its own Raw ref and receives only adapter-owned logical relation metadata plus `event_refs` when the shared Detail contract admits it. / **Inbox correlation 是 relation，不是 ownership。** Splice Protocol row 保留自身 Raw ref；`user/message` 保留自身 Raw ref，只接收 adapter 自有逻辑 relation metadata，并在共享 Detail 契约允许时使用 `event_refs`。
4. **Exact durable identity only.** Strict two-list replay, MessageId, source-compatible/full-message equality, unique insertion/claim, and append origin are required. Adjacency, time, turn proximity, and content similarity never correlate. / **只用精确持久 identity。** 必须满足严格双列表 replay、MessageId、source-compatible／完整 message equality、唯一 insertion／claim 与 append origin。相邻、时间、turn proximity 与内容相似绝不用于关联。
5. **No Main promotion.** Human and plugin messages keep their existing Main／Protocol semantics. Inbox adds provenance only; cancellation/replacement/ambiguous rows stay generic Protocol/Raw. / **不提升 Main。** 人类与 plugin message 保持既有 Main／Protocol 语义。Inbox 只增加 provenance；cancellation／replacement／歧义 row 保持 generic Protocol／Raw。

## Architecture-pressure log / 架构压力记录

| Finding / 发现 | Evidence / 证据 | Existing abstraction / 既有抽象 | Pressure / 压力 | Adapter-local disposition / adapter 本地处置 | Shared change? / 共享变更 | Severity / 严重性 |
| --- | --- | --- | --- | --- | --- | --- |
| Effective permission state is useful but Session shape is strict / 生效权限状态有用但 Session shape 严格 | Source three-knob fold; real 6/6 / 源码三 knob fold；真实 6／6 | Logical Event metadata + Detail / Logical Event metadata＋Detail | A public Session field would widen canonical contract / public Session field 会扩展 canonical contract | Per-event observed snapshot only / 仅逐 event observed snapshot | No / 否 | High / 高 |
| Deployment defaults are not durable / Deployment default 不持久 | Preset table is process config / preset table 是进程配置 | Exact source fact policy / 精确来源 fact 策略 | Default-bundle inference would misread custom deployments / 默认 bundle 推断会误读 custom deployment | Preserve names; unknown stays null / 保留名称；未知保持 null | No / 否 | High / 高 |
| Partial permission state is truthful / Partial permission state 真实 | Rows arrive independently / row 独立到达 | Structured context / 结构化 context | “complete” could imply defaults / complete 可能暗示 default | Complete means three observed facts only / complete 只表示观察到三项 fact | No / 否 | Medium / 中 |
| Inbox Raw belongs to splice / Inbox Raw 属于 splice | Physical writer rows + accepted ownership rule / 物理 writer row＋已接受 ownership rule | Logical relation/event refs / 逻辑 relation／event refs | Copying rawRefs would lie / 复制 rawRefs 会失真 | Relation metadata only / 只加 relation metadata | No / 否 | High / 高 |
| MessageId is authoritative / MessageId 权威 | Real 19/19 exact full-message match / 真实 19／19 完整 message 匹配 | Source-owned correlation / 来源自有关联 | Content similarity tempts false matches / 内容相似易诱发误关联 | Exact replay + identity guards / 精确 replay＋identity guard | No / 否 | High / 高 |
| Queue volume is not Main semantics / Queue 数量不是 Main 语义 | 38 rows mirror 19 surfaced messages / 38 row 镜像 19 条 surfaced message | Protocol + Supplemental Detail / Protocol＋Supplemental Detail | Duplicate visible content / 重复可见内容 | Keep splice Protocol; enrich relation / splice 保持 Protocol；增强 relation | No / 否 | High / 高 |
| Plugin next-step remains non-human / Plugin next-step 保持非人类 | Real nine plugin messages / 真实九条 plugin message | Existing non-human Protocol context / 既有非人类 Protocol context | Provenance must not change responsibility / provenance 不得改变 responsibility | Same relation, unchanged layer/role / 同一 relation，不改 layer／role | No / 否 | High / 高 |
| Seed ownership remains child-local / Seed ownership 保持 child-local | Phase 2A header seed boundary / Phase 2A header seed boundary | Child-owned projection / child-owned projection | Inherited Raw could be reassigned / inherited Raw 可能被重分配 | Derive only from child-owned evidence; defer inherited context / 只从 child 自有证据派生；推迟 inherited context | No / 否 | High / 高 |

## Milestones / 里程碑

- [x] M0 — accepted focused real-corpus/source audit; no repeat. / 已接受聚焦真实语料／源码审计；不重复。
- [ ] M1 — permission durable-state snapshots, Structured Detail, malformed/custom/partial/runtime tests, parity/freshness, and six-artifact gate. / Permission 持久状态 snapshot、结构化 Detail、malformed／custom／partial／runtime 测试、parity／freshness 与六工件门禁。
- [ ] M2 — strict inbox replay, exact relation metadata/event refs, optional splice Detail, defensive fallback tests, and exact 19-message gate. / 严格 inbox replay、精确 relation metadata／event ref、可选 splice Detail、防御回退测试与精确 19-message 门禁。
- [ ] M3 — full local gates, read-only replay, remote CI, docs closeout, archive, and stop. / 完整本地门禁、只读 replay、远程 CI、文档收尾、归档并停止。

## Fixture policy / Fixture 策略

- Add the smallest sanitized byte-protected format-v0 fixtures; tests never read `tmp/dsh-real-sessions`. / 增加最小脱敏、受字节保护的 format-v0 fixture；测试绝不读取 `tmp/dsh-real-sessions`。
- Permission real-style initial triple is real-corpus-derived; runtime switching, partial/malformed state, and custom preset names are current-source-only. / Permission 真实风格初始 triple 来自真实语料；runtime switching、partial／malformed state 与 custom preset name 仅由当前源码支撑。
- Inbox human next-turn and plugin next-step enqueue／claim relations are real-corpus-derived. Mismatch/malformed defensive cases are synthetic; cancellation/replacement remain generic if present and are labeled current-source-only. / Inbox 人类 next-turn 与 plugin next-step enqueue／claim relation 来自真实语料。Mismatch／malformed 防御 case 为合成；若包含 cancellation／replacement，则保持 generic 并标记仅当前源码。

## Validation contract / 验证契约

After M1 run focused permission tests, DeepSeek/conformance regressions, and six-artifact permission replay. After M2 run focused inbox/human/plugin/Detail tests and exact 19-message replay. Closeout runs all DeepSeek tests, source-adapter contract/conformance, affected Codex/Claude regressions, full Node, `release:check`, one browser suite, package smoke, six-artifact replay, `git diff --check`, and remote CI. Report PASS／FAIL／NOT RUN including transient history. / M1 后运行聚焦 permission 测试、DeepSeek／conformance 回归与六工件 permission replay。M2 后运行聚焦 inbox／human／plugin／Detail 测试及精确 19-message replay。收尾运行全部 DeepSeek 测试、source-adapter contract／conformance、受影响 Codex／Claude 回归、完整 Node、`release:check`、一次 browser suite、package smoke、六工件 replay、`git diff --check` 与远程 CI。包括瞬时历史在内精确报告 PASS／FAIL／NOT RUN。

## Non-goals / 非目标

Do not implement interactive approvals, hooks, command lifecycle, schedule, feedback, plan mode, web-search auxiliary requests, rich title-request presentation, inbox cancellation/replacement product semantics, compaction/prune, SQLite, future formats, or Raw random-access optimization. / 不实现 interactive approval、hook、command lifecycle、schedule、feedback、plan mode、web-search auxiliary request、丰富 title-request 呈现、inbox cancellation／replacement 产品语义、compaction/prune、SQLite、未来格式或 Raw 随机访问优化。

## Commit discipline / 提交纪律

Prefer four reviewable commits: (1) plan／accepted M0; (2) M1 Permission; (3) M2 Inbox; (4) validation／docs closeout. / 优先使用四个可评审 commit：(1) plan／已接受 M0；(2) M1 Permission；(3) M2 Inbox；(4) validation／文档收尾。

## Progress log / 进展记录

- 2026-08-23 (baseline): verified clean `support-dsh` at `dc7bcb354…`, equal to origin; verified clean upstream `b150a551…`, package `0.1.1-rc.2`. / 核验干净 `support-dsh@dc7bcb354…` 与 origin 相同；核验干净 upstream `b150a551…`、package `0.1.1-rc.2`。
