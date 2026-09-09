# DeepSeek Harness tool-result prune provenance fixture / DeepSeek Harness 工具结果裁剪来源追溯 fixture

This format-v0 JSONL fixture is minimal, synthetic, sanitized, and byte-protected. It contains no copied prompt, response, reasoning, tool output, local path, or identifier from the ignored current-writer Session. / 这份 format-v0 JSONL fixture 最小化、完全合成、经过脱敏并受字节保护；它不包含从 ignored current-writer Session 复制的 prompt、response、reasoning、工具输出、本地路径或标识符。

The physical shape is a structural derivation from the accepted `@deepseek-ai/dsh 0.1.1-rc.2` current-writer evidence and producer at `b150a551…`: one append-origin tool result, a singleton `compaction/prune` shadow price, and one later replacement `tool/result` whose exact replace range and `sourceEventSeqs` name the original result. Payload text and IDs are synthetic. / 物理形态由已接受的 `@deepseek-ai/dsh 0.1.1-rc.2` current-writer 证据及 `b150a551…` producer 做结构派生：一条 append-origin 工具结果、一条 singleton `compaction/prune` shadow price，以及一条通过精确 replace range 与 `sourceEventSeqs` 指向原始结果的后续 replacement `tool/result`。Payload 文本与 ID 均为合成。

The `.gitattributes` rule and focused SHA-256 assertion preserve the exact uncompressed bytes on Windows. / `.gitattributes` 规则与聚焦 SHA-256 断言保证未压缩字节在 Windows 上保持精确。
