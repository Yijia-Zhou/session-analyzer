# Claude pointer fork context / Claude 指针式分叉上下文

## Objective / 目标

Recognize Claude Code background `/fork` Sessions whose child transcript stores only a pointer-era continuation shell, reconstruct the exact parent ancestry visible at the fork point, and present that Inherited Session Context without copying parent Raw Records into the child or changing child/project metrics and search ownership. / 识别 Claude Code 后台 `/fork` 产生、子转录只保存 pointer-era continuation shell 的会话；重建分叉点可见的精确父会话 ancestry，并在不把父会话原始记录复制进 child、不改变 child／项目指标和搜索 ownership 的前提下展示该继承会话上下文。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-07-31 / 开始日期：2026-07-31
- Completed: 2026-07-31 / 完成日期：2026-07-31
- Target release: `0.1.3` / 目标版本：`0.1.3`
- Related context: `CONTEXT.md` / 相关上下文：`CONTEXT.md`
- Related product spec: `docs/product-specs/session-transcript-analyzer.md` / 相关产品规格：`docs/product-specs/session-transcript-analyzer.md`
- Related design: `docs/design-docs/transcript-source-adapters.md` / 相关设计：`docs/design-docs/transcript-source-adapters.md`
- Research sample: local, uncommitted `tmp/claude-session-transcripts/<sanitized-session>.jsonl`; the source session identifier is intentionally omitted from the public record. / 研究样本：本地未提交的 `tmp/claude-session-transcripts/<sanitized-session>.jsonl`；公开记录有意省略来源 session identifier。

## Evidence baseline / 证据基线

The child file contains only `ai-title` and `agent-name`. Its parent Session records an exact `/fork` local command followed by a UUID-linked `session waiting for a prompt · … · <source-session-prefix>` stdout row. Claude Code 2.1.121 changed forks from full transcript copies to read-time pointer hydration, and the 2.1.212 background-fork behavior leaves the new Session waiting for a prompt while the original terminal continues. Following the command's `parentUuid` in the sample yields 19 parent Raw Records represented by 8 Main and 8 Protocol events after local-command envelopes are classified as runtime evidence; the next prompt remains on the parent branch. / Child 文件只包含 `ai-title` 与 `agent-name`。其父会话记录了精确的 `/fork` local command，随后是通过 UUID 关联的 `session waiting for a prompt · … · <source-session-prefix>` stdout 行。Claude Code 2.1.121 把 fork 从完整转录复制改为读取时 pointer hydration，2.1.212 的后台 fork 行为则让新会话等待 prompt，同时原终端继续工作。把 local-command envelope 归类为运行时证据后，沿样本中 command 的 `parentUuid` 可得到 19 条父会话原始记录，对应 8 个 Main 与 8 个 Protocol 事件；下一条 prompt 仍留在父分支。

## Implementation phases / 实施阶段

1. Add fail-closed pointer-fork correlation from exact command/output UUID evidence and a unique same-container source-session prefix. / 根据精确 command／output UUID 证据与同一容器内唯一的来源会话前缀，增加 fail-closed 指针式分叉关联。
2. Reconstruct the source ancestry at the fork point and expose bounded display-only event previews with explicit parent ownership. / 重建分叉点的来源 ancestry，并以明确的父会话 ownership 暴露有界、仅展示的事件预览。
3. Show pointer mode, waiting-for-prompt state, counts, previews, fork point, and parent navigation in the bilingual browser UI. / 在双语浏览器 UI 中展示 pointer 模式、等待 prompt 状态、计数、预览、分叉点与父会话导航。
4. Lock behavior with synthetic tests, rebuild generated assets, and repeat full and real-corpus validation. / 使用合成测试锁定行为，重建生成资产，并重复完整验证与真实语料验证。

## Acceptance criteria / 验收标准

1. A title suffix alone never creates a relationship; missing, duplicate, or ambiguous command/output/session-prefix evidence fails closed. / 仅有标题后缀绝不建立关系；缺失、重复或有歧义的 command／output／session-prefix 证据会 fail closed。
2. Materialized forks retain lineage-based inference and are distinguished from pointer-backed forks. / 物化式分叉继续使用 lineage 推断，并与指针式分叉区分。
3. Pointer children expose the parent, fork timestamp, fork point, evidence owner, waiting state, and bounded Inherited Session Context projection. / 指针式 child 暴露父会话、分叉时间、分叉点、证据 owner、等待状态与有界的继承会话上下文投影。
4. Parent Raw Records and Logical Events do not enter child-owned arrays, metrics, filters, search targets, or project totals. / 父会话原始记录与逻辑事件不进入 child 拥有的数组、指标、筛选、搜索 target 或项目总计。
5. Synthetic, full Node, browser, package, generated-asset, real-corpus, and repository hygiene checks pass. / 合成测试、完整 Node、浏览器、package、生成资产、真实语料与仓库卫生检查全部通过。

## Progress log / 进度日志

- 2026-07-31: Confirmed the two-row child is a pointer-style background fork rather than a rename or corrupt transcript, and identified the exact parent command, output, fork point, and inherited ancestry. / 2026-07-31：确认两行 child 是指针式后台分叉，而非重命名或损坏转录，并定位精确父 command、output、分叉点与继承 ancestry。
- 2026-07-31: Implemented exact correlation, parent-owned inherited-context projection, corrected timestamps/project association, browser presentation, and focused regression coverage. / 2026-07-31：已实现精确关联、父会话拥有的继承上下文投影、时间戳／项目关联修正、浏览器呈现与聚焦回归覆盖。
- 2026-07-31: Completed bilingual contract updates and generated-asset convergence. `release:check` passed with 333/333 Node tests and package smoke; the full browser suite passed 84/84. Regression coverage also proves that exact pointer evidence can promote only its metadata-only child from an otherwise ambiguous multi-`cwd` container while unrelated metadata remains excluded. A real-corpus pass retained 41 Sessions, 579 Logical Events, and 662 Raw Records while resolving the pointer sample to its parent; the child itself still owns 2 Raw Records and 0 Main events. / 2026-07-31：完成双语契约更新与生成资产收敛。`release:check` 通过，其中 Node 测试 333/333 并通过 package smoke；完整浏览器套件 84/84 通过。回归覆盖还证明：在包含多个 `cwd` 的歧义容器中，只有被精确 pointer 证据指向的 metadata-only child 会被纳入，无关 metadata 仍会排除。真实语料复核保持 41 个会话、579 个逻辑事件与 662 条原始记录；child 自身仍只拥有 2 条 Raw 与 0 个 Main 事件。
- 2026-08-01: Independent review follow-up moved two local-command wrappers from inherited Main activity into Protocol. The same 19 inherited parent Raw Records now support 8 Main and 8 Protocol events without changing child/project ownership or total Logical/Raw counts. `release:check` passed with 337/337 Node tests and package smoke; the full browser suite passed 85/85. / 2026-08-01：独立审查后续把两条 local-command wrapper 从继承 Main 活动移入 Protocol。同样的 19 条继承父会话 Raw 现在对应 8 个 Main 与 8 个 Protocol 事件，不改变 child／项目 ownership 或逻辑／Raw 总数。`release:check` 通过，其中 Node 测试 337/337 并通过 package smoke；完整浏览器套件 85/85 通过。
