# Reading and continuation

Read when expanding context, selecting parts, or continuing bounded output.

Commands return JSON, with compact presentation by default and explicit `--presentation full` available. Use repeated `--ref` for batches and `--max-bytes` to control response size. Pass returned cursors and context exactly; use operation help for supported continuation flags. Evidence refs and ephemeral context refs have different lifetimes. If a source changed, search again; never substitute an old event position.

## Context and full views

Compact context stores event bodies once in top-level `events`; each window's `eventIndexes` and `anchorIndexes` index that array. Do not expect `items[].events` in this mode. Shared bodies do not merge sessions or assert causality. Choose one promising anchor before expanding several overlapping windows.

Choose nearby context or full-session pagination explicitly. Context `--length` is valid only with `--view full`. `--presentation compact` controls response structure and references independently of `--view full`, which selects bounded transcript content.

```sh
# Nearby message anchors
session-analyzer history context --endpoint http://127.0.0.1:17891 --context "<contextRef>" --ref "<hit-ref>" --presentation compact --view outline
# Session sequence from the beginning
session-analyzer history context --endpoint http://127.0.0.1:17891 --context "<contextRef>" --ref "<hit-ref>" --presentation compact --view full --limit 20 --length 2000
# Continue the returned window
session-analyzer history context --endpoint http://127.0.0.1:17891 --context "<contextRef>" --ref "<returned-next-ref>" --presentation compact --view full --limit 20 --length 2000
```

When required evidence is still missing, first follow returned continuation information if a promising candidate's supporting passage is not yet shown. If the original rationale is missing but implementation or acceptance messages are nearby, inspect available `previous`/gap context. Prefer these concrete leads over repeating broad searches; choose continuation or a more precise query to fill the remaining gap directly. Stop once the user's requested judgment has sufficient support; this does not require a fixed search → outline → gaps → read sequence, clearing every `hasMore`, or reading the whole Session.

The initial anchor may be outside the first full page. For long event text, use excerpt `nextOffset` with `read --parts projection`. `read --text-format text` removes exact duplicate code/terminal/JSON renderings within one event; unsupported renderers remain explicitly structured.

Batch independent context/read refs in one call. A gap exposes its event count; when the whole operation sequence matters, use `context --ref <gap> --limit 20` (up to 100) with a suitable byte budget and inspect its `next` until the gap is covered. `hasMore` concerns the batch, not internal gaps. Parse returned refs programmatically when possible instead of retyping them. For a long hit, `excerpt.hitOffset` is a UTF-16 offset for `read --parts projection --offset <offset>`; it is not a Raw source coordinate.

Main context uses message anchors; Protocol/Raw use layer-local neighbors.

Follow `relatedSessions[].ref` with `context` when a parent constraint or recorded fork/supersession is relevant. Check `unavailableRelatedSessions` before treating an empty navigable list as no relationship: `target_not_indexed` requires checking the fixed project/source coverage, not repeating broader searches in the same snapshot; `target_has_no_main_events` permits a session-scoped Raw/Protocol search for recorded evidence. State any remaining evidence gap. These lists do not infer causality or certify the target's current source validity; reading it still verifies the source.

## Output budget recovery

`read` fits oversized text against the final serialized UTF-8 JSON response, including escaping, identities, metadata and continuation objects. It keeps an around-hit read's hit inside the actual returned interval. Budget-deferred requested parts remain `available:true,deferred:true,reason:"output_budget"` and have a complete `next` request; never treat them as unavailable. `contentTruncated` describes unfinished bodies, while batch `hasMore` describes unread items.

`OUTPUT_BUDGET_TOO_SMALL` still occurs when identity and continuation cannot fit; `--max-bytes` counts UTF-8 JSON bytes and text `--length` counts UTF-16 code units. Narrow a read to useful parts (for example `projection`), or increase the permitted byte budget. Context full pages/gap ranges can use a smaller `--limit`; only full view permits `--length`. A nearby outline window may need a focused read instead. Read `--limit` also bounds Raw-link/association lists. Compact presentation with already-read `--context` may reduce repeated metadata. Changing view alone does not guarantee a fit. Check truncation and continuation before treating an excerpt as complete.

After changing parts, `aroundHit`, text length or context view, restart the selected refs without the old batch `--cursor`, then follow the new continuations. Page size and byte budget may change during continuation.

## Select content or a stored hit

Ordinary reads default to `mode=content`: message/request/result parts, or Raw for `source` locators. `--mode auto` remains opt-in: without explicit parts or a text range, a reference with a valid stored hit selects projection from 500 code units before to 1499 after it; an ordinary event reference without a hit reads content. Explicit selectors take precedence. Conflicting explicit parameters fail. An invalid old hit is never reused or described as the original hit. Range references still go through `context`, not `read`.

When `status.capabilities.aroundHit` is available, `read --context "<contextRef>" --ref "<returned-hit-ref>" --around-hit-before 800 --around-hit-after 1600` automatically selects search projection. JSON uses `aroundHit:{before:800,after:1600}`. Both counts are required nonnegative safe integers in UTF-16 code units; `before + after + 1` must be at most 100000. An explicit `parts` list may normalize only to `["projection"]`. Do not combine `aroundHit` with `source`, `offset`, `endOffset`, `length`, `textFormat` or a conflicting mode.

The ref must retain a stored hit offset; zero is valid. `HIT_OFFSET_UNAVAILABLE` means an explicit around-hit read has no anchor: search again or choose an explicit ordinary projection read, never guess the hit. Each batched ref gets its own window. A returned part reports its actual inclusive `offset`, exclusive `endOffset`, `hitOffset`, `totalLength`, `nextOffset`, `text` and `truncated`. Budget fitting may shorten the requested window while retaining the hit code unit, without claiming the full match length.

Each part's `previous` and `next` is a complete read input object, or null at that boundary. Submit the object unchanged through `--input-file`; do not resend `aroundHit`. Forward continuation uses `offset` at the actual returned end. Backward continuation uses exclusive `endOffset` at the actual returned start, so it remains adjacent even if that previous read also shrinks to fit its budget. `--end-offset` and `--offset` are mutually exclusive text coordinates. A continuation retains the part, ref with its matching contextRef, relevant text format, presentation and byte budget. A compact continuation may contain short handles; save the separate evidenceRef for durable citation and later verification. Projection coordinates do not map to message/request/result or Raw text. Top-level `next` pages batched items using the original request and cursor; compact `evidenceRef` preserves the original hit anchor for citation.

## Detail text, Raw links and offsets

With the default `textFormat=structured`, available message/request/result parts use `structured_detail_json` and may include rendered HTML. With `--text-format text`, they use `detail_text`; unsupported detail types remain represented as JSON. Both are detail projections, not verbatim source text. Use `--parts projection` for readable search text or Raw reads for original records. For durable citations, save compact read's `items[].evidenceRef` or full read's persistent `items[].ref`.

Expand context-window `gaps[].ref`, `previous` or `next` references through `history context --ref <returned-ref>`. They are event-range references, distinct from read-part continuation objects. For a long text part, submit its complete `next` input; `nextOffset` remains a UTF-16 text position if constructing an explicit `--offset`/`--length` request. `--parts raw` on a Logical Event returns Raw refs: read those with `--parts raw` to inspect original JSON. To page that Logical Event's Raw links, submit `rawRefsNext`, or pass `rawRefsNextOffset` through `--raw-offset` (`rawOffset` in JSON). Text `--offset` never means a link index. Submit an item's `logicalRefsNext` unchanged to continue its source associations. It carries both `source.logicalOffset` and the exact `source.rawRef`. Top-level `next` is the complete search/context/read batch continuation; `nextCursor` remains available for callers preserving the original arguments manually.

The shared request limit is 256 KiB of UTF-8 JSON, including file/stdin input. Serialize returned requests compactly. If a large search reports `CONTINUATION_TOO_LARGE`, shorten the query or reduce its terms and start a new search without the cursor. Changing the response `maxBytes` does not raise the request limit.

Repeated parts are deduplicated before offset interpretation. Check `contentTruncated` and each part's `truncated`, `deferred` and continuation as well as top-level `truncated` and `hasMore`: a finished batch can still contain unfinished parts or internal gaps.

## Structured input across shells

Use UTF-8 `--input-file <path>` for JSON requests and saved continuation objects, or `--input-file -` for stdin. Inline `--input '<JSON>'` remains available when the shell preserves quotes correctly. These input sources are mutually exclusive and bounded; a field already supplied in JSON cannot also be passed as a flag. The endpoint is a connection option, outside the JSON body. Prefer ordinary flags for around-hit reads so quoting JSON is unnecessary.

```powershell
# Write a returned continuation without relying on PowerShell's default file encoding.
$json = $read.items[0].parts[0].next | ConvertTo-Json -Depth 30
[IO.File]::WriteAllText('next-read.json', $json, [Text.UTF8Encoding]::new($false))
session-analyzer history read --endpoint 'http://127.0.0.1:17891' --input-file 'next-read.json'
```

```sh
session-analyzer history read --endpoint http://127.0.0.1:17891 --input-file next-read.json
cat next-read.json | session-analyzer history read --endpoint http://127.0.0.1:17891 --input-file -
```
