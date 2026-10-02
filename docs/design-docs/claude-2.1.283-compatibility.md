# Claude Code 2.1.283 compatibility review / 兼容性审查

Reviewed on 2026-09-27 against branch baseline `bd5ce31`. This accepts specific persisted shapes, not a new transcript schema inferred from the client version. / 于 2026-09-27 对分支基线 `bd5ce31` 审查；接纳的是具体持久化形态，不是根据客户端版本推断的新转录 schema。

## Evidence / 依据

- [Official changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md): `2.1.269` adds Bash edit diffs, `2.1.271` changes subagent hand-back and Monitor deadlines, `2.1.274` combines Monitor final output and exit, `2.1.283` fixes MCP background progress. These release notes establish behavior, not undocumented JSON field names. / 官方日志描述上述行为变化；它证明行为，不证明未公开 JSON 字段名。
- Locally installed official npm distribution: `@anthropic-ai/claude-code@2.1.283`, verified by `claude --version`, upgraded from `2.1.221`. The earlier accepted adapter evidence target was `2.1.220`. / 本地官方 npm 发行包由 `2.1.221` 升级并通过命令核验；此前 adapter 依据目标为 `2.1.220`。
- Fresh disposable-project sessions produced with [Space Bunny Alpha](https://openrouter.ai/stealth/space-bunny-alpha): ordinary Read/Bash, a Bash edit with `bashEditDiffEnabled`, resume, `--fork-session`, async Agent, and direct MCP. The exact new shape below was observed in the installed client; committed regressions use synthetic identities and content. Real transcripts are not committed. / 使用指定模型在临时项目生成普通读取／命令、开启 diff 的 Bash 修改、续接、CLI 分叉、异步 Agent 与直接 MCP；下述精确形态来自该客户端实测，提交的回归使用合成标识及内容，不提交真实转录。
- [OpenRouter integration instructions](https://openrouter.ai/docs/guides/coding-agents/claude-code-integration) require Claude's base URL to end in `/api`, with an empty `ANTHROPIC_API_KEY` and the existing bearer token. The old CC Switch provider used `/api/v1`; using that directly caused an HTTP 404. The selected CC Switch provider and live Claude settings now agree on `/api` and the requested model. / 官方接入要求 Claude base URL 以 `/api` 结尾，API key 留空并使用已有 bearer token；旧 CC Switch 提供方的 `/api/v1` 用于直连时产生 404，现已同步修正配置和模型。

Direct provider probes returned `cost: 0`. Claude's own result estimates a nonzero `total_cost_usd` with `costBasis: "unknown"`; it is not authoritative billing for this custom model. Do not turn `cost-state` estimates into verified provider charges. / 提供方直接探测返回 `cost: 0`；Claude 自身结果却含非零估算费用及 `costBasis: "unknown"`，这不是自定义模型的权威账单，不能把 `cost-state` 估算解释成已核验收费。

## Gap decisions / 缺口决策

| Area / 范围 | Evidence and prior behavior / 依据与原行为 | Decision / 决策 |
| --- | --- | --- |
| Bash edit diff / Bash 修改 diff | Exact `toolUseResult.bashEditDiff` persisted; command details showed stdout/stderr only and file facets omitted changed paths. / 精确结构已持久化，但命令详情只显示标准输出／错误，文件筛选漏掉改动路径。 | Implement typed bounded diff presentation and result-owned file facts, keeping command kind and outcome. / 实现有界 diff 展示与结果所属文件事实，保留命令种类及结果状态。 |
| Ordinary tools and resume / 普通工具及续接 | Fresh records pair by exact tool IDs and continue reading successfully. / 新记录按精确工具 ID 配对且续接可读。 | Retain existing behavior. / 保留现有行为。 |
| Async Agent / 异步 Agent | `async_launched` receipt and trusted queue/user terminal mirrors still correlate; one derived child is discoverable. / 启动回执与可信 queue/user 终态副本仍正确关联，可发现派生 child。 | Retain current exact ownership and terminal validation. / 保留精确归属与终态验证。 |
| SendMessage resume / SendMessage 续接 | A successful `resumedAgentId` receipt precedes a terminal notification with the same agent task ID but the SendMessage call ID. Previously a generic tool was considered successful immediately and its terminal stayed in Protocol. / 成功的 resumedAgentId 回执先于终态通知；通知使用相同 agent task ID 及新的 SendMessage call ID。此前该操作被当成普通工具立即成功，终态留在协议层。 | Classify as coordination and correlate a separate resume lifecycle using exact task/call identity, preserving ambiguity rejection for duplicate original launches. / 分类为协调，按精确 task/call 标识关联独立续接生命周期，同时保留重复原始启动的歧义拒绝。 |
| MCP auto-background / MCP 自动后台 | Two headless samples at 500 ms and 1,000 ms thresholds returned synchronously after a 5-second tool. Changelog confirms the feature, but these samples do not establish its persisted lifecycle shape. / 两个无界面样本在指定阈值下仍同步返回；更新日志证明功能存在，样本尚不能证明持久化生命周期形态。 | Keep direct MCP support; obtain an interactive/background receipt and terminal before extending lifecycle inference. / 保留直接 MCP 支持，取得交互式后台回执与终态后再扩展生命周期推断。 |
| CLI materialized fork / CLI 实体副本分叉 | `--fork-session` rewrites every copied row's `sessionId` to the child while retaining message UUIDs; no explicit parent pointer was observed. Current foreign-session-ID gate leaves it independent and includes the copied history. / CLI 分叉把所有复制行的 sessionId 改为 child、保留消息 UUID；未观察到显式父指针，当前 foreign-session-ID 门槛使其保持独立并包含复制历史。 | Document the relationship gap. Shared UUIDs alone do not choose a unique parent or distinguish sibling copies; do not fabricate parent ownership. / 记录关系缺口；共享 UUID 不能单独确定唯一父级或区分 sibling 副本，不合成父级归属。 |
| Auto-mode hand-back and Monitor / 自动模式回传与 Monitor | Release-note evidence only; sampled ordinary Agent did not emit the auto-mode-specific hand-back call. / 只有更新日志依据，普通 Agent 样本未发出自动模式专属回传调用。 | Follow-up fixture targets, not invented schemas. / 作为后续 fixture 目标，不臆造 schema。 |
| `atis-latch`, `cost-state`, attachments / 新 metadata 与 attachment | Present in fresh records, still reachable through Protocol/Raw fallback. / 新样本包含这些记录，仍可通过协议／原始层访问。 | Retain fallback, no unsupported cost/accounting semantics. / 保留 fallback，不增加无依据费用／计量语义。 |

## Accepted Bash result shape / 接纳的 Bash 结果形态

Synthetic illustration of the observed result-owned object: / 对实测结果所属结构的合成示例：

```json
{
  "bashEditDiff": {
    "files": [{
      "filePath": "/synthetic/example.txt",
      "hunks": [{
        "oldStart": 1, "oldLines": 2,
        "newStart": 1, "newLines": 2,
        "lines": [" alpha", "-beta", "+gamma"]
      }]
    }],
    "moreFiles": 0,
    "changedFiles": ["/synthetic/example.txt"]
  }
}
```

Only an exactly paired Bash call and uniquely owned result may promote these facts. A failed command can still have changed files; diff evidence must not overwrite its failure. A declined operation does not gain semantic edits from contradictory metadata. Multiple result blocks must not share record-level metadata. Malformed or omitted diff content remains inspectable through bounded supplemental JSON and Raw references. No referenced path is opened to construct a diff. / 只有精确配对的 Bash 调用和唯一归属结果才提升这些事实；失败命令也可能已修改文件，diff 不得覆盖失败状态；被拒绝操作不从矛盾 metadata 获得语义修改；多个结果 block 不得共享记录级 metadata；格式错误或省略内容仍可通过有界补充 JSON 和原始引用检查；构建 diff 不打开任何引用路径。

Reuse existing source-owned detail sections and file facets; avoid a new cross-source DTO or a second patch event for the command. / 复用现有来源所属详情 section 与文件筛选，不新增跨来源 DTO，也不为命令另造 patch 事件。

Per-call file facts come from that call's input, not the aggregate paths of sibling calls in the same Raw Record. The source-owned `bashEditFiles` fact contains only validated result diff paths, so the session changed-file summary cannot mistake a Read sibling or a supplemental path for a Bash edit. It does not increment the patch-event count. / 单次调用文件事实来自该调用输入，不继承同一原始记录内其他调用的聚合路径。来源所属 `bashEditFiles` 事实只包含已验证结果 diff 路径，避免会话修改文件汇总把同级 Read 或补充记录路径误当成 Bash 修改；它不增加 patch 事件计数。

## SendMessage resume / SendMessage 续接

The observed SendMessage resume receipt is `{ "success": true, "resumedAgentId": "synthetic-agent", "pin": { "id": "synthetic-agent" } }` for a request with `to: "synthetic-agent"`. The result does not prove task completion. Reuse the `async_agent` lifecycle with resume-specific detail wording; require consistent exact target evidence, unique call/result ownership and a subsequent trusted notification naming both task ID and this call ID. Ordinary message-delivery receipts remain coordination operations without a fabricated async lifecycle. Multiple original launches claiming the same task ID remain ambiguous. / 观测到的 SendMessage 续接回执如上，对应请求的 `to`；它不证明任务完成。复用 `async_agent` 生命周期并使用续接专属详情文案，要求目标证据精确一致、调用／结果唯一归属，且后续可信通知同时指定该 task ID 和本次 call ID。普通投递回执保持协调操作，不合成异步生命周期；多个原始启动声明相同 task ID 时仍视为歧义。

## Follow-up evidence, 2026-09-29 / 后续依据，2026-09-29

The gap table above records the original review. Follow-up used the same installed `2.1.283` client and configured model, a new disposable Git project, a local stdio MCP server with a 12-second synthetic tool and 2-second progress notifications, and bounded CLI probes. No real transcripts or credentials are committed. / 上表记录原始审查；本次使用相同的 `2.1.283` 客户端与已配置模型、新临时 Git 项目、本地 stdio MCP 服务器（12 秒合成工具、每 2 秒进度通知）及有界 CLI 探针。不提交真实转录或凭据。

### MCP background / MCP 后台

[Official MCP documentation](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls) explains the missing condition: non-interactive calls do not auto-background unless `CLAUDE_AUTO_BACKGROUND_TASKS=1`. With that flag and `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=1000`, the real client persisted background receipts and success/failure notifications. One short one-shot run exited before failure arrived; holding stream-json input open for 40 seconds captured it. Exiting without a terminal is not evidence of success. / [官方 MCP 文档](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)说明缺失条件：非交互调用需要 `CLAUDE_AUTO_BACKGROUND_TASKS=1` 才自动后台化。加上该标志与 1000 毫秒阈值后，真实客户端持久化了后台回执及成功／失败通知。一个短单轮执行在失败通知到达前退出；保持 stream-json 输入打开 40 秒后采到失败。没有终态便退出不证明成功。

- Launch: both the sole result block and array-valued `toolUseResult` contain the same client text naming `server/tool`, elapsed seconds, task ID and matching TaskStop ID. `sourceToolAssistantUUID` names the original call row. There is no structured `backgroundTaskId`. / 启动：唯一结果 block 和数组形态的 `toolUseResult` 包含相同客户端文本，给出 `server/tool`、耗时秒数、task ID 及一致的 TaskStop ID；`sourceToolAssistantUUID` 指向原调用行，没有结构化 `backgroundTaskId`。
- Terminal: exact queue/user mirrors contain `task-id`, `status` (`completed` or `failed`), `summary` and `result`, but **no `tool-use-id`**. The user mirror has `origin.kind: "task-notification"` and `promptSource: "system"`. / 终态：精确 queue/user 镜像包含 `task-id`、`status`（`completed` 或 `failed`）、`summary` 和 `result`，但**没有 `tool-use-id`**；user 镜像具有上述系统来源字段。
- Progress: SDK stream output emitted `system/task_progress` (5 success-probe rows; 6 failure-probe rows). No corresponding progress rows were found in those persisted project JSONL files. Stream output and stored transcript are different evidence surfaces; do not synthesize missing stored progress. / 进度：SDK 流输出含 `system/task_progress`（成功探针 5 条、失败探针 6 条），对应项目 JSONL 中未发现这些进度行。流输出与持久化转录是不同依据面，不合成缺失的存储进度。

Decision: accept the exact bounded receipt as `background_mcp` on the existing `mcp_call`. Require unique call/result ownership, a matching source assistant UUID and server/tool identity. A receipt remains `in_progress`. A terminal needs a unique task owner, causal order, the observed flat shape, and one trusted system-user row or its byte-identical queue mirror. Queue-only, duplicate, contradictory, malformed or validation-capacity-exceeded terminals stay Protocol/Raw and do not complete the call. Display truncation alone does not invalidate a terminal. Duplicate/conflict tests are deliberately synthetic; the actual sample supplied the ordinary queue/user mirror pair. / 决策：在既有 `mcp_call` 上接纳精确有界回执为 `background_mcp`，要求唯一调用／结果归属、匹配的来源 assistant UUID 和 server/tool 标识。回执保持 `in_progress`；终态要求唯一 task owner、因果顺序、实测平面结构，以及一条可信系统 user 行或其字节一致的 queue 镜像。只有 queue、重复、矛盾、畸形或超出验证容量的终态继续保留 Protocol/Raw，不完成调用；仅展示截断不会使终态无效。重复／冲突测试明确使用合成数据；真实样本提供的是普通 queue/user 镜像对。

### Auto mode and Monitor / 自动模式与 Monitor

Auto-mode initialization reported `permissionMode: "auto"`. A foreground Agent returned the model report inside a tool-result envelope with the `[Subagent hand-back]` provenance preamble, `classifierBoundary: true`, and structured `status: "completed"`. The child persisted ordinary assistant text, not a separately named hand-back tool invocation. Existing tool pairing already keeps the parent hand-back out of human-message counts; add a synthetic regression, but do not invent a hidden classifier verdict or a dedicated call that was not stored. / 自动模式初始化报告 `permissionMode: "auto"`；前台 Agent 在 tool-result envelope 中返回模型报告，带 `[Subagent hand-back]` 来源前言、`classifierBoundary: true` 与结构化 `status: "completed"`。child 存储普通 assistant 文本，没有单独命名的 hand-back 工具调用。既有工具配对已保证父会话回传不计作人类消息；新增合成回归，不合成未持久化的独立调用或隐藏 classifier 判定。

Monitor was exposed by the existing provider. Its receipt is `{ "taskId": "synthetic-task", "timeoutMs": 3000, "persistent": false }`. Completion and nonzero-exit probes persisted `task-id + tool-use-id`, `status`, `summary`, `output-file` and a final `<event>` in one terminal notification. A 3-second deadline on a 20-second sleep instead produced only a task-ID event with `[Monitor timed out — re-arm if needed.]`, with no status or call ID. / 现有提供方可使用 Monitor。回执形态如上；完成及非零退出探针将 `task-id + tool-use-id`、`status`、`summary`、`output-file` 和最后一个 `<event>` 持久化在同一终态通知中。20 秒 sleep 配 3 秒截止时间时，只产生含上述超时文本的 task-ID event，没有 status 或 call ID。

Decision: retain Monitor's `other_tool_call` kind, add a `monitor` lifecycle for a uniquely owned valid bounded receipt, and accept exact trusted success/failure terminals with final event content. Intermediate events and textual deadline alerts remain Protocol/Raw, not human messages. In the absence of an explicit accepted terminal the lifecycle stays `in_progress` (meaning terminal evidence missing, not a claim that the OS process is still running). Script stdout can imitate a timeout alert, so text alone must not establish timed-out state. / 决策：保留 Monitor 的 `other_tool_call`，对唯一归属的有效有界回执增加 `monitor` 生命周期，接纳精确可信成功／失败终态及最后事件内容。中间事件和文本截止提示继续在 Protocol/Raw，不算人类消息。缺少明确接纳的终态时保持 `in_progress`（表示终态依据缺失，不断言 OS 进程仍在运行）；脚本 stdout 可以仿造超时提示，不能仅凭文本确定超时状态。

Review hardening: Monitor terminal-candidate detection walks notification-level fields and treats their contents as opaque. Literal `<status>` or `<tool-use-id>` strings inside progress `<event>` output remain Protocol/Raw and cannot invalidate a subsequent genuine terminal. Malformed outer envelopes and actual outer terminal fields still enter strict validation; duplicate/conflicting terminals remain rejected. / 审查加固：Monitor 终态候选检测遍历通知外层字段，将字段内容视为不透明文本。进度 `<event>` 输出中的字面 `<status>` 或 `<tool-use-id>` 留在 Protocol/Raw，不能使后续真实终态失效。畸形外层 envelope 和真正的外层终态字段仍进入严格验证；重复／冲突终态继续被拒绝。

### Fork ownership / 分叉归属

Generated a parent, two CLI siblings, a continued parent, and a further CLI fork after continuation. Copied UUIDs remain shared and each fork rewrites copied `sessionId` values. No explicit persisted parent pointer was found in these project transcripts or in JSON sidecars matching the sampled sibling ID. This is bounded observation, not proof that no client storage can contain lineage. Synthetic missing-parent/conflicting-copy tests cover both resident and source-backed indexes and reindexing. / 已生成父会话、两个 CLI 兄弟分叉、父会话续接及续接后的进一步分叉。复制 UUID 仍共享，各分叉改写复制行的 `sessionId`；这些项目转录及匹配所采兄弟 ID 的 JSON sidecar 中未找到显式持久化父指针。这是有界观察，不证明客户端任何存储都不可能含 lineage。合成的父级缺失／副本冲突测试覆盖常驻索引、来源驱动索引及重建索引。

An interactive `/fork` attempt was rejected by the client because the launch's tool restrictions would not be inherited by the copy. Those safeguards were not removed. Unrestricted interactive fork remains uncollected and requires a separately approved environment or a user-produced minimized sample. Keep rewritten-ID copies independent and readable; do not select a parent by shared UUIDs or timestamps. / 交互式 `/fork` 被客户端拒绝，原因是副本不能继承启动时的工具限制；没有移除这些防护。未受该限制的交互式分叉尚未采集，需要另行获准的环境或用户生成的最小样本。改写 ID 的副本继续独立可读，不根据共享 UUID 或时间戳选择父级。

## Remaining evidence collection / 剩余依据采集

1. Persisted MCP progress, cancellation and non-flat terminal payloads; current SDK progress must not be conflated with project JSONL. / 持久化 MCP 进度、取消及非平面终态内容；不把当前 SDK 进度混同于项目 JSONL。
2. A stored dedicated auto-mode hand-back invocation/classifier verdict, and Monitor deadline evidence distinguishable from arbitrary script output. / 持久化的独立自动模式回传调用／classifier 判定，以及可与任意脚本输出区分的 Monitor 截止依据。
3. Explicit parent evidence for rewritten-ID forks and a permitted interactive-fork sample. / 改写 ID 分叉的显式父级依据，以及获准的交互式分叉样本。

## Capacity separation follow-up / 容量分离后续

The 2026-09-30 fix uses the already accepted 2.1.283 shapes and synthetic boundary fixtures; it introduces no upstream schema assumptions. An accepted Bash diff has an independent command search projection, so preceding stdout cannot exhaust its search budget. When presentation is omitted, the accepted diff retains its own bounded 16,000-unit JSON search prefix, independent of stdout. The generic structured-result search excludes that accepted diff to avoid counting the same body twice. Project search and session search agree across resident indexing and source-backed materialization. / 2026-09-30 修复沿用已接纳的 2.1.283 形态与合成边界 fixture，不增加上游 schema 假设。已接纳的 Bash diff 独立进入命令搜索投影，前置 stdout 不会耗尽其搜索预算；展示省略时，已接纳 diff 仍保留独立于 stdout 的 16,000 单位有界 JSON 搜索前缀；通用结构结果搜索排除该 diff，避免正文被重复计数。常驻索引与来源驱动物化的项目／会话搜索保持一致。

Bash diff presentation retains the original ceilings: 64 diff files, 256 changed paths, 256 hunks, 4,096 lines and 128,000 line-content UTF-16 units. Exceeding any display ceiling omits the typed diff body with a notice but preserves fully validated changed paths, file filters and changed-file summaries. Validation continues through the entire payload, including tails beyond the display limit. Its separate hard ceilings are 1,024 diff files, 4,096 changed paths, 4,096 hunks, 65,536 lines and 2,048,000 line-content UTF-16 units; each path remains limited to 4,096 units. Invalid, contradictory, ambiguous, declined or incompletely validated evidence never promotes file facts. The command kind/status and Raw references remain unchanged. / Bash diff 展示保留原上限：64 个 diff 文件、256 个修改路径、256 个 hunk、4,096 行和 128,000 个行内容 UTF-16 单位。任一展示上限超出时省略 typed diff 正文并提示，但保留完整验证后的修改路径、文件筛选及修改文件汇总。验证遍历完整内容，包括展示上限之后的尾部。独立验证硬上限为 1,024 个 diff 文件、4,096 个修改路径、4,096 个 hunk、65,536 行及 2,048,000 个行内容 UTF-16 单位；单路径仍限 4,096 单位。无效、矛盾、归属有歧义、被拒绝或未完成验证的依据不提升文件事实。命令种类／状态与原始引用保持不变。

MCP/Monitor terminal admission validates the full trusted flat envelope, identity and causal ownership before bounding summary/result presentation to 4,000/16,000 UTF-16 units with explicit omission markers. Fingerprints and queue/user mirror equality still use the full notification, including tails beyond those display budgets. The independent validation ceiling is 2,048,000 UTF-16 units for the whole notification; exceeding it retains Protocol/Raw fallback and does not establish a terminal. Existing non-flat, duplicate and conflict rejection remains intact. Large-body handling does not add support for unobserved notification shapes. / MCP／Monitor 终态先验证完整可信平面 envelope、身份及因果归属，再将 summary／result 展示限制为 4,000／16,000 个 UTF-16 单位并明确标记省略。指纹与 queue／user 镜像相等判断仍使用完整通知，包括展示预算之后的尾部。整条通知的独立验证上限为 2,048,000 个 UTF-16 单位；超出时保留 Protocol／Raw fallback，不确立终态。既有非平面、重复及冲突拒绝保持有效；大正文处理不扩展至未观测通知形态。
