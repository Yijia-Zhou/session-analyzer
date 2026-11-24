# Independent review / 独立复核

2026-11-24。复核对象为 [审计矩阵](../../design-docs/codex-0163-0172-audit.md)、[适配计划](../../exec-plans/active/2026-11-24-codex-0172-followups.md)、同目录专项记录和配套探针。独立从固定源码检查了持久化入口，用临时合成输入和本地模拟模型服务复跑 reader、writer。**两项影响后续实现的结论是普通用户输入必须与定时输入区分，音频镜像必须分别验证提交和落盘表示。** / Independent review reproduced the core reader failures and the local fork writer controls. Scheduled input shares the ordinary user provenance and typed mirror. File-audio evidence depends on which representation the writer actually persisted.

## 实跑结果 / Executed checks

| 检查 | 独立观测 |
| --- | --- |
| 版本和范围 | Analyzer HEAD 及本地 remote-tracking ref 为 `1b410ad88e83de49e6bfa899b2c6135bea8661d1`。本地解引用的 0.162.1 和 0.172.0 为 `092d3acd6b` 和 `3d86e43b07`，0.171.0 为 `ccf9be8cc4`。merge-base `ac9b5b8380`，两侧独有 4/1,951 个提交；关闭重命名检测的两端路径数 5,546。复核使用 Node 24.18.1。 |
| 合成 reader | 运行 `node scripts/audit-codex-0172-messages.js` 及 `node scripts/audit-codex-0172-operations.js`。完整、compact、冷物化、复用文件四种路径均重现带代次 cell 的等待与原执行拆分、typed MCP 失败与 Main 完成不一致。普通数字 cell 有两个阶段。XML 消息、speech frame、文件型出图 completion 的 Main 检索均未命中；实际 CLI 与对应专项记录一致。运行 `audit-codex-0172-cell-witness.js` 时给定一个全新合成 home，单个合格 wait 被拆分，四个物理归属检查通过。 |
| 祖先恢复 | `node scripts/audit-codex-0172-ancestor.js` 在两种 index builder 都显示仅归档存在时可读子会话，加入被截短但能正常解压的 active 副本后子会话被排除，并增加 `CODEX_HISTORY_BOUNDARY_INVALID`。这是无 SQLite current pointer 的反例；带 pointer、可用副本相互冲突与真实损坏频率仍需独立证据。 |
| 真实 0.172.0 writer，模拟模型 | 首轮运行 fork 范围的早期 `audit-codex-0172-writer.py` 并核验 native binary 版本，生成 6 个逻辑线程、7 个物理工件。普通 Legacy/Paginated、generic attached、带 TUI 来源且导入两个 bootstrap 项的 fork 均可读取。目标旁聊在首轮 3 种读法均为 3 个 Main 事件、2 个用户事件，边界命中 1 次。普通 fork revert 内容 Main 命中 0；Legacy attached 被 RPC `-32600` 拒绝。扩展后的 8 线程、4 路径结果见下方修订复查。 |
| 语料聚合工具 | 运行 `node scripts/audit-codex-0172-corpus.check.js` 通过。未读取私人日志。对已生成 JSON 核对边际计数与分母。主扫描、针对性补扫文件 SHA-256 分别为 `845993dc328e266b5ded6b58b80b9e66c3def015bb385d975c38370ca2254986`、`3428a7bb5cd00b10e1b7ccada948e6852fe5359980ac0eab92ff62ba5b614521`。 |

复核时另执行 5 个现有测试文件，61 项全过：`codex-0155-0160-messages`、`codex-async-message`、`codex-external-input`、`codex-0155-0160-code-mode`、`codex-configuration`（均为 `test/*.test.js`）。在消息探针加入 heartbeat 和三种外部音频对照后，重新执行了 33 行的消息探针及操作探针。

### 主动提交与定时输入 / Ordinary and scheduled input

使用与 fork 探针相同的隔离配置和回环 Responses 服务，在两个全新的 Paginated thread 分别调用 `turn/start`。正文同为 `<example>FIXTURE_ATTRIBUTION</example>`，只改变 `turnTrigger`。

| 触发来源 | 落盘的单一 content kind | part provenance | typed UserMessage | 基线用户计数 | Main / Protocol / Raw 检索 |
| --- | --- | --- | ---: | ---: | --- |
| `composer` | `user.text` | `user` | 1 | 0 | 0 / 1 / 2 |
| `automation_heartbeat_scheduled` | `user.heartbeat` | `user` | 1 | 0 | 0 / 1 / 2 |

两个 turn 均完成。typed 镜像与来源数组仍不足以区分这两个输入。普通输入的正文应可在 Main 找回；判断普通输入前需要核对 host 标记的 `user.heartbeat`，并保留冲突、未知或不全来源的保守路径。正文内容在这项实验中完全相同。源码先给所有 part 赋用户来源，再为定时输入设置不同的 kind，并发相同类型的 completion。 / The native writer persisted one typed user mirror for each trigger. Checking the aligned input kind distinguishes the scheduled control. [普通来源写入](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/src/session/mod.rs#L4029) · [定时输入及 typed 镜像](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/src/session/mod.rs#L6127)

### 外部输入音频的证据边界 / External tool-input audio

compact reader 合成对照为一条具名、无 call ID 的 `response_item.function_call_output` 及一条同 item ID 的 `item_completed.FunctionCallOutput`，两条均有同一可检索文本和一个 `input_audio` part。保持文本不变，只改变音频表示，结果如下。

| response / typed 表示 | Main 归属 | 正文 Main / Protocol / Raw 命中 |
| --- | --- | --- |
| inline / inline | 一个 `external_tool_input`，含两条 Raw 引用 | 1 / 0 / 2 |
| file / inline | 一个 `external_tool_input`，只引用 typed 行；response 留在 Protocol | 1 / 1 / 2 |
| file / file（导入假设） | 两条均在 Protocol | 0 / 2 / 2 |

对隔离 writer 实际提交同类 `turn/start.toolOutput`，inline 请求完成；直接提交 `file_id` 的请求返回 RPC `-32600`。源码在提交入口拒绝该引用。启用默认关闭的 `FileBackedToolAudio` 且有可用存储时，保存 *inline 输入* 的 clone 才可能将音频替换为文件引用；typed 项仍从最初的输入构造。真实上传成功时的外部输入镜像尚待采集。两个 file 表示的合成结果不应被用来估算真实用户丢失文本的频率。后续可加入源端转换、无效编码、同/异 file ID 的覆盖并检验 Raw 引用；也应保留对实际冲突的保护。 / Direct submission of an external file reference was rejected. The mixed representation is the source-supported follow-up case. Verify it with an enabled attachment store before broadening mirror correlation. [提交检查](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/src/session/turn_input.rs#L301) · [写盘转换](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/src/session/file_audio.rs#L51) · [typed 镜像](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/src/hook_runtime.rs#L783)

## 静态审查与未验项目 / Static review and limits

- 两种 history mode 对 `McpToolCallEnd` 和 typed completion 的选择不同，`ElicitationAbandoned`、`NetworkApprovalResolved` 与 `PrivateSessionEvent` 均属 transient。0.172 的专用帧与通过普通 response metadata 派生的输入回执需要分别判断。已核对候选策略、Realtime 类型与 history projections。上游测试仅作源码依据。 [持久化策略](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/rollout/src/policy.rs#L130) · [回执投影](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/history/src/lib.rs#L281)
- 配置审查发现 `2889d8e1bf` 的运行时 turn context 要求 permission profile，writer 仍输出旧 `sandbox_policy` 及条件性的 `file_system_sandbox_policy`。Analyzer 2B 取约定的 model/effort。审计已补充双写说明；没有证据需要在本轮更改配置 UI。 [磁盘兼容序列化](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/history/src/rollout_payload.rs#L83)
- 语料脚本对字段、枚举与维度使用白名单；输出中未发现任意文本、ID、真实路径或原始对话。截断数组的来源组合只覆盖已检的前 128 项。同文件相等、相邻、首条版本、补扫命中数均不能替代逐 turn 的归属或发生率。针对性 cell witness 会临时复制一份候选工件供 materializer 精确回查，最后移除并只打印计数；本次独立运行只给它合成工件。两次聚合使用不同的活动文件前缀。
- 真实 TUI bootstrap、scope-tagged MCP 失败、成功的外部音频上传、0.171 本地独立回执、强制 host reconnect、生产计费、浏览器 DOM、完整 CI 和全量上游测试未在本次复核执行。主审记录中的其他回归结果由各专项负责，独立复核不将它们重复计入实跑。 / Feature frequency, broad cross-platform behavior and end-to-end UI coverage remain unmeasured.

## 修订复查 / Review of revisions

修订后的矩阵已采用已验证的 composer/heartbeat 区别，分开直接 file ID 被拒、可选存储转换后的混合镜像与纯导入反例，并将权限 profile 双写、临时事件过滤纳入覆盖。旁聊计数现明确为一条普通提交加一条被误认的引导边界。对代次 cell 的实际影响，专项见证只给出一个真实文件中的三次拆分；本复核独立运行的是合成见证。任务级 Token 核算仍单列。 / The revised decisions reflect the writer admission checks, reader counterexamples and measured denominators.

- 独立再跑最终 writer，与首轮相比增加 Legacy 及 Paginated 音频对照，生成 8 个逻辑线程、9 个物理文件。两种模式均拒绝直接 file ID，合法 inline WAV turn 均完成，caption 检索 Main / Protocol / Raw 为 1 / 0 / 2。未压缩 resident、compact resident、冷 source-backed 和传入 previous index 的 reindex 全部比对一致；本数据的 `reusedSessions` 为 false。
- 独立在 0.171.0 提交的所有 Rust 文件检索 `TurnInputAccepted`、`SessionEndInputSaved` 及两个 snake_case 拼写。15 行命中包括协议声明、App Server 转换和通知分支、指标标签与 SQL 排除条件，未发现构造这两个 core 回执的本地 writer。这个范围保留了外部和导入来源的不确定性。
- 矩阵新增了两段既有读取能力，所引的设计记录与已完成计划支持历史前缀、Turn 归属、物化、配置与缓存、Code Mode 分组以及 History 检索的基线描述。历史 coverage 段落已限定其版本。在 `e269f2164c` 的直接输出路径，参数完整才标记 `tool_calls_complete`；候选所含 `35a9b70444` 允许截断参数而保留完整调用清单。中英文均区分两种口径。
- 对最终矩阵、计划和五份研究 Markdown 逐个解析相对链接，51 处本地引用均可定位，含新增的 8 处。13 个候选版本源码链接的路径与所引行号可在本地快照定位。原先 4 个探针链接的目录层级均已修复。`git diff --check` 通过。
- 本次复查以 Analyzer `1b410ad88e` 为基线。最终矩阵、计划及 coverage 文档对应 SHA-256 前 16 位依次为 `07299c699d658f34`、`7845a8c3afb76809`、`7e66bc9647e3dcde`。复跑的消息、writer、relation worker 文件依次为 `c2aaf25018a722ab`、`da66b756ac0cd640`、`92f4795a61fb2e51`。以上是本地未提交研究改动的检查记录。
