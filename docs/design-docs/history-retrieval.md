# History retrieval design / 历史检索设计

Status: accepted implementation direction, 2026-09-23. / 状态：已接受实现方向，2026-09-23。

## Boundary / 边界

The history service reuses source adapters, canonical Logical Events, ProjectQueryStore projections and Structured Detail. Its CLI and dedicated HTTP surface share one read service. The browser's mutable active source/project is never used as a retrieval context. A headless instance fixes one source/root/project and indexes once at startup. Restart explicitly to discover later history. / 历史服务复用 source adapters、规范逻辑事件、ProjectQueryStore 投影及结构化详情。CLI 与独立 HTTP 入口共享读取服务。浏览器可变的活动来源／项目不作为检索上下文。Headless 实例固定一个来源／根／项目，在启动时索引一次；明确重启以发现后续历史。

Candidate discovery uses compact query projections. Context/read materialize only selected sessions and share materialization within one request; later requests verify sources again. The service introduces retrieval projections, not canonical events, inferred decision states or new transcript parsers. Existing UI hit counts, snippets, file-filter meaning and Raw Reference ownership remain intact. / 候选发现使用紧凑查询投影；context/read 仅物化选定会话，在同一请求内共享物化结果；后续请求重新核验来源。服务新增检索投影，不新增规范事件、推测决策状态或转录解析器。保持既有 UI 命中计数、摘录、文件筛选含义和 Raw Reference 归属。

## Identity and scope / 标识与范围

Evidence references encode a versioned source/project/session/event locator plus the admitted source snapshot identity. Validate decoded shape and project/source membership before materialization; adapters verify source evidence during materialization. Obtain file paths only from admitted index metadata, never from arbitrary reference payload paths. Re-resolve events by identity, never by filtered `timelineIndex`. Incompatible source changes invalidate old evidence instead of rebinding a position. Context references bind to the running instance; pagination cursors additionally bind to operation parameters. Changing filters requires a new pagination sequence, while restarting expires the context. / 证据引用编码版本化来源／项目／会话／事件定位及准入来源快照标识。物化前验证解码形状及项目／来源归属，adapter 在物化期间核验来源证据。仅从准入索引 metadata 获取文件路径，不能读取引用载荷的任意路径。按身份重定位事件，不用筛选后的 `timelineIndex`。不兼容来源变化使旧证据失效，不将位置重新绑定。上下文引用绑定运行实例；分页游标另外绑定操作参数。改变筛选需开始新的分页序列，重启则使 context 过期。

Self-contained evidence locators can be reverified after restart. They depend on accessible source artifacts and matching event interpretation; they are not global IDs, cryptographic attestations, immutable content archives or UI deep links. Conservative invalidation is preferable to reading a different event. / 自包含证据定位符可重启后重新核验，依赖可访问来源工件和一致的事件解释；它们不是全局 ID、加密证明、不可变归档或 UI 深链接。保守失效优于读到其他事件。

Compact `er2` locators carry 132-bit SHA-256 prefixes for scope, session, snapshot and event identity; resolution checks collisions instead of choosing an arbitrary match. They need no process-local handle table to survive a restart. Older `er1` locators remain readable. Range locators also preserve navigation direction: backward pages consume a range's suffix when callers reduce the limit, so earlier unread events remain under `previous`. / 紧凑 `er2` 定位符携带范围、会话、快照和事件身份的 132 位 SHA-256 前缀；解析时检查碰撞，不任意选择匹配项。它们不依赖进程内句柄表即可跨重启读取。旧 `er1` 引用仍可读。范围定位符另外保留导航方向：调用方减小 limit 时，向前翻页从范围末尾读取，使更早未读事件继续留在 `previous` 中。

## Disclosure and ordering / 披露与顺序

Search yields bounded event candidates, not only the newest match in each session. Deterministic ordering and cursor continuation are reproducible within a snapshot; sophisticated relevance ranking is deferred. Search text is a literal clue, not a Boolean DSL. The existing `file` filter remains a broad recorded association (including transcript/Raw paths), not proof of a write. / 搜索返回有界事件候选，不只返回每会话最新命中。确定性排序与游标续读在快照内可复现；复杂相关性排序后置。搜索文本是字面线索，不是布尔 DSL。既有 `file` 筛选仍为广义已记录关联（含转录／Raw 路径），不证明写操作。

Context uses the U−/A−/H/A+/U+ rule from the [product contract](../product-specs/history-retrieval.md). The complete session order supplies boundaries even when a search filters to failures or tools. Ordered intervals between displayed anchors become expandable gaps; previous/next range references reach the remaining prefix/suffix without wrapping. Neighboring records establish adjacency only. Sources may expose explicit session relationships, but context never silently concatenates sessions. / 上下文采用[产品契约](../product-specs/history-retrieval.md)的 U−/A−/H/A+/U+ 规则。即使搜索只筛失败或工具，也由完整会话顺序确定边界。展示锚点之间的有序区间成为可展开间隙；previous/next 范围引用无循环地访问其余前缀／后缀。邻近记录仅证明邻近。来源可提供明确会话关系，但上下文不悄悄拼接会话。

Readable excerpts preserve line structure when available and declare whether their basis is a message, request, result or search projection. Raw reads retain source traceability. Byte accounting must include the serialized envelope and UTF-8 content, preserve valid JSON, and expose continuation rather than silently losing omitted items. Tiny budgets may be rejected when even the envelope cannot fit. / 可读摘录在可用时保留行结构，说明依据为消息、请求、结果或搜索投影。Raw 读取保留来源追溯。字节核算需包含序列化外层及 UTF-8 内容，保持有效 JSON，并通过续读暴露省略项。预算小到外层都无法容纳时可以拒绝。

## Direct retrieval echoes / 直接检索回声

Search first applies the requested layer and predicates to compact projections. Only sessions with potentially classifiable matching calls/results receive the Raw retrieval-hint scan and, when indicated, source materialization. Unrelated stale sources therefore cannot block matching evidence in another session. Classification can still add cost when a matching session also mentions this tool in documentation. DeepSeek compact Raw records currently cannot support this classification and expose a coverage gap. / 搜索先对紧凑投影应用所选层及筛选条件。只有存在可分类候选调用／结果的会话才扫描 Raw 检索线索，并在需要时物化来源。因此无关失效来源不会阻断另一个会话的匹配证据。匹配会话同时在文档中提及本工具时，分类仍可能增加成本。DeepSeek 紧凑 Raw 记录当前不能支持该分类，需暴露覆盖缺口。

A conservative recognizer examines structured tool requests for supported direct `session-analyzer history search/context/read` invocations and links their results using existing call relationships. Producer/operation fields help recognize the output but are not authentication. Unrecognized wrappers and mixed operations remain ordinary evidence. Classifications are retrieval-only, reversible and applied before candidate limits; they do not mutate events or establish that repeated text is independent evidence. / 保守识别器检查结构化工具请求中受支持的直接 `session-analyzer history search/context/read` 调用，利用既有调用关系关联结果。Producer/operation 字段帮助识别输出，但不是认证。未识别包装和混合操作仍是普通证据。分类仅作用于检索，可逆，先于候选限制应用；不修改事件，也不证明重复文本是独立证据。

## Alternatives and risks / 备选与风险

Adapters verify accepted source prefixes: append-only growth can preserve an existing running snapshot, while changes to indexed bytes fail. New suffixes are absent from old search projections; restart to include them and acquire new snapshot references. / Adapter 核验已接受来源前缀：仅追加增长可以保留运行中快照，而已索引字节变化会失败。旧搜索投影不包含新后缀；需重启纳入并获取新快照引用。

- Reusing `/api/source` and `/api/project` was rejected: concurrent readers would change user UI state. Fixed instances cost another process but isolate scope simply. / 拒绝复用 `/api/source` 和 `/api/project`：并发读取会改变用户 UI 状态。固定实例增加进程，但以简单边界隔离范围。
- A fresh index per command was rejected because progressive disclosure needs several cheap calls. Automatic daemons are deferred to avoid hidden lifecycle/configuration changes. / 拒绝逐命令建索引，因为渐进披露需要多次低成本调用。自动 daemon 后置，避免隐式生命周期／配置变化。
- Vector search, summarization and semantic segment classification are deferred until failure evidence shows they are needed; lexical retrieval can miss vocabulary changes and must disclose its scope. / 向量搜索、摘要及语义分段分类后置，等待失败证据证明必要性；词法检索可能漏掉术语变化，必须声明范围。
- Full shell parsing for echoes risks suppressing real development evidence. Narrow admission deliberately leaves some direct echoes and all unproven paraphrases searchable. / 完整 shell 回声解析有误删真实开发证据风险。窄准入有意保留部分直接回声及所有未获证明的转述。
- Snapshot checks detect source changes but do not retain removed history. Output budgets bound transfer, not necessarily indexing cost or the memory needed to materialize a large selected session. / 快照检查发现来源变化，但不保存已删除历史。输出预算约束传输，不必然约束索引成本或大型选定会话物化所需内存。

See [evaluation protocol](../evals/history-retrieval/README.md) for isolated, synthetic evidence-based tasks and honest reporting requirements. / 关于隔离、基于合成证据的任务及如实报告要求，参见[评估协议](../evals/history-retrieval/README.md)。
