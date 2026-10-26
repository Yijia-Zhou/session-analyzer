# OpenCode v2 接入 Session Analyzer：源码与实测研究

研究日期：2026-10-27（Asia/Shanghai）。本文是适配可行性研究与独立只读 PoC，**不是已完成的第五个 source adapter**，不包含产品接线、PR 或发布；只在研究分支归档文档。

## 结论

**可行，而且不用把 SQLite 伪装成 JSONL。推荐本地只读 SQLite 作为主要入口，统一 OpenCode v2 消息映射；官方 export 用于第一条导入验证路径，HTTP/SDK 作为已有 server/远程场景的第二读取后端，SSE 作为可选实时补充。**

SQLite 并非最难的部分。真正需要设计的是：可变消息行的快照一致性、索引与详情之间的版本绑定、回退删除、fork 的复制前缀，以及没有保存下来的历史状态。Session Analyzer 已有只读 SQLite 使用经验，Raw 与 Logical 的主要接口也已和 JSONL 解耦；需要补齐的是数据库来源的 materialization dependency。

成熟 UI 更偏向 API，是因为它们本身就是运行中 OpenCode server 的客户端；Analyzer 的离线、只读、本地历史分析定位，使 SQLite 更适合默认入口。这两种结论并不矛盾。

## 1. 固定研究基线：避免选错“v2”

| 对象 | 本次核查值 |
| --- | --- |
| Session Analyzer 开发基线 | `v0.3.0-development`，`d8b787f54b4d0613732578cae1ead5bd858a35ea` |
| 本地研究分支 | `research/opencode-v2`，独立 worktree；原 checkout 保持原状 |
| 真正 OpenCode v2 最新稳定包 | **`@opencode/cli@2.1.4`**，npm 发布于 2026-10-23；实跑 `opencode v2.1.4` |
| 稳定源码 | tag `v2.1.4`，`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824` |
| 最新默认开发源码 | `dev`，`ab4d1f3ab1a05278b4d0392124b9e7f1c8131f17` |
| 旧渠道 | `opencode-ai@latest` 仍为 1.19.4，不是此次 v2 安装目标 |
| 另一陷阱 | 名为 `2.0` 的旧开发分支并非当前 v2；旧 `@opencode-ai/sdk/v2` 的路径名也不代表支持 OpenCode major 2 |
| 工具链 | Node 24.19.0、npm 12.0.2；平台 Linux x64 |

来源：[v2 CLI 包](https://www.npmjs.com/package/@opencode/cli/v/2.1.4)、[稳定源码](https://github.com/anomalyco/opencode/tree/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824)、[开发源码](https://github.com/anomalyco/opencode/tree/ab4d1f3ab1a05278b4d0392124b9e7f1c8131f17)、[Analyzer 基线](https://github.com/Yijia-Zhou/session-analyzer/tree/d8b787f54b4d0613732578cae1ead5bd858a35ea)。

实际模型 case 只运行稳定版 2.1.4。dev 是静态源码核查，未宣称在 dev 上复现。特别是 dev 已新增媒体 `blob/blob_ref` 存储、移除 `session_pending` 等，而 package version 仍写 2.1.4，所以必须同时记录 binary version、源码 SHA 和 schema 指纹。

## 2. 真实 case 与证据

在独立 XDG 数据/配置/缓存目录、独立 Python 示例项目中运行。凭据仅用于 OpenRouter；没有把 Analyzer 源码或用户项目发送给模型。交付 fixture 已去除工作区绝对路径、OpenRouter 用户标识和凭据信息；未交付原始数据库或 auth/credential 数据。

先向 OpenRouter 查询模型目录，选择价格为 0 且支持 tools 的 `:free` 模型。`cohere/north-mini-code:free` 成功完成主要实验；OpenRouter 小请求 probe 的 `usage.cost` 为 0，OpenCode 的全部最终会话记录 cost 也为 0。这里是实际响应/记录值，不是独立账单核对。

| Case | 实际操作 | 观察结果 |
| --- | --- | --- |
| 01：限流与中断 | `google/gemma-4-31b-it:free` 简单文本请求；保存 retry，再主动 interrupt | 真实上游 429，assistant 原位 retry 更新，最终 interrupted；不能把 CLI 有 step_start 就当成功 |
| 02：工具闭环 | 免费模型读取文件，运行失败的 unittest，修复减法为加法，重跑 | 3 read、2 shell、1 edit；shell exit 1→0；两个测试最后均通过；压缩前 8 条 message |
| 03：fork + revert | 官方 API fork case02；在隔离 fork 上 stage/commit 最后一条消息的回退，`files:false` | fork 为独立根会话，带 fork 来源，无 parentID；消息 8→7，确有删除。此实验删的是最后的 idle，未把它夸大为复杂多步回退覆盖 |
| 04：显式父子会话 | 官方 API 创建 parentID 子会话，再运行真实 read 工具请求 | 有 parentID、agent-switched 与已完成响应；与 fork 关系分开 |
| 05：进行中状态 | 免费模型执行有 5 秒等待的 shell；同时采 API、export、SSE 和 SQLite | 44 条 SSE frame；running 时 API 2 条消息、export 仅 1 条 user；完成后 4 条消息；同 message ID 多次 UPDATE |
| 06：真正子代理委派 | 主模型调用 subagent 工具，子代理读两个文件，主模型汇总 | 创建真实子会话；工具 metadata.sessionID 与子会话 parentID 一致；主、子均完成 |
| 07：压缩 | 在 case02 调用官方 compact，模型生成摘要 | compaction.status=completed；消息 8→10，原 8 条消息保留；追加 compaction 和 idle |

最终语料为 **7 个 session、37 条消息**。7 个会话均逐页拉取 API，再与同一稳定时段 SQLite `session_message` 按 seq 还原的对象逐项比较，**全部相等**。其中 17 个记录中的 tool 对象包含 fork 复制来的 6 个，不能把 17 当作本次实际执行工具次数。

分页实测使用 limit=2：例如 case02 最终为 `[2,2,2,2,2,0]`。非空页始终可能携带 next cursor，必须读到空页；cursor 存在不能直接当作严格的 has-more。验证脚本在无活动执行的稳定窗口比对；这不是证明任意活跃写入期间多页 HTTP 读取具有原子快照。

### 最有决定性的缓存证据

只读 Node PoC 对活动数据库连续采样 20 次，捕获同一 message 原位变化：

| 事件水位变化 | 新增/删除 message | session.time_updated 是否变化 |
| --- | --- | --- |
| 6→7 | 均为 0 | 否 |
| 7→11 | 均为 0 | 否 |
| 11→13 | 均为 0 | 是 |

所有采样 `event` 表均为 **0 行**，`query_only=true`，本连接 `total_changes()=0`。因此：

- `session.time_updated` 不是完整失效依据。
- 旧消息 `seq` 不变，按“上次最大 seq 后追加读取”会漏掉正文/工具状态更新。
- `event_sequence` 有进展不等于 `event` 保存了可重放 payload。
- 本连接零写入不意味着其他 writer 没改变文件；活库正常继续工作。

样本的读事务与摘要耗时约 1.44–3.86ms，仅是小语料的描述性结果，不能推算大库性能。证据见交付包 `evidence/case-summary.json`、`evidence/sqlite-probe-observations.json`、`evidence/validation.json` 和 `fixtures/`。

## 3. v2 数据模型：读取的是当前投影

主要表为 `session_v2`、`session_message`，不是旧版 `session/message/part` 三表模式。[稳定 schema](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/core/src/session/sql.ts#L25)

| 来源对象 | 建议映射及注意事项 |
| --- | --- |
| session_v2 | project/directory/workspace、title、model/agent、tokens/cost、parent、fork、revert、运行状态时间 |
| session_message | `id/type/seq` 是单独列，正文 `data` 不包含完整 message；还原为 `{...data,id,type}`，按 seq 排序 |
| user | text、files、agents、skills，保留附件与上下文，不等同于纯文本 |
| assistant.content[] | 有序 text/reasoning/tool；一个 assistant 通常是一次 step，不能当成完整用户 turn |
| tool | id/name/state；streaming/running/completed/error；输入输出合在一个对象，规范化为稳定操作，避免调用与结果重复计数 |
| completed tool | 保留结构化 content、metadata、时间、exit；**本次 exit=1 的 shell 仍为 completed**，工具传输成功与进程退出码是不同维度 |
| 顶层 shell | 用户直接执行的 shell 消息，含 command/status/exit/output 等；与 assistant.content 内模型调用的 shell tool 分开，初版保留独立类型；本次未专项实测此入口 |
| idle | execution 成功/失败/中断的终点证据；部分 shutdown 中断不落 idle，缺失不自动等于失败 |
| system/synthetic/skill | 独立语义；不能伪装成 user 提示 |
| agent/model/location-switched | 配置与位置变更证据 |
| compaction | 状态与摘要；旧 transcript 在本次版本保留，不应用 context 截断规则删除历史 |
| session_inbox | 已排队未送达输入，不冒充已经执行的 user message |

消息 schema 与兼容转换：[session-message](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/schema/src/session-message.ts#L75)、[SessionLegacy](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/schema/src/session-legacy.ts#L3)。旧 v2 数据需要兼容转换策略，不能只凭列名相同就认定 JSON shape 一致。

### fork、subagent、回退与计费

- fork：`parent_id=null`，另有 `fork_session_id/fork_boundary`；复制已完成历史、换 message ID，累计会话 cost/tokens 清零。前缀中的旧 message usage 仍可能存在，聚合时不能再次算作新执行成本。
- subagent：通过 `parent_id` 及工具 metadata 的 sessionID 关联；异步回执另有 synthetic 元数据，不能仅靠标题猜关系。
- revert.stage：保存可撤销边界；revert.commit：删除 `seq>=boundary` 的 message。默认数据库无法还原已删尾部，需要 Analyzer 自己保留快照才可能保留此前已观察证据。
- compaction：追加后更新 compaction 行；当前 transcript 和模型 context 是不同视图，分析历史使用 messages，不用 context API。

源码：[fork projector](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/core/src/session/projector.ts#L109)、[revert projector](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/core/src/session/projector.ts#L781)、[subagent](https://github.com/anomalyco/opencode/blob/ab4d1f3ab1a05278b4d0392124b9e7f1c8131f17/packages/core/src/tool/plugin/subagent.ts#L184)。异步子代理、复杂 revert、自动 compaction、媒体附件与崩溃恢复只有源码依据或待验证，未纳入本次真实模型覆盖声明。

## 4. 五条接入路径比较

| 方案 | 优点 | 代价/边界 | 建议 |
| --- | --- | --- | --- |
| 原生 SQLite 只读 adapter | 离线、自动发现历史、不要求 server；保留投影和数据库关系 | schema/legacy 兼容、WAL、原地更新/删除、一致性快照 | **主要方案** |
| HTTP / `@opencode/client` | 官方解码；兼容转换、媒体 hydrate 由上游负责；支持远程 | 需要已有认证 server；分页不是固定快照；版本协议仍要 pin | 第二读取后端 |
| 官方 export JSON | `{info,messages}` 易导入、可复现、很适合验证 mapper | 过滤未完成 assistant/shell/compaction；手工导出不能自动索引全库；experimental 路由 | 第一个垂直切片与手工入口 |
| durable event log | 已启用 persist 时提供事件和 seq，可 replay | 默认 CLI 不持久化 payload；序号 gap 可合法；delta/progress 仍是 ephemeral | 仅明确支持的实例增强 |
| 插件/sidecar 自记 JSONL | 可记录从安装后发生的细粒度事件 | 无历史回填、writer/插件耦合、丢包恢复与去重复杂，隐私/磁盘开销 | 暂不作为默认方案 |

`opencode run --format json` 本次也生成了 JSONL，但它是 CLI 的兼容展示流（仍可见 step_start、part 包装），不是标准的持久化 transcript 文件：不能回填已有历史、不能替代原始 v2 对象，也不能解决断线/删除/修订问题。

### API/SSE 的具体约束

- `GET /api/session`，`GET /api/session/:id/message`；message 默认 50、上限 200，cursor 和 order 不能同时传。全量索引须遍历全部页、检测重复 cursor、去重；删除了 anchor 或并发修改时需要重读/标明非完整。
- `GET /api/event` 是实时 volatile SSE。重连本身不补历史；普通 SSE 不提供 Last-Event-ID 的持久 replay。消费慢还可能 queue overflow。以 HTTP 补拉纠正，不能仅靠 reducer 永久累积。
- `/api/experimental/session/:id/log?after=N&follow=true` 是另一条 durable log API。只有确证实例启用持久化才讨论历史 replay；不能因存在此路由就假设默认可用。
- text/reasoning/tool-input delta、tool progress 等是 ephemeral。SQLite 只反映 durable 边界，最终文本从 ended 事件写入。即便启用 event persist，也不能保证逐 token 重放。
- 默认 `Bus.configured` 的 persist=false；普通 CLI 未传 events.persist。本次 DB 的 event=0 实测与源码一致。
- 官方 export 会过滤运行中的消息；本次 running API=2、export=1 已复现。export 的 API 外层有 `{data:{info,messages}}`，应明确解包层级，不猜旧版格式。

源码：[Bus](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/core/src/bus.ts#L208)、[SSE 契约](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/protocol/src/groups/event.ts#L72)、[message 分页](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/server/src/handlers/message.ts#L30)、[export 过滤](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/core/src/session/transfer.ts#L56)。

## 5. 成熟自定义 UI：可以借鉴什么

这是固定 commit 的源码与 release 调研，**没有安装运行第三方 UI**；stars 仅是研究时点的规模信号，不是兼容性或质量保证。

| 项目 | 核查版本/成熟度 | 适合借鉴 |
| --- | --- | --- |
| OpenChamber | 12,198 stars；v2.5.2；main `0056bf6a9ca4aa229817af5bf37533f602a16cc3`，2026-10-26；多平台安装资产 | API client 与纯 projection 分层；同一消息投影支撑历史与实时；分页、重连补拉、版本门禁 |
| OpenCodeUI | 575 stars；v0.7.24；main `3cc22e8c14c2d22d46457b2a1a4f144748f01230`，2026-10-24；`@opencode/client ^2.0.21` | 更精简的原生 v2 接入；按服务器隔离的全局 session index；分页期间暂存 live mutation，快照完成后重放 |

OpenChamber 明确要求 OpenCode major=2 且至少 2.1.0。其正常 UI 路径是 SDK/API，不是直接读 SQLite；其迁移修复模块涉及写库，不应照搬到只读 Analyzer。参考：[兼容门禁](https://github.com/openchamber/openchamber/blob/0056bf6a9ca4aa229817af5bf37533f602a16cc3/packages/web/server/lib/opencode/compatibility.js#L16)、[client](https://github.com/openchamber/openchamber/blob/0056bf6a9ca4aa229817af5bf37533f602a16cc3/packages/ui/src/lib/opencode/client.ts#L1005)、[projection](https://github.com/openchamber/openchamber/blob/0056bf6a9ca4aa229817af5bf37533f602a16cc3/packages/ui/src/lib/opencode/projection.ts#L1)。

OpenCodeUI 在 SSE 重连成功后触发 HTTP 补偿读取；text.ended/reasoning.ended 用完整文本覆盖 delta。它的侧栏索引使用 parentID:null 只取根会话；Analyzer 应保留子会话，不能照搬该过滤。参考：[events](https://github.com/lehhair/OpenCodeUI/blob/3cc22e8c14c2d22d46457b2a1a4f144748f01230/src/api/events.ts#L590)、[message store](https://github.com/lehhair/OpenCodeUI/blob/3cc22e8c14c2d22d46457b2a1a4f144748f01230/src/store/messageStore.ts#L979)、[session index](https://github.com/lehhair/OpenCodeUI/blob/3cc22e8c14c2d22d46457b2a1a4f144748f01230/src/store/sessionIndexStore.ts#L1)。

两者的具体事件 reducer 在 ordinal/重试细节上不完全相同。借鉴结构和恢复策略，映射语义以固定上游 schema/projector 和真实 fixture 为准。Portal、opencode-vibe 等较早项目已检查，但不足以证明当前 v2 兼容，不作为主依据。

## 6. 对 0.3.0 Analyzer 的最小改动面

以下路径/行号针对固定基线 `d8b787f`；均是静态分析，不是已经修改。

| 模块 | 当前能力/缺口 | 建议 |
| --- | --- | --- |
| `src/codex-current-rollout.js:58` | 已用 node:sqlite 只读、query_only、busy_timeout、BEGIN 读取 Codex 元数据 | 复用安全模式，不加 better-sqlite3 依赖；OpenCode 正文另做 reader |
| `src/source-adapter-contract.js:3`、`src/pi.js:96` | source adapter 与 indexed-materialized-v1 生命周期已存在 | 新增 opencode adapter，复用 discovery/index/materialize/detail/raw/query 边界 |
| `src/canonical-contract.js:758`、`:974` | Raw/rawRefs/sourceLocator 与 Logical 大体来源中立 | typed SQLite locator：DB identity、table allowlist、session/message PK、JSON pointer、snapshotId；不造行号 |
| `src/canonical-contract.js:550` | dependency 只支持 file/directory 及文件策略 | MVP 用真正不可变的选中会话快照文件 + file/exact；长期加 database/row-set snapshot 类型 |
| `src/source-adapters.js:1392` | 物化会验证 snapshot 与 queryProjectionDigest | 固定快照物化，或源变化时报 stale；不把新正文塞进旧索引 |
| `src/project-query-store.js:473`、`src/session-query.js:885` | 紧凑索引、共享查询及结构筛选分页可复用 | 来源分页仅负责读取；不要替代 Analyzer 的语义分页；按会话瞬态映射 |
| `src/index-revision-lease.js:25`、`src/history-service.js:97` | revision lease、旧引用边界已存在 | 安装新 index revision；旧 evidence ref 不指向新对象 |
| `src/canonical-contract.js:31` | indexed metadata 仍有 sourceFile/bytes/lineCount | 明确存储类型和显示含义；message count 不冒充文件行数 |
| `src/source-adapters.js:50`、`src/cli.js:29`、`src/history-cli.js:6` | source 注册和 CLI roots | 加 OpenCode data root / 显式 DB 选择、诊断、标签及打包清单 |
| `src/history-source-locator.js:25` | history.read.source 故意仅支持 Codex JSONL | 初期保持不支持；正常 evidence refs 可用，不开放自由 SQL/任意路径 |

参考：[已有 SQLite reader](https://github.com/Yijia-Zhou/session-analyzer/blob/d8b787f54b4d0613732578cae1ead5bd858a35ea/src/codex-current-rollout.js#L58)、[snapshot dependency](https://github.com/Yijia-Zhou/session-analyzer/blob/d8b787f54b4d0613732578cae1ead5bd858a35ea/src/canonical-contract.js#L550)、[source adapters](https://github.com/Yijia-Zhou/session-analyzer/blob/d8b787f54b4d0613732578cae1ead5bd858a35ea/src/source-adapters.js#L1392)。

建议分层：

```text
SQLite / export / HTTP
        ↓ 独立读取与版本边界
OpenCodeSnapshot（meta、messages、relations、revision、coverage）
        ↓ 同一个纯 mapper
IndexedSession / Logical / Raw references
        ↓ 现有共享索引、查询、详情、materialization
Session Analyzer
```

示意 locator（拟议接口，不是既有兼容承诺）：

```json
{"type":"sqlite_row","sourceKind":"opencode","databaseId":"opaque-db-id","table":"session_message","sessionID":"ses_…","messageID":"msg_…","pointer":"/content/0","snapshotId":"sha256:…"}
```

只把数据库 path 放进现有 file dependency 并使用 accepted_prefix 是错误方案：WAL、原位更新和删除都不遵守前缀不变。把整个 transcript 偷塞 copied_value 也违背有界元数据与按需物化目标。

## 7. 推荐实现顺序与验收边界

1. **统一 mapper + export 导入。** 用本次脱敏 fixture 验证 user、assistant content、reasoning、tool、idle、retry、switch、fork、subagent、compaction 的映射；保留未知类型于 Protocol/Raw。证明 Main/Detail/Raw/搜索完整链路。
2. **原生 SQLite 发现、索引、物化。** XDG root、channel DB 与 OPENCODE_DB 显式选择；schema fingerprint/兼容门禁；短只读事务得到一套 session/rows/relations/revision。第一版可保存按会话不可变快照，复用 file/exact，同时设置磁盘配额、淘汰与敏感数据管理。
3. **更新与删除一致性。** event_sequence 是候选按会话失效水位，配合 session metadata、行集合/正文 digest；seq 不是行变更游标，PRAGMA data_version 只作同一连接变化提示。考虑 import、metadata 更新、恢复/替换 DB、schema 改变、归档/删除和跨会话关系依赖。产品版需要明确快照依赖闭包，不能把本次简易 hash 直接当完整契约。
4. **按需求增加 API 后端。** 固定 API/SDK 版本，server 身份隔离、认证、全量分页与重连补拉；不为只读目的自动启动 OpenCode 去迁移用户数据库。SSE 增强只在已有稳定快照基础上做。

关键验收：同 ID 更新、回退删除、并发 WAL、旧 ref stale、未知 schema、fork 前缀重复计费、subagent 完整发现、长文本/深 JSON/大工具输出、取消与资源预算。以后再覆盖跨平台、附件/dev blob、权限拒绝、工具 error 状态、崩溃恢复、断线/慢消费者、真实大库和长会话。Linux 小样本成功不代表这些边界已完成。

数据库读取规则：readOnly + allowExtension:false + query_only + 短 busy timeout；固定表/列、参数绑定；不加载上游 Database service、不 migration/checkpoint/设 journal_mode；活动库不用 immutable=true、不单独 cp .db 丢失 WAL；不为一次浏览长期钉住读事务。

## 8. 本次交付与验证范围

- 研究报告及固定 commit 的来源链接。
- `sqlite-probe.mjs`：独立 Node 只读诊断 PoC；只输出计数、类型、ID、hash/revision，不输出正文或工具输入输出。不注册到 Analyzer。
- `fixtures/`：本次真实模型/官方 API 操作形成的脱敏投影，保留与来源版本相关的 shape；不是手工捏造成功结果。
- `evidence/`：会话摘要、实时采样、SSE 类型计数、分页与 API/SQL 比对、只读检查。

PoC 对最多 1000 会话、每会话 10000 message 设置数量上限；它仍不是生产流式 reader，不保证大型单字段/全库内存安全，也未包含 legacy decoder。只用于本次小语料研究，不建议直接对任意庞大用户库扫描。

已执行 CLI 安装/版本验证、真实免费模型工具链、7 个会话 API/SQL 对照、运行中 export 差异验证、SSE 捕获和只读动态观测；完成示例项目 unittest 与 PoC 语法/只读检查。未修改 Analyzer 产品行为，因此未运行其全量 Node/browser/release 测试；没有声称第五 adapter 或浏览器接入验收通过。
