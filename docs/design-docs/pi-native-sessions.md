# Native pi sessions / 原生 pi 会话

## Evidence and admission / 依据与准入

The adapter targets native JSONL **session version 3**, as declared by `CURRENT_SESSION_VERSION` in the installed `@earendil-works/pi-coding-agent` **1.4.0** package. Evidence is its `dist/core/session-manager.js`, matching `.d.ts`, `dist/core/messages.d.ts`, and `docs/session-format.md`; message blocks and usage types come from matching `@earendil-works/pi-ai` 1.4.0 declarations. These local package sources, synthetic fixtures and fresh sandbox writer sessions define the tested boundary; this is not a promise about every future pi 1.x release. / 适配器面向原生 JSONL **session version 3**，依据安装的 **1.4.0** 包所列源码、类型和文档；消息块及 usage 类型以对应 pi-ai 1.4.0 声明为依据。本地包源码、合成 fixture 及新建 sandbox writer 会话确定测试边界，不承诺覆盖未来所有 pi 1.x 发布。

Only version 3 is interpreted. Unsupported versions are skipped with source diagnostics. The analyzer never imports pi's session loader or invokes its migration/write paths. Reading does not use credentials, invoke models, run recorded tools, fetch remote media, or modify transcript files. / 仅解释版本 3；不支持版本跳过并提供来源诊断。Analyzer 不导入 pi 会话 loader，也不调用迁移／写入路径。读取不使用凭据、不调用模型、不运行记录中的工具、不获取远程媒体、不修改转录文件。

`--source pi` explicitly selects the adapter; `--pi-home` is the agent directory containing `sessions/`. The default is `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`. Project membership follows the header `cwd`, not a decoded directory name. Only the selected source is indexed. / 显式选择所列来源与参数；根为包含 `sessions/` 的 agent 目录。默认使用已设置的环境变量，否则使用所列用户目录。项目归属按 header 的 `cwd`，不按目录名解码；只索引当前来源。

Environment-derived agent paths follow pi 1.4.0 `config.getAgentDir()` / `utils/paths.normalizePath()`: expand `~` and home-relative paths, decode `file://` URLs, and normalize Windows shell drive paths on Windows. Explicit `--pi-home` retains the shared CLI path behavior. / 环境变量中的 agent 路径遵循 pi 1.4.0 所列函数：展开 `~` 与用户目录相对路径、解码 `file://` URL，并在 Windows 上规范化 shell 盘符路径。显式 `--pi-home` 保持共享 CLI 路径行为。

## Branch ownership / 分支归属

pi persists an append-only tree: each entry has `id` and `parentId`, while the header has no entry parent. File order alone does not establish conversational ancestry. The analyzer emits one canonical Session for each valid root-to-leaf path, with ID `pi:<encoded-header-id>:<encoded-leaf-id>` (ordinary native UUID/hex IDs remain unchanged), `sourceSessionId` equal to the native session ID and `sourceDerivedId` equal to the leaf. Titles include the branch tip. / pi 保存追加树：每个 entry 有 `id` 与 `parentId`，header 不属于 entry 父链；文件顺序本身不证明对话祖先关系。Analyzer 为每条有效根到叶路径产生一个 canonical Session，使用所列 ID（普通原生 UUID／hex ID 不变），原生会话 ID 写入 sourceSessionId，叶节点写入 sourceDerivedId，标题包含分支叶节点。

Shared prefixes intentionally appear in every containing branch. Main/Protocol/Raw queries, counts and details stay within the selected branch. Project queries may therefore report the same physical prefix in several Sessions. All leaves are exposed, without claiming that any leaf is pi's current active context. An append that extends a leaf changes its Session ID after rebuilding; append-only storage does not make tip-based IDs permanent bookmarks. / 共享前缀有意在每条所属分支出现。Main／Protocol／Raw 查询、计数与详情限定在所选分支；项目查询因而可能在多个 Session 中报告同一物理前缀。所有叶节点均可访问，不声称其中任一是 pi 当前活动上下文。追加延长叶节点后重建会改变其 Session ID；追加存储不使叶节点 ID 成为永久书签。

Tool result pairing is confined to the same ancestor path and exact call identity; siblings must never complete each other's tools. A graph with missing parents, duplicate IDs or cycles becomes a single `invalid-tree` Protocol/Raw fallback Session containing the artifact, rather than inferred Main activity. Safe malformed or unknown rows retain fallback visibility. An unfinished final line is excluded with `PI_TORN_TAIL`; complete malformed lines remain visible. Duplicate native session IDs across files are skipped with `PI_SESSION_ID_AMBIGUOUS`. `parentSession` is source provenance only; no cross-file fork ownership or inherited-context hierarchy is inferred. / 工具结果仅在同一祖先路径按精确调用身份关联，兄弟分支不得相互完成工具。父节点缺失、重复 ID 或循环使工件成为单个 invalid-tree Protocol／Raw 回退 Session，而不推断 Main 活动。安全的无效／未知行保持回退可见性。未完成末行排除并报告 PI_TORN_TAIL，完整的无效行仍可见。跨文件重复原生会话 ID 跳过并报告 PI_SESSION_ID_AMBIGUOUS。parentSession 仅为来源信息，不推断跨文件 fork 归属或继承上下文层级。

## Mapping and boundaries / 映射与边界

| Native evidence / 原生依据 | Reader meaning / 阅读含义 |
| --- | --- |
| User and assistant text / 用户与助手文本 | Main messages with recorded content / 按记录内容展示 Main 消息 |
| Assistant thinking / 助手 thinking | Persisted reasoning text; no reconstruction of hidden reasoning / 已保存推理文本，不重建隐藏推理 |
| Assistant toolCall and matching toolResult / 工具调用与匹配结果 | Branch-owned tool activity and original request/result evidence / 分支所属工具活动及原始请求／结果依据 |
| Model/thinking-level changes, usage / 模型及 thinking level 变化、usage | Protocol source history; no inferred billing or cache state / Protocol 来源历史，不推断账单或 cache 状态 |
| Compaction, branch_summary, context_edit / 压缩、分支摘要、context edit | Recorded transitions; original history stays readable / 记录的变更，原始历史仍可阅读 |
| Custom entries/messages, labels, session_info / 自定义项／消息、标签、会话信息 | Conservative source evidence and Raw traceability / 保守保留来源依据与 Raw 追溯 |
| Unknown records / 未知记录 | Protocol/Raw fallback / Protocol／Raw 回退 |

This is a history reader, not `buildSessionContext()` or a replay engine. Compaction and context edits do not delete earlier text from history or search, and extension data does not acquire fabricated tool semantics. Image bodies and signatures are excluded from text search; source evidence remains available through Raw. Image preview support and source-specific rich extension rendering are outside this increment. / 这是历史阅读器，不是 buildSessionContext() 或重放引擎。压缩和 context edit 不从历史或搜索删除较早文本，扩展数据不被赋予伪造工具语义。图片正文及签名不进入文本搜索，来源依据仍可通过 Raw 访问。本轮不提供图片预览或来源专属扩展富渲染。

Native `read`, `write` and `edit` remain tool activities with recorded arguments, textual results, path facets and supplemental result details; this increment does not promote them into the analyzer's patch/diff model. Native Code Mode stays one outer tool operation. Its persisted `nestedCalls` receipt is shown as supporting evidence, with completeness and absent-result limits; it does not create independent nested Logical Events or infer nested output. `bashExecution.fullOutputPath` remains a reference and is not read from disk. / 原生 read、write 与 edit 保持工具活动，展示记录的参数、文本结果、路径筛选及补充结果详情；本轮不将其提升为 Analyzer 的 patch／diff 模型。原生 Code Mode 保持单个外层工具操作；已保存 nestedCalls 回执作为支持依据展示，并说明完整性与缺少结果的限制，不创建独立嵌套逻辑事件或推断嵌套输出。bashExecution.fullOutputPath 保持引用，不读取对应磁盘文件。

Detail presentation bounds each section's JSON depth, node count, array length and object width before shared contract validation. Oversized arguments, result details, nested-call receipts, context replacements and residual/Raw Detail values show omission markers with the original Raw References. Search and physical Raw readback retain the accepted evidence; presentation truncation is not a transcript rewrite or a change to the source receipt's `complete` flag. / 详情展示在共享契约校验前限制各 section 的 JSON 深度、节点数、数组长度及对象宽度。超限参数、结果详情、嵌套调用回执、context 替换及 residual／Raw Detail 值显示省略提示并保留原始 Raw References。搜索及物理 Raw 回读保留已接纳依据；展示截省不会改写转录，也不改变来源回执的 `complete` 标记。

Depth limiting starts during indexing/materialization, before recursive sanitization of cached Raw and logical display values. Valid JSON search still traverses the original record iteratively, so deep readable text remains searchable. Raw Detail and the physical readback's `parsed` companion are sanitized, depth-bounded previews; its `raw` string retains the exact accepted line, including omitted or opaque content. This also keeps HTTP response encoding safe for deeply nested records. / 深度限制从索引／物化阶段开始，在递归清理缓存 Raw 与逻辑展示值之前生效。合法 JSON 搜索仍迭代遍历原始记录，因此深层可读文本保持可搜索。Raw Detail 与物理回读的 `parsed` 字段是经过清理且有深度上限的预览；`raw` 字符串保持已接纳行的原文，包括被省略或不参与搜索的内容。这也避免深层记录使 HTTP 响应编码溢出。

Malformed JSON has no trusted field boundaries. Its text is excluded from search and snippets in every layer; a generic malformed-record description remains searchable in Protocol/Raw. Explicit Raw viewing/readback retains the original evidence. No regex-based partial recovery is used to guess which broken fields are safe. / 无效 JSON 没有可靠的字段边界，其文本不进入任何层的搜索或摘要；Protocol／Raw 可搜索通用的无效记录说明。显式 Raw 查看／回读保留原始依据，不通过正则局部恢复来猜测损坏字段中哪些内容可安全搜索。

## Indexed/Materialized lifecycle / 索引／物化生命周期

The adapter uses `indexed-materialized-v1`, the shared project query store and source-neutral Detail/Raw APIs. The Indexed Session retains its accepted physical prefix and digest rather than full message bodies. Cold materialization re-parses that same prefix and selected leaf; the projection digest must agree with indexing. Logical and Raw evidence carry source locators back to physical JSONL lines. Legacy file/line lookup is disabled because one physical record can belong to several branch Sessions. / 适配器复用所列生命周期、共享项目查询存储及来源中立的详情／Raw API。Indexed Session 保存已接纳物理前缀及摘要，而非完整消息正文。冷物化重新解析相同前缀及所选叶节点，查询投影摘要须与索引一致。逻辑与 Raw 依据通过 source locator 指向物理 JSONL 行。一个物理记录可属于多分支，因此禁用旧式文件／行查找。

Index discovery retains only per-artifact identity and snapshot metadata between files, then reconstructs one artifact at a time for projection. Each artifact is still fully parsed in memory, and branch paths duplicate shared ancestry; this increment makes no large-tree or unlimited-capacity claim. / 索引发现阶段跨文件仅保留每工件身份与快照元数据，再逐工件重建投影。单个工件仍在内存中完整解析，分支路径重复共享祖先；本轮不声称支持无限容量或已验证大型分支树性能。

Appending beyond the accepted prefix does not mix new records into the existing snapshot. Rebuild to include the append. Mutation, truncation or deletion of accepted evidence fails `INDEXED_SOURCE_STALE`; history retrieval translates unavailable snapshot evidence to `STALE_REFERENCE`. Rebuild/restart and search again for new evidence references. Reading saved history does not promise live monitoring. / 在已接纳前缀之后追加不会把新记录混入旧快照；需要重建才能纳入追加内容。已接纳依据被修改、截断或删除时报 INDEXED_SOURCE_STALE；history 检索将不可用快照依据转换为 STALE_REFERENCE。重建／重启并重新搜索以获取新依据引用。阅读已保存历史不承诺实时监控。

## Acceptance evidence / 验收依据

Synthetic contract, branch, HTTP and history tests live in `test/pi*.test.js`; shared adapter conformance, source switching and package checks cover integration. The [execution plan](../exec-plans/completed/2026-10-22-pi-native-source.md) records actual validation outcomes and the distinction between sandbox writer/API evidence and human TUI interaction. / 合成契约、分支、HTTP 与 history 测试位于所列文件；共享适配器契约、来源切换及包检查覆盖集成。[执行计划](../exec-plans/completed/2026-10-22-pi-native-source.md)记录真实验证结果，并区分 sandbox writer／API 依据与人工 TUI 操作。
