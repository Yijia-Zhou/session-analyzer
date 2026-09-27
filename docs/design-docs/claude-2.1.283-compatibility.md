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

## Next evidence collection / 后续依据采集

1. Obtain MCP background launch/progress/terminal records, including failure and duplicate terminal cases. / 获取 MCP 后台启动／进度／终态记录，包含失败及重复终态。
2. Exercise auto-mode hand-back and Monitor completion/deadline using an environment that exposes them; verify provenance before changing human-message counts. / 在支持的环境采集自动模式回传和 Monitor 完成／超时；修改人类消息计数前核验 provenance。
3. Seek explicit persisted parent evidence for rewritten-ID CLI forks, and collect siblings, resumed parents, missing parents and conflicting copies before defining an ownership rule. / 寻找改写 ID 的 CLI 分叉的显式持久化父级依据，并采集 sibling、续接父级、缺失父级和冲突副本，再定义归属规则。
