# Code Mode operation grouping / Code Mode 操作分组

## Goal-ready objective / 可直接用于 `/goal` 的目标

Build one evidence-backed Code Mode operation core from sanitized fixtures, then implement and compare two presentation candidates in separate worktrees: A as a composite Logical Event and B as a non-event group. Select and integrate one winner only after both satisfy identical grouping, status, traceability, counting, search, escalation, and browser evidence gates; then update the final bilingual product/design contract and archive this plan.

基于脱敏 fixture 构建一个有证据支持的 Code Mode 操作共享核心，然后在两个独立 worktree 中实现并比较两种呈现候选：A 为复合逻辑事件，B 为非事件 group。只有当两者满足完全相同的分组、状态、可追溯性、计数、搜索、提权和浏览器证据门禁后，才能选择并集成一个胜出方案；之后更新最终双语产品/设计 contract 并归档本计划。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: active; shared facts and both candidates are implemented and validated; explicit A/B selection is pending / 状态：进行中；共享事实与两个候选均已实现并通过验收；等待明确的 A/B 选型
- Started: 2026-07-14 / 开始日期：2026-07-14
- Related design: `docs/design-docs/code-mode-operations.md` / 相关设计：`docs/design-docs/code-mode-operations.md`
- Related investigation: `tmp/codex-schema-and-code-mode-investigation-2026-07-13.md` (local, gitignored evidence record) / 相关调查：`tmp/codex-schema-and-code-mode-investigation-2026-07-13.md`（本地、gitignored 证据记录）
- Deferred contract docs: `docs/product-specs/session-transcript-analyzer.md`, `docs/design-docs/logical-event-timeline.md` / 延后更新的 contract 文档：`docs/product-specs/session-transcript-analyzer.md`、`docs/design-docs/logical-event-timeline.md`

## Confirmed problem / 已确认问题

Current Codex sessions increasingly persist tool work as an outer Code Mode `exec`, optional pending cell, and one or more `wait` polls. The analyzer currently groups only by each outer call ID, so one user-meaningful operation appears as an `exec` tool event plus zero or more unrelated `wait` tool events. Nested patch, MCP, or web lifecycle rows can also become independent Logical Events, while nested shell activity often has no lifecycle row at all.

当前 Codex 会话越来越多地把工具工作持久化为外层 Code Mode `exec`、可选 pending cell 和一个或多个 `wait` poll。analyzer 当前只按各自外层 call ID 分组，因此一个对用户有意义的操作会显示为一个 `exec` 工具事件，再加零个或多个互不相关的 `wait` 工具事件。嵌套 patch、MCP 或 web 生命周期行还可能成为独立逻辑事件，而嵌套 shell 活动通常根本没有生命周期行。

The investigation found deterministic outer call/output and cell/wait identities, but no persisted public parent ID connecting every nested lifecycle event to an operation. It also found loops and `Promise.all` in multi-call JavaScript, pending cells without terminal waits, incomplete live tails, escalation arguments without separate approval events, and successful output that contains failure-like keywords. The implementation must preserve these uncertainties rather than collapse them into false execution facts.

调查发现，外层调用/输出和 cell/wait identity 可以确定性恢复，但没有持久化公开 parent ID 把每个嵌套生命周期事件连接到某个操作。调查还发现多调用 JavaScript 中存在循环与 `Promise.all`、pending cell 没有终态 wait、实时写入尾部不完整、提权 arguments 没有独立 approval event，以及成功输出中包含类似失败的关键字。实现必须保留这些不确定性，而不能把它们压扁成虚假的执行事实。

## Fixed decisions and invariants / 固定决策与不变量

1. There is one active plan and two experimental worktrees, not two competing plans. / 只有一个 active plan 和两个实验 worktree，不建立两个相互竞争的计划。
2. Fixtures and one shared operation core land and pass before the worktrees diverge. Both candidates consume that same core. / fixture 与一个共享操作核心必须先落盘并通过测试，随后 worktree 才能分叉；两个候选都消费同一个核心。
3. Candidate A is a composite Logical Event using existing `kind: other_tool_call`; candidate B is a non-event group. / 候选 A 是使用现有 `kind: other_tool_call` 的复合逻辑事件；候选 B 是非事件 group。
4. Neither candidate adds a new Logical Event kind. / 两个候选都不新增逻辑事件 kind。
5. Code Mode Operation outcome status is neutral. Observation state is a separate axis and never implies success or failure. / Code Mode 操作的结果状态保持中性；观测状态是独立轴，绝不暗示成功或失败。
6. Observed Nested Activity is associated only through one unique closed physical exec/wait call-output interval. No timestamp, tool-name, nested-ID-shape, JavaScript-text, or between-poll fallback is allowed. / 已观测嵌套活动只能通过一个唯一闭合的 exec/wait 调用-输出物理区间关联；不得使用 timestamp、工具名称、嵌套 ID 形态、JavaScript 文本或 poll 间隙兜底。
7. Operation `rawRefs` contain only outer exec and wait records. Nested `rawRefs` are never copied; detail links nested Logical Events through `eventRefs` (`event_refs` in decision shorthand). / 操作 `rawRefs` 只包含外层 exec 与 wait 记录。绝不复制嵌套 `rawRefs`；详情通过 `eventRefs`（决策简写为 `event_refs`）链接嵌套逻辑事件。
8. Tool metrics count one Code Mode Operation once, each Observed Nested Activity once, every wait zero times, and every Declared Nested Call zero times. / 工具指标对每个 Code Mode 操作计数一次、对每个已观测嵌套活动计数一次、对每个 wait 计数零次、对每个声明的嵌套调用计数零次。
9. Search owns outer JavaScript and exec/wait outputs once at the operation level; nested events keep their own search owner; `eventRefs` never duplicate text or hits. / 搜索把外层 JavaScript 与 exec/wait 输出在操作层只归属一次；嵌套事件保留自己的搜索 owner；`eventRefs` 绝不复制文本或命中。
10. The implementation never executes Code Mode JavaScript and never classifies failure, decline, or approval outcome by keyword. / 实现绝不执行 Code Mode JavaScript，也绝不通过关键字判定失败、拒绝或审批结果。
11. Product spec and `logical-event-timeline.md` stay unchanged until a winner is selected and explicitly accepted. / 产品规格与 `logical-event-timeline.md` 在胜出方案确定并明确获接受前保持不变。

## Worktree topology / Worktree 拓扑

The executor must use one shared-base branch plus two sibling worktrees created from the same verified shared-core commit:

执行者必须使用一个共享基础分支，并从同一个已验证共享核心 commit 创建两个平级 worktree：

```text
shared base: fixtures + CodeModeOperation core + representation-neutral tests
  |
  +-- worktree A: composite Logical Event adapter and UI/detail behavior
  |
  +-- worktree B: non-event group adapter and UI/detail behavior
```

Suggested branch/worktree labels are `experiment/code-mode-composite-event` and `experiment/code-mode-non-event-group`; exact filesystem paths are executor-local and must not be written into product code or fixtures. Do not copy implementation files manually between worktrees. Shared fixes belong on the shared base and must be applied equally before comparison; representation-specific code stays isolated until the decision.

建议的 branch/worktree 标签为 `experiment/code-mode-composite-event` 和 `experiment/code-mode-non-event-group`；具体文件系统路径由执行者本地决定，不得写入产品代码或 fixture。不要在 worktree 之间手工复制实现文件。共享修复应落在共享基础上，并在比较前同等应用到两个候选；呈现专属代码在决策前保持隔离。

## Required fixture matrix / 必需 fixture 矩阵

All fixtures must be synthetic, minimized, and sanitized. No real command, result, repository path, approval text, or transcript row may be committed.

所有 fixture 必须是合成、最小化且脱敏的。不得提交真实命令、结果、仓库路径、审批文本或转录行。

| Case / 场景 | Required evidence / 必需证据 |
|---|---|
| Direct terminal exec, no cell / 直接终态 exec，无 cell | One operation; terminal observed; neutral outcome; no waits / 一个操作；观测到终态；结果中性；无 wait |
| Pending exec then one terminal wait / Pending exec 后一次终态 wait | Exact cell linkage; one operation; wait count zero / 精确 cell 关联；一个操作；wait 计数为零 |
| Pending exec then multiple pending/terminal waits / Pending exec 后多次 pending/terminal wait | Ordered Poll Phases; only final observation is terminal / 有序轮询阶段；只有最终观测为终态 |
| Pending at transcript tail / 转录尾部 pending | `pending`, not failed or completed / `pending`，不是 failed 或 completed |
| Session continues/ends without terminal wait / 会话继续或结束但无终态 wait | `unobserved_terminal`, not failed / `unobserved_terminal`，不是 failed |
| Outer exec call without output at live tail / 实时尾部外层 exec 调用无输出 | `incomplete_tail`; no fabricated closed interval / `incomplete_tail`；不制造闭合区间 |
| Nested lifecycle wholly inside exec interval / 嵌套生命周期完整位于 exec 区间内 | Exactly one `eventRef`; nested raw refs stay on nested event / 恰好一个 `eventRef`；嵌套 raw refs 保留在嵌套事件 |
| Nested lifecycle wholly inside wait interval / 嵌套生命周期完整位于 wait 区间内 | Same unique association and ownership rules / 相同的唯一关联与所有权规则 |
| Lifecycle between polls, crossing boundaries, or ambiguous / 生命周期位于 poll 间隙、跨边界或有歧义 | No association / 不关联 |
| Multiple cells and non-overlapping intervals / 多 cell 与不重叠区间 | Stable independent operation identities / 稳定且独立的 operation identity |
| `require_escalated` text inside outer JavaScript / outer JavaScript 中的 `require_escalated` 文本 | Searchable source text only; no tag or approval outcome / 仅作为可搜索来源文本；无标签或审批结果 |
| Escalation/failure keywords in ordinary output / 普通输出含提权/失败关键字 | No escalation, failed status, or issue inference / 不推断提权、failed 状态或 issue |
| JavaScript loop, branch, and `Promise.all` call sites / JavaScript 循环、分支与 `Promise.all` 调用位置 | Remain only in the original JavaScript; no extracted event, summary, or runtime count / 只保留在原始 JavaScript 中；不提取事件、摘要或运行时计数 |
| Direct tool call adjacent to Code Mode / 直接工具调用与 Code Mode 相邻 | Direct call remains independent / 直接调用保持独立 |

## Execution phases / 执行阶段

### Phase 0: freeze source facts with fixtures / 第零阶段：用 fixture 冻结来源事实

1. Add the complete sanitized matrix before changing logical presentation. / 在改变逻辑呈现前增加完整脱敏矩阵。
2. Assert raw parsing retains outer call IDs, cell IDs, wait arguments, physical line identity, JavaScript, outputs, and unknown fields. / 断言 raw parsing 保留外层 call ID、cell ID、wait arguments、物理行 identity、JavaScript、输出和未知字段。
3. Add red expectations for current incorrect behavior: standalone waits, pending-as-completed, duplicated counting/search ownership, and missing operation association. / 为当前错误行为增加红灯预期：独立 waits、把 pending 当完成、重复计数/搜索归属，以及缺失操作关联。
4. Keep schema ordinal/turn-metadata fixture work separate unless a fixture row needs it solely to prove source identity remains physical-line based. / schema ordinal/turn-metadata fixture 工作继续分开；只有当某行必须用它证明 source identity 仍基于物理行时才纳入。

### Phase 1: implement the shared core / 第一阶段：实现共享核心

1. Add a representation-neutral module, expected near `src/codex-code-mode.js`, that discovers outer exec operations, pairs outputs, follows exact cell waits, and computes observation state. / 增加呈现中立模块，预计位于 `src/codex-code-mode.js` 附近，用于发现外层 exec 操作、配对输出、跟随精确 cell waits 并计算观测状态。
2. Build closed physical intervals only from exact call/output pairs. Associate nested lifecycle events only when their full raw ownership falls inside one unique interval. / 只从精确调用/输出 pair 构建闭合物理区间；只有嵌套生命周期事件的全部 raw 所有权位于一个唯一区间内时才关联。
3. Produce stable operation IDs, operation-owned refs, ordered Poll Phases, `eventRefs`, and deduplicated searchable text. Keep declared calls inside original JavaScript only. / 生成稳定 operation ID、操作自有 refs、有序轮询阶段、`eventRefs` 和去重搜索文本；声明调用只保留在原始 JavaScript 中。
4. Keep outcome status neutral and return observation state separately. Do not reuse generic tool “has output means completed” logic. / 保持结果状态中性，并单独返回观测状态；不得复用通用工具“有 output 就 completed”逻辑。
5. Land focused unit tests for the shared core and run the full Node suite before creating A/B branches. / 为共享核心落盘聚焦单元测试，并在创建 A/B branch 前运行完整 Node 测试套件。

### Phase 2: fork the two presentations / 第二阶段：分叉两种呈现

Create both worktrees from the exact same shared-core commit. Record the common commit in this plan's progress log before candidate work begins.

从完全相同的共享核心 commit 创建两个 worktree。在候选工作开始前，把共同 commit 记录到本计划进度日志。

**Worktree A — composite Logical Event / Worktree A——复合逻辑事件**

- Adapt each operation to one Main Timeline `other_tool_call` event with `subtype: code_mode_operation` and `toolName: exec`; add no kind. / 把每个操作适配为一个 Main Timeline `other_tool_call` 事件，使用 `subtype: code_mode_operation` 与 `toolName: exec`；不新增 kind。
- Use empty/neutral outcome status and normal severity; expose observation state only in Code Mode detail. / 使用空/中性结果状态和 normal severity；观测状态只在 Code Mode 详情中暴露。
- Operation raw refs include outer exec and waits only; detail `eventRefs` link nested events. / 操作 raw refs 只包含外层 exec 和 waits；详情 `eventRefs` 链接嵌套事件。
- Keep associated nested Logical Events independently visible, searchable, filterable, and countable. / 让已关联嵌套逻辑事件继续独立可见、可搜索、可筛选、可计数。

**Worktree B — non-event group / Worktree B——非事件 group**

- Do not emit a Logical Event for the operation. Add a stable group/container that owns outer exec/wait presentation, operation search identity, and one operation metric contribution. / 不为操作发出逻辑事件；增加稳定 group/container，负责外层 exec/wait 呈现、操作搜索 identity 和一次操作指标贡献。
- Expose the same observation state, operation-owned raw refs, detail `eventRefs`, and original JavaScript/output evidence as A. / 暴露与 A 相同的观测状态、操作自有 raw refs、详情 `eventRefs` 和原始 JavaScript/output 证据。
- Render child events for the outer exec, every wait Poll Phase, and every associated nested Logical Event. Wait children remain inspectable but contribute zero tool-call metrics. / 为 outer exec、每个 wait 轮询阶段和每个已关联 nested Logical Event 渲染子事件；wait 子项保持可检查，但贡献零次工具调用指标。
- Add only the minimum API/browser grouping shape needed to compare usability; do not silently turn the group into a new event kind. / 只增加比较可用性所需的最小 API/browser group 形态；不得把 group 偷偷变成新 event kind。

### Phase 3: run the symmetric decision gate / 第三阶段：运行对称决策门

For both worktrees, capture a machine-readable evidence table for every fixture:

对两个 worktree，都要为每个 fixture 记录机器可读证据表：

- operation ID and ordered outer/poll raw lines / operation ID 与有序 outer/poll raw 行
- observation state and neutral outcome surface / 观测状态与中性结果表面
- associated nested event IDs and proof that nested raw refs were not copied / 已关联 nested event ID，以及嵌套 raw refs 未被复制的证明
- tool-call counts: operation once + each nested once + waits zero / 工具调用计数：operation 一次 + 每个 nested 一次 + waits 零次
- exact search owner IDs and counts for JavaScript-only, poll-output-only, nested-only, and overlapping queries / JavaScript-only、poll-output-only、nested-only 和重叠 query 的精确搜索 owner ID 与计数
- proof that outer JavaScript escalation text remains searchable without approval/failure inference / outer JavaScript 提权文本保持可搜索、且不产生审批/失败推断的证明
- timeline/detail/Raw refs navigation result / timeline/detail/Raw refs 导航结果

Both candidates must pass the same unit, integration, browser, build, and package gates. A candidate that requires changing shared facts fails the comparison; move the necessary correction to the shared base, update fixtures, and rerun both.

两个候选必须通过相同的单元、集成、浏览器、构建和 package 门禁。任何需要改变共享事实的候选都视为比较失败；应把必要修正移到共享基础、更新 fixture，并重新运行两者。

### Phase 4: choose and integrate one winner / 第四阶段：选择并集成一个胜出方案

1. Compare readability, detail traceability, search/navigation fit, API/schema cost, folding/filter behavior, pagination, and implementation risk using the recorded evidence. / 使用已记录证据比较可读性、详情可追溯性、搜索/导航适配、API/schema 成本、折叠/筛选行为、分页和实现风险。
2. Record the explicit A/B decision and rejected candidate rationale in `docs/design-docs/code-mode-operations.md` and this plan. / 在 `docs/design-docs/code-mode-operations.md` 和本计划中记录明确 A/B 决策及未胜出候选的理由。
3. Integrate only the winner onto the main implementation line; remove experimental-only adapter code and tests that do not describe the accepted contract. / 只把胜出方案集成到主实现线；移除不描述已接受 contract 的实验专属 adapter 代码和测试。
4. Only now update `docs/product-specs/session-transcript-analyzer.md` and `docs/design-docs/logical-event-timeline.md` bilingually with the selected user-visible and canonical DTO behavior. / 只有此时才能根据选定的用户可见与 canonical DTO 行为，同步双语更新 `docs/product-specs/session-transcript-analyzer.md` 和 `docs/design-docs/logical-event-timeline.md`。
5. Update README/CHANGELOG only if the selected behavior changes documented user workflows or release-visible behavior. / 只有当选定行为改变已记录用户流程或 release-visible 行为时，才更新 README/CHANGELOG。

### Phase 5: final validation and archive / 第五阶段：最终验证与归档

1. Rebuild generated assets and run every final gate in the integrated winner state. / 在已集成胜出方案的状态下重建生成资源并运行所有最终门禁。
2. Perform in-app browser acceptance on sanitized fixtures, then read-only real-project acceptance covering at least one direct-complete operation, one multi-wait operation, one nested lifecycle association, and one unobserved/incomplete case if available. Never record sensitive bodies. / 先对脱敏 fixture 执行内置浏览器验收，再对真实项目执行只读验收，至少覆盖一个直接终态操作、一个 multi-wait 操作、一个 nested lifecycle 关联，以及一个可用的 unobserved/incomplete 场景。绝不记录敏感正文。
3. Record exact test counts, selected representation, retained limitations, and real-project structural evidence in the completion summary. / 在完成总结中记录精确测试数、选定呈现、保留限制和真实项目结构证据。
4. Move this plan to `completed/` and update `AGENTS.md` only after every completion gate passes. / 只有全部完成门禁通过后，才把本计划移到 `completed/` 并更新 `AGENTS.md`。

## Test requirements / 测试要求

- Shared-core tests must be presentation-neutral and directly cover every fixture matrix row. / 共享核心测试必须与呈现无关，并直接覆盖 fixture 矩阵每一行。
- Logical/detail tests must assert exact raw ownership and `eventRefs`, not only rendered labels. / logical/detail 测试必须断言精确 raw 所有权和 `eventRefs`，不能只断言渲染 label。
- Search tests must assert exact owner IDs/counts and prove wait/nested text is not duplicated into multiple owners. / 搜索测试必须断言精确 owner ID/计数，并证明 wait/nested 文本没有复制进多个 owner。
- Metrics tests must prove `1 operation + N observed nested + 0 waits + 0 declared calls`. / 指标测试必须证明 `1 operation + N observed nested + 0 waits + 0 declared calls`。
- Status/filter tests must prove every observation state stays outcome-neutral and nested failures do not roll up. / 状态/筛选测试必须证明每种观测状态都保持结果中性，且嵌套失败不会向上汇总。
- Escalation tests must prove outer JavaScript text remains searchable without a tag. A positive structured nested-request fixture is evidence-gated and deferred until a real or upstream-backed Code Mode shape exists. / 提权测试必须证明 outer JavaScript 文本保持可搜索但不产生标签；结构化 nested request 的正向 fixture 受证据门控，延后到出现真实或有上游依据的 Code Mode 形态。
- Browser tests must cover operation selection, nested event-ref traversal, Raw refs, folding, search next/previous, pagination, filters, and both locales. / 浏览器测试必须覆盖操作选择、nested event-ref 遍历、Raw refs、折叠、搜索 next/previous、分页、筛选和两种 locale。
- At least one regression must assert that static loop/branch call sites create no additional events or counts. / 至少一个回归必须断言静态循环/分支调用位置不会创建额外事件或计数。

## Completion gates / 完成门禁

The executor must not mark the goal complete, archive this plan, or report the feature as shipped until all gates pass in the final integrated winner state.

在最终集成的胜出方案状态下所有门禁通过前，执行者不得把目标标为完成、归档本计划或报告功能已交付。

1. The complete sanitized fixture matrix and shared operation core landed before A/B divergence, and the common base commit is recorded. / 完整脱敏 fixture 矩阵和共享操作核心在 A/B 分叉前落盘，并已记录共同 base commit。
2. Both candidates were implemented in separate worktrees from that same commit and evaluated with identical tests/evidence. / 两个候选从同一 commit 在独立 worktree 实现，并用相同测试/证据评估。
3. The winner and rejected-candidate rationale are recorded bilingually; no hybrid representation remains accidentally. / 胜出方案与未胜出候选理由已双语记录；没有意外残留混合呈现。
4. No new Logical Event kind exists. / 没有新增逻辑事件 kind。
5. Observation and outcome remain separate; Code Mode operations are outcome-neutral; no keyword-based failure/approval classification exists. / 观测与结果保持分离；Code Mode 操作结果中性；不存在基于关键字的失败/审批分类。
6. Unique physical-interval association is the only nested parent inference, and ambiguous/cross-boundary cases remain unassociated. / 唯一物理区间关联是仅有的 nested parent 推断；歧义/跨边界场景保持未关联。
7. Operation raw refs exclude nested raw refs; detail `eventRefs` are traversable; no source row, metric, or search text is duplicated through the relation. / 操作 raw refs 排除嵌套 raw refs；详情 `eventRefs` 可遍历；没有来源行、指标或搜索文本通过该关系被复制。
8. Tool metrics equal operation once + each Observed Nested Activity once + waits zero; Declared Nested Calls remain zero. / 工具指标等于 operation 一次 + 每个已观测嵌套活动一次 + waits 零次；声明的嵌套调用保持零次。
9. Product spec and `logical-event-timeline.md` were changed only after winner acceptance and now describe the same final behavior in English and Chinese. / 产品规格与 `logical-event-timeline.md` 只在胜出方案获接受后修改，且中英文描述同一最终行为。
10. `npm run build`, `npm run build:check`, `npm test`, full `npm run test:browser`, `npm run test:package`, and `git diff --check` all pass. / `npm run build`、`npm run build:check`、`npm test`、完整 `npm run test:browser`、`npm run test:package` 和 `git diff --check` 全部通过。
11. Focused Code Mode unit and browser groups pass twice after the full suites to detect order or async flakiness. / 完整套件后，聚焦 Code Mode 单元与浏览器组连续通过两次，以发现顺序或异步 flaky。
12. Sanitized-fixture and read-only real-project acceptance evidence is recorded without sensitive JavaScript, commands, results, or transcript content. / 已记录脱敏 fixture 与真实项目只读验收证据，且不包含敏感 JavaScript、命令、结果或转录内容。

## Files likely to change / 可能变更的文件

- `src/codex-source.js`: retain/expose any bounded structured fields required by operation grouping. / 保留/暴露操作分组所需的受限结构化字段。
- `src/codex-code-mode.js` (expected new shared module): operation grouping, cell/wait chaining, observation state, physical intervals, association, and operation search ownership. / （预计新增共享模块）操作分组、cell/wait 链、观测状态、物理区间、关联和操作搜索归属。
- `src/codex-logical.js`, `src/codex-detail.js`, `src/codex-search.js`, and `src/codex.js`: candidate adapters, detail event refs, counting/search integration, and public assembly. / 候选 adapter、详情 event refs、计数/搜索集成和公开组装。
- `src/browser/` and `src/shared/i18n.js`: selected presentation, nested navigation, status labels if needed, and bilingual UI. / 选定呈现、nested 导航、必要的状态 label 和双语 UI。
- `test/fixtures/`, focused `test/codex-code-mode.test.js`, existing Codex unit/integration tests, and `e2e/browser.test.js`: sanitized matrix and symmetric candidate evidence. / 脱敏矩阵和对称候选证据。
- `public/assets/app.js`: generated only through the build after winner integration. / 只在胜出方案集成后通过构建生成。
- Final bilingual product/design docs after the decision, plus this plan's decision and completion logs. / 决策后的最终双语产品/设计文档，以及本计划的决策与完成日志。

## Risks and prohibited shortcuts / 风险与禁止捷径

- **Prohibited:** execute JavaScript, use `eval`, invoke project Node/V8, or simulate branches to infer nested execution. / **禁止：**执行 JavaScript、使用 `eval`、调用项目 Node/V8，或模拟分支来推断嵌套执行。
- **Prohibited:** count regex/AST call sites as executions or fabricate per-call outputs. / **禁止：**把 regex/AST 调用位置计为执行，或制造逐调用输出。
- **Prohibited:** infer failure, decline, approval, or permission outcome from keywords in arbitrary text. / **禁止：**根据任意文本关键字推断失败、拒绝、审批或权限结果。
- **Prohibited:** copy nested `rawRefs` or search text into the operation, then deduplicate only in UI or counters. / **禁止：**把嵌套 `rawRefs` 或搜索文本复制进操作后，只在 UI 或计数器层去重。
- **Prohibited:** associate lifecycle events by timestamp proximity, tool-name match, ID prefix, or position between closed poll intervals. / **禁止：**按 timestamp 接近度、工具名称匹配、ID 前缀或闭合 poll 区间之间的位置关联生命周期事件。
- **Prohibited:** modify product spec or logical timeline early so one experiment appears contractually preferred. / **禁止：**提前修改产品规格或逻辑时间线，使某一实验看似在 contract 上更受偏好。
- **Risk:** candidate B may expose that search and pagination currently assume every owner is a Logical Event. Treat this as comparison evidence, not permission to create a disguised event kind. / **风险：**候选 B 可能暴露搜索与分页当前假定每个 owner 都是逻辑事件。应把它视为比较证据，而不是创建伪装 event kind 的许可。
- **Risk:** real transcripts can evolve while the experiment runs. New shapes require fixture review through the schema runbook before changing shared semantics. / **风险：**实验期间真实转录可能继续演化。新形态必须先通过 schema runbook 的 fixture 审查，再改变共享语义。

## Progress log / 进度日志

- 2026-07-14: Converted the local Code Mode investigation into a bilingual proposed design and this single active A/B execution plan. Fixed the shared semantics, fixture-first/shared-core-first order, two-worktree decision gate, and the deliberate deferral of product-spec and logical-timeline changes. No runtime code, fixture, product spec, or logical timeline was changed. / 2026-07-14：把本地 Code Mode 调查转化为双语提议设计和这个单一 active A/B 执行计划。固定了共享语义、fixture-first/shared-core-first 顺序、双 worktree 决策门，以及有意延后产品规格和逻辑时间线变更的安排。尚未修改运行时代码、fixture、产品规格或逻辑时间线。
- 2026-07-14: Added the representation-neutral `codex-code-mode` projection and five sanitized JSONL fixtures. Focused tests cover exact call/cell matching, known output envelopes, multi-wait ordering, EOF pending, explicit-boundary unobserved terminal, parallel/orphan ambiguity, same-file closed spans, and outer-JavaScript escalation text as a negative case. Main-thread validation passed 192/192 tests before A/B divergence. / 2026-07-14：增加了呈现中立的 `codex-code-mode` 投影和五份脱敏 JSONL fixture。聚焦测试覆盖精确 call/cell 匹配、已知 output envelope、multi-wait 顺序、EOF pending、明确边界后的 unobserved terminal、并行/orphan 歧义、同文件闭合区间，以及 outer JavaScript 提权文本负例。A/B 分叉前主线程验收通过 192/192 项测试。
- 2026-07-14: Shared-core commit `128a24a` (`feat: add Code Mode operation shared model`) is the immutable implementation base for both presentation candidates. / 2026-07-14：共享核心提交 `128a24a`（`feat: add Code Mode operation shared model`）是两个呈现候选共同且不可变的实现基础。
- 2026-07-14: Created `G:\vibe\session-analyzer-code-mode-a` on `spike/code-mode-composite-event` and `G:\vibe\session-analyzer-code-mode-b` on `spike/code-mode-group-container`, both directly from `128a24a`. Candidate implementation began under separate subagent ownership. / 2026-07-14：从 `128a24a` 直接创建 `G:\vibe\session-analyzer-code-mode-a`（`spike/code-mode-composite-event`）和 `G:\vibe\session-analyzer-code-mode-b`（`spike/code-mode-group-container`）；两个候选已由不同 subagent 独立开始实现。
- 2026-07-15: Independent review exposed ambiguous duplicate outer call IDs, diverging candidate-owned association logic, filtered `eventRefs` navigation, and B-specific search, metrics, ordering, pagination, project-target, and i18n defects. Representation-neutral raw/search/event-ref facts were centralized in shared commit `dc6b177` (`feat: centralize Code Mode operation facts`). Main, A, and B use a byte-identical `src/codex-code-mode-facts.js` (`SHA-256 3CE3DB2F...309977`). Duplicate outer calls now contribute one operation each while an ambiguous output creates no third event or owner. / 2026-07-15：独立 review 发现了歧义 duplicate outer call ID、候选各自维护关联事实、筛选后的 `eventRefs` 无法导航，以及 B 专属的搜索、指标、顺序、分页、项目目标和 i18n 缺陷。呈现中立的 raw/search/event-ref 事实已集中到共享提交 `dc6b177`（`feat: centralize Code Mode operation facts`）。主线、A、B 使用逐字节一致的 `src/codex-code-mode-facts.js`（`SHA-256 3CE3DB2F...309977`）。duplicate outer call 现在各贡献一次 operation，歧义 output 不再产生第三个事件或 owner。
- 2026-07-15: Candidate A landed as `e77d825` (`feat: prototype Code Mode composite events`). It emits one neutral `other_tool_call/code_mode_operation` event, consumes associated waits, keeps nested events independent, and supports filtered event-ref temporary reveal with coherent Back/history cleanup. Main-thread validation passed 201/201 unit tests, 50/50 full browser tests, build/build-check, package, focused regressions, and diff checks. / 2026-07-15：候选 A 已提交为 `e77d825`（`feat: prototype Code Mode composite events`）。它发出一条中性的 `other_tool_call/code_mode_operation` 事件，消费关联 waits，保持 nested events 独立，并支持筛选外 event-ref 的临时揭示及一致的 Back/history 清理。主线程验收通过 201/201 单元测试、50/50 完整浏览器测试、build/build-check、package、聚焦回归与 diff 检查。
- 2026-07-15: Candidate B landed as `d06f4a5` (`feat: prototype Code Mode grouped operations`). The operation remains outside `logicalEvents`; raw-identity phase children are grouped without changing global event order, waits contribute zero, operation metrics belong to stable group IDs, soft pagination uses `nextOffset`, and project/session search materializes group targets under the same structural filters as A. Main-thread validation passed 204/204 unit tests, 51/51 full browser tests including the B-specific flow, build/build-check, package, focused regressions, and diff checks. / 2026-07-15：候选 B 已提交为 `d06f4a5`（`feat: prototype Code Mode grouped operations`）。operation 继续位于 `logicalEvents` 之外；按 raw identity 构造的 phase children 在不改变全局事件顺序的前提下分组，wait 贡献零次，operation 指标归属于稳定 group ID，软分页使用 `nextOffset`，project/session 搜索在与 A 相同的结构筛选下物化 group target。主线程验收通过 204/204 单元测试、51/51 完整浏览器测试（含 B 专属流程）、build/build-check、package、聚焦回归与 diff 检查。
- 2026-07-15: Three-run read-only cold-start medians on the evolving local corpus were baseline 8.14 s / 989 MiB peak RSS, A 8.32 s / 984 MiB, and B 9.35 s / 997 MiB. These are directional rather than threshold results because the corpus changed during measurement; A is close to baseline while B pays measurable group-sidecar cost. No sensitive bodies were recorded. / 2026-07-15：在持续变化的本地 corpus 上执行三次只读冷启动，中位数分别为 baseline 8.14 秒 / 峰值 RSS 989 MiB、A 8.32 秒 / 984 MiB、B 9.35 秒 / 997 MiB。由于测量期间 corpus 持续变化，这些数据只表示方向、不作为硬阈值；A 接近 baseline，B 存在可测的 group-sidecar 成本。未记录任何敏感正文。
- 2026-07-15: Playwright acceptance against a one-session sanitized corpus confirmed identical tool metrics (`2 operations + patch + MCP`, waits zero), direct and multi-wait observation summaries, preserved interleaved-event order, localized group/detail text, and traversable nested refs. Candidate servers remain available locally at `http://127.0.0.1:17891` (A) and `http://127.0.0.1:17892` (B) for explicit selection. Final review has no open findings. Product spec and `logical-event-timeline.md` remain unchanged until that selection. / 2026-07-15：针对单 session 脱敏 corpus 的 Playwright 验收确认了相同的工具指标（`2 operations + patch + MCP`，wait 为零）、直接与 multi-wait 观测摘要、穿插事件顺序保持、分组/详情双语文本以及可遍历 nested refs。候选服务器继续在本地 `http://127.0.0.1:17891`（A）与 `http://127.0.0.1:17892`（B）提供明确选型体验。最终 review 无未解决 finding。在选型前，产品规格与 `logical-event-timeline.md` 继续保持不变。
