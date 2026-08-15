# Memory/runtime reliability review follow-up / 内存／运行时可靠性审查跟进

## Objective / 目标

Close the remaining review findings after compact Codex indexing without redesigning the accepted compact-index architecture: bound and cancel runtime source hydration, make indexed-source stale failures actionable in the browser, synchronize `--log-dir` documentation, and repeat the relevant validation gates. / 在不重做已接受的紧凑索引架构的前提下，关闭 compact Codex indexing 后剩余的审查 finding：限制并取消运行时来源 hydration、让浏览器中的索引来源过期失败具备可执行恢复路径、同步 `--log-dir` 文档，并重新运行相关验证门禁。

## Status and ownership / 状态与负责人

- Owner: GPT-5.6 Sol xhigh; sole architecture owner and writer / 负责人：GPT-5.6 Sol xhigh；唯一架构 owner 与 writer
- Status: completed / 状态：已完成
- Started: 2026-08-13 / 开始日期：2026-08-13
- Completed: 2026-08-13 / 完成日期：2026-08-13
- Branch／worktree: `memory-runtime-reliability` at pre-follow-up `2af079b6accb20d6fb9cc9223adce5547a7e5a25`, registered worktree `tmp/worktrees/memory-runtime-reliability` / 分支／工作树：`memory-runtime-reliability`，跟进前 HEAD 为 `2af079b6accb20d6fb9cc9223adce5547a7e5a25`，登记 worktree 为 `tmp/worktrees/memory-runtime-reliability`
- Primary checkout remains outside implementation scope; its unrelated untracked showcase files are user-owned. / 主 checkout 不属于实现范围；其中无关的未跟踪 showcase 文件归用户所有。

## Revalidated findings / 已复核 findings

1. P2 confirmed code-path risk, not a reproduced OOM: each visible expanded event or visible Code Mode operation could start an independent detail request; every Codex request scanned its source JSONL from row one to its latest referenced row; browser abort did not reach the server reader; no hydration concurrency bound existed. / P2 已确认是代码路径风险，而非已复现 OOM：每个可见展开事件或可见 Code Mode operation 都能发起独立 detail 请求；每个 Codex 请求从来源 JSONL 第一行扫描到最靠后的引用行；浏览器 abort 未到达服务端 reader；不存在 hydration 并发上限。
2. P3 confirmed: server errors had internal `INDEXED_SOURCE_STALE` identity but API responses discarded it, detail stored only English text, and structured detail always offered ineffective Retry while Raw Reference failures escaped as generic errors. / P3 已确认：服务端错误内部具有 `INDEXED_SOURCE_STALE` identity，但 API response 丢弃该信息；detail 只保存英文文本；结构化详情总是提供无效 Retry，而 Raw Reference 失败作为普通错误冒泡。
3. P3 confirmed: `README.zh-CN.md` lacked the English README's `--log-dir`, aggregate-only privacy, retention, and fatal-OOM stderr explanation. / P3 已确认：`README.zh-CN.md` 缺少英文 README 中关于 `--log-dir`、仅聚合隐私、保留数量与 fatal-OOM stderr 的说明。

## Accepted lifecycle contract / 已接受 lifecycle 契约

- One FIFO coordinator belongs to each committed Codex index, admits at most two active source hydration operations, and is shared by structured detail, indexed Raw readback, image preview, and guarded legacy Raw reads. It is not process-global. / 每个 committed Codex index 拥有一个 FIFO coordinator，同时最多允许两个活跃来源 hydration operation；结构化详情、已索引 Raw 回读、图片预览与受保护的旧 Raw read 共用该 coordinator。它不是进程全局 coordinator。
- The source-neutral adapter boundary accepts the HTTP request `AbortSignal`. A queued cancelled request performs no source I/O; an active reader checks cancellation between rows, closes the stream, and checks again before Raw reconstruction or DTO assembly. Cancellation never mutates the committed index or another request. / 来源中立 adapter 边界接受 HTTP request `AbortSignal`。排队后取消的请求不产生来源 I/O；活跃 reader 会在行之间检查取消、关闭 stream，并在 Raw 重建或 DTO 组装前再次检查。取消绝不修改 committed index 或其它请求。
- Stable `409 + INDEXED_SOURCE_STALE` response semantics drive localized existing-project reindex recovery for both detail and Raw References. Ordinary detail errors retain Retry, while other Raw-reference failures retain their existing handling. / 稳定的 `409 + INDEXED_SOURCE_STALE` response 语义为 detail 与 Raw Reference 驱动已本地化的既有项目重新索引恢复；普通 detail 错误继续提供 Retry，其它 Raw-reference 失败保留既有处理方式。
- No parsed-record cache, byte-offset index, search redesign, or compact-index representation change. / 不增加 parsed-record cache、byte-offset index、search 重构或紧凑索引表示变更。

## New aggregate profiling / 新增聚合 profiling

On Node `v24.18.1` with the normal 2,240 MiB V8 heap, the evolving private corpus contained 456 Sessions, 251,995 Raw Records, 175,036 Logical Events, and about 882 MiB candidate bytes. Cold indexing completed in 33.1 s at 1,909／1,702 MiB peak／post-GC heap. A following changed-session reindex reused 455／456 Sessions in 6.8 s at 1,914／1,702 MiB. Six late details in the largest Session scanned 50,045 rows with observed maximum concurrency two, completed in 575 ms, and moved heap from 1,701 MiB to 1,744 MiB transiently and back to 1,702 MiB after GC. Four queued cancellations opened no file; one active cancellation stopped at row 100 while an independent request completed. No OOM was reproduced. No source paths, transcript content, prompts, dumps, snapshots, or helper output are committed. / 在 Node `v24.18.1` 与普通 2,240 MiB V8 heap 下，持续演进的私有语料包含 456 个 Session、251,995 条 Raw Record、175,036 个 Logical Event 与约 882 MiB candidate bytes。Cold indexing 在 33.1 秒内完成，peak／post-GC heap 为 1,909／1,702 MiB；随后一次 changed-session reindex 在 6.8 秒内复用 455／456 个 Session，heap 为 1,914／1,702 MiB。最大 Session 中 6 个靠后 detail 合计扫描 50,045 行，观测最大并发为 2，总耗时 575 ms；heap 从 1,701 MiB 短暂升至 1,744 MiB，GC 后回到 1,702 MiB。4 个排队取消未打开文件；一个活跃取消在第 100 行停止，同时独立请求正常完成。未复现 OOM。未提交任何来源路径、transcript 内容、prompt、dump、snapshot 或 helper 输出。

## Completed gates / 已完成门禁

- Deterministic hydration coverage proves a per-index maximum of two, FIFO admission across structured detail／indexed Raw／image preview／legacy Raw, queued cancellation before source I/O, active scan termination, request isolation, committed-index immutability, and independent-index concurrency. Hydrated-detail equivalence, stale `409`, and append-only acceptance also pass. / 确定性 hydration 覆盖证明：每个 index 的最大并发为 2；structured detail／indexed Raw／image preview／legacy Raw 之间按 FIFO 准入；排队取消发生在来源 I/O 之前；活跃扫描会停止；请求彼此隔离；committed index 保持不变；不同 index 可独立并发。Hydrated-detail 等价、stale `409` 与 append-only 接受也均通过。
- Focused server lifecycle, source-switch, i18n, and stale-recovery browser checks passed. The final complete Node suite passed 458／458; the complete browser E2E suite passed 108／108; release checks passed generated-asset verification plus Codex and Claude packaged-runtime smoke. `git diff --check` passed. / 聚焦 server lifecycle、source-switch、i18n 与 stale-recovery browser 检查均通过。最终完整 Node suite 为 458／458；完整 browser E2E suite 为 108／108；release check 通过 generated asset 校验以及 Codex、Claude packaged-runtime smoke。`git diff --check` 通过。
- Sol inspected the full follow-up diff and retained the compact-index architecture. A fresh Luna read-only review, followed by a final delta review after closing its test-only P3 gap, reported no remaining P0／P1／P2／P3 findings. / Sol 检查了完整跟进 diff，并保留 compact-index 架构。新的 Luna 只读审查在其仅测试层面的 P3 缺口关闭后又完成最终增量复核，结论为无剩余 P0／P1／P2／P3 finding。

## Closure / 收口

Concurrent hydration amplification is bounded without a cache or offset-index redesign; abandoned active work observes disconnect cancellation, queued unneeded work performs no source I/O, and cancellation does not affect another request or committed index. Stale structured detail and Raw References now have one localized reindex recovery model. English／Chinese `--log-dir` documentation is synchronized. The original compact-index retention and freshness guarantees remain intact, and every implementation／test／documentation change stayed in the registered dedicated worktree. / 并发 hydration 放大效应已在不引入 cache 或 offset index 重构的情况下受到限制；被放弃的活跃工作会观察 disconnect 取消，排队但已不需要的工作不会产生来源 I/O，取消不会影响其它请求或 committed index。过期的结构化详情与 Raw Reference 现在共用一个本地化重建索引恢复模型。英文／中文 `--log-dir` 文档已同步。原有 compact-index retention 与 freshness 保证保持不变，所有实现／测试／文档变更始终位于已登记的专用 worktree。
