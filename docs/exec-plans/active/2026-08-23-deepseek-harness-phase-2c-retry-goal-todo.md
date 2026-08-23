# DeepSeek Harness Phase 2C — LLM retry and durable task state / DeepSeek Harness 第二阶段 C —— LLM 重试与持久任务状态

## Status / 状态

- Status: active; focused M0 source/real-corpus mapping complete, production implementation not yet started. / 状态：活跃；聚焦 M0 源码／真实语料映射已完成，尚未开始生产实现。
- Branch: `support-dsh`; clean starting head `9f7f0f26469a8a5a3c2cf2e1fbf7e4652783aad2`, equal to `origin/support-dsh`. / 分支：`support-dsh`；干净起始 head 为 `9f7f0f26469a8a5a3c2cf2e1fbf7e4652783aad2`，与 `origin/support-dsh` 一致。
- Accepted predecessor: Phase 2B implementation `b4e8f601…`, implementation CI `32633025427`, archive head `9f7f0f264…`, archive CI `32633383567`; Phase 1／2A／2B remain closed. / 已接受前序：Phase 2B 实现 `b4e8f601…`、实现 CI `32633025427`、归档 head `9f7f0f264…`、归档 CI `32633383567`；Phase 1／2A／2B 保持关闭。
- Current upstream: official `master` and local clean checkout both remain `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, package `@deepseek-ai/dsh 0.1.1-rc.2`; no broad delta audit was repeated. / 当前上游：官方 `master` 与本地干净 checkout 均仍为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，package 为 `@deepseek-ai/dsh 0.1.1-rc.2`；未重复广泛 delta audit。

## Objective / 目标

Add source-owned structured support for `llm/retry`／`llm/retry-started`, durable `goal/change` state plus attributed Goal continuation messages, and `todo/write` whole-list snapshots. Preserve strict Indexed／Materialized lifecycle, exact physical Raw ownership, accepted-snapshot freshness, ProjectQueryStore parity, and all accepted Phase 1–2B behavior. Stop after M3 and full validation. / 为 `llm/retry`／`llm/retry-started`、持久 `goal/change` 状态及带归因的 Goal continuation message、`todo/write` 全量列表快照增加来源自有的结构化支持。保持严格 Indexed／Materialized 生命周期、精确物理 Raw ownership、accepted-snapshot freshness、ProjectQueryStore parity 与全部已接受 Phase 1–2B 行为。M3 与完整验证后停止。

## Evidence precedence / 证据优先级

1. Accepted Session Analyzer source-neutral contracts/design/tests are the application specification. / 已接受的 Session Analyzer 来源中立契约／设计／测试是应用规格。
2. Unchanged current DeepSeek Harness source `b150a551…` defines intended retry/Goal/Todo semantics. / 未变化的当前 DeepSeek Harness 源码 `b150a551…` 定义 retry／Goal／Todo 预期语义。
3. The six copied read-only Sessions define only their actually persisted writer shapes. / 六份复制的只读 Session 只定义其实际持久 writer shape。
4. Sanitized committed fixtures define supported Session Analyzer behavior without importing private payloads. / 脱敏已提交 fixture 在不引入私有 payload 的前提下定义受支持的 Session Analyzer 行为。

## M0 focused mapping / M0 聚焦映射

The ignored structural scanner is `tmp/dsh-phase2c-structural-check.js`. It reads only committed physical records and reports identities, sequence positions, field presence, counts, and status vocabulary; it does not print failed request messages, objectives, Todo content, prompts, source, or command output. / 已忽略的结构扫描器为 `tmp/dsh-phase2c-structural-check.js`。它只读取已提交物理 record，并报告 identity、seq 位置、字段存在性、计数与 status vocabulary；不打印失败 request message、objective、Todo content、prompt、源码或命令输出。

### Retry evidence / Retry 证据

- Only real Minimal Session `session-244d9853-e5c8-4321-8c79-c4f043ca9976` contains retry lifecycle: five `llm/retry` and five `llm/retry-started`. / 只有真实 Minimal Session `session-244d9853-e5c8-4321-8c79-c4f043ca9976` 含 retry 生命周期：五条 `llm/retry` 与五条 `llm/retry-started`。
- All five schedules have distinct non-empty `retryId`, `turn:1`, steps `81／89／124／140／211`, provider `deepseek-official`, normal mode, one identical finite policy key, `retry:1`, `maxRetries:2`, roughly 475–540 ms delay, and failure code `TRANSPORT`. Real failure objects contain exactly `code` and non-empty `message`; no status, provider retry-after, or request ID occurs. / 五条 schedule 都有互不相同的非空 `retryId`、`turn:1`、step `81／89／124／140／211`、provider `deepseek-official`、normal mode、同一个有限 policy key、`retry:1`、`maxRetries:2`、约 475–540 ms delay 与失败 code `TRANSPORT`。真实 failure object 恰含 `code` 与非空 `message`；未出现 status、provider retry-after 或 request ID。
- Every matching started row is the immediately following seq and repeats exact retryId／turn／step／retry. Each pair occurs inside its open step, before a much later `step/end`; none implies the eventual request outcome. / 每条匹配 started row 都是紧随其后的 seq，并精确重复 retryId／turn／step／retry。每对记录都位于开放 step 内且远早于 `step/end`；任何一对都不表示最终 request outcome。
- Scheduled-only cancellation, always mode, retry number >1, provider retry-after, and malformed/duplicate identities are current-source-only fixture cases, not real-corpus observations. / 仅 schedule 的取消、always mode、retry number 大于 1、provider retry-after 与畸形／重复 identity 都是仅当前源码支撑的 fixture case，并非真实语料观察。

### Goal evidence / Goal 证据

- Only Standard playground Session `session-82b92006-083e-4c81-8a2d-8c79de28e927` contains `goal/change`: `create` revision 1 in phase `active`, then `complete` revision 2 in phase `complete`, same Goal ID, `roundsStarted:0`, `maxGoalRounds:256`, valid create/update timestamps, and no blocked reason or clear tombstone. / 只有 Standard playground Session `session-82b92006-083e-4c81-8a2d-8c79de28e927` 含 `goal/change`：`create` revision 1／phase `active`，随后 `complete` revision 2／phase `complete`；Goal ID 相同，`roundsStarted:0`、`maxGoalRounds:256`，create／update timestamp 有效，无 blocked reason 或 clear tombstone。
- The create row is physically between one `create_goal` call/result and the complete row between one `update_goal` call/result. Neither state payload carries callId/tool identity; interval/adjacency is not ownership evidence, so state events and tool operations remain separate. No real `get_goal` call occurs. / Create row 物理上位于一对 `create_goal` call／result 之间，complete row 位于一对 `update_goal` call／result 之间。两条状态 payload 都不携带 callId／tool identity；区间／相邻不是 ownership 证据，因此状态 event 与工具 operation 保持分离。真实语料未出现 `get_goal` call。
- `user/message` with `source.kind:"goal"` occurs in 0/6 Sessions. Current source proves the exact attribution shape `{ kind, goalId, revision, round }`; any support is source-backed, not writer-observed here. / `source.kind:"goal"` 的 `user/message` 在 0／6 个 Session 中出现。当前源码证明其精确归因 shape `{ kind, goalId, revision, round }`；相关支持属于源码支撑，而非本语料 writer 实证。

### Todo evidence / Todo 证据

- The Standard Session contains three `todo/write` whole-list snapshots, each with 10 items and exact item keys `content,status`. Status histograms are `9 pending + 1 in_progress`, then `9 completed + 1 in_progress`, then `10 completed`. / Standard Session 含三条 `todo/write` 全量列表快照，每条都有 10 项，item key 恰为 `content,status`。Status 直方图依次为 `9 pending + 1 in_progress`、`9 completed + 1 in_progress`、`10 completed`。
- Each row is physically between one `todo_write` call/result, but carries no call/tool identity. Snapshot and tool operation remain separate. Item content is deliberately absent from the M0 report. / 每条 row 物理上位于一对 `todo_write` call／result 之间，但不携带 call／tool identity。快照与工具 operation 保持分离。M0 报告有意不包含 item content。
- Current source defines every write as a complete replacement list with no item ID/delta semantics. Empty lists and several `in_progress` items are durable-shape-valid; the latter depends on writer-time deployment policy and must replay after policy changes. / 当前源码把每次 write 定义为完整 replacement list，不存在 item ID／delta 语义。空列表与多个 `in_progress` item 都符合持久 shape；后者取决于写入时部署策略，并须在策略变化后仍可 replay。
- Important source nuance: the live `todos` projection is the latest snapshot only within the standing turn and resets to `null` on the next `turn/start`; durable historical `todo/write` events remain intact. / 重要源码细节：live `todos` projection 只在当前 standing turn 内表示最新快照，并在下一条 `turn/start` 重置为 `null`；持久历史 `todo/write` event 仍完整保留。

### Negative corpus evidence / 语料负面证据

- The other five Sessions contain zero retry/Goal/Todo state rows and must acquire no false projections. The PTC Session remains the Phase 2B oracle at 12 outer／35 nested. / 其它五个 Session 的 retry／Goal／Todo 状态 row 均为零，不得产生误投影。PTC Session 继续作为 Phase 2B 的 12 outer／35 nested oracle。
- No exact durable identity links `goal/change` or `todo/write` to a tool call anywhere in this corpus or current event types. / 本语料与当前 event type 中都没有精确持久 identity 把 `goal/change` 或 `todo/write` 链接到工具 call。

## Product/support decisions / 产品／支持决定

1. **Retry is grouped Protocol lifecycle, not outcome.** One valid chain keyed by exact `retryId` becomes one Protocol event with ordered schedule/started Raw References and numbered attempt facts. Status describes only observed lifecycle (`started` or `scheduled`); it never says success/exhausted. Invalid or cross-chain identity falls back row-by-row to Protocol/Raw. / **Retry 是 grouped Protocol 生命周期，而非 outcome。** 以精确 `retryId` 为 key 的一条有效 chain 成为一条 Protocol event，拥有有序 schedule／started Raw Reference 与编号 attempt fact。Status 只描述已观察生命周期（`started` 或 `scheduled`），绝不表示 success／exhausted。无效或跨 chain identity 逐 row 回退 Protocol／Raw。
2. **Goal state is canonical Main `goal`, independently owned.** Every valid `goal/change` becomes one Main `goal` state event with its full snapshot/tombstone and exact one-row Raw ownership. Nearby `create_goal`／`get_goal`／`update_goal` calls remain ordinary tool operations because no source identity supports a composite. / **Goal 状态使用 canonical Main `goal`，并保持独立 ownership。** 每条有效 `goal/change` 成为一条 Main `goal` 状态 event，携带完整 snapshot／tombstone，并精确拥有单 row Raw。邻近 `create_goal`／`get_goal`／`update_goal` call 因无来源 identity 支撑 composite，继续作为普通工具 operation。
3. **Durable phase only.** Project `active／paused／blocked／complete` and blocked reason; never invent `armed／disarmed` activation. Strict revision/transition folds admit state facts; malformed changes remain Protocol/Raw. / **只投影持久 phase。** 投影 `active／paused／blocked／complete` 与 blocked reason；绝不发明 `armed／disarmed` activation。严格 revision／transition fold 准入状态 fact；畸形 change 保持 Protocol／Raw。
4. **Goal continuation is Protocol context.** A valid source-kind Goal user message remains non-human Protocol evidence with exact goalId／revision／round and model-visible content. It may advance adapter-local fold validation, but is not merged into a state event or human transcript. / **Goal continuation 属于 Protocol context。** 有效 source-kind Goal user message 保持为非人类 Protocol 证据，携带精确 goalId／revision／round 与模型可见 content。它可以推进 adapter 本地 fold validation，但不合并进状态 event 或人类 transcript。
5. **Todo cleanly qualifies as `plan_update`.** One valid `todo/write` snapshot becomes one Main `plan_update` event, uses the existing source-neutral plan facet/renderer, carries the complete ordered `planSnapshot`, and invents no item IDs. The adjacent `todo_write` operation stays separate. / **Todo 清晰符合 `plan_update`。** 每条有效 `todo/write` 快照成为一条 Main `plan_update` event，复用既有来源中立 plan facet／renderer，携带完整有序 `planSnapshot`，且不发明 item ID。相邻 `todo_write` operation 保持分离。

## Architecture-pressure log / 架构压力记录

| Finding / 发现 | Upstream + real evidence / 上游＋真实证据 | Existing abstraction / 既有抽象 | Mismatch / 不匹配 | Adapter-local solution / adapter 本地方案 | Shared change required? / 需要共享修改？ | Severity / 严重性 | Disposition / 处置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Retry is scheduling/start, not completion / Retry 是 schedule／start 而非完成 | Source explicit; real 5 paired / 源码明确；真实五对 | Protocol lifecycle/status / Protocol 生命周期／status | Generic success wording would lie / 通用 success 文案会失真 | Group exact IDs; lifecycle-only status / 按精确 ID 归组；只给生命周期 status | No / 否 | High / 高 | M1 adapter-owned Detail and labels / M1 adapter 自有 Detail 与 label |
| Goal state versus tool operation / Goal 状态与工具 operation | Real rows inside intervals but no callId / 真实 row 位于区间内但无 callId | Tool pairing + canonical Goal / 工具配对＋canonical Goal | Adjacency tempts false composite / 相邻容易诱发虚假 composite | Separate events and Raw owners / 分离 event 与 Raw owner | No / 否 | High / 高 | Never correlate temporally / 永不按时间关联 |
| Durable phase versus activation / 持久 phase 与 activation | Source says activation process-local / 源码说明 activation 仅进程本地 | Goal status vocabulary / Goal status vocabulary | `active` could be mistaken for armed / `active` 可能被误作 armed | Expose durable phase only / 只暴露持久 phase | No / 否 | High / 高 | Explicit Detail note; no activation field / Detail 明示；无 activation 字段 |
| Goal continuation versus human message / Goal continuation 与人类消息 | Source attribution exact; real 0/6 / 源码归因精确；真实 0／6 | Human append-origin contract / 人类 append-origin 契约 | Wire role is user but origin is Goal policy / wire role 为 user，但 origin 是 Goal policy | Protocol context with attribution / 带归因的 Protocol context | No / 否 | High / 高 | Source-only fixture; never increment human count / 仅源码 fixture；绝不增加 human count |
| Todo whole snapshot versus plan abstraction / Todo 全量快照与 plan 抽象 | Source complete replacement; real 3 / 源码完整替换；真实三条 | Canonical `plan_update` + `planSnapshot` / canonical `plan_update`＋`planSnapshot` | No stable IDs or deltas / 无稳定 ID 或 delta | Ordered snapshot steps only / 只保留有序 snapshot step | No / 否 | Medium / 中 | Reuse plan facet/renderer exactly / 精确复用 plan facet／renderer |
| Todo state versus tool call / Todo 状态与工具 call | Real interval, no identity / 真实区间、无 identity | Exact tool call/result pairing / 精确工具 call／result 配对 | Composite would duplicate/steal Raw evidence / composite 会重复／夺取 Raw 证据 | Separate state and operation events / 分离状态与 operation event | No / 否 | High / 高 | No temporal merge / 不按时间合并 |
| Live Todo projection resets next turn / Live Todo projection 在下一 turn 重置 | Current `src/index.ts`; real writes one turn / 当前源码；真实 write 位于单 turn | Historical plan-update timeline / 历史 plan-update timeline | “Latest forever” would overstate current state / “永久最新”会夸大当前状态 | Preserve every event; only claim standing-turn current value / 保留每条 event；只声明 standing-turn 当前值 | No / 否 | Medium / 中 | Test reset semantics if exposing current projection / 若暴露当前 projection 则测试 reset 语义 |

## Milestones / 里程碑

- [x] M0 — verify accepted baseline/current upstream and complete focused structural source/real mapping. / 核验已接受基线／当前上游，并完成聚焦结构源码／真实映射。
- [x] M1 — implement grouped retry Protocol lifecycle, source-backed synthetic fixture, Detail, parity/freshness/fallback tests, and real five-pair replay gate. / 实现 grouped retry Protocol 生命周期、源码支撑合成 fixture、Detail、parity／freshness／fallback 测试及真实五对 replay 门禁。
- [ ] M2 — implement strict durable Goal fold, independent Main Goal events, Protocol continuation attribution, structured Detail, and Codex Goal regression gate. / 实现严格持久 Goal fold、独立 Main Goal event、Protocol continuation 归因、结构化 Detail 与 Codex Goal 回归门禁。
- [ ] M3 — implement strict Todo snapshot admission as Main `plan_update`, existing plan facet/renderer Detail, no item identity/call merge, and real three-snapshot gate. / 实现严格 Todo 快照准入为 Main `plan_update`、复用既有 plan facet／renderer Detail、不创建 item identity／call merge，并完成真实三快照门禁。
- [ ] M4 closeout — replay all six artifacts, run all applicable local gates, push remote CI, record exact results, and stop without starting deferred families. / 重放六份工件，运行全部适用本地门禁，push 远程 CI，记录精确结果，并在不启动推迟 family 的情况下停止。

## Fixture policy / Fixture 策略

- Committed tests never read `tmp/dsh-real-sessions`; real prompt/objective/Todo/failure text, local paths, source, output, and credentials must not enter fixtures/docs. / 已提交测试绝不读取 `tmp/dsh-real-sessions`；真实 prompt／objective／Todo／failure 文本、本地路径、源码、输出与 credential 不得进入 fixture／文档。
- Add the smallest sanitized format-v0 physical fixtures, labeled separately as real-shape structural derivation or current-source-only cases. Preserve byte-exact JSONL through `.gitattributes`. / 增加最小脱敏 format-v0 物理 fixture，分别标明真实 shape 结构派生或仅当前源码 case；通过 `.gitattributes` 保持逐字节精确 JSONL。
- Retry fixture covers paired real style, schedule-only, normal/always, sequential numbering, and malformed identity. Goal fixture covers every source-backed operation/phase, blocked reason, clear, revision fold, continuation attribution, and malformed fallback. Todo fixture covers replacement/empty/parallel-active/malformed shapes without stable IDs. / Retry fixture 覆盖真实风格配对、仅 schedule、normal／always、连续编号与畸形 identity。Goal fixture 覆盖各源码支撑 operation／phase、blocked reason、clear、revision fold、continuation 归因与畸形回退。Todo fixture 覆盖 replacement／empty／并行 active／畸形 shape，且无稳定 ID。

## Validation contract / 验证契约

After each milestone run its focused tests and affected contract/facet suites. Closeout must run all DeepSeek tests; source-adapter contract/conformance; Codex/Claude Goal/plan regressions affected by reuse; full Node; `release:check`; browser because Goal/Todo/Detail are user-visible; package smoke; read-only six-artifact replay; `git diff --check`; and remote CI after push. Report PASS／FAIL／NOT RUN exactly, including any transient rerun history. / 每个里程碑后运行其聚焦测试与受影响 contract／facet suite。收尾必须运行全部 DeepSeek 测试、source-adapter contract／conformance、受复用影响的 Codex／Claude Goal／plan 回归、完整 Node、`release:check`、因 Goal／Todo／Detail 用户可见而运行 browser、package smoke、六工件只读 replay、`git diff --check`，并在 push 后运行远程 CI。精确报告 PASS／FAIL／NOT RUN，包括任何瞬时重跑历史。

Real replay must prove: exactly five retry lifecycle projections in the Minimal evidence Session; exactly two Goal and three Todo state projections in the Standard evidence Session; zero false Phase 2C projections elsewhere; PTC remains 12 outer／35 nested; marker-only resumes retain ordinary Main history; no Raw ownership collisions or Phase 2B workflow regression. / 真实 replay 必须证明：Minimal 证据 Session 恰有五条 retry 生命周期投影；Standard 证据 Session 恰有两条 Goal 与三条 Todo 状态投影；其它 Session 零误投影；PTC 保持 12 outer／35 nested；仅 marker resume 保留普通 Main 历史；无 Raw ownership collision 或 Phase 2B workflow 回归。

## Commit discipline / 提交纪律

Prefer reviewable commits: (1) this plan + M0 evidence; (2) M1 retry; (3) M2 Goal; (4) M3 Todo; (5) validation/docs closeout. / 优先使用可评审提交：(1) 本计划＋M0 证据；(2) M1 retry；(3) M2 Goal；(4) M3 Todo；(5) 验证／文档收尾。

## Non-goals / 非目标

Do not implement approvals, permission/sandbox enrichment, hooks, command lifecycle, schedule, feedback, `plan/mode`, web-search auxiliary LLM request, compaction/prune, future formats, SQLite, Detail/Raw random access, image-bearing Code Mode result follow-up, or any other deferred family. / 不实现 approval、permission／sandbox 增强、hook、command 生命周期、schedule、feedback、`plan/mode`、web-search 辅助 LLM request、compaction/prune、未来格式、SQLite、Detail／Raw 随机访问、含图 Code Mode result follow-up 或其它推迟 family。

## Progress log / 进展记录

- 2026-08-23 (baseline): verified clean `support-dsh` at accepted archive head `9f7f0f264…`; no legitimate advancement required reconciliation. / 核验干净 `support-dsh` 位于已接受归档 head `9f7f0f264…`；无需对齐合法前进。
- 2026-08-23 (upstream): local checkout and official remote both remain clean/current at `b150a551…`, `0.1.1-rc.2`; inspected only requested retry/Goal/Todo modules. / 本地 checkout 与官方 remote 均保持 clean／current 于 `b150a551…`、`0.1.1-rc.2`；只检查指定 retry／Goal／Todo 模块。
- 2026-08-23 (focused corpus): scanned only Phase 2C families and nearby tool identities across six ignored artifacts. Recorded five real retry pairs, two Goal snapshots, three Todo snapshots, 0/6 Goal continuations, exact negative evidence elsewhere, and no durable state-to-call identity. / 只扫描六份 ignored 工件中的 Phase 2C family 与邻近工具 identity。记录五对真实 retry、两条 Goal snapshot、三条 Todo snapshot、0／6 Goal continuation、其它位置精确负面证据，以及不存在持久 state-to-call identity。
- 2026-08-23 (M1): added one byte-protected retry fixture plus grouped Protocol lifecycle and adapter-owned Detail. Exact retryId/provider/policy/turn/step/numbering governs admission; schedule-only stays `scheduled`, matching wait completion becomes `started`, neither becomes success, and malformed chains fall back row by row. New tests pass 3/3; combined DeepSeek/Phase 2A/2B/conformance passes 54/54. Read-only real replay yields exactly five lifecycle events, zero fallback, and unchanged 841 Main events in the evidence Session. Shared changes: none. / 新增一份受字节保护 retry fixture、grouped Protocol 生命周期与 adapter 自有 Detail。准入由精确 retryId／provider／policy／turn／step／numbering 决定；仅 schedule 保持 `scheduled`，匹配 wait 完成成为 `started`，两者都不成为 success，畸形 chain 逐 row 回退。新增测试 3／3 通过；DeepSeek／Phase 2A／2B／conformance 组合门禁 54／54 通过。只读真实 replay 在证据 Session 中精确得到五条 lifecycle、零 fallback，且 Main 仍为 841。共享修改：无。
