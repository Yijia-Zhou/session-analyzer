# External source mapping pressure tests / 外部 source 映射压力测试

## Metadata / 元数据

- Owner: repository maintainers / 负责人：仓库维护者
- Status: accepted for v0.1 schema pressure testing / 状态：已接受为 v0.1 schema 压力测试
- Last updated: 2026-06-11 / 最近更新：2026-06-11
- Scope: design pressure tests only; no non-Codex importer commitment for v0.1 / 范围：仅设计压力测试；v0.1 不承诺非 Codex importer
- Related design doc: `docs/design-docs/logical-event-timeline.md`
- Related plan: `docs/exec-plans/active/2026-06-10-v0.1-release-hardening.md`

## Summary / 摘要

v0.1 remains Codex-first. Claude Code, OpenCode, Crush, and Hermes are used here to pressure-test the canonical DTO envelope and source locator model before the public release, not to promise importer support in v0.1.

v0.1 仍保持 Codex 优先。Claude Code、OpenCode、Crush 和 Hermes 在本文中用于在公开发布前压力测试 canonical DTO envelope 与 source locator 模型，而不是承诺在 v0.1 支持 importer。

The Stage 1 envelope remains sufficient for the observed and researched pressure points: `schemaVersion`, `sourceKind`, optional `sourceSchemaVersion`, typed `sourceLocator`, raw DTO top-level `sourceRecordType` / `sourceEventType`, and row-level `rawRefs[]` source type metadata on logical/detail DTOs. Logical and detail DTOs keep refs-only source type semantics.

阶段 1 envelope 对已观察和已调研的压力点仍然足够：`schemaVersion`、`sourceKind`、可选 `sourceSchemaVersion`、typed `sourceLocator`、raw DTO 顶层 `sourceRecordType` / `sourceEventType`，以及 logical/detail DTO 上逐行 `rawRefs[]` source type metadata。Logical 和 detail DTO 保持 refs-only source type 语义。

## Evidence recorded on 2026-06-10 / 2026-06-10 记录的依据

The following sources were used as external schema pressure-test inputs. They are evidence for adapter shape, not accepted importer specifications.

以下来源被用作外部 schema 压力测试输入。它们是 adapter 形态依据，而不是已接受的 importer 规格。

- Claude Code docs: `https://code.claude.com/docs/en/session-management`, `https://code.claude.com/docs/en/cli-reference`, `https://code.claude.com/docs/en/hooks`
- OpenCode docs and source: `https://opencode.ai/docs/`, `https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/schema.ts`, `https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/message.ts`, `https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts`, `https://github.com/anomalyco/opencode/blob/dev/packages/core/src/event.ts`
- OpenCode dev HEAD observed by the manager for this pressure test: `649618c50ac382a763921201cb2b53e0dff88e0c`
- Crush: treated as a likely database or event-sourced pressure point by analogy, without a verified concrete schema in this repository.
- Hermes: kept as an observation target until a trustworthy transcript or schema source is available.

- Claude Code 文档：`https://code.claude.com/docs/en/session-management`、`https://code.claude.com/docs/en/cli-reference`、`https://code.claude.com/docs/en/hooks`
- OpenCode 文档和源码：`https://opencode.ai/docs/`、`https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/schema.ts`、`https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/message.ts`、`https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts`、`https://github.com/anomalyco/opencode/blob/dev/packages/core/src/event.ts`
- 本次压力测试中由 manager 观察到的 OpenCode dev HEAD：`649618c50ac382a763921201cb2b53e0dff88e0c`
- Crush：按类似数据库或 event-sourced 形态作为压力点处理，但本仓库尚未验证其具体 schema。
- Hermes：在取得可信 transcript 或 schema 来源前，保持为观察目标。

## Pressure-test inputs / 压力测试输入

### Claude Code

Claude Code pressures the model through session identity, streaming, and operational metadata rather than only through file-line transcript rows.

Claude Code 对模型的压力主要来自 session identity、streaming 和操作元数据，而不只是 file-line transcript 行。

- Session keys may need to represent project, session, and subpath shape instead of a single JSONL path. / Session key 可能需要表示 project、session 和 subpath 形态，而不是单一 JSONL 路径。
- Sessions may come from JSONL or external session stores, so locators must not assume a local file path. / Session 可能来自 JSONL 或外部 session store，因此 locator 不能假设本地文件路径。
- Partial stream events need stable raw drill-down without forcing every partial into a separate top-level logical event. / Partial stream event 需要稳定 raw 下钻，但不应强迫每个 partial 都成为独立顶层 logical event。
- Hooks can add lifecycle records around the main assistant/user/tool sequence. / Hook 可能在主 assistant/user/tool 序列周围增加 lifecycle record。
- Subagents and permissions add source metadata that may matter for labels, status, grouping, or details. / Subagent 和 permission 会增加可能影响 label、status、grouping 或 detail 的 source metadata。
- Parent tool-use relationships may be present, but they do not justify a canonical `parentRef` until UI, search, grouping, or detail behavior needs it. / Parent tool-use 关系可能存在，但在 UI、搜索、分组或 detail 行为需要它之前，不足以证明要加入 canonical `parentRef`。

### OpenCode

OpenCode pressures the model through database projections, message/part granularity, tool state, and durable event cursors.

OpenCode 通过数据库投影、message/part 粒度、tool state 和持久 event cursor 对模型施压。

- SQLite-backed `session`, `message`, `part`, and `session_message` projections require locators that can point at rows, messages, parts, and projection sequence values. / SQLite 支撑的 `session`、`message`、`part` 和 `session_message` 投影要求 locator 能指向 row、message、part 和投影序列值。
- Durable event streams may expose aggregate cursor or sequence positions rather than file line numbers. / 持久 event stream 可能暴露 aggregate cursor 或 sequence 位置，而不是文件行号。
- Assistant content parts include text, reasoning, and tool content; a single logical row may need several raw refs. / Assistant content part 包含 text、reasoning 和 tool content；单个 logical row 可能需要多个 raw ref。
- Tool state can move through pending, running, completed, and error states; mapping should preserve raw traceability without adding adapter-specific state fields to every DTO. / Tool state 可能经历 pending、running、completed 和 error；映射应保留 raw 可追踪性，而不是给每个 DTO 添加 adapter-specific 状态字段。
- Aggregate event cursor or sequence shape should be represented as source locator data, not as a new cross-source top-level field. / Aggregate event cursor 或 sequence 形态应表示为 source locator 数据，而不是新的跨 source 顶层字段。

### Crush

Crush is a pressure-test placeholder for database-backed or event-sourced transcript storage. It is useful for validating that the envelope does not assume JSONL, file paths, or one raw row per logical event, but this document does not claim a verified Crush schema.

Crush 是 database-backed 或 event-sourced transcript storage 的压力测试占位。它可用于验证 envelope 不假设 JSONL、文件路径或每个 logical event 只有一个 raw row，但本文不声称已验证 Crush schema。

### Hermes

Hermes remains an observation target. No envelope field should be added for Hermes until a trustworthy transcript, schema, or upstream source exists and shows a concrete UI/search/grouping/detail need.

Hermes 保持为观察目标。在取得可信 transcript、schema 或 upstream source，并证明存在具体 UI、搜索、分组或 detail 需求前，不应为 Hermes 添加 envelope 字段。

## Envelope conclusion / Envelope 结论

The existing envelope is intentionally small and adapter-ready:

现有 envelope 有意保持小而 adapter-ready：

- `schemaVersion` lets every returned DTO state the Session Analyzer DTO contract it follows. / `schemaVersion` 让每个返回 DTO 说明自己遵循的 Session Analyzer DTO contract。
- `sourceKind` identifies the source family, such as `codex`, future `claude-code`, future `opencode`, or a future verified source kind. / `sourceKind` 标识 source family，例如 `codex`、未来的 `claude-code`、未来的 `opencode`，或未来已验证的 source kind。
- `sourceSchemaVersion` remains optional and must not be invented when the source does not provide a trustworthy version. / `sourceSchemaVersion` 保持可选；来源未提供可信版本时不得编造。
- `sourceLocator` is a typed object, so future adapters can represent JSONL lines, database rows, message/part IDs, or event stream cursors without changing the canonical DTO shape. / `sourceLocator` 是 typed object，因此未来 adapter 可以表示 JSONL 行、数据库 row、message/part ID 或 event stream cursor，而无需改变 canonical DTO 形态。
- Raw DTOs may expose top-level `sourceRecordType` and `sourceEventType` because they represent a precise source row or record. / Raw DTO 可以暴露顶层 `sourceRecordType` 和 `sourceEventType`，因为它们表示精确 source row 或 record。
- Logical/detail DTOs keep source type metadata inside `rawRefs[]` so grouped rows remain refs-only and do not pretend to have one aggregate source type. / Logical/detail DTO 将 source type metadata 保持在 `rawRefs[]` 内，使分组行保持 refs-only，不伪装成拥有单一聚合 source type。

Do not add `parentRef`, `externalSessionKey`, `adapterWarnings`, or similar broad optional fields during v0.1 hardening unless a later verified source proves that the field changes UI behavior, search behavior, grouping, or detail rendering.

在 v0.1 加固期间，不要添加 `parentRef`、`externalSessionKey`、`adapterWarnings` 或类似宽泛可选字段，除非后续已验证 source 证明该字段会改变 UI 行为、搜索行为、分组或 detail 渲染。

## Future locator examples / 未来 locator 示例

The following examples describe future pressure-test semantics only. They are not implemented APIs, not accepted public importer contracts, and not fixtures.

以下示例只描述未来压力测试语义。它们不是已实现 API，不是已接受的公开 importer contract，也不是 fixture。

```json
{
  "type": "jsonl-line",
  "path": "/home/user/.claude/projects/example/session.jsonl",
  "line": 42
}
```

```json
{
  "type": "claude-session",
  "projectKey": "example-project",
  "sessionId": "session-uuid-or-name",
  "subpath": "packages/web",
  "recordOrdinal": 42
}
```

```json
{
  "type": "sqlite-row",
  "database": "opencode.db",
  "table": "session_message",
  "sessionId": "ses_example",
  "rowId": "msg_example",
  "seq": 17
}
```

```json
{
  "type": "opencode-message-part",
  "sessionId": "ses_example",
  "messageId": "msg_example",
  "partId": "part_example"
}
```

```json
{
  "type": "event-stream",
  "aggregateId": "ses_example",
  "cursor": 123,
  "seq": 17
}
```

Adapter implementations may choose different exact keys after real importer work begins. The important constraint is that locator shape remains source-specific and typed, while the canonical DTO envelope remains stable.

真实 importer 工作开始后，adapter 实现可以选择不同的精确 key。关键约束是 locator 形态保持 source-specific 且 typed，同时 canonical DTO envelope 保持稳定。

## Release implication / 发布影响

Stage 4 does not change runtime behavior. It confirms that v0.1 can stay Codex-first while preserving future source boundaries for non-Codex adapters. Browser automation remains the next release-hardening stage.

阶段 4 不改变 runtime 行为。它确认 v0.1 可以保持 Codex 优先，同时为未来非 Codex adapter 保留 source 边界。浏览器自动化仍是下一个发布前加固阶段。
