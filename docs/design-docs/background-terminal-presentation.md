# Background terminal requests / 后台终端请求

## Scope / 范围

Phase A interprets durable Codex `response_item/function_call(name=write_stdin)` arguments as request evidence. Each call remains its existing Logical Event. No origin association, output-header parser, process epoch, or canonical `exec_command` classification change is included. / A 阶段将 durable Codex `response_item/function_call(name=write_stdin)` 的 arguments 解释为请求证据。每次调用保留原有 Logical Event；不包含 origin 关联、输出 header parser、process epoch 或 `exec_command` canonical 分类变更。

## Facts and ownership / 事实与归属

- Exactly one durable function request must belong to the event. Missing `chars` or an empty string means `poll`; every nonempty string means `input`, including whitespace, newline, Ctrl-C and escape sequences. Invalid JSON, non-object arguments and non-string explicit `chars` fall back to generic presentation. / Event 必须拥有恰好一条 durable function request。缺失 `chars` 或空字符串表示 `poll`；所有非空字符串均表示 `input`，包括空白、换行、Ctrl-C 和转义序列。无效 JSON、非对象参数和显式非字符串 `chars` 回退到通用展示。
- `session.presentationIndexes.backgroundTerminalRequests` maps existing event IDs to `{action, processId?}`. `processId` is admitted only for a JSON integer in the source i32 range; invalid IDs do not erase independently valid action evidence. This number identifies the requested runtime process, not the Analyzer Session or a permanent process identity. / 该索引将既有 event ID 映射到 `{action, processId?}`。仅接受源 i32 范围内的 JSON 整数 ID；无效 ID 不抹去独立有效的 action 证据。该数字是请求中的 runtime process ID，不是 Analyzer Session 标识或永久 process identity。
- Facts are rebuilt during materialized-session finalization from existing raw arguments. They are not added to the durable project-query store or canonical Logical Event. No canonical schema version change is needed; server restart discards old in-memory materializations. / 在 materialized session finalization 中从既有 raw arguments 重建事实，不加入持久 project-query store 或 canonical Logical Event。无需修改 canonical schema version；服务重启丢弃旧的内存 materialization。
- No stdin, output, command text, `originEventId`, or Raw References are copied into this index. Existing generic search storage is unchanged; this is not a global stdin-redaction change. / 索引不复制 stdin、output、command text、`originEventId` 或 Raw References。既有 generic 搜索存储保持不变；本次并非全局 stdin 脱敏。

## Presentation / 呈现

Timeline and Trajectory show `Background terminal poll request` or `Background terminal input request`, localized together. Request wording applies equally to pending, rejected and completed calls, without asserting a successful wait or write. No command suffix is shown. Compact terminal cards suppress generic arguments/search snippets; search hit identity and counts remain available and full evidence can be inspected. / Timeline 与 Trajectory 同步显示“后台终端轮询请求”或“后台终端输入请求”。请求措辞适用于 pending、rejected 和 completed 调用，不声称等待或写入成功；不显示 command 后缀。紧凑 terminal 卡片不显示 generic 参数／搜索片段；搜索命中 identity 和数量保留，可检查完整证据。

Detail reuses generic Request/Response hydration and adds process ID, request type, and bounded input in JSON string notation, making whitespace/control characters explicit. The hydrated generic Request retains the original data under existing detail limits and Raw Record access. Raw Reference ownership, search ownership, counts, canonical labels/kinds/status, and folding rules are unchanged. / Detail 复用 generic Request/Response hydration，增加 process ID、请求类型及有界 JSON 字符串形式的输入，使空白／控制字符可辨识。Hydrated generic Request 按既有 detail 限制及 Raw Record 访问方式保留原数据。Raw Reference ownership、搜索 ownership、计数、canonical label/kind/status 与折叠规则均不变。

## Evidence and deferred work / 证据与后续工作

Source basis: [write_stdin handler](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs), reviewed during design. The MVP depends only on argument defaults/types, not unstable runtime lifecycle persistence. Synthetic fixture: `test/fixtures/background-terminal/requests.jsonl`. / 来源依据：设计阶段已复核的上述 handler。MVP 仅依赖参数默认值／类型，不依赖不稳定的 runtime lifecycle 持久化。合成 fixture 见上述路径。

Phase B is separately bounded in `../exec-plans/active/2026-09-11-terminal-continuation-ordering-investigation.md`. Phase C is tech debt #25. Neither blocks request presentation. / B 阶段窄调查单列于上述 active plan；C 阶段见技术债 #25，均不阻塞请求呈现。
