# Lazy Image Preview Payload Externalization / 图片预览 Payload 外置与懒加载

## Metadata / 元数据

- Status / 状态: Completed / 已完成
- Created / 创建时间: 2026-05-31
- Last updated / 最后更新: 2026-05-31
- Scope / 范围: Embedded image previews in indexed transcript sessions / 已索引会话中的内嵌图片预览
- Related product spec / 相关产品规格: `docs/product-specs/session-transcript-analyzer.md`
- Related design doc / 相关设计文档: `docs/design-docs/logical-event-timeline.md`
- Related debt tracker / 相关技术债: `docs/exec-plans/tech-debt-tracker.md`

## Objective / 目标

Move supported embedded image payloads out of the long-lived in-memory session index. Keep only lightweight source locators and preview metadata in memory, expose image bytes through a controlled same-origin binary endpoint, and let all preview images load through normal browser lazy loading.

将受支持的内嵌图片 payload 从常驻内存的 session 索引中移出。内存中只保留轻量级来源定位信息与预览元数据，通过受控的同源二进制端点提供图片字节，并让所有预览图片通过浏览器原生机制按需加载。

This plan intentionally does not introduce a generic deferred-section architecture for every large event. It solves the measured image-payload problem first while keeping the design extensible.

本计划不会为所有“大事件”直接引入通用 deferred-section 架构。首期先解决已经测量确认的图片 payload 问题，同时为后续扩展保留空间。

## Problem Statement / 问题陈述

The current implementation visually marks preview images with `loading='lazy'`, but the expensive work has already happened before the browser sees the `<img>` element:

当前实现虽然在预览图片上设置了 `loading='lazy'`，但在浏览器看到 `<img>` 之前，高成本工作已经发生：

1. Transcript indexing parses JSONL lines that may contain large `data:image/...;base64,...` strings.
2. Raw indexed events retain parsed records and derived strings.
3. Logical detail construction emits supported image data URLs inside `image_preview` sections.
4. The browser detail cache can retain those inline strings after detail expansion.

1. Transcript 索引会解析可能包含大型 `data:image/...;base64,...` 字符串的 JSONL 行。
2. Raw 索引事件会保留 parsed record 以及派生字符串。
3. Logical detail 构建会把受支持的图片 data URL 放入 `image_preview` section。
4. 浏览器 detail cache 在展开详情后仍可能继续保留这些内联字符串。

Observed corpus measurements from the current development dataset are useful as a baseline, not as fixed acceptance thresholds:

当前开发数据集上的观测值可作为基线，但不是固定验收阈值：

- `74` `view_image` events were observed.
- Retained inline preview strings totaled approximately `15.94 MB`.
- The largest single retained preview string was approximately `3.15 MB`.
- The local index build completed in approximately `27 s`.

- 观测到 `74` 个 `view_image` 事件。
- 保留的内联预览字符串总量约为 `15.94 MB`。
- 最大单个保留预览字符串约为 `3.15 MB`。
- 本地索引构建耗时约为 `27 s`。

The implementation must remeasure these values after the change because corpus composition and machine state can vary.

实现完成后必须重新测量这些数值，因为语料构成和机器状态可能变化。

## Scope / 范围

### In Scope / 范围内

- Externalize supported embedded image data URLs before long-lived raw-event retention.
- Keep compact image descriptors containing source location and display metadata.
- Preserve sanitized markers in retained inspector payloads instead of inline base64.
- Return preview descriptors and controlled API URLs from logical detail responses.
- Add a same-origin binary image-preview endpoint that reloads and validates source JSONL on demand.
- Render all embedded preview images from endpoint URLs with `loading='lazy'` and `decoding='async'`.
- Preserve lossless raw-record drilldown through source-backed on-demand reads.
- Prune stale frontend detail-cache entries when switching sessions.
- Measure index-time, memory, detail-response, and preview-request effects.

- 在 raw event 长期保留前外置受支持的内嵌图片 data URL。
- 保留包含来源定位信息和展示元数据的紧凑图片 descriptor。
- 在保留的 inspector payload 中使用清洗标记，而不是内联 base64。
- 在 logical detail 响应中返回预览 descriptor 和受控 API URL。
- 新增同源二进制图片预览端点，按需重新读取并验证来源 JSONL。
- 所有内嵌预览图片统一从端点 URL 渲染，并设置 `loading='lazy'` 与 `decoding='async'`。
- 通过基于源文件的按需读取继续保证 raw-record drilldown 无损。
- 切换 session 时清理陈旧的前端 detail cache 条目。
- 测量索引耗时、内存、detail 响应体积和预览请求性能变化。

### Out of Scope / 范围外

- A generic deferred loader for arbitrary large event sections.
- A generalized external storage layer for every large indexed field.
- Thumbnail generation, image transcoding, or image resizing.
- Temporary blob files or a persistent binary cache.
- Cross-session or global content-addressed deduplication.
- Mandatory byte-offset indexing in the first implementation.
- Full raw-timeline virtualization or generic raw-layer lazy loading.
- Solving non-image large-field memory retention unless measurement shows a regression blocker.

- 为任意大型 event section 建立通用 deferred loader。
- 为所有大型索引字段建立泛化外部存储层。
- 缩略图生成、图片转码或图片缩放。
- 临时 blob 文件或持久化二进制缓存。
- 跨 session 或全局内容寻址去重。
- 在首期实现中强制引入 byte offset 索引。
- 完整的 raw timeline 虚拟化或通用 raw layer 懒加载。
- 除非测量结果显示存在回归阻塞，否则不处理非图片大型字段的内存驻留问题。

## Repository Context / 仓库上下文

The implementation should start from these anchors:

实现应从以下锚点开始：

- `src/codex.js`
  - `makeRawEvent`: raw-event retention boundary.
  - `createLogicalEvent`: logical aggregation boundary.
  - `redactEmbeddedDataUrls`: existing defense-in-depth sanitizer.
  - `imagePreviewSection`: current inline preview construction.
  - `sanitizeLogicalEventDto` and `sanitizeLogicalDetailSection`: logical API sanitization.
  - `buildEventDetail`: detail response construction.
  - `parseSessionFile`: JSONL parsing and indexing.
  - `readRawLine`: current source-line reload helper.
- `server.js`
  - Logical detail route.
  - Existing `/api/raw` lossless source-read route.
- `public/renderers.js`
  - `renderImagePreview`: browser preview rendering.
- `public/app.js`
  - `loadEventDetail`: detail fetch and cache.
  - Expanded-detail scheduling and session switching.
- `test/codex.test.js`
  - Indexing, DTO, sanitizer, and detail tests.
- `test/renderers.test.js`
  - Preview renderer tests.

## Required Invariants / 必须保持的不变量

1. Logical timeline and logical detail JSON must not expose inline embedded image payloads.
2. The long-lived indexed session model must not retain supported image base64 payloads through `parsed`, `output`, `searchText`, presentation strings, or preview sections.
3. Raw source files remain the authoritative lossless record. Existing raw references continue to identify source JSONL rows.
4. The server must not accept arbitrary filesystem paths or arbitrary JSON paths from the browser.
5. The binary endpoint may only serve supported image MIME types: PNG, JPEG, GIF, WebP, and AVIF.
6. Existing preview limits and event-level duplicate suppression remain bounded. The current limit of `8` previews per event remains unless a measured reason justifies changing it.
7. Unsupported or malformed embedded payloads remain sanitized and must not become downloadable through the new endpoint.
8. The frontend must treat endpoint URLs as same-origin controlled resources. Existing data-URL sanitization remains as defense in depth.
9. Raw drilldown remains intentionally lossless on demand, even though the normal indexed representation becomes lightweight.
10. The implementation must work with UTF-8 JSONL, Windows CRLF, missing files, changed files, cancelled indexing, and partially malformed transcript rows.

1. Logical timeline 和 logical detail JSON 不得暴露内联图片 payload。
2. 常驻内存的 indexed session model 不得通过 `parsed`、`output`、`searchText`、presentation string 或 preview section 保留受支持图片的 base64 payload。
3. Raw 源文件继续作为无损权威记录。现有 raw reference 继续定位源 JSONL 行。
4. 服务端不得接受浏览器提供的任意文件系统路径或任意 JSON path。
5. 二进制端点只允许返回受支持的图片 MIME：PNG、JPEG、GIF、WebP 和 AVIF。
6. 现有预览数量限制和 event 内去重必须继续有界。除非测量结果支持调整，否则每个 event 的预览上限保持为 `8`。
7. 不受支持或格式错误的内嵌 payload 必须继续被清洗，不得通过新端点下载。
8. 前端必须把端点 URL 视为受控同源资源。现有 data URL 清洗继续作为纵深防御。
9. 虽然常规索引表示会轻量化，但 raw drilldown 必须继续支持按需无损查看。
10. 实现必须覆盖 UTF-8 JSONL、Windows CRLF、文件缺失、文件变化、索引取消和部分损坏的 transcript 行。

## Chosen Design / 选定设计

### 1. Externalize Before Raw Retention / 在 Raw 保留前外置

During JSONL parsing, recursively scan record values for supported embedded image data URLs before passing the record to `makeRawEvent`. Replace each supported payload in the retained parsed record with an explicit marker and attach compact sidecar descriptors to the raw event.

在 JSONL 解析期间，在 record 进入 `makeRawEvent` 之前递归扫描其 value 中受支持的内嵌图片 data URL。将保留 parsed record 中的 payload 替换为明确标记，并在 raw event 上附加紧凑 sidecar descriptor。

This ordering matters: replacing payloads after `makeRawEvent` would allow generic derived strings such as `output` or `searchText` to copy base64 into memory.

顺序很重要：如果在 `makeRawEvent` 之后才替换 payload，`output` 或 `searchText` 等通用派生字符串仍可能把 base64 复制进内存。

Only values are scanned. Object keys are not rewritten. The scanner must be cycle-safe even though parsed JSON should be acyclic, and it must preserve ordinary strings exactly.

只扫描 value，不改写 object key。虽然 JSON 解析结果理论上无环，扫描器仍应防御循环引用；普通字符串必须保持原样。

### 2. Lightweight Descriptor / 轻量 Descriptor

The retained descriptor should contain only data needed to locate, validate, deduplicate for presentation, and describe a preview:

保留的 descriptor 只包含定位、验证、展示级去重和描述预览所需的数据：

```js
{
  previewId: 'opaque-server-generated-id',
  source: {
    file: 'session-relative-or-index-owned-file-reference',
    line: 123,
    jsonPath: ['payload', 'content', 0, 'image_url'],
  },
  mimeType: 'image/png',
  estimatedBytes: 2359296,
  dedupeKey: 'compact-presentation-only-key',
}
```

`previewId` is opaque to the browser. `jsonPath` is retained inside the server-owned index only. A compact `dedupeKey` may be computed during scanning to preserve event-local duplicate suppression, but it must never authorize retrieval. Fetch authorization is based on the server-owned descriptor selected through session, event, and preview identity.

`previewId` 对浏览器不透明。`jsonPath` 只保留在服务端持有的索引中。扫描时可计算紧凑的 `dedupeKey`，用于保持 event 内展示去重；但它绝不能用于授权读取。读取授权必须基于 session、event 与 preview identity 选中的服务端 descriptor。

The implementation should avoid storing the original data URL, decoded bytes, or a full duplicate payload in the descriptor. If a hash is used, measure its index-time impact and avoid large temporary buffer copies where practical.

descriptor 不得保留原始 data URL、解码后字节或完整 payload 副本。如果使用 hash，需要测量其索引耗时影响，并尽量避免大型临时 buffer 复制。

When building a logical detail response, aggregate descriptors from the logical event's grouped raw events, suppress duplicates by the compact presentation key, and enforce the existing preview cap. Do not recover previews by rescanning retained marker strings.

构建 logical detail 响应时，从 logical event 聚合的 raw event 中收集 descriptor，使用紧凑展示 key 去重，并执行现有预览上限。不得通过重新扫描常驻 marker string 来恢复预览。

### 3. Logical Detail Contract / Logical Detail 契约

`image_preview` sections should return preview metadata and same-origin endpoint URLs instead of data URLs. The exact DTO shape may follow existing renderer conventions, but it must be explicit and bounded:

`image_preview` section 应返回预览元数据与同源端点 URL，而不是 data URL。具体 DTO 形状可沿用现有 renderer 约定，但必须明确且有界：

```js
{
  type: 'image_preview',
  images: [
    {
      previewId: 'opaque-server-generated-id',
      src: '/api/sessions/<session>/events/<event>/image-previews/<preview>',
      mimeType: 'image/png',
      estimatedBytes: 2359296,
      alt: 'Image preview 1',
    },
  ],
}
```

Inspector payload sections continue to display a clear marker such as `[embedded image available in preview]`. They do not regain inline base64.

Inspector payload section 继续显示类似 `[embedded image available in preview]` 的明确标记，不再恢复内联 base64。

### 4. Controlled Binary Endpoint / 受控二进制端点

Add a route shaped like:

新增类似以下形式的路由：

```text
GET /api/sessions/:sessionId/events/:eventId/image-previews/:previewId
```

The endpoint must:

端点必须：

1. Resolve `sessionId`, `eventId`, and `previewId` through the indexed server model.
2. Use only the server-owned locator. Ignore and reject client attempts to provide `file` or `jsonPath`.
3. Verify that the locator still refers to an indexed raw source owned by the selected session and remains inside the allowed source boundary.
4. Reload the source JSONL row from disk.
5. Traverse the validated stored path.
6. Revalidate the data URL prefix, MIME whitelist, base64 syntax, and decoded-size guard.
7. Decode and return image bytes with the validated `Content-Type`, `Content-Length`, and `X-Content-Type-Options: nosniff`.
8. Return non-cache-retaining headers initially, such as `Cache-Control: no-store`, until source mutation and cache semantics are deliberately designed.
9. Return a clear bounded error for stale, missing, mutated, oversized, unsupported, or malformed sources.

1. 通过服务端索引模型解析 `sessionId`、`eventId` 和 `previewId`。
2. 只使用服务端持有的 locator。忽略并拒绝客户端传入 `file` 或 `jsonPath` 的尝试。
3. 验证 locator 仍指向所选 session 持有的已索引 raw source，并保持在允许的来源边界内。
4. 从磁盘重新读取来源 JSONL 行。
5. 沿已验证的存储 path 取值。
6. 重新验证 data URL 前缀、MIME 白名单、base64 格式和解码后大小限制。
7. 解码并使用已验证的 `Content-Type`、`Content-Length` 和 `X-Content-Type-Options: nosniff` 返回图片字节。
8. 初期返回不保留缓存的 header，例如 `Cache-Control: no-store`，直到来源变化和缓存语义被明确设计。
9. 对来源过期、缺失、变化、过大、不受支持或格式错误返回清晰且有界的错误。

The endpoint must not decode bytes during normal detail loading. Decoding occurs only when the browser requests an image URL.

正常 detail 加载不得触发字节解码。只有浏览器请求图片 URL 时才解码。

Define encoded-size and decoded-size guards as named server constants covered by tests. SVG is intentionally excluded from the MIME whitelist because this endpoint is for raster preview bytes, not active document content.

将编码大小与解码大小限制定义为具名服务端常量，并通过测试覆盖。SVG 明确排除在 MIME 白名单外，因为该端点只服务光栅预览字节，不提供可执行文档内容。

### 5. Frontend Loading and Cache Hygiene / 前端加载与缓存卫生

`renderImagePreview` should only render controlled endpoint URLs. Keep `loading='lazy'` and add or preserve `decoding='async'`. Because the `src` is now a URL rather than an inline payload, browser lazy loading becomes real: image bytes are fetched only when the browser decides the image is relevant.

`renderImagePreview` 只渲染受控端点 URL。保留 `loading='lazy'`，并增加或保留 `decoding='async'`。由于 `src` 变成 URL 而不是内联 payload，浏览器懒加载才真正生效：只有浏览器判断图片相关时才会获取字节。

An inspector image that is immediately visible after expansion may load immediately. That is expected behavior, not a failure of lazy loading.

Inspector 展开后立即可见的图片可能马上加载。这是预期行为，不代表懒加载失效。

On session switch, prune stale detail-cache data and detail errors. A general byte-budgeted browser LRU is optional follow-up work unless measurement shows the lightweight descriptor cache still causes a meaningful issue.

切换 session 时清理陈旧 detail cache 数据和 detail error。除非测量显示轻量 descriptor cache 仍有明显问题，否则通用的按字节预算浏览器 LRU 留作后续工作。

### 6. Raw Lossless Drilldown / Raw 无损下钻

The source JSONL line remains authoritative. Existing `/api/raw` reads must continue to return the original row from disk. The retained in-memory raw event may show an externalization marker instead of base64.

来源 JSONL 行继续作为权威记录。现有 `/api/raw` 读取必须继续从磁盘返回原始行。内存中保留的 raw event 可显示外置标记而不是 base64。

The raw-layer inspector needs an explicit contract review during implementation. If its current in-memory `Raw JSON` section would become lossy, expose the source-backed raw-row fetch through the existing Raw refs interaction or add an explicit on-demand raw-row action. Do not silently label a marker-only payload as lossless raw JSON.

实现期间必须明确复核 raw layer inspector 契约。如果其当前内存 `Raw JSON` section 会变成有损内容，则通过现有 Raw refs 交互暴露基于源文件的 raw-row 读取，或增加明确的按需 raw-row 操作。不得把只有标记的 payload 静默标成无损 raw JSON。

### 7. Byte Offsets: Measure Before Adding / Byte Offset：测量后再引入

The existing `readRawLine` helper reloads a source line by scanning from the beginning of the file. The current parser uses decoded `readline` iteration, so exact UTF-8 byte offsets are not free: CRLF handling, multibyte characters, and stream boundaries require deliberate implementation.

现有 `readRawLine` helper 会从文件起点扫描到目标行。当前 parser 使用解码后的 `readline` 迭代，因此精确 UTF-8 byte offset 并非零成本：CRLF、多字节字符和 stream boundary 都需要明确处理。

Initial implementation should use the existing line-based reload path for correctness. Measure preview-request latency on early, middle, and late lines. Add byte offsets only if measured latency is unacceptable.

首期实现应优先复用现有按行读取路径，保证正确性。对文件前部、中部和尾部行的预览请求分别测量延迟。只有在延迟不可接受时才增加 byte offset。

If offsets are added, store an index-owned byte offset and row byte length, then read exactly that slice and verify JSON/path validity. Offset support is an optimization, not a correctness dependency.

如果引入 offset，则存储索引持有的 byte offset 与 row byte length，精确读取该片段，并继续验证 JSON/path 有效性。Offset 是优化，不是正确性依赖。

## Alternatives Considered / 已考虑方案

### Inline Data URLs with Browser Lazy Attributes / 内联 Data URL 配合浏览器 Lazy 属性

Rejected. It delays some decoding work but does not prevent index retention, detail-response inflation, or frontend cache retention.

不采用。它可以延后部分解码，但无法避免索引驻留、detail 响应膨胀和前端缓存驻留。

### Threshold-Based Loading with a "Load Preview" Button / 按大小阈值显示“加载预览”按钮

Deferred. It adds branching UI and threshold tuning. Once every preview uses an endpoint URL, browser lazy loading provides a simpler default. A manual button can be reconsidered only if very large images still cause a measured UX issue.

暂缓。它会增加 UI 分支和阈值调参。所有预览统一使用端点 URL 后，浏览器懒加载已经提供更简单的默认行为。只有在超大图片仍造成可测量 UX 问题时，才重新考虑手动按钮。

### Generic Deferred Sections for All Large Events / 所有大型事件统一 Deferred Section

Deferred. It increases DTO, endpoint, renderer, cache, and compatibility complexity before non-image bottlenecks are measured.

暂缓。在尚未测量非图片瓶颈前，它会提前增加 DTO、端点、renderer、缓存和兼容复杂度。

### Temporary Blob Files / 临时 Blob 文件

Rejected for the first version. They add lifecycle cleanup, stale cache, disk pressure, and synchronization concerns. The JSONL source already contains the authoritative payload.

首期不采用。临时文件会增加生命周期清理、陈旧缓存、磁盘压力和同步问题。JSONL 来源已经包含权威 payload。

### Mandatory Byte-Offset Indexing / 强制 Byte Offset 索引

Deferred until measured. It can reduce late-line lookup latency but adds parser complexity and edge cases. Line-based lookup is a simpler correctness baseline.

测量前暂缓。它可以降低尾部行读取延迟，但会增加 parser 复杂度和 corner case。按行读取是更简单的正确性基线。

## Risk Analysis / 风险分析

### R1. Hidden Base64 Copies Remain in the Index / 索引中仍残留隐藏 Base64 副本

Risk: Externalizing only `image_preview` output would miss copies in `parsed`, `output`, `searchText`, presentation strings, or derived sections.

风险：如果只外置 `image_preview` 输出，会遗漏 `parsed`、`output`、`searchText`、presentation string 或派生 section 中的副本。

Mitigation: Externalize before `makeRawEvent`, retain existing recursive sanitizer, and add index audits that recursively scan retained session objects.

缓解：在 `makeRawEvent` 前完成外置，保留现有递归 sanitizer，并增加递归扫描常驻 session object 的索引审计。

### R2. Raw Inspector Becomes Quietly Lossy / Raw Inspector 静默变为有损

Risk: Replacing data URLs in retained raw events can make an in-memory raw JSON view incomplete.

风险：替换常驻 raw event 中的 data URL 后，内存 raw JSON 视图可能不完整。

Mitigation: Treat source-backed `/api/raw` as authoritative, surface an explicit marker, and add a clear on-demand lossless raw-row action where needed.

缓解：将基于源文件的 `/api/raw` 作为权威读取，显示明确标记，并在需要处增加清晰的按需无损 raw-row 操作。

### R3. Binary Endpoint Becomes a File-Read Primitive / 二进制端点演变为任意文件读取入口

Risk: Accepting client-provided paths or JSON paths could expose filesystem content.

风险：接受客户端提供的 path 或 JSON path 可能泄露文件系统内容。

Mitigation: Resolve only opaque server-owned preview descriptors under an already indexed session event. Revalidate MIME and payload format before responding.

缓解：只解析已索引 session event 下由服务端持有的不透明 preview descriptor。响应前重新验证 MIME 和 payload 格式。

### R4. Source File Changes After Indexing / 索引后来源文件变化

Risk: Append, rewrite, deletion, or rotation can invalidate line and path locators.

风险：追加、重写、删除或轮转可能使 line 和 path locator 失效。

Mitigation: Reparse and revalidate on request. Return an explicit stale-source response instead of serving mismatched bytes. Record observed behavior for append-only transcripts.

缓解：请求时重新解析并验证。来源不匹配时返回明确的 stale-source 响应，不提供错误字节。记录 append-only transcript 下的实际行为。

### R5. Late-Line Requests Are Slow / 尾部行请求缓慢

Risk: `readRawLine` currently scans from file start.

风险：`readRawLine` 当前从文件开头扫描。

Mitigation: Measure early, middle, and late preview requests. Add byte-offset lookup only if the measured latency warrants the parser complexity.

缓解：测量前部、中部和尾部预览请求。只有实测延迟证明值得承担 parser 复杂度时才增加 byte-offset lookup。

### R6. Hashing or Deduplication Adds Index Cost / Hash 或去重增加索引成本

Risk: Computing a cryptographic digest or allocating large temporary buffers can offset memory gains with index-time overhead.

风险：计算加密 digest 或分配大型临时 buffer，可能用索引耗时抵消内存收益。

Mitigation: Keep dedupe event-local, compact, and presentation-only. Benchmark any digest choice. Never use the dedupe key as a security boundary.

缓解：去重仅限 event 内、保持紧凑、只影响展示。对任何 digest 选择做基准测试。绝不把 dedupe key 用作安全边界。

### R7. Browser Still Fetches Too Much / 浏览器仍请求过多图片

Risk: Expanded visible sections may make several images relevant at once.

风险：展开后可见的 section 可能让多张图片同时进入相关范围。

Mitigation: Keep the event-level preview cap, use `loading='lazy'`, retain bounded detail expansion behavior, and verify network requests manually in the browser.

缓解：保留 event 级预览上限，使用 `loading='lazy'`，保持有界的 detail 展开行为，并在浏览器中手工验证网络请求。

### R8. Malformed or Oversized Payload Causes Resource Pressure / 损坏或超大 Payload 造成资源压力

Risk: Base64 decode can allocate significant memory or throw on malformed input.

风险：base64 解码可能分配大量内存，或因损坏输入抛错。

Mitigation: Check encoded and estimated decoded size before decoding, apply a hard decoded-size limit, validate syntax, and return a bounded error.

缓解：解码前检查编码长度和估算解码大小，设置硬性解码大小限制，验证格式，并返回有界错误。

### R9. UTF-8 and CRLF Break Future Offset Reads / UTF-8 与 CRLF 破坏后续 Offset 读取

Risk: Character count is not byte count, and newline widths vary.

风险：字符数不等于字节数，换行宽度也会变化。

Mitigation: Keep line-based correctness first. If offset indexing is added, test multibyte UTF-8, LF, CRLF, empty lines, and final lines without newline.

缓解：首期保持按行读取正确性。如果增加 offset 索引，测试多字节 UTF-8、LF、CRLF、空行和无末尾换行的最后一行。

### R10. Scope Expands into a General Storage Rewrite / 范围膨胀为通用存储重写

Risk: Solving every large-event case at once would increase implementation and review surface substantially.

风险：一次性解决所有大型事件场景会显著扩大实现与 review 范围。

Mitigation: Ship image externalization first. Record measured non-image issues separately and only generalize after evidence.

缓解：先交付图片外置。单独记录测量到的非图片问题，只在有证据后再泛化。

### R11. Concurrent Preview Requests Cause a Decode Burst / 并发预览请求造成解码突发

Risk: A visible expanded section or repeated client requests can trigger several decodes at once and create short-lived memory pressure.

风险：可见的展开 section 或重复客户端请求可能同时触发多次解码，造成短时内存压力。

Mitigation: Keep the per-event preview cap, enforce strict per-image encoded and decoded limits before allocation, and measure burst behavior. Add a small server-side concurrency limiter only if measurements show the local service needs one.

缓解：保留每个 event 的预览上限，在分配前执行严格的单图编码和解码大小限制，并测量突发行为。只有测量显示本地服务确实需要时，才增加小型服务端并发限制器。

## Implementation Milestones / 实施里程碑

### Milestone 1: Index-Time Externalization / 里程碑 1：索引阶段外置

Implement the recursive supported-image extractor and invoke it before `makeRawEvent`.

实现递归 supported-image extractor，并在 `makeRawEvent` 前调用。

Tasks / 任务:

- Add a canonical supported-image data URL parser shared by externalization and endpoint validation.
- Replace supported image payload values with an explicit retained marker.
- Attach compact source descriptors to raw events.
- Keep extraction state local to the in-progress session build so cancellation cannot leak partial descriptors into a published index.
- Preserve existing sanitizer behavior for unsupported or malformed values.
- Add recursive retained-index audits in tests.
- Measure index build time and retained model size before and after.

- 增加由外置逻辑和端点验证共用的 canonical supported-image data URL parser。
- 将受支持图片 payload value 替换为明确保留标记。
- 在 raw event 上附加紧凑来源 descriptor。
- 将抽取状态限制在正在构建的 session 内，确保取消索引不会把部分 descriptor 泄漏到已发布索引。
- 对不受支持或格式错误的 value 保持现有 sanitizer 行为。
- 在测试中增加递归常驻索引审计。
- 测量变更前后的索引构建耗时和常驻模型大小。

Exit criteria / 完成标准:

- Retained indexed session objects contain no supported inline image base64 payload.
- Existing logical event tests remain green after adapting expected descriptors.
- Raw source rows remain unchanged on disk.

- 常驻 indexed session object 不包含受支持图片的内联 base64 payload。
- 调整预期 descriptor 后，现有 logical event 测试继续通过。
- 磁盘上的 raw 来源行保持不变。

### Milestone 2: Preview Binary Endpoint / 里程碑 2：预览二进制端点

Add the controlled preview route and source rehydration path.

新增受控预览路由和来源 rehydration 路径。

Tasks / 任务:

- Resolve previews only through indexed opaque identities.
- Reload and parse the source JSONL row.
- Traverse the stored path safely.
- Validate MIME whitelist, base64 syntax, encoded size, and decoded size.
- Return binary bytes, defensive headers, and bounded error responses.
- Add route tests for valid, missing, stale, malformed, unsupported, oversized, malformed-identifier, source-boundary, and traversal-attempt cases.

- 只通过索引中的不透明 identity 解析预览。
- 重新读取并解析来源 JSONL 行。
- 安全遍历存储 path。
- 验证 MIME 白名单、base64 格式、编码大小和解码大小。
- 返回二进制字节、防御性 header 和有界错误响应。
- 增加有效、缺失、过期、损坏、不受支持、超限、非法 identifier、来源边界和路径探测场景的路由测试。

Exit criteria / 完成标准:

- Detail JSON contains metadata URLs but no image base64.
- Valid preview URLs return correct bytes and `Content-Type`.
- Browser-controlled input cannot select arbitrary source files or paths.

- Detail JSON 只包含元数据 URL，不包含图片 base64。
- 有效预览 URL 返回正确字节与 `Content-Type`。
- 浏览器输入无法选择任意来源文件或 path。

### Milestone 3: Frontend Lazy Rendering and Raw UX / 里程碑 3：前端懒渲染与 Raw UX

Switch all embedded preview rendering to endpoint URLs and make raw losslessness explicit.

将所有内嵌预览渲染切换到端点 URL，并明确 raw 无损语义。

Tasks / 任务:

- Update renderer validation to allow only controlled preview endpoint URLs.
- Preserve `loading='lazy'` and `decoding='async'`.
- Keep clear fallback UI for failed preview requests.
- Prune stale detail cache and detail errors on session switch.
- Review raw-layer inspector behavior and add an explicit lossless source-row action if the retained marker would otherwise be misleading.
- Manually inspect network behavior in a browser.

- 更新 renderer 校验，只允许受控预览端点 URL。
- 保留 `loading='lazy'` 和 `decoding='async'`。
- 对失败预览请求保留清晰 fallback UI。
- 切换 session 时清理陈旧 detail cache 和 detail error。
- 复核 raw-layer inspector 行为；如果保留标记会造成误导，则增加明确的无损来源行操作。
- 在浏览器中手工检查网络行为。

Exit criteria / 完成标准:

- Opening a detail response does not transfer image bytes by itself.
- Visible previews load on demand.
- Raw drilldown clearly distinguishes lightweight indexed content from lossless source content.

- 仅打开 detail 响应不会传输图片字节。
- 可见预览按需加载。
- Raw drilldown 清楚区分轻量索引内容和无损来源内容。

### Milestone 4: Performance Decision and Documentation Closure / 里程碑 4：性能决策与文档收口

Measure the result, decide whether byte offsets are justified, and update long-lived documentation.

测量结果，决定是否值得引入 byte offset，并更新长期文档。

Tasks / 任务:

- Compare index duration and retained-memory proxy measurements against baseline.
- Measure preview request latency for early, middle, and late source rows.
- Measure logical detail response sizes before and after.
- Scan logical timeline, logical detail, and retained index structures for leaked inline image payloads.
- Run the full automated test suite and syntax checks.
- Restart the local server and verify browser behavior.
- Update the product spec, design doc, debt tracker, and this plan with final decisions.
- Move this plan to `docs/exec-plans/completed/` only after implementation and validation finish.

- 对比索引耗时和常驻内存代理指标与基线。
- 测量来源文件前部、中部和尾部行的预览请求延迟。
- 测量变更前后的 logical detail 响应体积。
- 扫描 logical timeline、logical detail 和常驻索引结构中的内联图片 payload 泄漏。
- 运行完整自动化测试和语法检查。
- 重启本地服务并验证浏览器行为。
- 使用最终决策更新产品规格、设计文档、技术债 tracker 和本计划。
- 只有在实现和验证结束后，才将本计划移动到 `docs/exec-plans/completed/`。

Decision gate / 决策门:

- If line-based preview reads are acceptable, keep byte offsets out of scope and record the measurement.
- If late-line requests are materially slow, add a measured byte-offset follow-up milestone before closing this plan.

- 如果按行读取预览的性能可接受，则保持 byte offset 不在范围内，并记录测量结果。
- 如果尾部行请求明显缓慢，则在关闭本计划前增加经过测量支持的 byte-offset 后续里程碑。

## Validation Matrix / 验证矩阵

### Automated / 自动化

- Supported image MIME types: PNG, JPEG, GIF, WebP, AVIF.
- Unsupported MIME type remains sanitized and has no endpoint descriptor.
- Plain non-base64 data URL remains sanitized.
- Line-wrapped supported base64 payload is externalized and can be rehydrated.
- Nested arrays and objects are scanned without changing ordinary values.
- Duplicate images remain bounded and event-local dedup still works.
- More than `8` images remain capped.
- Missing output, missing path, malformed JSON, malformed base64, and oversized payload return bounded behavior.
- Malformed URL-encoded identifiers, source-boundary violations, and traversal attempts cannot select arbitrary files or JSON paths.
- Concurrent visible previews remain bounded by the event preview cap and per-image size guards.
- Raw refs still return original lossless lines.
- Logical timeline and logical detail JSON contain no inline image data URLs.
- Retained indexed session model contains no supported inline image data URLs.
- Renderer escapes metadata and accepts only controlled endpoint sources.
- Session switch prunes stale detail-cache state.

- 受支持图片 MIME：PNG、JPEG、GIF、WebP、AVIF。
- 不受支持 MIME 保持清洗状态，且没有端点 descriptor。
- 普通非 base64 data URL 保持清洗状态。
- 换行包裹的受支持 base64 payload 能够外置并 rehydrate。
- 扫描嵌套 array 与 object，且不改变普通 value。
- 重复图片继续有界，event 内去重仍有效。
- 超过 `8` 张图片时继续截断。
- output 缺失、path 缺失、JSON 损坏、base64 损坏和 payload 超限均返回有界行为。
- 非法 URL 编码 identifier、来源边界违规和路径探测无法选择任意文件或 JSON path。
- 并发可见预览继续受到 event 预览上限和单图大小限制约束。
- Raw refs 仍返回原始无损行。
- Logical timeline 和 logical detail JSON 不包含内联图片 data URL。
- 常驻 indexed session model 不包含受支持的内联图片 data URL。
- Renderer 转义元数据，且只接受受控端点 source。
- Session 切换会清理陈旧 detail-cache 状态。

### Manual / 手工

- Expand a `view_image` event while watching browser network requests.
- Confirm detail JSON arrives before image bytes.
- Confirm an immediately visible preview loads normally.
- Confirm previews outside the relevant viewport are not eagerly fetched where browser behavior permits deferral.
- Switch sessions and confirm prior detail state does not leak into the new session.
- Open raw drilldown and confirm the lossless source row remains accessible.
- Restart the service and repeat one valid preview request.

- 观察浏览器网络请求，同时展开一个 `view_image` event。
- 确认 detail JSON 先到达，图片字节后按需到达。
- 确认立即可见的预览可以正常加载。
- 在浏览器允许延后请求时，确认视口外预览不会被主动获取。
- 切换 session，确认旧 detail 状态不会泄漏到新 session。
- 打开 raw drilldown，确认仍可访问无损来源行。
- 重启服务后重复一次有效预览请求。

### Commands / 命令

```powershell
npm test
node --check 'src\codex.js'
node --check 'server.js'
node --check 'public\app.js'
node --check 'public\renderers.js'
git diff --check
```

## Rollback Strategy / 回滚策略

Keep the work staged by milestone:

按里程碑分阶段提交工作：

1. Land index descriptor extraction with tests.
2. Land endpoint behavior with tests.
3. Land frontend renderer and cache changes.
4. Land documentation and measurement closure.

1. 提交索引 descriptor 抽取和测试。
2. 提交端点行为和测试。
3. 提交前端 renderer 与缓存改动。
4. 提交文档与测量收口。

If endpoint or frontend behavior regresses, the descriptor model remains independently testable. Do not restore inline base64 as a silent fallback in logical detail responses; use an explicit error state while fixing the regression.

如果端点或前端行为回归，descriptor model 仍可独立测试。不得在 logical detail 响应中静默恢复内联 base64 作为 fallback；修复期间应使用明确错误状态。

## Progress Log / 进度日志

### 2026-05-31

- Created this active plan after reviewing current implementation paths, documentation conventions, and measured image-payload behavior.
- Chose all-image URL-based lazy preview loading plus selective server-index externalization.
- Kept generic large-section lazy loading and mandatory byte-offset indexing out of the initial scope.
- Identified raw-layer lossless drilldown as an explicit compatibility checkpoint rather than assuming the existing in-memory raw inspector remains lossless.

- 在复核当前实现路径、文档规范和图片 payload 测量结果后创建本 active plan。
- 选定所有图片统一 URL 懒加载，并在服务端索引中选择性外置图片 payload。
- 首期不引入通用大型 section 懒加载，也不强制增加 byte-offset 索引。
- 将 raw layer 无损下钻列为明确兼容性检查点，而不是默认假设现有内存 raw inspector 仍然无损。

### 2026-05-31 Completion / 完成记录

- Externalized supported raster image data URLs before retained raw-event derivation and added compact event-local source descriptors.
- Added a controlled binary endpoint that resolves indexed descriptors only, rereads source JSONL rows, validates MIME, path, signature, base64 syntax, and size guards, and returns `no-store`, `nosniff` raster bytes.
- Switched inspector previews to controlled same-origin URLs with native lazy loading, async decoding, explicit failure state, and session-switch detail-cache invalidation.
- Added automated coverage for renderer allowlisting, externalization, dedupe caps, bounded decoder behavior, arbitrary-path rejection, stale sources, malformed identifiers, and lossless Raw refs.
- Verified `npm test` with `58` passing tests, JavaScript syntax checks, and `git diff --check`.
- Restarted the local service and verified a real `view_image` inspector in Playwright: detail loaded first, then `/image-previews/image-363-0` loaded separately with HTTP `200`.
- Rebuilt the 2026-05-31 development corpus in approximately `8.2 s`: `56` sessions, `24,515` logical events, `39,702` raw events, `87` image descriptors, and zero retained supported inline image data URLs.
- Reduced all-logical-detail serialization from approximately `88.8 MB` before the change to `74.3 MB` after the change.
- Measured representative front, middle, and later preview source reads at approximately `15-20 ms`; byte-offset indexing remains deferred.
- Recorded generic non-image large-section deferred loading as separate technical debt.

- 在保留 raw event 派生之前外置受支持的 raster 图片 data URL，并增加紧凑的 event-local 来源 descriptor。
- 新增受控二进制端点：只解析已索引 descriptor，重新读取来源 JSONL 行，验证 MIME、path、签名、base64 语法和大小限制，并返回带 `no-store`、`nosniff` 的 raster 字节。
- 将 inspector 预览切换为受控同源 URL，使用浏览器原生懒加载、异步解码、明确失败状态，并在 session 切换时让 detail cache 失效。
- 增加自动化覆盖：renderer allowlist、外置、去重上限、有界 decoder、任意路径拒绝、来源过期、非法 identifier 和无损 Raw refs。
- 已验证 `npm test` 的 `58` 个测试全部通过，并运行 JavaScript 语法检查和 `git diff --check`。
- 已重启本地服务，并通过 Playwright 验证真实 `view_image` inspector：detail 先加载，随后 `/image-previews/image-363-0` 独立请求并返回 HTTP `200`。
- 重新构建 2026-05-31 开发语料，耗时约 `8.2 s`：`56` 个 session、`24,515` 个 logical event、`39,702` 个 raw event、`87` 个图片 descriptor，保留的受支持内联图片 data URL 数量为零。
- 全量 logical detail 序列化体积由变更前约 `88.8 MB` 降至变更后约 `74.3 MB`。
- 代表性的前部、中部和后部预览来源读取约耗时 `15-20 ms`；byte-offset 索引继续推迟。
- 已将通用非图片大型 section 延迟加载记录为独立技术债。
