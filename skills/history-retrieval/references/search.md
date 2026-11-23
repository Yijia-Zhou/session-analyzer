# Search mechanics

Read before composing filters or combining queries, and when recovering grouped pages or investigating retrieval echoes.

Search specific identifiers first. Keep broad terms as independent fallback queries: adding `CI` to a union with two SHAs broadens the match set rather than narrowing it. Pass repeated `--query` for an intentional literal OR; the text `A OR B` is one literal phrase. A paraphrase from a summary may not appear verbatim in the source; prefer its original identifier or evidence locator.

Default `--order diverse` spreads candidates across matching sessions; it does not rank decisions by importance. Use `--session <returned-sessionId>` to search one promising Session, or `--order session` for grouped browsing. Preserve the original query/order/scope when using `nextCursor`; page size and byte budget may change.

Search is literal. Repeated `--query` is allowed; `--kind` takes one value and cannot be repeated. To inspect multiple kinds, search each separately or omit that filter. Repeatability is specific to each option. Repeated `--exclude` terms are NOT; structural filters are AND on the same event. `--query '--help'` searches that literal option name. Changing query/order/scope needs a fresh search; page size and byte budget may change during continuation.

## Independent query groups

When capabilities include `queryGroups`, use `search --input '{"groups":[{"id":"sha","query":"abc123","limit":3},{"id":"fallback","query":"CI","limit":2}]}'` for independent queries in one call; each group keeps its own counts, cursor and budget. Top-level `maxBytes` limits the entire response. A `not_executed` group has unknown counts; `results_omitted` was scanned but returned no candidates. Retry either group separately with its original query; for `results_omitted` preserve `resumeCursor` if non-null (otherwise omit cursor). Only `state=complete` uses `nextCursor` for subsequent candidates. Never treat an omitted/unexecuted group as zero hits. A group's `complete` state means this request ran, not that all its candidates have been read.

If a single or grouped search reports `CONTINUATION_TOO_LARGE`, the complete next request or group retry would exceed the 256 KiB CLI/HTTP request limit. Use shorter or fewer terms and start a new search without its old cursor.

Grouped continuation must retain the original group `id`, query and filters. To retry one group, submit a one-element `groups` array, for example `{"groups":[{"id":"sha","query":"abc123","cursor":"<resumeCursor>"}]}`; omit cursor when resumeCursor is null. Do not transfer a group cursor to flat single-search input. The same rule applies to nextCursor.

Invalid groups fail the request: correct the reported input before retrying.

## Retrieval echoes

Default search excludes reliably identified direct retrieval artifacts. Use `--retrieval-artifacts include` or `only` when investigating retrieval itself. This filter is deliberately narrow: wrappers, mixed commands and assistant paraphrases may remain. Repeated retrieval output is not independent confirmation; follow the original evidence.

DeepSeek reports its current direct-retrieval-artifact classification gap.
