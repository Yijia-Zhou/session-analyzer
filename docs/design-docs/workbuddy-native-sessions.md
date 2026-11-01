# Native WorkBuddy / CodeBuddy sessions / 原生 WorkBuddy／CodeBuddy 会话

## Authority and format boundary / 依据与格式边界

The initial compatibility target is the native local JSONL engine shipped in official npm package `@tencent-ai/codebuddy-code@2.179.0`. Its `product.json` records commit `4735eb77fa44fd99d56cf5a19b9d4fdf02f0d240` and build date `2026-10-30T16:09:10.432Z`; npm integrity is `sha512-LN5JEeR3hQgnGMVTg7Nir6l9Mf1LV0VjVc7QEksnsobzYSMpLufLrcOXlMibhX3w+AgryJmd3MDbnIv+boYWFg==`. / 首个兼容目标为所列官方 npm 包中的本地 JSONL 引擎；产品 commit、构建时间与 npm 完整性值如上。

The package's installation guide explicitly identifies WorkBuddy as another application using the CodeBuddy engine. This supports a shared source label, not an untested claim about all WorkBuddy desktop releases or exports. `--output-format stream-json` emits a different envelope and is not the persisted input format. Client version is evidence metadata, not a guessed schema version. / 随包安装指南明确将 WorkBuddy 列为使用 CodeBuddy 引擎的应用；因此采用共享来源名称，但不声明兼容所有未经测试的 WorkBuddy 桌面版本或导出。stream-json 标准输出具有不同 envelope，不是此处持久化输入格式。客户端版本仅是依据 metadata，不推断 schema 版本。

Read-only source anchors in the pinned package: / 固定包中的只读来源锚点：

- `dist-server/types/vendor/cbc-core/node/session/local-jsonl-session-store.d.ts`, `session-store-contract.d.ts`, `transcript-branch.d.ts`, `session-meta-keys.d.ts` and their implementation in `dist-server/codebuddy.js`: persistence, branch facts and session metadata. / 持久化、分支事实与会话 metadata。
- `dist/web-ui/docs/cn%2Fcli%2Finstallation.md` and `cn%2Fcli%2Fcodebuddy-dir.md`: config root and `projects/` native history. / 配置根与原生历史目录。
- Isolated real CLI probes with OpenRouter free models: user/assistant messages, readable reasoning, exact tool calls/results and request/model metadata. Producer access is only evidence collection; Analyzer reading and ordinary tests require no model, credentials or producer installation. / 使用 OpenRouter 免费模型的隔离真实 CLI 探针覆盖用户／助手消息、可读推理、精确工具调用／结果及请求／模型 metadata。Producer 访问仅用于收集依据；Analyzer 阅读与普通测试不需要模型、凭据或 producer 安装。

The compiled writer `dist-server/codebuddy.js` SHA-256 is `e52dbfacc3d1f7ec9b81e040a9b212c151b44494d50076afc88494065b94e916`. Additional typed evidence lives under `dist-server/types/vendor/cbc-shared/node/agent/{openai-agents-types,custom-input-item-types}.d.ts` and `dist-server/types/node/tools/{tool-protocol,file-change-artifact}.d.ts`. / 编译 writer 的 SHA-256 如上；额外类型依据位于所列 agent 与工具声明文件。

Fresh producer probes also recorded Write, Edit, successful and denied Bash, TaskCreate/TaskUpdate/TaskList, injected recovery prompts and a successful manual `/compact`. Manual compaction was an **assistant** message with `isSummary`, `isCompacted` and `isCompactInternal`, not a transport `system/compact_boundary`. Task `rawResponse.todos` held the active subset while `acpV2PlanSnapshot.entries` retained the complete list, including completed entries. / 新生成探针还记录了写入、修改、成功及拒绝的命令、任务创建／更新／列表、运行时恢复提示，以及成功的手动压缩。手动压缩是带所列标记的**助手**消息，不是传输层 compact_boundary；任务 todos 是活动子集，完整计划快照仍保留已完成条目。

## Selection and identity / 选择与身份

Use `--source workbuddy --workbuddy-home /path/to/config-root` or choose **WorkBuddy / CodeBuddy** in the project chooser. The root contains `projects/`, defaults to `CODEBUDDY_CONFIG_DIR` or `~/.codebuddy`, and can explicitly select a WorkBuddy-hosted engine root. Do not guess a desktop application's private storage location. / 使用所列 CLI 参数或项目选择器中的来源。根目录包含 `projects/`，默认使用所列环境变量或目录，也可显式选择 WorkBuddy 托管的引擎根；不猜测桌面应用私有存储位置。

Project association comes from recorded `cwd`, not decoding the container directory name. Native file identity and physical JSONL lines own Raw references. Source reads do not run tools, rewrite transcripts, fetch URLs or open arbitrary referenced files. / 项目关联来自记录中的 `cwd`，不解码容器目录名推断路径。原生文件身份与物理 JSONL 行拥有 Raw 引用。来源读取不执行工具、不重写转录、不请求 URL，也不打开任意引用文件。

## Mapping policy / 映射规则

User and assistant text, readable reasoning and exact tool calls/results use existing Main, search and Detail contracts. Native fields remain adapter-owned; generic session querying and browser rendering consume canonical contracts. Unknown or malformed shapes keep Protocol/Raw fallback rather than acquiring invented semantics. / 用户与助手文本、可读推理及精确工具调用／结果使用既有 Main、搜索与 Detail 契约。原生字段由 adapter 所有；共享会话查询与浏览器呈现消费 canonical 契约。未知或异常形态保留 Protocol／Raw 回退，不赋予虚构语义。

Tool pairing requires corroborating unique call identity, name and request evidence; ambiguous or missing results remain inspectable. Request intent is distinct from a successful file change, plan update or subagent relationship. Native result and renderer fields can improve readable presentation but cannot establish unrecorded outcomes. / 工具配对要求唯一调用 identity、名称及请求依据相互吻合；歧义或缺失结果仍可检查。请求意图区别于成功的文件修改、计划更新或子代理关系。原生结果及 renderer 字段可改善可读呈现，但不能建立未记录的结果。

Session metadata, usage, goals, checkpoints and other runtime facts retain traceability. In particular, cumulative terminal cost is not summed as per-turn cost, and duplicated model usage carried by multiple rows is not counted as distinct model requests. / 会话 metadata、用量、目标、检查点及其他运行时事实保留可追溯性；尤其不把终态累计费用逐条相加，也不把多行重复携带的模型用量视为多个请求。

### Implemented reading coverage / 已实现阅读覆盖

| Native evidence / 原生依据 | Presentation / 呈现 |
| --- | --- |
| Human/assistant message and `rawContent` reasoning / 人类／助手消息与推理 | Main readable text; injected meta/recovery prompts stay Protocol / 主层可读文本；注入的 meta／恢复提示保留在协议层 |
| Bash/PowerShell; Read/Write/Edit/MultiEdit / 命令与文件操作 | Command, requested paths/content/replacements, result and explicit exit/error evidence; actual diff only from a recorded patch receipt / 命令、请求路径／内容／替换、结果及明确退出／错误依据；仅从已记录 patch 回执展示实际 diff |
| Task/plan tools / 任务／计划工具 | Request and result; full ACP checklist retains completed entries, active subset is labeled separately / 请求与结果；完整 ACP 清单保留已完成项，活动子集另行标注 |
| Goal and explicit compaction / 目标与明确压缩 | Condition/outcome, recorded counters and readable summary; original Raw retained / 条件／结果、记录计数与可读摘要；保留原始记录 |
| Titles, model/usage, context, terminal/recovery facts / 标题、模型／用量、上下文、终态／恢复事实 | Recorded titles and bounded structured inspection, with Protocol/Raw traceability / 已记录标题与有界结构化检查，保留协议／原始追溯 |
| `projects/<project>/<parent>/subagents/<agent>.jsonl` | Separate physical session and path-evidenced parent link; child call references remain recorded metadata / 独立物理会话及目录结构证明的父级链接；子调用引用保留为已记录 metadata |
| REPL nested calls, artifacts and media references / REPL 嵌套调用、工件和媒体引用 | Bounded evidence inspection; no inferred nested execution tree or automatic external payload loading / 有界依据检查；不推断嵌套执行树，不自动加载外置 payload |

## Recorded history rather than active-lane replay / 已记录历史而非活动 lane 回放

The viewer presents physical recorded history, including earlier resend/rewind branches, with an explicit Protocol notice and native markers. It does not claim to reconstruct only the engine's current lane. Native IDs can repeat across adjacent response rows; treating every duplicate as corruption or blindly following one ID map would lose evidence. Compaction, rewind and retry facts remain visible rather than deleting historical work. / 查看器呈现完整物理记录历史，包括较早的重发／回退分支，并显示明确的 Protocol 提示及原生标记；不声称仅重建引擎当前 lane。相邻响应行可能重复原生 ID；将所有重复视为损坏或盲目沿单一 ID 映射会丢失依据。压缩、回退与重试事实保持可见，不删除历史工作。

## Limits and validation / 限制与验证

The adapter does not claim every desktop storage version, SDK/ACP stdout event or external media/artifact payload. Attachments and unsupported structured results retain evidence fallback; arbitrary file/URL references do not become executable navigation or downloads. Cross-file fork/subagent relationships require exact source evidence, not matching prose or reused IDs. / 适配器不声明支持所有桌面存储版本、SDK／ACP 标准输出事件或外置媒体／工件 payload。附件与未支持结构化结果保留依据回退；任意文件／URL 引用不会变成可执行导航或下载。跨文件 fork／子代理关系要求精确来源依据，不由相似文本或复用 ID 推断。

The [implementation plan](../exec-plans/completed/2026-10-31-workbuddy-adaptation.md) records actual mapping coverage, independent review and executed acceptance. Synthetic fixtures cover native shapes without real transcript content. Browser acceptance exercises search→tool Detail→Raw and Timeline/Trajectory at desktop and mobile widths. Real probe readback stays outside repository history. / [实施计划](../exec-plans/completed/2026-10-31-workbuddy-adaptation.md)记录实际映射覆盖、独立审查与已执行验收。合成 fixture 覆盖原生形态且不含真实转录内容；浏览器验收覆盖桌面／移动宽度下搜索→工具详情→Raw 及时间线／轨迹阅读。真实探针回读保留在仓库历史之外。
