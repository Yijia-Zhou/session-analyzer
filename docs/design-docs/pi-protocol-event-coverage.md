# pi protocol event coverage / pi 协议事件覆盖

## Evidence boundary / 依据边界

Reviewed 2026-10-23 against adapter baseline `209a8d1` and pinned `@earendil-works/pi-coding-agent` **1.4.0**, session **v3**. This inventory distinguishes interpreted behavior from merely retained evidence. It is not a claim of complete pi feature support or compatibility with future releases. / 本文于 2026-10-23 对照 adapter 基线 `209a8d1` 与固定的 **1.4.0** 包、session **v3** 审查；区分已解释行为与仅保留的依据，不声称完整支持 pi 功能或兼容未来版本。

Authoritative package paths are `docs/session-format.md`, `docs/message-types.md`, `dist/core/session-manager.{js,d.ts}`, `dist/core/messages.d.ts`, and `dist/core/tools/*.{js,d.ts}` inside that exact npm package. The review used a read-only extraction outside this repository. Upstream [session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md) and [message types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/message-types.md) are navigation links to moving sources; the pinned package takes precedence. No real transcript is included here. / 权威依据为固定 npm 包内所列路径；审查使用仓库外的只读解包。上游链接指向会变化的源码，仅供导航，以固定包为准；本文不包含真实转录。

Implementation: [storage](../../src/pi-storage.js), [branch/logical mapping](../../src/pi-logical.js), [Detail](../../src/pi-detail.js), [adapter lifecycle](../../src/pi.js). Contracts: [native sessions](pi-native-sessions.md), [source adapters](transcript-source-adapters.md), [schema runbook](schema-update-runbook.md). / 实现与契约见所列链接。

Status vocabulary: **R** = interpreted mapping or dedicated presentation; **G** = generic Protocol/Raw or JSON evidence, without richer semantics; **U** = source-defined but dedicated fixture/interpretation remains unverified; **N** = not a normal persisted JSONL record. R does not imply full field coverage. / 状态：**R** 已解释映射或专门展示；**G** 通用 Protocol／Raw 或 JSON 依据，不增加更丰富语义；**U** 来源已定义，但专门 fixture／解释尚未验证；**N** 非正常持久化 JSONL 记录。R 不表示覆盖全部字段。

## Entries / 记录类型

| Persisted shape / 持久化形态 | Baseline coverage / 基线覆盖 | Evidence / 依据 |
| --- | --- | --- |
| `session` v3 | R: header admission, cwd project ownership, branch notice; `parentSession` provenance only. / header 准入、cwd 项目归属及分支提示；parentSession 仅为来源信息。 | [pi tests](../../test/pi.test.js), [storage](../../src/pi-storage.js) |
| `message` | Role/block matrix below; unknown roles use `pi_message` fallback. / 角色及内容块见下表；未知角色回退。 | [logical](../../src/pi-logical.js) |
| `model_change`, `thinking_level_change` | G: searchable Protocol history; no replayed effective settings. Selected/virtual model must not replace physical assistant model. / 可搜索的 Protocol 历史，不重放生效配置；所选／虚拟模型不得替代实际响应模型。 | [pi tests](../../test/pi.test.js) |
| `usage` (arbitrary `kind`) | G: Protocol/Raw; no canonical token/cost totals. Unknown kind is valid upstream usage. / Protocol／Raw；无 canonical token／cost 总量；未知 kind 在上游仍为有效 usage。 | [pi tests](../../test/pi.test.js) |
| `compaction` | R: Main compaction summary, `firstKeptEntryId`, `tokensBefore`, `fromHook`; G: `systemMessage`, `usage`, extension `details`. Earlier history remains searchable. / Main 摘要及所列字段；其余为通用依据；早期历史仍可搜索。 | [pi tests](../../test/pi.test.js), [Detail](../../src/pi-detail.js) |
| `branch_summary` | R: Protocol summary and `fromId`; G: `usage`, `details`, `fromHook`. Summary is about the left path, not copied child messages. / Protocol 摘要及 fromId；其余通用保留；摘要描述离开的路径，不是复制的子消息。 | [pi tests](../../test/pi.test.js) |
| `context_edit` | R: Protocol target/replacement and whether target is an earlier ancestor; never edits historical text or accounting. / Protocol 目标、替换值及祖先检查；不修改历史文本或统计。 | [pi tests](../../test/pi.test.js) |
| `custom` | G: extension state; not model-context messages or fabricated tools. / 扩展状态；不是模型上下文消息，不推断工具。 | [pi tests](../../test/pi.test.js) |
| `custom_message` | R: conservative Protocol text, customType/display; G: details and image payload. display=false does not erase persisted evidence. / 保守展示 Protocol 文本与标识；details／图片通用保留；display=false 不删除依据。 | [pi tests](../../test/pi.test.js) |
| `label` | G: target and label, including absent label used to clear; no bookmark resolution. / 通用保留 target／label（缺失可表示清除），不解析书签。 | [pi tests](../../test/pi.test.js) |
| `session_info` | R: latest branch-local name contributes title; G: record itself. / 分支内最新名称参与标题，记录本身通用保留。 | [pi tests](../../test/pi.test.js) |
| Unknown/malformed complete rows | G: fallback; malformed bytes only through exact Raw readback, excluded from search/snippets. Torn final line excluded with diagnostic. / 回退；完整无效 JSON 字节仅经精确 Raw 读取，不进入搜索／预览；未完成末行排除并诊断。 | [adversarial](../../test/pi-adversarial.test.js), [regressions](../../test/pi-review-regressions.test.js) |

## Roles, content and runtime boundaries / 角色、内容及运行期边界

| Shape / 形态 | Baseline coverage / 基线覆盖 |
| --- | --- |
| `user` text/string | R: Main text; user starts a derived turn. Counts are rendered text-block events, not native messages/requests. / Main 文本；用户开启派生 turn；计数按展示文本块事件，不等同原生消息／请求数。 |
| `assistant` text/thinking | R: Main assistant/reasoning; empty/redacted thinking has no invented text. Signatures are opaque and excluded from search. / Main 助手文本／推理；空或隐藏 thinking 不补造文本；签名不透明且不进入搜索。 |
| Assistant metadata | R: scalar provider/model/API/stop reason in Detail, assistant usage JSON; G/U: responseModel/responseId, thinking levels, diagnostics, deferred handle, rawStopReason/endTurn. / Detail 展示标量上下文及 usage JSON；其余通用保留／未专门验证。 |
| Assistant `stopReason` | R: `error`/`aborted` produce issues; other reasons do not certify tool success. `length`, `toolUse`, `deferred`, `stop` remain recorded context. / error／aborted 产生问题事件；其他值不证明工具成功，其余保留上下文。 |
| `system` | G/U: generic `pi_message`, including prompt `sections` patches and toolsAdded/toolsRemoved; no effective prompt/tool replay. / 通用回退，包括 prompt 分区补丁及工具变更；不重放生效状态。 |
| `toolResult` | R: exact branch-local call pairing or unpaired Protocol; text output; G: arbitrary details and optional usage. / 精确分支内配对或未配对 Protocol、文本结果；details／可选 usage 通用保留。 |
| `bashExecution` | R: direct user shell command, output, exitCode/cancelled/truncated/excludeFromContext/fullOutputPath. It is not an assistant tool result. / 用户直接 shell 命令及所列字段，不是助手工具结果。 |
| `custom` message role | R: conservative Protocol text/type/display; no extension renderer execution. / 保守 Protocol 文本及标识，不执行扩展 renderer。 |
| `branchSummary`, `compactionSummary` roles | N for normal writer path: generated context messages come from summary entries; manually persisted roles receive generic fallback. / 正常 writer 不持久化这些派生上下文消息；手动写入则通用回退。 |
| Image/unknown content blocks | G: explicit Protocol/Raw evidence; paired tool-result images stay in Raw rather than Main text. No media fetch/preview. / Protocol／Raw 依据；已配对结果中的图片留在 Raw，不进入 Main 文本；不获取／预览媒体。 |
| Streaming deltas, `message_update`, `tool_execution_update`, partial `pending` assistant | N: runtime lifecycle/progress does not imply saved JSONL entries. / 运行期生命周期／进度不等同持久化记录。 |

Focused proof: [role/recency](../../test/pi-role-recency.test.js), [value boundaries](../../test/pi-value-boundaries.test.js), [adversarial pairing](../../test/pi-adversarial.test.js), [Detail bounds](../../test/pi-review-regressions.test.js). Source-defined rows marked U must gain minimized synthetic fixtures before claiming richer support. / 聚焦证明见所列测试；U 项需最小化合成 fixture 后才能声称更丰富支持。

## Tools and result details / 工具及结果 details

Baseline all assistant tools retain arguments, textual output, exact call IDs and Raw refs. Only `bash` becomes `command`; other names become `other_tool_call`. `read`/`write`/`edit` string paths populate touchedFiles, but baseline does not produce patch counts or reconstructed before/after files. / 基线所有助手工具保留参数、文本结果、精确调用 ID 与 Raw 引用；仅 bash 映射 command，其余为 other_tool_call。read／write／edit 字符串路径进入 touchedFiles，但基线不生成 patch 计数或重建修改前后文件。

| Tool/evidence / 工具依据 | Baseline / 基线 | Rich mapping boundary / 丰富映射边界 |
| --- | --- | --- |
| `read {path,offset?,limit?}`; `details.truncation` | G request/result/details JSON / 通用请求／结果／details | Source-defined read range/truncation; no disk read or assumed full file. / 来源定义范围／截断，不读取磁盘或假定完整文件。 |
| `write {path,content}` | G with touched path / 通用展示及路径 | A recorded requested rewrite is not proof of successful disk state. / 记录的请求不证明成功后的磁盘状态。 |
| `edit {path,edits:[{oldText,newText}]}`; `details {diff,patch,firstChangedLine?}` | G with touched path / 通用展示及路径 | Pinned native schema uses edits array; result-owned display diff and unified patch are distinct. Do not import older top-level oldText/newText semantics. / 固定 schema 使用 edits 数组；结果拥有的显示 diff 与统一 patch 不同，不套用旧式顶层字段。 |
| `bash {command,timeout?}`; details truncation/fullOutputPath | R command text; G details / 命令文本专门展示，details 通用保留 | Tool result does not generally persist exitCode; never infer it from terminal prose. Programmatic bash output schema differs from persisted toolResult envelope. / 工具结果通常不持久化 exitCode，不从文本推断；编程接口输出 schema 不同于持久化 envelope。 |
| Other built-in/extension names, namespaced tools | G generic calls / 通用调用 | A name alone does not establish built-in schema or namespace semantics. / 名称本身不证明内置 schema 或 namespace 语义。 |
| `nestedCalls {calls,complete}` | R bounded receipt JSON and incomplete notice; G malformed receipt / 有界回执与不完整提示；畸形形态通用回退 | Metadata only: no nested outputs, inferred ancestry, subagent Sessions or replay graph. / 仅 metadata，不含嵌套结果，不推断祖先、子 agent Session 或重放图。 |

A result completes a call only with one matching call ID and one later same-name result on that ancestor path. Duplicate, early, missing and sibling results remain unpaired/incomplete. isError must be an explicit boolean to establish completed success/failure. / 仅同一祖先路径内唯一调用 ID 与唯一、较晚、同名结果完成配对；重复、提前、缺失及兄弟结果保持未配对／不完整；必须显式布尔 isError 才建立完成状态。

### Implemented additions after the baseline / 基线后的已实现增量

The current working-tree increment adds [native tool shape checks and patch admission](../../src/pi-native-tools.js), integrated through [logical mapping](../../src/pi-logical.js) and [Detail](../../src/pi-detail.js). This section supersedes the corresponding baseline tool rows; other matrix gaps remain open. / 当前工作树增量增加原生工具形态检查与 patch 准入，并接入逻辑映射及 Detail；本节替代对应基线工具行，其他矩阵缺口仍保留。

- R: valid native read/write/grep/find/ls requests gain readable activity previews and recorded path facets; bash/powershell string commands gain their recorded shell language. Invalid argument shapes retain generic evidence. / 有效原生请求增加可读活动预览及记录路径；bash／powershell 字符串命令使用记录的 shell 语言；无效参数形态保持通用依据。
- R: a uniquely paired successful edit with native edits array and valid result.details.patch becomes a canonical patch, with result-owned hunks, path facets and patch statistics. Admission checks exact request-path headers, ordered ranges and complete hunk accounting; failed/incomplete edits and missing/invalid patches stay request activities with a notice. / 唯一配对成功的原生 edit 仅在结果 patch 有效时提升为 canonical patch，提供结果拥有的 hunk、路径及 patch 统计；准入检查精确请求路径 header、有序范围及完整 hunk 行数；失败／不完整及缺失／无效 patch 保持请求活动并提示。
- G remains intentional for arbitrary details/truncation JSON, images and extension overrides. Write shows recorded content without invented prior file state; no output file or fullOutputPath is opened. / 任意 details／截断 JSON、图片及扩展覆盖仍有意保留通用展示；write 展示记录内容，不补造旧文件状态，不打开结果文件或 fullOutputPath。

Focused [native-tool tests](../../test/pi-native-tools.test.js) cover successful/failed/malformed edits, result-owned patch search, large typed Detail bounds and index/materialization parity. [Browser acceptance](../../e2e/pi-native-tools.test.js) covers both locales and desktop/mobile rendering, Files counts, file activity and Raw. Execution counts and environment limitations belong to the [maturation plan](../exec-plans/active/2026-10-23-pi-reader-maturation.md); image/provider fixture gaps remain independent. / 原生工具测试覆盖成功／失败／无效修改、结果所属 patch 搜索、大型类型化详情边界及索引／物化一致性；浏览器验收覆盖双语、桌面／移动端、Files 计数、文件活动及 Raw。执行数量及环境限制记录在完善计划中，图片／provider fixture 缺口仍独立存在。

### Recorded state and usage additions / 记录状态及 usage 增量

The current [recorded-state helper](../../src/pi-recorded-state.js) supersedes the baseline G/U classification for dedicated system/model/thinking/usage receipts. Detail now explains named prompt patches and tool declaration changes, compaction checkpoints and context-edit effects; branch-local selection snapshots distinguish selected model from last recorded physical assistant model. This remains recorded evidence, not v3 context replay or a provider wire request. / 当前记录状态 helper 为 system／model／thinking／usage 提供专门回执，替代对应基线 G／U 状态；Detail 解释 prompt 分区补丁、工具声明变更、压缩 checkpoint 与 context edit 效果；分支内选择快照区分所选模型与最近实际响应模型。这仍是记录依据，不是 v3 上下文重放或 provider 请求。

Usage receipts cover assistant, nested tool work, standalone usage, compaction and branch summaries. Nonnegative finite numeric fields, explicit zero, missing/invalid coverage and recorded cost remain distinct. Branch Detail presents category-separated partial sums and eligible/missing-receipt/field coverage; it does not populate global canonical usage totals, infer billing/cache behavior or sum branches. [Recorded-state tests](../../test/pi-recorded-state.test.js) cover index/materialization, sibling isolation, invalid newer selection, absent receipts and overflow. / Usage 回执覆盖五类贡献项，区分非负有限数、明确零值、缺失／无效覆盖及记录费用。分支 Detail 展示分类部分和及候选记录／缺失回执／逐字段覆盖，不填充全局 canonical 总量、不推断账单／cache 行为，也不累加分支；测试覆盖索引／物化、兄弟隔离、较晚无效选择、缺失回执及溢出。

Runtime context replay and durable bookmarks remain explicitly deferred; see the [active maturation plan](../exec-plans/active/2026-10-23-pi-reader-maturation.md). / 运行期上下文重放及持久书签明确延后，见活动计划。

### Nested receipts and source navigation / 嵌套回执及来源导航

[Recorded nested-call presentation](../../src/pi-nested-calls.js) now renders bounded receipt counts, recorded success/error/unfinished outcomes, IDs, optional duration/argument-byte metadata, errors and arguments. At most 24 calls receive detailed sections; display truncation does not change the source completeness flag. This remains one outer operation: no nested output, independent tool count, subagent or dispatch graph is invented. Unsupported receipts retain fallback. / 嵌套调用展示增加有界回执计数、记录的成功／错误／未完成状态、ID、可选时长／参数字节数、错误及参数；最多详细展示 24 个调用，展示截断不改变来源完整性标记。仍属于一个外层操作，不补造嵌套输出、独立工具计数、子 agent 或 dispatch 图；不支持的回执保持回退。

Context-edit, label and compaction target navigation uses exact accepted same-branch earlier Raw records. A compaction whose firstKeptEntryId equals its own ID explicitly means retain no preceding conversation entries. Invalid-tree fallback receives no semantic state/usage interpretation. [Reading-evidence tests](../../test/pi-reading-evidence.test.js) cover these boundaries and complete Raw preservation; [browser tests](../../e2e/pi-reading-evidence.test.js) exercise actual target navigation and structured receipts. / Context edit、label 与 compaction 目标导航仅使用已接纳的同分支早期 Raw 记录；firstKeptEntryId 等于压缩自身 ID 时明确表示不保留先前对话。无效树回退不解释状态／usage 语义。阅读依据测试覆盖这些边界及完整 Raw 保留，浏览器测试实际操作目标导航及结构化回执。

## Identity and statistics contract proposals / 身份与统计契约提案

Grouping and branch-scoped accounting below are implemented presentation rules. Durable bookmarks and whole-native-session totals remain future contracts, not new API guarantees. / 下述分组及分支作用域统计为已实现呈现规则；持久书签及完整原生会话总量仍是后续契约，不是新增 API 保证。

1. Group branches by `(sourceKind, sourceSessionId)` within the admitted source root. Keep native artifact provenance separately. Current `pi:<encoded-session-id>:<encoded-leaf-id>` identifies a root-to-leaf snapshot; appending a child replaces that leaf Session ID. Never label a last-persisted entry as the current interactive cursor: navigation without persistence can move the cursor. / 在已接纳根目录内按所列身份分组，另保留物理工件来源。现有 ID 标识根到叶快照；追加子节点会替换叶 Session ID；最后持久化 entry 不等于当前交互游标，未持久化导航也可移动游标。
2. Durable entry references should include native session ID + entry ID, an admitted artifact/root discriminator, and block index when relevant. Resolve a historical entry to all containing descendant leaves or require an explicit branch; do not silently choose the newest sibling. Current canonical event/raw IDs include the leaf and are not permanent bookmarks. Exact byte evidence additionally needs accepted snapshot and physical line locator. / 持久引用应含原生 session ID、entry ID、已接纳工件／根标识，必要时加 block index；解析到所有包含它的后代叶或要求明确分支，不默选最新兄弟。当前 event／raw ID 包含叶，不是永久书签；精确字节依据还需快照与物理行定位。
3. Label branch statistics as path-scoped, including shared prefixes. Full native-session/project totals must deduplicate physical entries before aggregating, never sum leaf analyses. Distinguish artifact bytes/lines from branch-owned event counts; current bytes/lineCount describe the artifact. A tool call may be shared but have different completion on descendant branches; aggregate calls by call-entry/block and results by physical result entry rather than merging sibling outcomes. / 分支统计标明按路径且含共享前缀；原生会话／项目总量先按物理 entry 去重，不直接累加叶分析。区分工件字节／行数与分支事件数；当前 bytes／lineCount 描述工件。同一共享调用可在后代有不同完成状态，应分别按调用 entry／block 与结果 entry 统计，不合并兄弟结果。
4. Usage totals need explicit scope and attribution: assistant model work, toolResult nested model work, standalone usage entries (any kind), compaction usage and branch-summary usage are distinct persisted contributors. Deduplicate each physical contributor; do not also add a derived presentation event. `reasoning` is included in output; `cacheWrite1h` is a subset of cacheWrite. Preserve recorded cost rather than recomputing tariffs; do not sum main-model and nested-tool subtotals twice. Baseline exposes evidence only: tokenUsage is empty and tokenStats.maxObserved is a placeholder, not measured zero usage. / Usage 总量需明确范围及归属：助手、工具内嵌模型、独立 usage（任意 kind）、压缩及分支摘要是不同持久化贡献项。每个物理贡献项去重，不再累加派生展示事件。reasoning 已含在 output，cacheWrite1h 属于 cacheWrite 子集；保留记录费用，不重算价格，不重复累加主模型及工具子量。基线仅展示依据，空 tokenUsage 与占位 maxObserved 不代表实际用量为零。

## Validation / 验证

The initial inventory is pinned-source/static evidence; linked synthetic Node/browser tests validate implemented additions. The execution plan records actual local runs, independent review and hosted-CI limitations separately. Relative references and bilingual consistency are checked with each update. / 初始盘点为固定来源／静态依据；链接的合成 Node／浏览器测试验证已实现增量。执行计划分别记录实际本地运行、独立审查及 hosted CI 限制；更新时检查相对引用及双语一致性。
