# DeepSeek Harness Phase 1 fixtures / DeepSeek Harness 第一阶段 fixtures

All transcripts are synthetic and were written by the current DeepSeek Harness
runtime. No real user session transcript is stored here. / 所有转录均为合成数据，由当前 DeepSeek Harness 运行时写入。这里不保存任何真实用户会话转录。

## Writer provenance / writer 来源

- npm package / npm 包: `@deepseek-ai/dsh` `0.1.0-rc.6`
- Source anchor inspected for intent only / 仅为理解实现意图检查的源码锚点: `tmp/deepseek-harness` commit `47f943859bef60e4160492346772ded9b24f765a`
- The npm artifact is **not** claimed to be byte-for-byte identical to that Git commit. / **不**声称 npm 产物与该 Git 提交逐字节一致。
- Runtime used by the spike / spike 运行环境: Node v25.6.1.

## Physical files / 物理文件

| File / 文件 | Case / 场景 | Provenance / 来源 | Notes / 说明 |
| --- | --- | --- | --- |
| `sessions/--home-joejack-dsh_playground-spike-ws-normal--/session-695bc3a2-78cb-4585-8acc-e637c327efa1/session.jsonl.zstd` | normal user → assistant/tool → result round | byte copy of the physical current-writer artifact from `spike/fx-home` | authoritative physical evidence |
| `../deepseek-harness-uncompressed/sessions/--home-joejack-dsh_playground-spike-ws-normal--/session-695bc3a2-78cb-4585-8acc-e637c327efa1/session.jsonl` | same logical normal session, `compression:none`, kept in a separate fixture root because the JSONL backend permits exactly one physical artifact per session directory | generated through the `@deepseek-ai/dsh` `0.1.0-rc.6` JSONL persistence writer (`JsonlSessionPersistence` with `compression:"none"`), replaying the original per-batch storage rows | byte-identical JSONL to the spike's decoded inspection artifact; physical bytes are uncompressed |
| `sessions/--home-joejack-dsh_playground-spike-ws-interrupt--/session-d4976b66-54c6-4884-aa6a-819d07759be8/session.jsonl.zstd` | user-aborted partial assistant turn with packed chunks | byte copy of the physical current-writer artifact from `spike/fx-home` | no finalized `assistant/message`; 269 chunks packed into 16 rows |
| `sessions/--home-joejack-dsh_playground-spike-ws-interrupt--/session-b2744c2e-515a-4f02-b16a-c706f921576a/session.jsonl.zstd` | SIGKILL interrupted/open-turn artifact | byte copy of `spike/artifacts/crash-state.raw.zstd` | exposes 783 committed stored events and an open turn; the read-only analyzer adds no synthetic `step/end`/`turn/end` closers. Torn-frame behavior is covered in tests by truncating a valid frame byte range; the physical writer artifact is never modified in the committed fixture |

The `cwd` values in the headers are synthetic spike workspace paths and are
intentionally retained as fixture data. / header 中的 `cwd` 值是合成 spike 工作区路径，有意保留为 fixture 数据。
