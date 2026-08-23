# DeepSeek Harness Phase 2C fixtures / DeepSeek Harness 第二阶段 C fixtures

All payloads are synthetic and sanitized. No copied real-Session failure message, objective, Todo content, prompt, source code, tool output, local path, credential, or private identifier is stored here. / 所有 payload 均为合成并已脱敏；这里不保存任何复制自真实 Session 的 failure message、objective、Todo content、prompt、源码、工具输出、本地路径、credential 或私有 identifier。

## Evidence labels / 证据标签

- `retry/session.jsonl` preserves current format-v0 `llm/retry` and `llm/retry-started` physical shapes from source `b150a551…` (`0.1.1-rc.2`). The normal retry-1 schedule/start case is a sanitized structural derivation of the five copied Minimal examples. Scheduled-only cancellation/incomplete evidence, always mode, and a two-attempt chain are current-source-backed synthetic cases, not real-corpus observations. / `retry/session.jsonl` 保留当前源码 `b150a551…`（`0.1.1-rc.2`）的 format-v0 `llm/retry` 与 `llm/retry-started` 物理 shape。Normal retry-1 schedule／start case 是五个复制 Minimal 示例的脱敏结构派生；仅 schedule 的取消／不完整证据、always mode 与两 attempt chain 都是当前源码支撑的合成 case，并非真实语料观察。

The `.gitattributes` rule keeps every uncompressed JSONL fixture byte-exact on Windows. / `.gitattributes` 规则保证每个未压缩 JSONL fixture 在 Windows 上保持逐字节精确。
