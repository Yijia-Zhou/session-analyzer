# OpenCode v2 适配整体实施计划

状态：第 3 版评审稿，2026-10-28（Asia/Shanghai）。研究与计划修订已完成；下述产品实现、测试接线和兼容声明尚未完成。本轮只收紧验收契约，供 GPT Pro 和后续实施者复核，不增加架构层次。

## 1. 目标与总体决策

从 Session Analyzer 的 v0.3.0-development 基线接入 OpenCode v2 本地会话，使其进入现有项目发现、索引、Main、Detail、Raw、搜索及 evidence refs 流程。默认采用独立的只读 SQLite reader，不要求用户或日常 CI 安装、启动 OpenCode，也不调用模型。

统一 mapper 接收带明确版本与覆盖范围的 OpenCodeSnapshot；SQLite 是首个正式读取后端。官方 export、API 投影和数据库源对象共同提供测试证据。完整 export 文件导入功能、已有 server 的 HTTP 后端以及 SSE，按后续需求独立增加。

首个可交付 SQLite adapter 必须同时完成快照一致性、更新/删除处理、旧引用语义、资源释放和明确诊断。高效增量刷新、实时推送、长期历史归档可以后置。使用 SQLite 并不消除上游 schema 兼容维护，只是避免把 OpenCode 可执行程序变成 Analyzer 的运行依赖。

## 2. 固定基线与证据边界

| 对象 | 本计划依据 |
| --- | --- |
| Analyzer | v0.3.0-development，d8b787f54b4d0613732578cae1ead5bd858a35ea |
| 研究工作分支 | research/opencode-v2；独立 worktree，未修改原 checkout |
| OpenCode 实跑版本 | @opencode/cli@2.1.4；68bc26b7da1990ce10ffecfbc1e09eb13aa5d824 |
| OpenCode 开发源码 | ab4d1f3ab1a05278b4d0392124b9e7f1c8131f17；仅静态检查，schema 已与稳定版不同 |
| 实验运行环境 | Linux x64、Node 24.19.0；不代表已验证 Windows 或所有 Node 22 |
| 配套研究报告 | docs/design-docs/opencode-v2-adaptation-research.md；交付包内为 research-report.md |

版本号描述原研究时点，不声称该版本将一直是最新版。实施前记录当时 Analyzer HEAD、支持的 OpenCode 版本、源码 SHA、实际 DDL 与 JSON shape；不能把开发版差异混进稳定版支持声明。旧包 opencode-ai 和旧 SDK 路径中的 v2 不等于本次 OpenCode major 2。

已有真实实验支持：7 个 session、37 条 message，在无活动执行的稳定窗口，逐页 API 对象与 SQLite 还原对象相等；同 ID 消息原位更新、运行时 export 少于 API、fork 复制前缀、真实子代理、回退删除最后一条 idle、压缩保留旧消息。这不是复杂回退、活跃 HTTP 分页原子性或大库性能证明。

补充证据分级：

- export 过滤规则有固定源码及 fixture 支持：assistant 只要缺少 time.completed 就被过滤，即使会话已经 interrupted/idle；shell、compaction 的 running 状态也会被过滤。
- worktree.resolved 的 metadata 反例来自静态源码与上游测试阅读：事件按 project aggregate 推进序号；projector 可改 session 的 project_id/path 并保留 time_updated。它证明项目归属依赖不能只看 session 水位，不证明正文更新会绕过 session 水位。本轮未运行该上游测试。
- 只读 WAL 补充实验在合成库上复现了创建 -shm：query_only=true、total_changes=0，主 DB/WAL 哈希未变，但新增共享内存文件。不能把逻辑只读表述为绝对零文件系统写入。
- 原始 7 会话 API/SQL 比较、分页和 DB/WAL 检查在原环境执行过；现有资料包提供结果摘要与脱敏投影，未提供完整原始 DB、逐页响应及比较器，不能仅凭 ZIP 独立重跑原实验。

## 3. 对旧计划的修订

| 原安排或易误解点 | 修订后的要求 |
| --- | --- |
| 先实现完整 export 导入 | 先做纯 mapper 与多来源、版本化 fixture；不以完整导入 UI/CLI 为前置 |
| SQLite 接入后再补更新与删除一致性 | 一致性和生命周期进入首个正式 adapter 的交付门槛 |
| session 序号加更新时间可作完整版本 | 只能作候选变化提示；以实际输入依赖闭包与内容摘要绑定快照 |
| file/exact 可以直接复用，资源问题随之解决 | 它只能校验文件内容；快照的创建、所有权转交、退役及清理要新增工程 |
| export 覆盖历史消息即可验证 adapter | 补充未完成/中断源对象，以及真正通过 SQLite reader 的确定性测试 |
| 每次 CI 运行 OpenCode 生成样本 | 日常 CI 读取固定工件、创建临时 DB；上游兼容任务独立运行 |

## 4. 首版范围与不变量

首版支持声明以明确版本/schema 和操作系统矩阵为准。目标纳入 user、assistant 的 text/reasoning/tool、idle、retry、中断、顶层 shell、system/synthetic/skill、切换消息、fork、subagent 和 compaction。未知消息类型保留 Raw/Protocol，并报告解释覆盖范围；不可识别的存储布局不得猜测解析或返回虚假的“零会话”。

必须保持：

1. 从 session_v2、session_message 还原消息；id/type/seq 列与 data JSON 的职责分开。seq 是排序依据，不是行更新游标。
2. tool.completed 与进程 exit=0 分开；顶层 shell 与 assistant 内的 shell tool 分开。assistant step 不冒充整个用户 turn。
3. fork 与 parent/subagent 分开；复制前缀不重复归为新执行成本。compaction 后保留的 transcript 不按模型 context 截断。inbox 待送达输入不伪装成已执行 user message。
4. Main、搜索命中、Detail 和 Raw 属于同一索引 revision 的证据；旧引用不能静默读取新正文。
5. 未保存的中间状态、已经删除且从未观察过的尾部，不承诺恢复；临时快照不是永久历史档案。
6. 不把 SQLite 文件当 JSONL，不造文件行号；sourceFile/bytes/lineCount 的含义需要在正式契约和 UI 中明确。
7. 不导入上游 Database service、不迁移、不 checkpoint、不改变 journal_mode；活动库不用 immutable=true，也不直接复制主 DB 而忽略 WAL。
8. 日常产品读取与 PR 测试不依赖 OpenCode CLI、server、OpenRouter key 或免费模型。

HTTP/SSE、完整 export 导入、dev blob/media hydrate、跨版本 legacy 自动兼容、持久事件重放、长期归档和大库增量优化不作为首版默认能力。附件元信息可保留，但不能声称已能解析或打开所有外部媒体；暂不支持的布局必须有明确诊断。

## 5. 首选快照方案及现有接口缺口

### 5.1 一次读取与后续物化分别保证一致性

首选 MVP：对选定项目中纳入索引的每个会话保存不可变的原生数据快照，完整 Logical/Raw 对象仍按需物化。不能把“按需物化”误解为“点击详情后才捕获来源”。

构建流程：

1. 验证运行时能力和来源身份；只读打开 DB，启用 query_only、禁用扩展加载，设置短 busy timeout。固定表/列并使用参数绑定。
2. 在一个有界读事务内，将该项目的成员/关系 manifest、所需 metadata 与会话行流式捕获到私有 staging 目录。事务覆盖集合发现和数据读取，避免跨时刻拼接；不在浏览器使用期间持有事务。
3. 关闭读事务与连接，再仅从 staging 数据生成统一快照、内容摘要、紧凑索引和共享 query store。捕获及构建各阶段均执行单字段、嵌套深度、会话数、总字节、耗时及磁盘预算；超限应明确失败，不以截断成功代替。
4. 完整捕获并通过校验后封存快照，全有或全无地安装新的 index revision。失败或取消时释放未发布资源，保留仍然有效的旧 revision，并明确提示刷新失败、当前数据可能不是最新的；首次构建失败不得发布空项目冒充成功。
5. Detail/Raw 从已发布快照物化。当前 revision 可显示已捕获的旧状态；刷新成功后使用新 revision。退役引用按既有 stale/retired 语义失败，不自动转向新对象。

这是有界项目快照，不是全库所有项目同一时刻的承诺。事务内写 staging 仍会延长 WAL reader 持有期，必须量测并设置上限；不在事务内做 mapper/UI 工作。若真实项目规模使这个方案不能满足预算，再评估“索引摘要 + 物化前重读并验证完整依赖闭包”的备选。备选一旦不匹配就返回 stale，不能悄悄用新数据补旧索引。

### 5.2 依赖闭包

快照身份至少由实际参与计算的下列输入确定：

- 来源 DB 实例/替换身份、兼容 profile、相关 schema/decoder/mapper 版本。路径、mtime 或 PRAGMA user_version 单独不足以标识来源版本。
- 项目归属及显示所用 metadata、被纳入的 session 集合、parent/fork/child 关系。跨项目关联只读取约定字段；关系目标缺失要保留明确状态，不能递归无界展开。
- 每个会话的相关 metadata、按 seq 排序的消息 PK/type/seq/data；遗漏/删除、原位内容变化和顺序变化均影响摘要。
- 若某项外部附件或补充数据实际参与展示/搜索，其身份与内容依赖也必须进入；未捕获的附件明确标为不可回读，不能稍后查询 live DB/文件补成另一版本。不使用的全库无关表不必进入。

将项目集合/关系 manifest 与会话内容摘要分别记录，并在所依赖的层绑定；避免把任意无关会话变化扩大成所有会话失效。event_sequence、session.time_updated、PRAGMA data_version 只用于提示重新观察或将来的优化，不替代这些正确性依据。首版可显式刷新并重建，不承诺实时观察。

同一来源身份命名空间内，一个已发布的 snapshot ID 只能对应一组不可变的实际输入与版本约定；改变其内容、依赖或解释版本必须得到新的快照身份。禁止封存后原地改写消息 JSON，再以更新摘要的方式保留原 snapshot ID。文件被外部修改应报告完整性失败，不能重新登记为原快照。

M2 分别验证三层不变量，不能仅凭 hash 相同推断整个链路正确：

| 验收层 | 独立验证内容 |
| --- | --- |
| 输入完整性 | 用受控读事务视图和独立预期核对项目成员、消息集合、顺序与关系；测试遗漏、混入和捕获期间写入 |
| 内容完整性 | 快照文件与封存时记录的摘要对应；改写或删除文件必须被检测，不能更新摘要掩盖变化 |
| 引用一致性 | 索引、搜索命中、Detail、Raw 绑定同一 snapshot/revision；测试旧、新引用交叉使用，不能只比较各自文件 hash |

### 5.3 所有权与清理

staging 资源由构建任务拥有；发布后转交 index revision 的资源 owner。每次物化/文件读取持有 reader lease；退役先拒绝新任务并取消旧任务，等实际 I/O 完成、reader 释放后才删除目录。AbortSignal 已触发不等于 I/O 已停止。

拟议状态为 building → sealed → published → retired → disposed；发布前失败由构建 scope 回收。首版不跨 revision 去重快照，允许旧、新目录在交接时短暂并存。运行时 owner 状态不塞进 canonical metadata。

现有 index-revision-lease 主要释放 queryStore，不能假定已有通用 adapter dispose 钩子。需补充快照 owner 的接线，覆盖构建失败、并发刷新、取消、revision 替换、正常退出、清理重试及崩溃残留。可借鉴 project-query-disk 的幂等释放模式，但残留清扫要限制在 Analyzer 自有目录，避免删除其他活跃进程的快照。

server 的构建 scope、history-service 的独立索引和共享 viewer/关闭入口必须一起核对，避免双重释放或 viewer 仍持有快照时提前清理。快照文件丢失、被改或摘要不符时明确报告 stale/损坏，禁止回退到 live DB 拼接。

file/exact 只用于真正封存的快照文件，不能指向活动 DB。磁盘配额不能淘汰仍被使用的快照；额度不足时拒绝新构建并给出诊断。默认权限收紧，不把原始正文复制进无界内存 metadata 或日志。

### 5.4 WAL 与来源权限契约

M0 定义支持条件和诊断，M2 验证“目录可写/只读 × SHM 已存在/不存在”四种组合，并记录主 DB、WAL、SHM 各文件的实际访问权限。再覆盖独立 writer 活跃，以及 WAL 缺失、损坏、不可访问的受控场景。权限测试需证明限制确实生效，不能以提权进程绕过限制的结果判定支持。

不同 SQLite/平台条件下，预期可以是完整读取成功，也可以是明确的权限、不支持或损坏诊断；不能静默回退到仅读取主 DB。没有 WAL 也可能是正常状态，不能一概报损坏；对于已知包含未 checkpoint 提交的测试库，要用固定预期检测丢失数据，且不承诺从任意主 DB 中识别所有已经丢失的 WAL 历史。若某种组合需要可写来源目录，应写入该版本/平台的用户文档限制。

M2 普通 CI 使用合成库和独立 SQLite writer；另一个真实 OpenCode 进程使用数据库的场景放进独立上游兼容任务，避免引入日常 CI 的 CLI 依赖。不针对用户活动库删除或破坏侧文件来测试。

### 5.5 预算失败与发布契约

以选定项目的新 revision 为提交单元：预算超限、权限失败、锁等待超时、schema 不兼容、完整性失败或取消，均不得发布部分项目或安装部分新快照。旧 revision 只有仍满足完整性/生命周期条件时才可继续读取；否则明确不可用，不用旧数据掩盖失败。

M0 确定各预算的阈值、计量时点、取消检查点和诊断类别；区分预算超限、磁盘不足、权限、锁定、schema、完整性及取消，保留原始错误依据。失败路径必须关闭事务、连接和文件句柄，等待实际 I/O 退出，再回收 staging 与派生 queryStore。删除失败时保留受控、可观察的重试记录，不能声称目录已清理，也不能让候选版本变为可读。

M2 注入捕获中、构建中和发布前的预算失败，分别验证无部分发布、旧 revision 的可用状态与刷新失败提示、资源释放；同时覆盖无旧 revision 的首次失败。成功路径与失败路径都必须满足同一发布契约。

## 6. 实施里程碑与完成条件

| 阶段 | 工作与产物 | 完成条件 |
| --- | --- | --- |
| M0 契约定稿 | 对照届时开发分支，确定来源选择、兼容 profile、snapshot/manifest 输入、Raw locator、owner、预算及诊断；更新正式规格与设计 | 明确权限矩阵、快照身份绑定、三层完整性和全有或全无失败语义；不把研究 PoC 当产品 reader |
| M1 mapper 与证据 | 多来源最小化 fixture；纯 mapper；消息/工具/关系/计费映射；未知类型保留 | 可离线运行；覆盖 settled、running、interrupted 和关键语义；预期结果有独立上游依据 |
| M2 SQLite 垂直切片 | 发现、只读捕获、快照 owner、索引、查询、按需物化、Raw、刷新与 stale、清理 | 同 ID 更新、删除、metadata、WAL/权限、三层完整性、取消/退役及预算失败测试通过；最小 UI/history 流程可用 |
| M3 首版产品验收 | 扩充边界、跨平台、浏览器和安装包测试；能力诊断、支持矩阵、用户文档 | 声明支持的平台/Node 版本实测通过；无 OpenCode 的安装包能读取合成库；其他来源不回归 |
| M4 独立兼容与后续能力 | 固定上游版本探针、升级工件；按需 API/export 导入、性能优化 | 每次支持范围扩展有证据；优化与新增后端保持同一快照/mapper 契约 |

M1 是内部映射验证，不作为“已支持 OpenCode”的发布。M2 必须包含最低一致性和资源管理；M3 必须完成声明范围内的测试，不能把当前 CI 的 Windows/Node 22 验收一律推迟到性能阶段。

现有接线位置：src/source-adapter-contract.js、src/source-adapters.js、src/canonical-contract.js、src/project-query-store.js、src/index-revision-lease.js、src/materialized-session-owner.js、src/history-service.js、src/cli.js、src/history-cli.js，以及来源标签、浏览器呈现、package.json files 清单。具体模块拆分由 M0 决定，不先扩大公共接口。

history.read.source 当前有意限定 Codex JSONL；OpenCode 首版可以继续返回不支持。正常 evidence refs、Detail 与 Raw 读取必须可用。数据库 locator 只表达受限来源身份/表/主键/指针/快照，不暴露任意 SQL。

## 7. 日常 CI 与上游兼容任务

| 层 | 输入与检查 | 是否运行 OpenCode |
| --- | --- | --- |
| PR 必跑 mapper/契约测试 | 版本化、最小化的脱敏/合成对象；覆盖语义、查询摘要与 Raw 关联 | 否 |
| PR 必跑 SQLite 测试 | 用 Node 按固定上游 DDL/profile 建临时 DB，调用真实 adapter；独立 writer 模拟 WAL/更新/删除 | 否 |
| 现有规则下的浏览器和安装包检查 | 合成数据启动 Analyzer，验证发现→搜索→详情→Raw；无 OpenCode 安装环境 | 否 |
| 独立手动/定期兼容任务 | 固定版本 OpenCode、隔离 XDG/DB，检查真实 writer/schema/API/export 与保存工件的关系 | 是，不默认调用模型 |
| 可选真实模型采样 | 新语义难以用已有证据确认时，受控生成新 case、脱敏、审查后更新 fixture | 是，可需要凭据；不进入普通 PR 门禁 |

当前 CI 为 Linux Node 22/24、Windows Node 24，以及浏览器/安装包流程；它未安装 harness CLI。已有 Codex 测试通过 node:sqlite 创建临时库并验证 WAL，已有 pi/DeepSeek fixture 固定 producer 来源，OpenCode 延续这个方式。

禁止测试运行时执行 npx latest 导出、从用户 home 发现真实库、为构造 expected 而调用被测 mapper，或在缺少 SQLite 能力时静默跳过核心覆盖。运行时检查实际所需的 node:sqlite 能力；仅 engines >=22 不等于所有早期 Node 22 均满足要求。正式支持的 Node 下核心测试应运行并通过；另测能力缺失时的诊断，且不妨碍其他来源。

固定 fixture 必须记录 binary version、源码 SHA、schema 指纹、采集/脱敏方法及覆盖缺口。合成库适合确定性边界测试，但不能作为唯一上游真值。上游 latest 探测可单独告警，不能把未经评估的新版本自动纳入支持；宣布支持某一新版本之前，必须完成该版本的兼容验证。

重点验收：

- 消息数量与 seq 不变的内容/工具更新；会话 metadata/项目归属变化而 session 水位未变；新增、归档、整会话删除及回退后缀删除。
- 读事务期间独立 writer 提交，当前快照内部一致，下一次刷新观察到新状态；原路径 DB 替换、schema 变化、损坏/锁定/权限问题给出可辨别诊断。
- 旧索引的搜索/Detail/Raw 不混入新正文；活动快照不可被配额淘汰；取消后等待实际 reader 释放；并发构建仅发布符合当前请求的一版。
- 未完成、中断、缺 idle、tool error/非零 exit、fork 前缀、子会话发现及 compaction；原实验未覆盖的项目用合成/上游证据补足并标明来源。
- 单字段过大、深 JSON、大输出、磁盘不足、失败重试、正常退出与崩溃残留；界限和错误语义由 M0 确定并在 M2/M3 实测。

## 8. 交付证据与可复现性

本次评审包包含更新报告、本计划、原 PoC、原脱敏样本/实测摘要，以及只读 SHM 合成实验的观察结果。旧实验摘要保留原义，不因计划修订改成“已实现”“已通过 CI”。

后续在 M1/M2 补充不含凭据的采集脚本、可重建的最小数据库（DDL 与种子行）、确定性比较器、独立固定预期，以及分页响应或摘要对应关系和 fixture manifest。原始私人 DB 不是必须的交付物；可以通过专用合成项目和脱敏重建流程复现所声明的行为。新脚本重跑证明的是新一轮结果，不倒推为已经独立复现原实验。

现有 sqlite-probe.mjs 只记录计数、hash 和水位，不保存旧消息 payload；其 mutation 汇总未完整覆盖整会话删除/纯 metadata 变化，也没有生产级字段大小与生命周期管理。它可作诊断证据，不能直接承担 reader、快照仓库或完整失效契约。

## 9. 请外部评审重点判断

1. 首选“有界项目事务 → 原生快照 → 派生索引 → revision 发布”是否适合本项目规模？哪些约束会迫使首版改用重读验证方案？
2. 项目分组、成员集合、parent/fork/child 和 metadata 的依赖闭包是否完整？会话级摘要与项目 manifest 的职责是否足够清晰？
3. owner/reader lease 的退役与实际 I/O drain 是否覆盖竞态？现有 queryStore 清理模式可复用到什么程度？
4. 兼容 profile、未知 schema/消息、Node 能力缺失及只读权限失败的边界是否明确？还有哪些情况可能被误报为空库或成功？
5. 固定真实工件与合成 DB 测试的组合，能否避免仅 export 的盲区和自证循环？哪些上游兼容检查应成为版本支持声明的前置？
6. M2/M3 的首版门槛是否遗漏影响证据可信度的问题？哪些工作可延后而不损害首版正确性？

请区分代码事实、方案建议和需要新实验才能成立的判断；不要把“安装成功”“PoC 成功”或“固定样本通过”当成正式适配与兼容验收已完成。

## 10. 进度与参考入口

- 2026-10-27：完成固定版本源码研究、隔离安装、免费模型真实 case、SQLite PoC、API/SQL 对照及第三方 UI 静态研究。
- 2026-10-28：核查外部建议；补充 export 过滤解释、project metadata 水位反例和只读 SHM 合成实验；修订实现顺序、快照生命周期及 CI 分层。
- 2026-10-28，第 3 版小修：补充 WAL/目录权限矩阵、快照 ID 与三层完整性、预算失败的全有或全无发布语义；M0→M4 顺序及首版范围保持不变，未新增实验或产品测试。
- 待执行：M0 至 M4。尚无 OpenCode 产品 adapter、相关产品测试通过记录或支持版本发布。

固定源码入口：

- [OpenCode export 过滤](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/core/src/session/transfer.ts#L165)
- [项目解析对 session metadata 的投影](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/core/src/session/projector.ts#L498)
- [上游项目归属测试](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/core/test/session-create.test.ts#L134)
- [Analyzer dependency 契约](https://github.com/Yijia-Zhou/session-analyzer/blob/d8b787f54b4d0613732578cae1ead5bd858a35ea/src/canonical-contract.js#L550)
- [Analyzer revision 退役与释放](https://github.com/Yijia-Zhou/session-analyzer/blob/d8b787f54b4d0613732578cae1ead5bd858a35ea/src/index-revision-lease.js#L52)
- [现有 CI](https://github.com/Yijia-Zhou/session-analyzer/blob/d8b787f54b4d0613732578cae1ead5bd858a35ea/.github/workflows/ci.yml#L42)
- [现有 SQLite 临时库测试](https://github.com/Yijia-Zhou/session-analyzer/blob/d8b787f54b4d0613732578cae1ead5bd858a35ea/test/codex-current-rollout.test.js#L13)
