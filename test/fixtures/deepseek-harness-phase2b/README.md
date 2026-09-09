# DeepSeek Harness Phase 2B fixtures / DeepSeek Harness 第二阶段 B fixtures

All payloads are synthetic and sanitized. No copied real-Session prompt, source code, tool output, local path, or identifier is stored here. / 所有载荷均为合成并已脱敏；这里不保存任何复制自真实会话的 prompt、源码、工具输出、本地路径或标识符。

## Evidence labels / 证据标签

- `code-mode/session.jsonl` preserves the current format-v0 physical row shapes and durable ID topology from current DeepSeek Harness source `b150a55…` (`0.1.1-rc.2`). Its successful depth-1 pairing and interleaved ordering are sanitized structural derivations from the copied PTC Session; nested error, start-only incomplete, failed outer result, and depth 2 are current-source-backed synthetic cases, not real-corpus observations. / `code-mode/session.jsonl` 保留当前 DeepSeek Harness 源码 `b150a55…`（`0.1.1-rc.2`）的 format-v0 物理 row 形态与持久 ID 拓扑。成功的 depth-1 pairing 与交错顺序来自已复制 PTC 会话的脱敏结构派生；nested error、仅 start 的 incomplete、outer result 失败及 depth 2 都是当前源码支撑的合成场景，并非真实语料观察。
- `workflow/session.jsonl` is a current-source-only synthetic projection of the four `tool-workflow/*` rows and their invariants. The accepted copied corpus contains this family in 0/6 Sessions, so this fixture does not claim empirical writer validation. / `workflow/session.jsonl` 是四类 `tool-workflow/*` row 及其 invariant 的当前源码专属合成投影。已接受的复制语料在 0／6 个会话中包含该 family，因此该 fixture 不声称具有真实 writer 实证验证。

The `.gitattributes` rule keeps these uncompressed JSONL files byte-exact on Windows. / `.gitattributes` 规则保证这些未压缩 JSONL 文件在 Windows 上保持逐字节精确。
