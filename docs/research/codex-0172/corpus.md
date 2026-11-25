# 本地 Codex rollout 结构调查 · 2026-11-24

**本地工件能证明落盘形态及共存关系。** 本次主扫描读取 1,620 个物理文件，首条会话元数据包含 1,617 个不同的逻辑线程 ID。所有文件的首个 `history_mode` 都是 `paginated`，所有解析成功的记录都有整数 `ordinal`。本样本没有 Legacy 模式的对照组。一个人可以使用多个客户端、线程、派生会话，同一条历史也可以被拷入多个文件。[完整聚合](corpus.json)

## 范围和方法

- 先检查默认 Codex home、`CODEX_HOME` 与当前用户目录下名称含 Codex 且有会话子目录的直接子目录。环境变量未设置，仅命中一个 home。分别遍历 `sessions`、`archived_sessions`。其他 OS 用户、多台设备、WSL、未指明的自定义根不在范围内。
- 盘点时限制首行读取至 1 MiB，通过流式 Zstd 解码收集首行版本、文件数量、压缩大小、修改日期及规范文件名日期。首行版本覆盖 0.101.0 至 0.172.0，带限定符的 build 仅按数字版本归为 `-qualified`。主扫描所见 <=0.162 系列为 1,361 个文件，0.163–0.171 为 252，0.172.0 为 7。[预调查](corpus-inventory.json)
- 依据预调查选择顺序解压全体工件。主扫描开始时记录每个文件的大小，以这个物理末尾为界，扫描后再比较大小、mtime 和 inode。五个文件发生变化。结果包含已读取的库存前缀，没有全局原子快照，也没有持续追踪写入。不同阶段各自记录库存，因此活动文件的大小和数量可变化。
- 主扫描库存共 1,399,217,687 个物理字节，其中活动目录 1,544 个 Zstd、58 个普通 JSONL，归档目录 18 个 Zstd。最大压缩文件 127,972,757 字节。解码共 5,272,155,378 字节、917,036 行，行时间戳覆盖 2026-02-18 至 2026-11-24 UTC。全部读至库存末尾，没有读解码失败、无效 UTF-8、无效 JSON 或超限行。349 行超过 1 MiB，最大行 8,449,976 字节。
- 解压窗口上限 128 MiB，每文件解码上限 4 GiB、行数上限 250,000，单条 JSON 解析上限 32 MiB，超长行会排空至换行并单独计数。受控结构递归深度最多 6，单个数组最多查看前 128 项。29 次数组遍历触及截断，嵌套计数为有界观察。对顶层记录仍逐行计数。扫描使用 Node 24.18.1。
- 只保留公开协议标签和数值。陌生标签折叠为 `other`，陌生字段按容器累加。引用和身份值只在进程内做精确等值比较；脚本不输出路径、标识符、参数、原文、账号、外部资源、任意工具名或待执行指令。不同阶段均未打开状态库或外部资源。

## 可供复现选择的场景

| 观察对象 | 物理记录与文件 | 可支持的决策 |
| --- | --- | --- |
| 用户角色与 part 来源 | 128 条 `role=user` 的对齐记录由 `agents_md+harness` 组成，见于 127 文件；纯 `harness` 30 条/21 文件，纯 `skills` 1 条/1 文件；纯 `user` 对照 1,260 条/98 文件 | 可构造每种来源与旧式缺少 metadata 的对照。源字段同时存在、数组长度相等；是否形成多算用户输入须复现 Analyzer 消费路径。来源组合统计取每个数组前 128 项。 |
| 跨 Agent 交付 | 47 条 `inter_agent_communication` 见于 10 文件；5,087 条 `inter_agent_communication_metadata` 见于 577 文件，每一条的紧接下一条均为 `response_item.agent_message`。6,131 条 agent response 中 1,625 条带对齐的 Tool 来源（100 文件）。 | 可验证 sidecar 加消息的配对候选。1,044 个额外 response 表明并非每条 agent 消息都有前置 sidecar。相邻关系的通用含义需核对固定版本 reader。 |
| 异步和保留输入 | 41 个 canonical `AgentMessage` 记录了异步 delivery（22 文件），39 条 item 带非空 questions；6 个顶层 `retained_context` 全为 `verified_answer`。 | 将异步询问、已确认回答和普通 assistant message 分别作为 fixture。可用史料没有交付标记 `metadata.delivered_assistant_message`。 |
| 根 metadata | 9,342 个 message 带 `retained_source`（394 文件）；2,285 个 message 带 `history_sequence`（81 文件），同路径 `sampled_through_sequence` 边际计数相同。另有 831 个 message 带非空 `guardian_sources`。 | 主记录、sidecar 和 compaction checkpoint 分开计数。含两个整数的 response 中，20,408 个水位在本文件出现过对应 response 序号，753 个未命中；这是等值查找，不足以证明跨文件链损坏。 |
| Fork、Guardian、附属线程 | 135 个首 meta 含 `forked_from_id`，全能在语料找到目标首 meta。2 个 `attached_thread=true` 均为 VSCode source、user thread_source，且带 fork、history_base 与显式 fork ordinal 边界。283 个首 meta 的 `thread_source=guardian_review`；259 个 `source.subagent=review`。 | 附属标记可作为精确 fixture；未经入口证据不可给这两个会话指认特定前端操作。两个 review 计数使用不同维度。 |
| Token、Turn、窗口 | 38,595 条顶层 `token_usage_record`（697 文件），均匹配首 meta 的 thread_id 和同文件某个 context/start 的 turn_id。195 个 checkpoint 另带非空 `latest_token_usage_record`，另有 337 个显式 null。139,031 个 `token_count` 中 7,930 条 `info.last_usage_includes_reasoning=true`（114 文件）。 | 有直接使用记录、累计观测和 checkpoint 三类 fixture 条件。匹配 owner 的事实不提供新任务的成本总数。 |
| Code Mode 和 MCP | 8 个直接 `function_call_output` 带非空 `executed_tool_calls`（1 文件）；`tool_calls_complete=true` 另计 8 条（1 文件）。未观察到 manifest 内部参数截断哨兵、`cell_id` 或 `tool_result_metadata`。主调查有 3,541 个 canonical `McpToolCall`，没有 Legacy end 事件。 | 两个 manifest 边际计数不能确定清单来自 Code Mode cell。环境字段及 generation cell 的针对性探针见下文。 |
| Realtime、音频、多模态 | 同一文件中有 2 开 2 闭，未观察到新 frame、输入回执或 realtime 根 metadata。受检音频路径无有效命中。14 个 `Extension(image_gen.generation)`（2 文件）均有非空字符串 result，均无非空 fileId。 | 新 realtime、音频和仅有文件 ID 的图像形态仍需独立来源或合成验证。 |
| 其他 | 2,951 条 message 的 output part 有空 `annotations` 和空 `logprobs`（各 234 文件）。无 canonical moderation，未见顶层 `dynamic_tools_updated`。106 个 meta 带 `account_scoped=true`（97 文件），只计字段存在。 | 空数组是可保留的实测形态。未解码、摘录或保留任何注解、账号、音频、图像或工具原文。 |

## 异常和解释边界

在所有可解析记录中，顶层类型、监测的 `event_msg` 和 `response_item` subtype、canonical item 类型都命中白名单。完整计数在 `records`、`contexts`、`canonicalItems`；`fieldOccurrences` 是各白名单路径出现次数，`markerRecords` 是每种特征的去重行数，`markerFiles` 是物理文件数。一个文件可以贡献多个来源组合或字段。协议中存在但语料为零的类型不会出现在稀疏 JSON 中。

- 1,672 个 session metadata 比文件数多 52。4 个文件出现多个数字版本或版本限定类别，这可能来自继承、复制等过程。没有第二条 metadata 的文件也可能经历更新、迁移或 resume。这些 version band 是文件标签。包括本次调查在内的活动会话也可以贡献信息。
- 11,237 个带非空 item ID 的完成记录重复同文件相同 (thread_id, turn_id, item.id) 键，其中 11,225 为 Reasoning，12 为 McpToolCall。这不能单独证明重复执行或多算。另有 2 个逻辑首 meta ID 各出现在多个物理工件中。
- 1,124 个首 meta 的 parent_thread_id 有 1 个目标未作为首 meta 观察到；561 个 thread_spawn.parent_thread_id 全命中。1,730 个 start attribution 的父级 ID 未在同文件 start/context 出现，45 个命中同文件其他 turn。此等值查找没有拼接物理历史链，也没有搜索外部根，无法据此标记悬空引用。
- 134,705 条已计数的 function/custom output 均有同文件相同 call_id 的相应调用族候选（两类调用的 ID 合并查找）。这项测试不检查先后顺序、唯一性、Turn 或语义归属。同文件的额外 session meta、继承内容和未生效分支均保留在物理计数中。
- `source` 维度中有 434 个 cli、33 个 vscode、3 个 exec、561 个 subagent.thread_spawn、259 个 subagent.review、330 个 subagent.other。它不识别客户端 UI、模型提供者或设备用户数。没有受控运行新 writer；所有本地记录均属既有或自然增长的落盘观察。

## 重跑及针对性探针

下列命令只向标准输出写聚合 JSON（自检只报告结果）。可用重复的 `--root` 指定其他 Codex home。可复用脚本和独立校验分别见 [扫描器](../../../scripts/audit-codex-0172-corpus.js) 与 [合成校验](../../../scripts/audit-codex-0172-corpus.check.js)。

```text
node scripts/audit-codex-0172-corpus.js --inventory
node scripts/audit-codex-0172-corpus.js
node scripts/audit-codex-0172-corpus.js --plain-mcp
node scripts/audit-codex-0172-corpus.js --mcp-cells
node scripts/audit-codex-0172-corpus.check.js
```

首个 MCP 抽样读取全部 58 个普通文件，首版本分别为 0.169/0.170/0.171/0.172（1/15/35/7），158 个 typed 项的 camelCase、snake_case 环境字段均缺省。[普通文件补测](corpus-mcp-sample.json)

随后在独立库存中流式补扫全部 1,620 个工件，仅匹配 MCP 与 Code Mode 证据。1,620 个均读到库存末尾，4 个在盘点后有变动。跨阶段活动文件新增了一个 typed MCP，因此下面单独给出本次分母。[全量定向补测](corpus-mcp-cells.json)

| 精确条件 | Zstd | 普通 JSONL |
| --- | ---: | ---: |
| canonical `item_completed.McpToolCall` | 3,383 条/94 文件 | 159 条/4 文件 |
| 上项有 `environmentId` 或 `environment_id`；或 Legacy invocation 含作用域 | 0 | 0 |
| function call 的 namespace 符合可选 `mcp__` 加 12 位小写十六进制及双下划线前缀 | 0 | 0 |
| tool output 的首行符合 generation cell 运行中回执 | 13 条/5 文件 | 43 条/6 文件 |
| wait 参数为 generation 格式且相同 cell ID 出现在同文件运行中回执中 | 13 条/5 文件 | 47 条/6 文件 |
| 十进制 cell 的运行中回执 / wait 参数 | 5,431 / 5,436 | 150 / 145 |

MCP 的同 ID 匹配仅比较 `function_call.call_id` 与 typed item ID，再比较 name/tool。得到 252 个同名、109 个同 ID 异名和 3,181 个没有该类直接调用的项。缺少该类调用不排除 Code Mode 内嵌执行。带散列的 namespace 单独出现也不足以证明环境归属。

运行中回执识别字符串 output 或数组首个 text/input_text part 的**第一行**，整行须为 `Script running with cell ID g<digits>:<digits>`。wait 要求 function call 名为 `wait` 或 `functions.wait` 且结构化参数中的 `cell_id` 符合该格式。同文件 ID 命中用于证明新旧记录在真实语料中存在，不能证明个别 wait 的时序或唯一归属。Code Mode 执行清单中的 `cell_id` 是另一条字段路径。

合成自检实际覆盖普通和 Zstd、无换行尾部、非法 JSON、超过行长上限、库存后追加、重复 metadata 版本、fork/call ID 等值连接、未知字段/值脱敏，以及带作用域 MCP 和 generation cell 的精确条件（含正文内嵌回执的反例）。脚本不需要安装依赖或调用 Codex API。
