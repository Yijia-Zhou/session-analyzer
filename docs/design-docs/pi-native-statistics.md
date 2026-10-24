# pi whole-native statistics / pi 完整原生统计

## User question and scope / 用户问题与范围

After trying approach A, returning to shared history and completing B, a reader needs both branch-local evidence and the work recorded across the native tree. Adding branch totals repeats shared ancestors. The native overview therefore counts physical records once and offers a separate, initially collapsed statistics disclosure; the existing models/usage action explicitly opens the selected branch. / 尝试 A、回到共同历史并完成 B 后，读者既需要分支内依据，也需要原生树中保存的工作总量。累加分支会重复祖先，因此原生概览按物理记录计一次，并提供独立、默认折叠的统计；原模型／用量入口明确打开所选分支。

The unit is one admitted JSONL artifact at its accepted snapshot, not a project, lineage across files, active runtime context or provider bill. Native counts do not change canonical Session IDs, Main/Protocol/Raw rows, branch counts, file activity, analysis, tokenUsage, tokenStats or query projection digests. / 单位是已接纳快照中的单个准入 JSONL 工件，不是项目、跨文件谱系、活动运行期上下文或 provider 账单。原生计数不改变 canonical Session ID、Main／Protocol／Raw 行、分支计数、文件活动、analysis、tokenUsage、tokenStats 或查询投影摘要。

## Physical contributors / 物理贡献项

`src/pi-native-statistics.js` reduces the already verified parsed document without retaining a second ledger or full payload copies. Physical line identity is local to the admitted artifact/snapshot; assistant tool requests additionally use content-block position. Tool call IDs and leaf-bound event IDs are not deduplication keys. / 统计模块汇总已验证的解析文档，不保留第二份贡献项列表或完整 payload 副本。物理行身份限定于准入工件／快照，助手工具请求另以内容块位置区分；工具 call ID 和含叶身份的事件 ID 不作去重键。

| Count / 计数 | Meaning / 含义 |
| --- | --- |
| `rawRecords` | Accepted nonblank rows including the header. / 含 header 的已接纳非空行。 |
| `entryRecords` | All accepted rows after the header. / header 后全部已接纳行。 |
| `unlinkedRecords` | Entry rows excluded from the admitted entry map, including malformed or missing-ID records. / 未进入准入 entry 映射的行，含无效 JSON 或缺 ID 记录。 |
| `malformedRecords` | JSON parse failures; a subset of unlinked records, not an additional total. / JSON 解析失败，是未关联行的子集，不是额外总量。 |
| Message roles / 消息角色 | One admitted physical message per role, including empty, image-only and multiple-block messages. / 每条准入物理消息按角色计一次，含空、仅图片及多块消息。 |
| `assistantToolRequests` | Each assistant `toolCall` block, even if its call ID cannot support pairing; request evidence does not prove execution. / 每个助手 toolCall 块，包括无法用于配对的 call ID；请求依据不证明执行。 |
| `toolResultMessages` | Each physical tool-result message independently of pairing, success or failure. / 每条物理工具结果独立计数，不依赖配对或成败。 |
| `directShellExecutions` | Direct `bashExecution` records, kept separate from other messages and assistant requests; cancellation and excluded-context flags do not remove a record. / 直接 bashExecution 记录，与其他消息和助手请求分列；取消或排除上下文不删除记录。 |

A shared request with two sibling results is one request and two result records. Duplicate, early, wrong-name or orphan result identities do not invent a match. Native success/failure and patch totals remain deferred because pairing and patch admission can differ by descendant branch, including when a later duplicate makes a previously unique identity ambiguous. / 共享请求及两个兄弟结果计为一个请求、两条结果。重复、提前、名称不符或孤立的结果身份不补造关联。原生成败及 patch 总量延后，因为配对及 patch 准入可随后代分支改变，包括较晚重复使原先唯一身份变为歧义。

Semantic contributors require admitted tree entries. Loose rows remain in physical counts and explicit coverage, without acquiring message or usage semantics. Invalid trees retain the existing navigation-unavailable behavior; they do not fabricate zero semantic activity. / 语义贡献项要求准入树 entry。游离行进入物理计数及明确覆盖，不获得消息或用量语义；无效树保持现有导航不可用行为，不伪造零语义活动。

## Recorded usage / 已记录用量

The scope-neutral reducer retains the existing branch reducer's contract. Native usage visits each physical eligible entry once, with separate `assistant`, `tool_nested_model_work`, `usage`, `compaction` and `branch_summary` groups. No arbitrary kind/model grouping or cross-category grand total is added. / 范围中立汇总保留现有分支汇总契约。原生用量对每条符合条件的物理 entry 访问一次，分别保留所列五类；不新增任意 kind／model 分组或跨类别总和。

Each category exposes eligible records, records lacking a usage property and receipts. A receipt means the usage property exists, including null or malformed values; it does not mean valid usage. Each numeric field exposes its recorded partial sum, recorded/missing/invalid counts and overflow. Missing fields among receipts and records without a receipt are separate coverage facts. Zero remains zero; unknown and overflow sums remain null and are labelled distinctly in the UI. / 每类提供符合条件记录、缺 usage 属性记录及回执数。回执指存在 usage 属性，含 null 或无效值，不等于有效用量。每个数值字段提供已记录部分和、已记录／缺失／无效数及溢出；回执内缺字段与整条记录缺回执是不同覆盖事实。零保持为零，未知和溢出部分和为 null，界面分别标注。

Reasoning is included in output and cacheWrite1h is included in cacheWrite; these fields must not be added again. Standalone or nested work is not attributed to the currently selected model. No cost, currency, price, provider-attempt count or final request is reconstructed. Recorded per-entry costs remain available in existing Detail. / reasoning 已含在 output，cacheWrite1h 已含在 cacheWrite，不重复相加；独立或嵌套工作不归因于当前所选模型。不重建费用、币种、价格、provider 尝试次数或最终请求；逐条已记录费用仍可从现有 Detail 检查。

## Read boundary and presentation / 读取边界与展示

`readPiNavigation()` adds a fixed-shape `nativeStatistics` object with schemaVersion 1, scope `native_session`, basis `accepted_physical_records`, sourceSessionId/sourceFile, counts and usageByCategory. It reuses existing source/project/index-revision leases and accepted-prefix, digest and file-identity checks. Appending does not change an old accepted snapshot; rebuilding admits the additional records. Branch/label display caps do not cap native statistics. No canonical schema or persistent index format changes. / 导航读取增加固定形状的所列 DTO，复用来源／项目／索引 revision lease 及已接纳前缀、摘要、文件身份校验。追加不改变旧快照，重建后才接纳新记录；分支／标签展示上限不截断原生统计。不改变 canonical schema 或持久索引格式。

The browser uses the existing overview request owner, so late responses cannot replace another source/project/index/session. The native disclosure starts closed. Category summaries and field coverage use wrapping rows for English desktop and Chinese mobile; unknown usage is never displayed as zero. / 浏览器复用现有概览请求 owner，迟到响应不能替换其他来源／项目／索引／会话。原生统计默认收起，类别摘要及字段覆盖在英文桌面和中文移动端采用可换行布局，未知用量不显示为零。

## Evidence and remaining work / 依据与剩余工作

Synthetic [statistics tests](../../test/pi-native-statistics.test.js), existing [branch accounting](../../test/pi-file-accounting.test.js) and [browser workflows](../../e2e/pi-navigation.test.js) cover the contract. Execution results, independent review and private-corpus readback belong in the [execution plan](../exec-plans/completed/2026-10-24-pi-native-statistics.md). No real transcripts or screenshots are committed. / 合成统计、既有分支核算及浏览器工作流覆盖契约；实际检查、独立审查和私有语料回读记录于执行计划。不提交真实转录或截图。

This removes shared-prefix duplication from native accounting only. Branch search hits and query-store rows still repeat. The next storage increment may share exact encoded disk text ranges with bounded builder/request caches while preserving branch IDs, row ordering and projection digests; projected equality, not physical call identity alone, must authorize reuse. Full context projection, cross-file navigation, extension semantics and branch-qualified native patch totals remain independent work. / 本批仅消除原生核算中的共享前缀重复，分支搜索命中及查询存储行仍重复。后续存储增量可用有界 builder／request 缓存共享精确编码的磁盘文本范围，同时保留分支 ID、行序和投影摘要；复用依据须为投影相等，不能只靠物理调用身份。完整上下文投影、跨文件导航、扩展语义及按分支准入的原生 patch 总量单独推进。
