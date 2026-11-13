# Codex record capacity / Codex 单条记录容量

## Contract / 契约

Codex JSONL readers admit at most 64 MiB of decoded UTF-8 bytes per physical record, excluding LF/CRLF delimiters. This is a record bound, not a whole-file size bound. Plain and Zstandard artifacts use the same policy. Oversized records produce `CODEX_ROLLOUT_RECORD_TOO_LARGE`; direct read requests use HTTP 413. / Codex JSONL reader 每个物理记录最多接纳 64 MiB 解码后 UTF-8 字节，不含 LF／CRLF 分隔符。这是单条记录限制，不是文件总大小限制；普通与 Zstandard 工件采用同一策略。超限返回所列错误码，直接读取请求使用 HTTP 413。

Project discovery diagnoses and excludes the affected artifact, then continues independent artifacts. Index builders exclude a candidate rejected during initial parsing/relationship analysis; they never publish that candidate's partial Session or query data. A later failure while replaying already accepted evidence rejects the operation, preserving the existing index. Counts with source diagnostics must not be described as complete corpus coverage. / 项目发现诊断并排除受影响工件，继续其他独立工件；索引构建排除初始解析／关系分析阶段被拒绝的候选，不发布其部分会话或查询数据。回放已接纳依据期间的后续失败拒绝该操作并保留既有索引。存在来源诊断时，计数不能被描述为完整语料覆盖。

No JSON text is truncated or fabricated. Accepted records retain their Raw identity, line numbering, native bytes and prefix hashes. The shared iterator preserves the previous parser's LF, CRLF and standalone-CR handling, including delimiter boundaries split across stream chunks and an unterminated final record. / 不截断或伪造 JSON。已接纳记录保持 Raw 身份、行号、原生字节及前缀 hash；共用迭代器保留既有 parser 对 LF、CRLF、独立 CR 的处理，覆盖分隔符跨 chunk 及未换行结尾的记录。

## Implementation and tradeoffs / 实现与取舍

`src/codex-rollout-storage.js#readLogicalLines` counts byte slices before concatenating/decoding a record. Async iteration supplies backpressure and normal Promise rejection; every exit destroys its input. Discovery inspection, parsing, relationship scans, Raw verification and single-line readback use it. A 64 MiB working bound stays well below V8's approximately 512-million-code-unit string ceiling and allows records substantially larger than existing multi-megabyte fixtures, while bounding accumulation before JSON parsing. It is not a total heap, decoded-file or JSON-object-allocation guarantee. / 所列共用迭代器在记录拼接／解码前统计字节片段，以异步迭代提供背压及正常 Promise rejection，并在所有退出路径销毁输入。项目检查、解析、关系扫描、Raw 核验及单行回读均使用它。64 MiB 工作上限远低于 V8 约五亿码元的字符串上限，可容纳显著大于既有数 MiB fixture 的记录，同时限制 JSON 解析前的积累；它不保证总堆、解码文件或 JSON 对象分配容量。

The Zstandard snapshot layer still validates and captures decoded bytes before a reader consumes the private snapshot; this change does not add a decoded-file disk budget. Large multi-record files remain stream-readable. Increasing the V8 heap, catching only the HTTP request, or skipping arbitrary bytes would not solve the original unchecked `readline` callback throw correctly. / Zstandard 快照层仍先验证并捕获解码字节，再由 reader 消费私有快照；本变更未增加解码文件磁盘预算。包含大量正常记录的大文件仍可流式读取。增大 V8 堆、仅捕获 HTTP 请求异常或任意跳过字节，都不能正确解决原来未受控 readline 回调抛出异常的问题。

Project discovery owns a per-request abort controller. Request disconnect and source-configuration revision changes cancel its adapter context; completed/failed operations remove listeners and controllers. Revision checks still prevent stale results from updating the project cache, including adapters that finish after cancellation. / 项目发现为每个请求管理取消控制器；请求断开及来源配置 revision 变化会取消传给 adapter 的上下文，完成／失败时移除监听和控制器。Revision 检查继续防止过期结果写入项目缓存，包括取消后才完成的 adapter。

## Evidence / 依据

An actual plain rollout contained a newline-terminated 1,516,023,436-byte tool-output record. Calling project discovery once reproduced an uncaught `RangeError: Invalid string length` in Node 24.22.2's `readline` data callback. A first project-summary response had already succeeded, explaining the visible project list with unfinished statistics. Committed tests use synthetic input only. / 实际普通 rollout 包含一条有换行终止、大小如上的工具输出记录；单次项目发现即可在 Node 24.22.2 的 readline data 回调复现未捕获字符串长度异常。项目概要此前已成功返回，因此界面已显示列表但统计未完成。提交的测试仅使用合成输入。

Tests cover byte boundaries, UTF-8, CRLF, cancellation, I/O failure, early close, plain/compressed single-line reads, both index builders, and a separate HTTP process that survives a sparse oversized fixture. The existing Codex snapshot/history tests protect accepted-prefix and replay behavior. / 测试覆盖字节边界、UTF-8、CRLF、取消、I/O 失败、提前关闭、普通／压缩单行读取、两种索引构建，以及面对稀疏超大 fixture 仍存活的独立 HTTP 进程。既有 Codex 快照／历史测试保护已接纳前缀及回放行为。
