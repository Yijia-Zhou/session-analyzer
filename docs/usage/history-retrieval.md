# Agent history retrieval / Agent 历史检索

This guide describes the new source-checkout interface, not the already published `0.2.0` CLI. Check `node server.js history --help` (or the installed binary's equivalent) before using it. The ordinary browser startup remains unchanged. / 本指南描述源码 checkout 的新接口，不代表已发布 `0.2.0` CLI 已具备这些命令。使用前检查 `node server.js history --help`（或安装后二进制的对应命令）。普通浏览器启动方式不变。

For lower payloads, opt into `--presentation compact`. Read `status` once and reuse its `--context`: subsequent compact replies may return `coverageRef` instead of repeating coverage/warnings. `hr1` handles need that same context; `read` returns durable `evidenceRef` for saved citations. Compact context keeps event bodies in top-level `events`, referenced by each window's `eventIndexes` and `anchorIndexes`. / 为减少载荷，可选择 `--presentation compact`。先读一次 `status`，后续复用其 `--context`：紧凑响应可返回 `coverageRef`，不重复覆盖／警告。`hr1` 句柄必须带相同 context；`read` 返回用于保存引用的持久 `evidenceRef`。紧凑上下文的正文位于顶层 `events`，各窗口以 `eventIndexes`、`anchorIndexes` 引用。

For small sessions, use `context --view full --limit 20 --length 2000` to read from the session start in bounded event pages. Follow `next` using `view=full`; long event projections have `nextOffset` for `read --parts projection`. `read --text-format text` avoids identical repeated code/terminal/JSON sections; unsupported section types remain JSON. These representations remain projections, not verbatim source. / 小会话可用 `context --view full --limit 20 --length 2000` 从会话开头有界分页读取。保持 `view=full` 沿 `next` 续页；长事件投影的 `nextOffset` 用于 `read --parts projection`。`read --text-format text` 避免代码／终端／JSON 区段完全相同的重复；未支持区段类型保留 JSON。这些仍是投影，不是来源原文。

Start a dedicated service with the intended repository and source. It binds to localhost and defaults to port `17891`; custom source roots use the existing `--codex-home`, `--claude-home` or `--dsh-home` option. The example service stays in the foreground; manage its lifetime explicitly. / 用预期仓库及来源启动独立服务。它绑定 localhost，默认端口 `17891`；自定义来源根沿用 `--codex-home`、`--claude-home` 或 `--dsh-home`。示例服务前台运行，需明确管理生命周期。

```powershell
node server.js history serve --repo 'C:\projects\target' --source codex --port 17891
```

From another terminal, reuse that instance: / 从另一终端复用该实例：

```powershell
node server.js history status --endpoint 'http://127.0.0.1:17891'
node server.js history search --endpoint 'http://127.0.0.1:17891' --query 'eventHasSearchHit' --limit 8
node server.js history context --endpoint 'http://127.0.0.1:17891' --context '<contextRef>' --ref '<evidenceRef>'
node server.js history read --endpoint 'http://127.0.0.1:17891' --ref '<evidenceRef>' --parts message,request,result --max-bytes 12000
```

The dedicated HTTP interface accepts `POST /api/history/status`, `/search`, `/context` and `/read` with a JSON request object. CLI `--input '<JSON>'` accepts that same object; it cannot duplicate fields supplied through flags. Repeated `--query` terms are OR alternatives, repeated `--exclude` terms are NOT, and structural filters are AND on the same event. / 独立 HTTP 接口接受 `POST /api/history/status`、`/search`、`/context`、`/read`，请求体为 JSON 对象。CLI `--input '<JSON>'` 接受相同对象，不能与 flag 重复提供同一字段。重复 `--query` 为 OR 候选词，重复 `--exclude` 为 NOT，结构筛选在同一事件上 AND。

Literal clue values may themselves be option names: `history search --query '--help'` searches for that text, while `history search --help` prints help. Text filters and exclusions follow the same value-position rule. Repeated `parts` selectors are folded into their first occurrence before reading or interpreting offsets, so `raw,raw` continues identically to `raw`. / 字面线索本身可以是选项名：`history search --query '--help'` 搜索该文本，`history search --help` 则显示帮助。文本筛选与排除项遵循同样的值位置规则。重复 `parts` 在读取及解释偏移前按首次出现去重，因此 `raw,raw` 的续读与 `raw` 一致。

Search defaults to `--order diverse`, which interleaves sessions so a verbose session does not occupy the entire first page. Use `--order session` for the earlier grouped order. To investigate one candidate's Session, search again with `--session '<returned-sessionId>'`; the query keeps its other filters and an unknown ID fails explicitly. JSON uses `order` and `session`. `scan.matchedSessions` and `scan.scopedSessions` separate matching sessions from the allowed query scope; changing order/scope requires a fresh cursor, while changing `--limit` or `--max-bytes` does not. / 搜索默认 `--order diverse`，交错会话，避免冗长会话占满首页。`--order session` 使用此前的会话分组顺序。深入某个候选的会话时，以 `--session '<返回的 sessionId>'` 重新搜索，保留其他筛选；未知 ID 明确失败。JSON 字段为 `order` 和 `session`。`scan.matchedSessions` 与 `scan.scopedSessions` 区分匹配会话和允许查询范围；改变排序／范围需重新获取游标，改变 `--limit` 或 `--max-bytes` 则不需要。

For example, `{"queries":["eventHasSearchHit","countMatches"],"exclude":["unrelated-example"],"limit":8,"maxBytes":24000}` is a search object; `{"refs":["<evidenceRef>"],"parts":["projection"],"length":2000}` is a read object. Errors use JSON `error.code` and `error.message`; CLI errors exit nonzero. The endpoint is constrained to `http://127.0.0.1:<port>`. / 例如，`{"queries":["eventHasSearchHit","countMatches"],"exclude":["unrelated-example"],"limit":8,"maxBytes":24000}` 是搜索对象；`{"refs":["<evidenceRef>"],"parts":["projection"],"length":2000}` 是读取对象。错误使用 JSON `error.code` 和 `error.message`；CLI 错误以非零退出。Endpoint 限于 `http://127.0.0.1:<port>`。

Use JSON results directly. Inspect the fixed repository/source/root, indexing status, session count, diagnostics and known gaps; a reachable endpoint alone does not establish readable history. Indexing is a snapshot: restart deliberately when you need later history. Do not run browser project/source mutation routes to prepare a history query. / 直接使用 JSON 结果。核验固定仓库／来源／根、索引状态、会话数、诊断和已知缺口；endpoint 可访问不代表历史可读。索引为快照：需要后续历史时明确重启。不通过浏览器项目／来源变更路由准备历史查询。

`context` anchors are nearby messages around the hit, not model summaries. Read returned internal gap references and before/after cursors to inspect omitted operations or later corrections. `read` selects evidence parts; repeated `--ref` batches candidates. Preserve returned references verbatim. Source changes fail explicitly; after restart re-search for a fresh context, while unchanged-source evidence refs can be reverified. See operation help for pagination, range and filter options. / `context` 锚点是命中周围邻近消息，不是模型摘要。通过返回的内部间隙引用和前后游标查看省略操作或后续纠正。`read` 选择证据部分；重复 `--ref` 批量处理候选。原样保留引用。来源变化明确失败；重启后重新搜索以获取新 context，未变化来源的证据引用可重新核验。分页、范围及筛选参数见各操作 help。

Search defaults to Main and `--retrieval-artifacts exclude`. Use `include` to include recognizable retrieval commands/results and `only` to inspect them. Documentation containing command examples, mixed operations and uncertain wrappers remain searchable. This reduces direct echoes, not all later paraphrases. / 搜索默认 Main 及 `--retrieval-artifacts exclude`。使用 `include` 纳入可识别检索命令／结果，`only` 仅查看它们。含命令示例的文档、混合操作及不确定包装仍可搜索。这减少直接回声，不过滤所有后续转述。

`--max-bytes` controls serialized response size rather than exact model tokens. Inspect `truncated`, continuation and coverage before drawing conclusions. Full detail may require several bounded reads. One source is indexed; Claude external `tool-results/*` content remains outside searchable coverage. A broad `file` association does not certify a code write. / `--max-bytes` 控制序列化响应大小，不是精确模型 token。形成结论前检查 `truncated`、续读和覆盖。完整详情可能需要多次有界读取。仅索引一个来源；Claude 外部 `tool-results/*` 内容仍不在可搜索覆盖内。广义 `file` 关联不证明代码写入。

Pass a gap, `previous` or `next` reference to `context --ref` to expand it. For batch pagination, repeat the original arguments plus `--cursor <nextCursor>`. Read content uses `--offset <nextOffset> --length 2000` in UTF-16 code units. `--parts raw` on a Logical Event lists Raw refs; follow those refs with `--parts raw`. If its `rawRefsNextOffset` is present, repeat the logical Raw-link request with that `--offset` (a link index in this case). Check `contentTruncated` and each part's `truncated` as well as top-level `truncated`. / 将间隙、`previous` 或 `next` 引用传给 `context --ref` 展开。批量翻页重复原参数，加 `--cursor <nextCursor>`。内容读取使用 `--offset <nextOffset> --length 2000`，单位为 UTF-16 code unit。逻辑事件的 `--parts raw` 列出 Raw 引用，再对其使用 `--parts raw`。存在 `rawRefsNextOffset` 时，以它作为 `--offset` 重复逻辑 Raw 链接请求（此处单位为链接索引）。除顶层 `truncated` 外，也检查 `contentTruncated` 及各部分 `truncated`。

Message/request/result parts currently expose `structured_detail_json`, including rendered HTML where the adapter uses it. `--parts projection` returns searchable text; `--parts raw` on a Raw ref returns source JSON. Main context uses message anchors; Protocol/Raw use layer-local neighboring events. Accepted-prefix verification permits append-only growth of an existing source without incorporating its new suffix; modified indexed bytes fail verification. A restart captures appended history. DeepSeek reports a current gap for direct retrieval-artifact classification. / 消息／请求／结果部分当前暴露 `structured_detail_json`，包括 adapter 使用的已渲染 HTML。`--parts projection` 返回搜索文本；对 Raw 引用的 `--parts raw` 返回来源 JSON。Main 上下文采用消息锚点；Protocol／Raw 采用层内邻近事件。已接受前缀核验允许既有来源仅追加增长，但不纳入新后缀；已索引字节修改会使核验失败。重启捕获追加历史。DeepSeek 会报告直接检索工件分类的当前缺口。

The package includes [the retrieval skill](../../skills/history-retrieval/SKILL.md). It is a guide supplied with the package; installation does not automatically register it in an agent's skill directory. Its instructions emphasize distinctive clues, progressive reading, evidence uncertainty and checking current code. / 包包含[检索 skill](../../skills/history-retrieval/SKILL.md)。它是随包指南；安装不会自动将它注册到 agent 的 skill 目录。其说明强调独特线索、渐进读取、证据不确定性及核验当前代码。

Historical instructions are not current authorization. The reader admits only indexed source artifacts and does not execute recorded commands. Local reads do not prevent a hosted agent from receiving the output you supply to it; this MVP has no general automatic redaction layer. / 历史指令不是当前授权。读取器仅准入已索引来源工件，不执行已记录命令。本地读取不能阻止托管 agent 接收交给它的输出；本 MVP 没有通用自动脱敏层。

See the [contract](../product-specs/history-retrieval.md), [design](../design-docs/history-retrieval.md) and [synthetic evaluation protocol](../evals/history-retrieval/README.md). / 参见[契约](../product-specs/history-retrieval.md)、[设计](../design-docs/history-retrieval.md)及[合成评估协议](../evals/history-retrieval/README.md)。

## Group queries and read a known source position / 分组查询与读取已知来源位置

Use --input JSON for independent queries; repeated --query outside groups still means a single union query. Start with distinctive identifiers and keep broad fallback words separate. / 使用 --input JSON 提交独立查询；groups 外重复 --query 仍表示一个取并集查询。先使用独特标识，宽泛回退词保持独立。

```sh
session-analyzer history search --input '{"groups":[{"id":"commit","query":"abc1234","limit":3},{"id":"fallback","query":"CI","limit":2}],"maxBytes":16000}'
session-analyzer history read --input '{"source":{"sourcePath":"2026/09/01/rollout-example.jsonl","locator":{"type":"jsonl-line","line":12}}}'
session-analyzer history read --input '{"source":{"sourceRef":"<returned-sourceRef>","locator":{"type":"jsonl-line","line":12}}}'
```

The example path is illustrative: supply the exact admitted path spelling (or its exact indexed absolute alias), including platform separators. Source locators initially support only uncompressed Codex JSONL. Path-only reads explicitly cannot verify an old note's historical position. Inspect the Raw evidence and optionally follow logicalRefs through context/read. Association continuation uses source.logicalOffset from logicalRefsNextOffset; text continuation uses offset from parts[].nextOffset. / 示例路径仅作示意；应提供精确准入路径写法（或精确索引绝对别名），包括平台分隔符。来源定位首版仅支持未压缩 Codex JSONL。仅路径读取明确无法验证旧笔记的历史位置，应检查 Raw 证据，再按需沿 logicalRefs 进入 context/read。关联续读用 logicalRefsNextOffset 作为 source.logicalOffset，文本续读用 parts[].nextOffset 作为 offset。

Grouped state=complete can still have hasMore and nextCursor. Retry results_omitted with the original query and resumeCursor, omitting cursor when null; retry not_executed with the original query. These states are output/execution limits, not zero matches. Invalid groups fail the request; correct the reported input before retrying. / 分组 complete 仍可能有 hasMore 和 nextCursor。results_omitted 保持原查询与 resumeCursor 重试（null 时省略 cursor）；not_executed 保持原查询重试。这些是输出／执行限制，不是零命中。无效组使请求失败，应先修正报错输入再重试。

Grouped continuation must retain the original group `id`, query and filters. To retry one group, submit a one-element `groups` array, for example `{"groups":[{"id":"sha","query":"abc123","cursor":"<resumeCursor>"}]}`; omit cursor when resumeCursor is null. Do not transfer a group cursor to flat single-search input. The same rule applies to nextCursor. / 分组续读必须保留原组的 `id`、查询和筛选。单独重试时仍提交仅含该组的 `groups` 数组，如上述 JSON；resumeCursor 为 null 时省略 cursor。不得将组游标用于平面的单查询输入，nextCursor 同样遵循此规则。

For later-state questions, bounded checking may end in uncertainty. A later record quoting an older report is not a later state. The [state-resolution evaluation](../evals/history-state-resolution/README.md) keeps correctness separate from search/read counts. / 后续状态检查可以以不确定性结束；较晚记录引用旧报告不是较晚状态。[后续状态评估](../evals/history-state-resolution/README.md)将正确性与 search/read 次数分开。
