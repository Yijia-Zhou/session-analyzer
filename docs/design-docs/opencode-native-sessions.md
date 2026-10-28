# Native OpenCode sessions / 原生 OpenCode 会话

## Scope and authority / 范围与依据

This source-checkout adapter targets the native SQLite projection of OpenCode **2.1.4**, pinned to commit **68bc26b7da1990ce10ffecfbc1e09eb13aa5d824**. It does not treat every package named OpenCode, every major-2 database, or the development branch as the same format. The published Analyzer 0.2.1 package does not include this adapter. / 本源码 checkout 适配器面向 OpenCode **2.1.4** 的原生 SQLite 投影，固定源码为 **68bc26b7da1990ce10ffecfbc1e09eb13aa5d824**。不把所有名为 OpenCode 的包、所有 major-2 数据库或开发分支视为同一格式。已发布的 Analyzer 0.2.1 包不含本适配器。

The [research report](opencode-v2-adaptation-research.md) records upstream source, isolated real cases and evidence limitations. The [implementation plan](../exec-plans/active/2026-10-28-opencode-v2-adaptation.md) owns execution and verification status. Reader tests use minimized synthetic data with fixed upstream shapes; ordinary tests and product reads do not install or start OpenCode, call a model, or require an API key. / [研究报告](opencode-v2-adaptation-research.md)记录上游源码、隔离真实案例及证据边界；[实施计划](../exec-plans/active/2026-10-28-opencode-v2-adaptation.md)记录执行与验证状态。阅读器测试使用固定上游形态的最小合成数据；普通测试和产品读取不安装或启动 OpenCode、不调用模型、不要求 API key。

## Source selection / 来源选择

After source setup and build, run / 完成源码配置和构建后运行：

    node server.js --source opencode --repo /path/to/project --opencode-home /path/to/opencode.db

The source option also accepts the OpenCode data directory containing the database. An explicit root selects that source only; other harness homes are not scanned. Project association follows recorded database metadata, not the Analyzer installation directory. Choose OpenCode in the project chooser to configure the root and select a recorded project. / 来源参数也接受包含数据库的 OpenCode 数据目录。显式根只选择该来源，不扫描其他 harness 根。项目关联使用数据库中记录的 metadata，不使用 Analyzer 安装目录。可在项目选择器中选择 OpenCode、配置来源根，再选择记录中的项目。

The default data directory is `opencode` under `XDG_DATA_HOME`, falling back to `~/.local/share/opencode`. A directory selects `opencode.db`; `OPENCODE_DB` may select an absolute database path or one relative to that data directory. In-memory databases are unsupported. Other channel databases must be selected explicitly and are not merged automatically. / 默认数据目录为 `XDG_DATA_HOME` 下的 `opencode`，回退到 `~/.local/share/opencode`。目录选取其中的 `opencode.db`；`OPENCODE_DB` 可指定绝对数据库路径或相对该数据目录的路径。不支持内存数据库。其他 channel 的数据库须显式选择，不自动合并。

The runtime must provide the required built-in node:sqlite capabilities. A missing runtime capability or unsupported database profile produces a source-specific diagnostic rather than a successful empty index; other sources remain available. / 运行时须提供所需的内置 node:sqlite 能力。运行时能力缺失或数据库 profile 不支持时，给出来源专属诊断，不能以成功的空索引代替；其他来源仍可使用。

## Native evidence and mapping / 原生依据与映射

The reader uses session_v2 and session_message. Message id/type/seq are relational columns; data holds the native JSON body. seq determines ordering, not a mutation cursor. JSONL line numbers are not fabricated: Raw evidence uses database identity, table, primary key, pointer and snapshot identity. / 阅读器使用 session_v2 与 session_message。消息 id/type/seq 是关系列，data 保存原生 JSON 正文。seq 确定顺序，不作为变更游标。不伪造 JSONL 行号：Raw 依据使用数据库身份、表、主键、指针和快照身份。

| Native evidence / 原生依据 | Reading semantics / 阅读语义 |
| --- | --- |
| User and assistant text / 用户与助手文本 | Main message content; an assistant step is not automatically a complete user turn / Main 消息内容，assistant step 不自动等于完整 user turn |
| Assistant reasoning / 助手 reasoning | Persisted readable text only / 仅展示已持久化的可读文本 |
| Assistant content tool / 助手 content 中的工具 | Ordered request, state and recorded result; completed transport and nonzero process exit remain distinct / 有序请求、状态及已记录结果；传输完成与进程非零退出保持区别 |
| Top-level shell / 顶层 shell | Recorded direct shell activity, distinct from an assistant tool / 已记录的直接 shell 活动，与助手工具分开 |
| Idle, retry, interruption / idle、重试、中断 | Recorded lifecycle evidence; missing idle does not prove failure / 已记录生命周期依据；缺失 idle 不证明失败 |
| Compaction and switch records / 压缩与切换记录 | Recorded history transitions; compaction does not erase earlier captured transcript / 已记录历史变更；压缩不删除此前捕获的转录 |
| Parent/subagent and fork / 父子代理与 fork | Separate recorded relations; native session cost/token totals avoid summing copied prefix usage again / 区分记录关系；使用原生会话 cost／token 总数，避免重复累加复制前缀的用量 |
| Unknown message shapes / 未知消息形态 | Conservative Protocol/Raw evidence rather than invented semantics / 保守保留 Protocol／Raw 依据，不补造语义 |

Attachment references remain evidence rather than arbitrary file reads. This increment does not promise upstream media hydration, hidden reasoning, full model-context replay, restoration of unobserved deleted rows, or reconstruction of ephemeral streaming deltas. / 附件引用仅作为依据，不据此任意读取文件。本轮不承诺上游媒体 hydrate、隐藏推理、完整模型上下文重放、恢复未观察到的已删除行或重建临时流式 delta。

Native attachment base64 is omitted from Main and search while the captured SQL row remains available through Raw. Compaction completion follows its recorded state even when a provider leaves the summary empty. / 原生附件的 base64 不进入 Main 或搜索，捕获的 SQL 行仍可通过 Raw 读取。Compaction 是否完成依据记录状态，即使 provider 留下空摘要也不改判为进行中。

Message, turn and tool/command counts describe each captured session's visible history, including any copied fork prefix. They are not deduplicated counts of newly executed work across a fork family. A recorded fork boundary does not prove that a mutable parent still contains the original copied rows. / 消息、轮次和工具／命令计数描述各捕获会话可见的历史，包含已复制的 fork 前缀；它们不是跨 fork 家族去重后的新执行工作量。记录的 fork boundary 不能证明可变父会话仍保存最初复制的行。

## Project capture and revision binding / 项目捕获与 revision 绑定

A bounded SQLite read transaction captures project membership, relationship facts, metadata and ordered message rows into private staging files. Mapping and query-store construction happen after that transaction closes. All captured files and their digests are sealed before the replacement Index is installed. / 有界 SQLite 读事务将项目成员、关系事实、metadata 和有序消息行捕获到私有 staging 文件。映射与 query store 构建在事务关闭后执行；捕获文件及其摘要封存后，才安装替换 Index。

Each admitted Session has immutable source data while complete Logical/Raw objects remain materialized on demand. A snapshot ID binds one immutable input and interpretation-version set. Source mutation, deletion or compaction after capture cannot change the content served by that revision. Refresh captures a replacement; old evidence references never silently resolve to new content. / 每个接纳的 Session 都有不可变来源数据，完整 Logical／Raw 对象仍按需物化。snapshot ID 绑定一组不可变输入及解释版本。捕获后的来源修改、删除或压缩不能改变该 revision 提供的内容；刷新捕获替换版本，旧依据引用不得静默指向新内容。

The dependency closure includes the metadata and relations actually used for project membership and interpretation. Session timestamps and event_sequence are insufficient identity checks: project-level events can change membership metadata without advancing those session-level markers. Per-session content identity and the project membership manifest have distinct responsibilities. / 依赖闭包包括项目归属与解释实际使用的 metadata 和关系。会话时间戳与 event_sequence 不足以标识版本：项目级事件可以在不推进会话级标记时修改归属 metadata。会话内容身份和项目成员 manifest 各有独立职责。

Input completeness, sealed-file integrity and reference consistency require independent checks. Matching a file hash alone does not prove that every expected row was captured or that search and Detail reference that file. Missing or modified snapshot files produce explicit stale/integrity failure; the reader does not repair them by reading the live database into the old revision. / 输入完整性、封存文件完整性和引用一致性分别校验。仅文件 hash 相同，不能证明应有行已全部捕获或搜索与 Detail 引用了该文件。快照文件缺失或被改时报明确 stale／完整性失败，不通过读取活动数据库来补旧 revision。

## Read-only and failure behavior / 只读与失败行为

The connection is read-only, query-only, extension-disabled and bounded by a short busy timeout. Analyzer does not import the OpenCode database service, perform migrations/checkpoints, change journal mode, or bypass WAL using immutable mode or a main-file-only copy. SQLite may still create or access a shared-memory side file; logical read-only does not mean zero filesystem writes. / 连接使用只读、query-only、禁用扩展和短 busy timeout。Analyzer 不导入 OpenCode 数据库服务、不执行迁移或 checkpoint、不改变 journal mode，也不通过 immutable 模式或仅复制主库绕过 WAL。SQLite 仍可能创建或访问共享内存侧文件；逻辑只读不代表零文件系统写入。

Directory and DB/WAL/SHM access permissions are separate conditions. WAL absence can be valid; it is not automatically corruption. A missing WAL that already contained lost commits cannot always be identified from the remaining main file. Unsupported permissions, inaccessible or damaged files, locking and unsupported schema need distinguishable diagnostics, never a silent main-file-only fallback. / 目录与 DB／WAL／SHM 各自的访问权限是不同条件。WAL 缺失可以合法，不能自动判为损坏。若 WAL 中已有提交数据丢失，仅凭剩余主文件不一定能识别。权限不支持、文件不可访问或损坏、锁定及 schema 不支持须有可辨别诊断，不能静默回退为仅读取主库。

After establishing its read view, the reader validates the bounded WAL header, checksum-valid prefix and observable commit markers. After a verified commit, an invalid same-cycle suffix is accepted only when every remaining same-cycle frame has a zero commit marker, as legitimate rolled-back spill can leave such frames. Older allocated cycles require distinct salts with a plausibly older salt sequence; current-cycle frames must not reappear afterward. Incomplete frames, ambiguous salts or a commit after a damaged frame fail explicitly and may require a retry after the writer settles. The reader does not parse SQLite's internal SHM layout. / 建立读取视图后，阅读器有界校验 WAL header、checksum 有效前缀及可观察的 commit marker。已验证 commit 之后，同周期无效后缀仅在其后所有同周期 frame 的 commit marker 都为零时可接受，因为合法回滚 spill 可能留下此类 frame。旧分配周期要求 salt 不同且 salt 序号合理较旧，其后不得重新出现当前周期 frame。不完整 frame、歧义 salt 或损坏 frame 后出现 commit 均明确失败，可能需要等 writer 稳定后重试。不解析 SQLite 内部 SHM 二进制布局。

WAL validation is not cryptographic authentication or historical recovery. Coordinated changes to commit markers or salts can be indistinguishable from legitimate uncommitted or older allocated tails; this reader cannot prove that unobserved committed history was never lost. It does not write, checkpoint, repair or truncate the source, and never substitutes a main-file-only fallback. / WAL 校验不是密码学认证或历史恢复。对 commit marker 或 salt 的协同修改可能与合法未提交后缀或旧分配尾部无法区分；阅读器不能证明未观察到的已提交历史从未丢失。不写入、checkpoint、修复或截断来源，也不回退为只读取主数据库文件。

Capture and derived-index budgets apply before publication. A failed, cancelled or over-budget replacement is not partially published; a still-valid old revision remains readable and the refresh failure remains visible. A first build failure does not become an empty successful project. This does not promise unlimited project size or hard real-time interruption of a synchronous SQLite call. / 捕获与派生索引预算在发布前生效。失败、取消或超预算的替换版本不部分发布；仍有效的旧 revision 保持可读，同时显示刷新失败。首次构建失败不伪装为成功的空项目。本能力不承诺无限项目规模，也不承诺硬实时中断同步 SQLite 调用。

The initial internal defaults are deliberate admission limits, not advertised corpus capacity. Capturing another revision cannot evict a live revision to satisfy them. / 首版内部默认值是明确的接纳限制，不作为对外语料容量承诺；捕获新 revision 不得为满足这些限制而淘汰仍有效的 revision。

| Budget / 预算 | Default / 默认值 |
| --- | --- |
| Catalog rows per table / 每表目录行数 | 20,000 |
| Captured project sessions / 捕获的项目会话数 | 2,000 |
| Captured messages / 捕获消息数 | 200,000 |
| One native field / 单个原生字段 | 1 MiB |
| One captured session / 单个会话快照 | 32 MiB |
| One capture including manifest / 一次捕获含 manifest | 128 MiB |
| Live capture bytes per snapshot base in this process / 本进程每个快照根的活动捕获总字节 | 256 MiB |
| Source WAL admitted for validation / 接纳校验的来源 WAL | 256 MiB |
| Derived query-store byte budget / 派生 query store 字节预算 | 256 MiB |
| Native JSON depth / 原生 JSON 深度 | 128 |
| Capture deadline / 捕获时限 | 10 seconds / 秒 |
| Build deadline checked between sessions / 会话之间检查的构建时限 | 60 seconds / 秒 |
| SQLite busy timeout / SQLite 忙等待 | 50 milliseconds / 毫秒 |

Capture admission uses `OPENCODE_CAPTURE_LIMIT`; the build deadline uses `OPENCODE_BUDGET_EXCEEDED`. Permission, lock contention, disk exhaustion, schema, malformed data and missing runtime capabilities have separate `OPENCODE_*` codes. Snapshot loss or modification uses `INDEXED_SOURCE_STALE`; cross-revision history evidence uses `STALE_REFERENCE`. These are diagnostic categories, not recovery instructions to migrate or modify the source. / 捕获接纳超限使用 `OPENCODE_CAPTURE_LIMIT`，构建时限使用 `OPENCODE_BUDGET_EXCEEDED`。权限、锁竞争、磁盘不足、schema、格式错误及运行时能力缺失各有独立 `OPENCODE_*` 错误码。快照丢失或变动使用 `INDEXED_SOURCE_STALE`，跨 revision 的历史依据使用 `STALE_REFERENCE`。这些是诊断类别，不是迁移或修改来源的恢复指令。

## Resource ownership / 资源所有权

Build scope owns unpublished snapshots. On publication, ownership passes to the Index revision; reads hold resource leases. Retirement rejects new readers, cancels outstanding work and waits for actual read completion before removing files. Cancellation signaling alone is not proof of I/O completion. Cleanup is idempotent; failure and retry remain observable. / 构建 scope 拥有未发布快照；发布后转交 Index revision，读取持有资源 lease。退役拒绝新 reader、取消在途工作，并等待实际读取完成后再删除文件。取消信号本身不证明 I/O 已完成。清理幂等，失败及重试保持可观察。

Temporary snapshots are not a permanent archive. Quota pressure must not remove files still owned by a valid revision. Server rebuild, history-service ownership and shared viewer closure must release the same resources without early deletion or double disposal. / 临时快照不是永久归档；配额压力不能删除有效 revision 仍拥有的文件。Server 重建、history-service 所有权和共享 viewer 关闭须正确释放同一资源，避免提前删除或重复释放。

## Validation and deferred work / 验证与后续范围

The [compatibility maintenance matrix and probe](opencode-compatibility-maintenance.md) provides isolated real-producer checks and pinned candidate comparisons under the common schema runbook. It is a maintenance tool outside the runtime/package dependency path. / 兼容维护矩阵与探针按共用 schema 手册提供隔离真实 producer 检查及固定候选比较，属于运行时／安装包依赖路径之外的维护工具。

The implementation plan records executed checks separately from planned acceptance. The target suite covers pure mapping, synthetic SQLite/WAL and mutation cases, snapshot lifecycle, browser reading and installed-package use without OpenCode. Platform/runtime compatibility is claimed only for executed combinations; a Linux Node 24 pass does not prove Windows or all Node 22 releases. / 实施计划区分已执行检查与计划验收。目标测试覆盖纯映射、合成 SQLite／WAL 与变更场景、快照生命周期、浏览器阅读和未安装 OpenCode 时的安装包使用。仅对实际执行的组合声明平台／运行时兼容；Linux Node 24 通过不证明 Windows 或所有 Node 22 版本通过。

HTTP/SDK, SSE, complete export-import UI, dev blob layouts, long-term historical archives and incremental performance optimization remain separate follow-ups. Export is useful fixture evidence but filters some unfinished and interrupted messages; daily CI does not generate it by running upstream. The direct history.read.source file/line API remains Codex-specific; OpenCode uses returned evidence references and typed Raw locators. / HTTP／SDK、SSE、完整 export 导入 UI、dev blob 布局、长期历史归档及增量性能优化保持独立后续工作。Export 可作为 fixture 依据，但会过滤部分未完成及中断消息；日常 CI 不运行上游来生成它。history.read.source 文件／行接口继续限定 Codex；OpenCode 使用返回的依据引用和类型化 Raw locator。
