# Search mechanics / 搜索细节

Read before composing filters or combining queries, and when recovering grouped pages or investigating retrieval echoes. / 组合筛选或合并查询前，以及恢复分组页或调查检索回声时阅读。

Search specific identifiers first. Keep broad terms as independent fallback queries: adding `CI` to a union with two SHAs broadens the match set rather than narrowing it. Pass repeated `--query` for an intentional literal OR; the text `A OR B` is one literal phrase. A paraphrase from a summary may not appear verbatim in the source; prefer its original identifier or evidence locator. / 优先搜索具体标识，将宽泛词作为独立回退查询：把 `CI` 与两个 SHA 合并取并集会扩大匹配，而非收窄。需要字面词组的 OR 时重复 `--query`；文本 `A OR B` 是一个完整字面短语。摘要改写未必逐字出现在来源中，优先使用原始标识或证据定位。

Default `--order diverse` spreads candidates across matching sessions; it does not rank decisions by importance. Use `--session <returned-sessionId>` to search one promising Session, or `--order session` for grouped browsing. Preserve the original query/order/scope when using `nextCursor`; page size and byte budget may change. / 默认 `--order diverse` 使候选覆盖不同匹配会话，不按决定重要性排名。使用 `--session <返回的 sessionId>` 深入搜索一个有价值的会话，或用 `--order session` 分组浏览。使用 `nextCursor` 时保留原查询／排序／范围；页大小和字节预算可以改变。

Search is literal. Repeated `--query` is allowed; `--kind` takes one value and cannot be repeated. To inspect multiple kinds, search each separately or omit that filter. Repeatability is specific to each option. Repeated `--exclude` terms are NOT; structural filters are AND on the same event. `--query '--help'` searches that literal option name. Changing query/order/scope needs a fresh search; page size and byte budget may change during continuation. / 搜索为字面匹配。允许重复 `--query`；`--kind` 只接受一个值，不可重复。查看多种 kind 时分别搜索，或省略此筛选。能否重复取决于各选项。重复 `--exclude` 为 NOT；结构筛选在同一事件上 AND。`--query '--help'` 搜索该选项名字面文本。查询／排序／范围改变时重新搜索；续读时可改变页大小和字节预算。

## Independent query groups / 独立查询组

When capabilities include `queryGroups`, use `search --input '{"groups":[{"id":"sha","query":"abc123","limit":3},{"id":"fallback","query":"CI","limit":2}]}'` for independent queries in one call; each group keeps its own counts, cursor and budget. Top-level `maxBytes` limits the entire response. A `not_executed` group has unknown counts; `results_omitted` was scanned but returned no candidates. Retry either group separately with its original query; for `results_omitted` preserve `resumeCursor` if non-null (otherwise omit cursor). Only `state=complete` uses `nextCursor` for subsequent candidates. Never treat an omitted/unexecuted group as zero hits. A group's `complete` state means this request ran, not that all its candidates have been read. / 能力包含 `queryGroups` 时，使用上述 `search --input` 示例一次提交独立查询，各组保留自己的计数、游标及预算；顶层 `maxBytes` 限制整批。`not_executed` 的计数未知；`results_omitted` 已扫描但未返回候选。两者都可保持原查询单独重试；后者保留非 null 的 `resumeCursor`，为 null 时省略 cursor。只有 `state=complete` 才沿 `nextCursor` 读取后续候选。不能将省略／未执行组当作零命中；组的 complete 仅表示本次已执行，不表示候选全读完。

Grouped continuation must retain the original group `id`, query and filters. To retry one group, submit a one-element `groups` array, for example `{"groups":[{"id":"sha","query":"abc123","cursor":"<resumeCursor>"}]}`; omit cursor when resumeCursor is null. Do not transfer a group cursor to flat single-search input. The same rule applies to nextCursor. / 分组续读必须保留原组的 `id`、查询和筛选。单独重试时仍提交仅含该组的 `groups` 数组，如上述 JSON；resumeCursor 为 null 时省略 cursor。不得将组游标用于平面的单查询输入，nextCursor 同样遵循此规则。

Invalid groups fail the request: correct the reported input before retrying. / 无效组使请求失败，应先修正报错输入再重试。

## Retrieval echoes / 检索回声

Default search excludes reliably identified direct retrieval artifacts. Use `--retrieval-artifacts include` or `only` when investigating retrieval itself. This filter is deliberately narrow: wrappers, mixed commands and assistant paraphrases may remain. Repeated retrieval output is not independent confirmation; follow the original evidence. / 默认搜索排除可靠识别的直接检索工件。调查检索自身时使用 `--retrieval-artifacts include` 或 `only`。过滤有意收窄：包装、混合命令和助手转述可能保留。重复检索输出不是独立确认，应追溯原始证据。

DeepSeek reports its current direct-retrieval-artifact classification gap. / DeepSeek 会报告直接检索工件分类的当前缺口。
