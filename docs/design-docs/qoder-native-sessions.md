# Qoder native sessions / Qoder 原生会话

## Authority and accepted profile / 依据与接纳形态

The implementation target is the user-selected native Windows `.qoder-cn/projects` history, inspected read-only on 2026-11-13. It is a separate accepted adapter target, not evidence for Claude Code or a claim of compatibility with all Qoder releases. The initial inventory contains 110 JSONL files (50 primary, 60 child), 86,543 newline-committed records and 217,971,387 bytes. There are 31 project containers with transcripts; directory names are not authoritative paths. / 实现目标为用户指定的 Windows 原生历史，于所列日期只读检查。这是独立接纳的 adapter 目标，不作为 Claude Code 依据，也不声称兼容所有 Qoder 版本。初始盘点有 110 份 JSONL（50 主、60 子）、86,543 条换行提交记录、217,971,387 字节；31 个项目容器包含转录，目录名不是权威路径。

Recorded producer versions are `1.1.16`, `1.1.66`, `1.1.69`, `1.1.75`, `1.1.75-hotfix.1`, and `1.1.79-hotfix.7/.9/.11/.17/.18/.19`. Version is metadata, not an inferred schema version. The installed Qoder CN desktop `0.4.9` reports commit `b8a26d69d9c1927d6c97399596a9d24b508ae998`; static bundled code corroborates compact-boundary fields, but is not a pinned readable CLI writer specification. Acceptance combines the explicitly selected native corpus, structural inventory, minimized synthetic regressions and fail-closed unknown handling. Future producer upgrades require new evidence. / 记录中的 producer 版本如上；版本仅是元数据，不据此推断 schema。已安装桌面程序报告所列版本和提交；随包代码静态检查可佐证压缩边界字段，但不等同于固定、可读的 CLI writer 规范。接纳依据结合用户明确选定的原生语料、结构盘点、最小合成回归和保守未知处理；未来升级需要新依据。

The installed desktop update payload also reports `0.5.7`, commit `73fe8d7343fbbbc3fb5ec665489082f6e4db0128`; neither desktop version identifies the producer of each native record. / 已安装桌面更新包还报告所列版本与提交；两个桌面版本均不能逐条确定原生记录的 producer。

No private transcript, sidecar content, user prompt or output is committed. Tests construct synthetic native records in temporary directories. / 不提交私人转录、sidecar 正文、用户提示词或输出；测试在临时目录构造原生形态的合成记录。

## Storage, identity and lifecycle / 存储、身份与生命周期

`--source qoder --qoder-home <root>` selects the root containing `projects/`; default `~/.qoder-cn`. Discovery accepts `<container>/<session>.jsonl` and `<container>/<session>/subagents/agent-<id>.jsonl`, without following symlinks or arbitrary nested folders. A native user/assistant envelope and absolute recorded `cwd` establish admission and project association; the shared versioned project-path policy applies. Workspace-directory and relocation records remain visible evidence. / 所列参数选择包含 projects 的根，默认如上。发现仅接纳所列主／子会话布局，不跟随符号链接或任意嵌套目录。原生 user／assistant 封装和记录的绝对 cwd 决定准入及项目归属，并采用共享版本化路径策略；工作空间目录及迁移记录保留为可见依据。

Session identity is source-qualified physical path, preventing repeated native IDs across containers from colliding. Children use their own physical identity even though native `sessionId` names the parent. The observed child layout supplies parent Session identity; navigation from an Agent call additionally requires a unique call and agreeing child `agentId`, parent `sessionId` and `parent_tool_use_id`. Metadata/task sidecars are not required (two task sidecars are empty). Ambiguity produces no actionable link. / 会话身份使用带来源限定的物理路径，避免跨容器重复 ID 冲突。子会话采用自己的物理身份，即使原生 sessionId 指向父级。已观察的子目录布局提供父会话身份；Agent 调用跳转另要求唯一调用及相符的子 agentId、父 sessionId、parent_tool_use_id。不依赖 metadata／task sidecar（其中两份 task 文件为空）；歧义不产生可操作跳转。

The shared Indexed/Materialized contract stores query projections and accepted-prefix descriptors rather than transcript bodies. Reads validate source-root containment, file identity and SHA-256 of the indexed prefix. Appends are permitted; rewrite, truncation or replacement returns `INDEXED_SOURCE_STALE`. Non-newline tails are excluded with `QODER_TORN_TAIL`; malformed committed lines retain exact Raw. Root/artifact diagnostics and cancellation remain explicit. / 共享索引／物化契约保存查询投影和接纳前缀 descriptor，不在索引中保留正文。读取核验根目录包含关系、文件身份及前缀 SHA-256；允许追加，改写／截断／替换返回所列失效码。无换行尾部排除并诊断，已提交的损坏行保留精确 Raw；根／工件诊断与取消保持明确。

## Reading and mapping / 阅读与映射

| Native evidence / 原生依据 | Behavior / 行为 |
| --- | --- |
| user/assistant text, thinking, image blocks | Main messages/reasoning and bounded inline image previews; media payloads/signatures excluded from search/display projections / Main 消息／思考及有界内嵌图片预览；搜索与展示投影排除媒体字节／签名 |
| `tool_use` / `tool_result` | Exact unique call identity, native source assistant UUID when present, same session/agent and unique parent ancestry; unpaired results remain Protocol / 精确唯一调用身份、存在时的原生来源 assistant UUID、相同会话／agent 及唯一父祖先链；未配对结果保留 Protocol |
| Bash / file tools | Native commands, exit/failure/background/cancel evidence; Read/Write/Edit/DeleteFile variants, requested edits and recorded diffs; no inferred shell success from prose / 原生命令、退出／失败／后台／取消依据；文件工具参数变体、请求修改及已记录 diff；不从文本推断 shell 成功 |
| TodoWrite / Task tools / AskUserQuestion / Agent | Recorded task requests/reminders, question/options/answers, agent prompt/result and corroborated child navigation / 已记录任务请求／提醒、问题／选项／回答、agent 提示／结果及经佐证的子会话跳转 |
| MCP / web / memory / remaining tools | Recorded tool names, arguments, inline output and result metadata; MCP wrappers do not impersonate native tools / 记录名称、参数、内联输出及结果元数据；MCP wrapper 不冒充原生工具 |
| compact boundary + summary | A uniquely identified boundary/summary pair is one Main compaction with both Raw refs; preserve unpaired evidence / 唯一明确的边界／摘要配对合为一个 Main 压缩并保留双方 Raw；未配对依据继续可见 |
| runtime-config / usage / attachments / queue / retry | Protocol evidence with structured Detail; no fabricated request billing/cache accounting or full workflow lifecycle / Protocol 依据及结构化详情；不制造请求计费／缓存核算或完整工作流生命周期 |
| meta/internal/compaction-origin input | Protocol or compaction, outside ordinary human turn/title counts / Protocol 或压缩，不计为普通人工回合／标题 |
| unknown/malformed records or content | Protocol and physical Raw fallback / Protocol 与物理 Raw 回退 |

The timeline is physical saved history. Active-leaf markers and copied fork records remain visible; it does not claim active-branch replay, undo semantics, fork deduplication or cross-session token totals. Recorded parent edges constrain turns and tool ownership even when physical branches interleave. / 时间线展示物理保存历史，active-leaf 标记及复制的 fork 记录继续可见；不声称实现活动分支回放、撤销语义、fork 去重或跨会话 token 总量。即使分支交错，记录的父边仍约束回合及工具归属。

Native usage has zero input/output/cache token counts in the inspected corpus, while credits and context-usage values exist. These remain qualified native fields, not canonical usage/cost estimates. / 所查语料的输入／输出／缓存 token 计数均为零，但存在 credits 和上下文用量值；这些保留为原生限定字段，不转化为 canonical 用量／费用估计。

## Payload and sidecar boundaries / 正文与 sidecar 边界

Preview only inline base64 image blocks in the accepted JSONL, including uniquely owned `toolUseResult[]` image blocks. Display at most eight per event, with 16 MiB encoded / 12 MiB decoded limits each and a raster MIME allowlist. HTTPS image references are not fetched; metadata inline bytes are not asserted identical to the remote image. Detail is bounded and always retains Raw refs; physical Raw readback remains exact. / 仅预览已接纳 JSONL 内嵌 base64 图片，包括归属唯一的 toolUseResult 数组图片。每事件最多八幅，每幅编码／解码限制分别为 16／12 MiB，并限制 raster MIME。HTTPS 引用不抓取，也不声称元数据内嵌字节与远程图像相同。详情有界且始终保留 Raw 引用；物理 Raw 回读保持精确。

The 223 project `tool-results/*.txt` sidecars have no verified references from the inspected results. All eight exact persisted-output wrappers and 19 structured `persistedOutput` objects point outside `projects/`; background and Agent output paths also point outside it. They remain visible references/inline previews. No external file hydration, arbitrary-path reads or desktop runtime/database dependency is introduced. / 223 份项目 tool-results 文本 sidecar 在所查结果中没有经验证的引用。八个精确 persisted-output wrapper 及 19 个结构化 persistedOutput 均指向 projects 外，后台及 Agent 输出路径也在外部；保留为可见引用／内联预览。不引入外部文件补载、任意路径读取或桌面运行时／数据库依赖。

## Validation and remaining cases / 验证与剩余案例

Synthetic reader tests distinguish evidence preservation from inferred semantics: duplicate/cross-owned results, branch ancestry, compaction pairing, parameter variants, status precedence, runtime input, inline/remote images, unknown shapes, prefix freshness, path containment, cancellation and index/materialization/query parity. Real-corpus replay and exact review evidence are recorded in the [execution plan](../exec-plans/completed/2026-11-13-qoder-native-sessions.md). / 合成 reader 测试区分保留依据与推断语义，覆盖重复／跨归属结果、分支祖先、压缩配对、参数变体、状态优先级、运行时输入、内嵌／远程图片、未知形态、前缀新鲜度、路径包含关系、取消及索引／物化／查询一致性。真实语料回放及精确审查依据记录于执行计划。

Additional isolated writer captures are needed before extending the following semantics. Existing occurrences remain readable within the boundaries above; these requests are not claims that the features are absent from the corpus. / 扩展下列语义前需要额外隔离的 writer 采集。现有记录在上述边界内可读；以下请求不表示语料中没有这些功能。

| Gap / 缺口 | How to manufacture a real case / 如何制造真实 case |
| --- | --- |
| Active branch, edit/resend, rewind, fork / 活动分支、编辑重发、回退、分叉 | In a disposable project create two turns, edit/resend the first prompt, switch to an older leaf, fork and resume each branch. Save before/after JSONL and a UI action/time ledger; keep copied UUIDs, forkedFrom and active-leaf markers. / 在临时项目完成两个回合，编辑重发首条，切回旧叶，分叉并分别续接；保存操作前后 JSONL、UI 操作及时间，保留复制 UUID、forkedFrom 和 active-leaf。 |
| Background command and Agent completion / 后台命令与 Agent 完成 | Launch a short background task, poll it to completion; repeat with nonzero exit, timeout and explicit cancellation. Run two simultaneous Agents, one resumed and one cancelled. Preserve parent/child JSONL and meta/task sidecars before and after terminal delivery. / 启动短后台任务并轮询完成；分别制造非零退出、超时、取消；同时运行两个 Agent，一个续接、一个取消，保留终态投递前后的父／子 JSONL 与 sidecar。 |
| Approval/question/plan causal lifecycle / 审批／问答／计划因果生命周期 | In a sandbox project request a safe file edit or command requiring approval, deny then approve/retry; ask a multiple-choice question, answer once and cancel once; enter/exit plan mode with accept/reject. Keep call IDs, denial kinds and late input origins. / 在临时项目请求需要审批的安全编辑或命令，先拒绝再批准重试；制造一次问答回答和一次取消，计划模式分别接受／拒绝；保留调用 ID、拒绝类型及稍后输入来源。 |
| Hook, queued, remote and scheduled input provenance / hook、排队、远程及定时输入来源 | Use harmless echo hooks for success/failure, enqueue a prompt during a running turn, and run one disposable scheduled/remote task. Capture native origin and attachment evidence together with human action times. / 使用安全 echo hook 制造成功／失败，回合运行中排队输入，再执行一个临时定时／远程任务；将原生 origin／attachment 与人工操作时间一并保存。 |
| Usage/accounting meaning / 用量核算含义 | Record two short same-model turns plus a model switch and manual compaction; preserve complete usage/requestTokenAnchor and the client's displayed totals. Obtain a writer capture with nonzero token fields before deriving token/cache metrics. / 同模型连续两轮，再切换模型并手动压缩；保留完整 usage／requestTokenAnchor 与客户端总量；得到非零 token 的 writer 记录后才推导 token／cache 指标。 |
| External outputs and attachment persistence / 外部输出及附件持久化 | Generate a bounded large stdout result, a text file, a notebook and a small image; record the exact referencing JSONL plus referenced sidecars before/after restart or cleanup. Use a disposable root to establish ownership and missing-file behavior without collecting private files. / 制造有界大 stdout、文本文件、notebook 与小图片，保存准确引用 JSONL 及重启／清理前后的 sidecar；使用临时根验证归属和缺失文件行为。 |
| Manual compaction / 手动压缩 | Use the documented manual compact control in a scratch conversation, then send another prompt and tool call; capture boundary/summary/active-leaf/usage order. If the UI supports it, also cancel a compaction. The current corpus establishes auto compaction only. / 在临时会话使用正式手动压缩入口，随后再发提示并调用工具，采集边界／摘要／active-leaf／usage 顺序；若 UI 支持，再取消一次压缩。当前语料仅证明 auto 压缩。 |
| Multiple workspaces, relocation and worktrees / 多工作空间、迁移与 worktree | Open two scratch directories as one workspace, relocate one repository and create/remove a supported worktree; preserve directories, cwd, relocated and non-null worktreeSession before/after. Current worktreeSession values are null. / 将两个临时目录作为一个 workspace 打开，迁移其中一个仓库并创建／删除支持的 worktree，保留操作前后 directories、cwd、relocated 与非空 worktreeSession；当前该字段均为空。 |
| Other versions/platforms / 其他版本与平台 | Repeat minimal chat→tool→resume→child→compaction on the global `.qoder` distribution and Linux/macOS or a new CLI version; record actual producer version and storage layout. / 在全球版 .qoder、Linux／macOS 或新版 CLI 重复最小聊天→工具→续接→子代理→压缩，记录实际 producer 版本和布局。 |
