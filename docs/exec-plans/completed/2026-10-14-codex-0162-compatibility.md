# Codex 0.162 compatibility / Codex 0.162 兼容

Status: completed; real-project acceptance passed after the separately authorized [rollout-history follow-up](2026-10-14-codex-rollout-history-chains.md) resolved debt #31. / 状态：完成；另行授权的[rollout 历史后续](2026-10-14-codex-rollout-history-chains.md)解决债务 31 后，真实项目验收通过。

## Scope / 范围

Implement the first compatibility round against pinned `rust-v0.162.0` writer evidence: correct command output labels, surface recorded truncation evidence, distinguish requested versus resolved sub-agent startup settings, and summarize additional tool declarations in Protocol. Preserve existing kinds, counts, Raw ownership, source locators and old shapes. Turn-lineage navigation/aggregation and Codex SQLite ingestion are outside this round. / 根据固定版本 writer 依据实施首轮兼容：修正命令输出标签，展示记录中的截断证据，区分请求与实际解析的子 agent 启动设置，在 Protocol 中摘要新增工具声明。保留既有 kind、计数、Raw 归属、来源定位及旧形态。本轮不包含 turn lineage 导航／聚合及 Codex SQLite 接入。

## Evidence and boundaries / 依据与边界

- [Persistence policy](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/rollout/src/policy.rs): the 64 KiB command policy applies to paginated `item_completed.CommandExecution.aggregated_output`, with the exact persistence marker. It is not a universal limit on response outputs. / 命令 64 KiB 策略适用于分页历史的所列字段及精确持久化标记，不是全部 response output 的通用限制。
- [MCP truncation helper](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/utils/output-truncation/src/lib.rs): oversized results become bounded serialized-JSON text previews, retaining `isError` and removing structured content/meta; the generic text marker alone does not establish which stage truncated the result. / 超大结果转为有界序列化 JSON 文本预览，保留错误状态并移除结构化内容／meta；通用文本标记本身不能证明截断阶段。
- [Turn items](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/protocol/src/items.rs) and [protocol](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/protocol/src/protocol.rs): persisted `SubAgentActivity` / `sub_agent_activity` use `model` and `reasoning_effort`; only startup evidence establishes resolved creation settings, not lifetime settings. Context fields are optional to this reader and `summary` is compatibility evidence. / 持久化活动使用所列字段；仅启动证据用于实际创建设置，不能代表整个生命周期。当前 reader 可选处理 context 字段，summary 保持兼容证据。
- [Additional tools](https://github.com/openai/codex/pull/50435): declarations persist in legacy and paginated history, including nested namespace definitions. They are not tool executions. / 工具声明在两种历史模式均可持久化，包含嵌套 namespace；声明不等于工具执行。

## Work and validation / 工作与验证

- [x] Add synthetic regressions for labels, truncation evidence/negative lookalikes, MCP errors, startup evidence/conflicts, declarations, optional context and mixed-version records. / 加入上述正负向合成回归。
- [x] Implement bounded source-specific admission and localized detail presentation; retain search tails and Raw round trips. / 实现有界来源准入与本地化详情，保留搜索尾部与 Raw 回读。
- [x] Check strict/compact/source-backed representations, incremental append and warm reuse. / 核验三种表示、增量追加及暖复用。
- [x] Update product/design/coverage documentation in English and Chinese; rebuild shared browser assets when needed. / 同步双语产品／设计／覆盖文档，按需重建共享浏览器资产。
- [x] Run relevant Node and browser checks, inspect the final diff, and restart the local development server for acceptance. / 执行相关 Node／浏览器验证，审查最终 diff，重启本地开发服务供验收。

## Initial verification / 初始验证

Five existing focused test files passed before implementation. Temporary synthetic probes confirmed aggregated-only command parsing/search, MCP error preservation, Protocol fallback for declarations, and exact source readback. They also reproduced merged output labeled stdout and resolved startup metadata absent from the Main collaboration detail/search. No real 0.162 writer session was generated. / 实现前五组既有聚焦测试通过；临时合成探针确认合并输出解析／搜索、MCP 错误保留、声明 Protocol 回退及精确来源回读，并复现合并输出误标 stdout、实际启动设置未进入 Main 协作详情／搜索。未生成真实 0.162 writer 会话。

## Implementation and validation / 实现与验证

Startup facts require a unique same-owner spawn call and started activity, bounded source fields, and no contradictory output child ID. Model/effort alone enter Main search through existing opaque-data redaction; legacy metadata-only activity stays traceability-only. The declaration summary scans at most 256 nodes to depth 4, displays at most 24 names with explicit name shortening, and labels incomplete counts as bounded lower bounds. Unknown envelopes remain generic. / 启动事实要求唯一同归属 spawn 调用及启动活动、有界来源字段，且结果中的子 agent ID 不矛盾。仅模型／effort 通过既有不透明数据脱敏进入 Main 搜索；旧版纯 metadata 活动仍仅用于溯源。声明摘要最多扫描 256 个节点、深度 4，最多显示 24 个名称并明确标记名称缩短，未完整扫描的计数标为有界下限；未知 envelope 保持通用回退。

Code Mode keeps its existing nested-event links. Source truncation evidence appears in the nested command's own hydrated detail; the outer operation does not perform extra Raw reads or assume ownership of nested output. / Code Mode 保留既有嵌套事件链接；来源截断证据在嵌套命令自身 hydrated 详情显示，外层操作不增加 Raw 读取，也不接管嵌套输出。

- PASS: full Node suite, 1702 passed / 2 platform skips / 0 failed (`node --test --test-reporter=spec 'test/*.test.js'`), Windows Node 24.18.1. The first full pass exposed and repaired a dependency-boundary violation and legacy metadata search expansion; two intentional generic-output label expectations were updated without weakening their text/cursor checks. / PASS：Windows Node 24.18.1 上全量 Node 通过 1702、平台跳过 2、失败 0。首轮全量检查发现并修复模块依赖边界违规及旧 metadata 搜索扩张；另两处通用输出标签预期按新语义更新，保留文字／游标断言。
- PASS: focused browser coverage, 11/11 including nested subtests: new 0.162 behavior in English/Chinese and Timeline/Trajectory, old 0.160 typed tools, long output layout, Code Mode shell/terminal presentation, and DeepSeek member navigation. / PASS：相关浏览器覆盖 11/11（含子测试），包含新版双语双呈现、旧版 typed 工具、长输出布局、Code Mode 命令／终端及 DeepSeek 成员导航。
- PASS: generated browser build/check, local documentation references and `git diff --check`. Full browser suite and standalone installed-package smoke were not run; this round changes no package file allowlist or dependencies. / PASS：生成资产构建／检查、本地文档引用及 diff 检查。未运行全量浏览器套件及独立安装包 smoke；本轮未改变打包文件清单或依赖。
- Existing unrelated changes in the CI diagnostics plan and hydration test were retained; no commit or publication was performed. / 保留已有 CI 诊断计划及 hydration 测试中的无关改动；未提交或发布。

## Real-project acceptance blocker / 真实项目验收阻断

Resolved by the authorized follow-up: final service acceptance indexed 999 Sessions with zero source diagnostics and verified real Main/command/Raw reading plus cross-session search. Final combined validation passed 1731 Node tests (2 platform skips), six targeted browser tests and installed-package smoke. The historical blocker investigation below explains the scope extension. / 已由获授权后续解决：最终服务验收成功索引 999 个会话、来源诊断为零，并核验真实 Main／命令／Raw 阅读及跨会话搜索。最终组合验证通过 1731 项 Node 测试（平台跳过 2）、六项聚焦浏览器测试及安装包 smoke。下文保留当时阻断调查，以说明范围扩展。

Restart targeted the existing Codex root and this checkout's project. The first fresh index failed with `PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED` / `ENOSPC`: the volume backing the user temp directory had only about 1.2 GiB available for approximately 3 GiB of matching transcript history. A process-local `TEMP`/`TMP` override to ignored `output/codex-0162-runtime/` moved disposable query storage to the spacious workspace volume without changing global environment or source logs. / 重启沿用既有 Codex 根与本 checkout 项目。首次重新索引因所列空间错误失败：用户临时目录所在卷仅余约 1.2 GiB，而匹配历史约 3 GiB。仅对服务进程覆盖 TEMP／TMP 至忽略目录，将可丢弃查询存储放到空间充足的工作区卷，未改全局环境或来源日志。

The retry then failed with `PROJECT_QUERY_STORE_CONTRACT_VIOLATION` on duplicate Session IDs. Three observed 0.162.1 artifacts have the same `session_meta.id` / `session_id` while suffixed artifacts carry a `history_base` chain. The official [recorder](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/rollout/src/recorder.rs) identifies `<conversation_id>_<rollout_id>` filenames as `thread/revert`: thread identity remains stable while a new immutable rollout is created. Minimal synthetic reproduction fails identically against the current tree and fully baseline HEAD source dependencies. This is the existing [debt #31](../tech-debt-tracker.md), not a regression in the first-round field adaptation. No artifact was deleted, renamed, arbitrarily merged or silently excluded. At that point, real-project reading remained unverified and the separate physical-rollout/logical-session adaptation awaited user direction; the authorized follow-up above subsequently resolved both. / 重试随后因重复会话 ID 触发所列契约错误。观测到三份 0.162.1 工件具有相同逻辑身份，带后缀工件具有 history_base 链。官方 recorder 明确这种文件名来自 thread/revert：线程身份保持不变，新建不可变 rollout。最小合成复现在当前与完整基线 HEAD 来源依赖上结果相同，属于既有债务 31，并非首轮字段适配回归。未删除、重命名、任意合并或静默排除任何工件。当时真实项目阅读尚未验证，独立的物理 rollout／逻辑会话适配范围等待用户决定；上文所述获授权后续已解决这两项问题。
