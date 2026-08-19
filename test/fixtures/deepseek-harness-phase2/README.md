# DeepSeek Harness Phase 2A fixtures / DeepSeek Harness 第二阶段 A fixtures

All transcripts are synthetic. No real user session transcript is stored here. / 所有转录均为合成数据，不包含真实用户会话转录。

## Physical byte provenance / 物理字节来源

| Case / 场景 | Files / 文件 | Provenance / 来源 |
| --- | --- | --- |
| spawned subagent | `session-fcf6d004…` (parent) → `43e17fdc…` (child) | byte copies of current-writer artifacts from `spike/fx-home/sessions/…`, writer `@deepseek-ai/dsh` npm `0.1.0-rc.6` / 从 `spike/fx-home` 逐字节复制的当前 writer 产物 |
| seedless parented fork | `session-0b3a0d49…` (parent) → `3a7dda0f…` (child) | same byte-copy provenance / 同上 |
| seeded fork | `session-142314a5…` (parent) → `1e7def20…` (child, `seedLength:54` + `session/end-seed` at seq 54) | same byte-copy provenance / 同上 |
| effective preset, no selection | `preset-header-code` | uncompressed `session.jsonl` written through the `0.1.0-rc.6` `JsonlSessionPersistence` backend (`compression:"none"`, `packChunks:false`) with a synthetic header/event sequence; no current-writer runtime produced an `agent-preset/selected` artifact in the spike, so this is persistence-writer serialization evidence plus upstream source semantics / 通过 `0.1.0-rc.6` `JsonlSessionPersistence` 写入的合成序列；spike 未产生 `agent-preset/selected` 运行时产物 |
| effective preset, one selection | `preset-selected-code` | same writer serialization provenance / 同上 |
| effective preset, multiple selections | `preset-selected-latest` | same writer serialization provenance / 同上 |

Upstream source anchor for intent: `tmp/deepseek-harness` commit `47f943859bef60e4160492346772ded9b24f765a`. / 源码意图锚点同上。

The `.gitattributes` Phase 2A `session.jsonl` pattern preserves uncompressed bytes exactly on checkout, including Windows. / `.gitattributes` 规则保证未压缩 fixture 在检出时字节不变。
