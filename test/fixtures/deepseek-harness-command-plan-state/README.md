# DeepSeek Harness command and plan-state fixture

This sanitized format-v0 fixture preserves only the accepted Batch A structural
facts needed by the adapter: two unique `command/run` + `command/done` pairs,
independent boolean `plan/mode` rows, and one intervening unrelated Protocol
row. It contains no real prompt, reasoning, assistant output, credential, or
private path. Tests protect the exact fixture bytes with SHA-256.

`command/done.sourceEventSeq` cases are synthetic and backed by the current
upstream `@deepseek-ai/dsh` command contract at commit `b150a551…`; Batch A did
not observe that optional field.
