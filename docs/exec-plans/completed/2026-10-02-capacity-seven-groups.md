# Seven capacity groups / 七组容量改进

Follow-up correction / 后续修正: external review of `3a0cdde` found three gaps in group 2: warm current-session HTTP search still scanned synchronously, Claude notification display projections inflated occurrence counts, and DeepSeek PTC lost JSON argument field names. The prior project-disk cancellation evidence did not prove current-session query cancellation. See the [follow-up execution record](2026-10-02-capacity-external-findings.md) for confirmed reproductions, repairs and integration evidence. / 对 `3a0cdde` 的外部复核确认第 2 组仍有三项缺口：已物化会话 HTTP 搜索仍同步扫描，Claude 通知展示投影重复增加命中次数，DeepSeek PTC 丢失 JSON 参数字段名。此前项目磁盘取消证据不能证明会话查询可取消。复现、修复与集成证据见后续执行记录。

## Baseline and authorization / 基线与授权

- Task: `G:\vibe\session-analyzer-capacity-task.md`; implementation, local validation, commits, task branch push and PR authorized. No merge, release, tags or real transcript upload. / 任务书授权实现、本地验证、提交、任务分支推送与 PR；不合并、发布、打标签或上传真实转录。
- Clean workspace; local and remote main verified at `6e84bb09876561ced0b060e68f3ee5da173614a5`, including #71/#72. Task branch `capacity/seven-groups`. / 工作区干净，本地与远端 main 已核实，包含 #71/#72。
- Toolchain already selected: Node 24.18.1, npm 12.0.2. / 已选工具链符合开发策略。

## Initial work and recovery map (historical) / 初始工作与恢复索引（历史）

| Group / 组 | Current evidence and work / 当前证据与工作 | Owner / 负责人 |
| --- | --- | --- |
| 1 | Confirmed `buildTextChunks` rejects a >4 MiB logical row; design segmented text retaining one event. / 已确认单行拒绝；设计保留事件身份的分段文本。 | root |
| 2 | Confirmed ordinary DeepSeek and Claude search prefixes remain bounded; expand only after storage supports them. / 已确认普通搜索仍截前缀；先承载再扩搜索域。 | root |
| 3 | Confirmed cumulative rows/bytes hard rejection and shared resident dictionary; investigate bounded disk storage and lifecycle. / 已确认累计硬拒绝与常驻字典；设计磁盘路径及生命周期。 | root |
| 4 | Full-tree snapshot array rejects >65,536 entries as source change; streaming digest implementation in progress. / 全树数组超限误报变化；实现流式摘要。 | source_capacity |
| 5 | Offset clamp confirmed; exact safe-integer validation and HTTP tests in progress. / 已确认钳制；实现精确安全整数与 HTTP 回归。 | pagination_capacity |
| 6 | Trace actual producers before conclusions; Codex/Claude dependency counts are fixed, descriptor collections can grow. / 先核实际生产者；Codex/Claude依赖项数固定，描述符集合可增长。 | contract_capacity |
| 7 | First-record bounded read under review; progressive plain/compressed reading and diagnostics in progress. / 首记录读取复核中；实现递进读取与准确诊断。 | source_capacity |

Separate evidence notes from each agent will be integrated and reviewed here. Subtask reports are not final validation. / 各 agent 的证据记录将在此集成复审，子任务报告不替代集成验证。

## Integration gates / 集成门槛

1. Storage and query path before expanded adapter search text. / 先存储读取，再扩 adapter 搜索。
2. Focused synthetic regressions, then isolated capacity experiments with resource measurements. / 聚焦合成回归，再隔离容量量测。
3. Full Node suite, generated build check, browser, installed-package smoke, serial profile coverage and applicable cross-platform CI. / 完整 Node、生成资产、浏览器、安装包、串行 profile 与适用跨平台 CI。
4. Review actual failures, preserve prior valid Index on failed rebuild, cleanup/cancellation and compatibility; update bilingual product/design docs, commit and PR. / 复审失败、旧索引保全、清理取消与兼容；同步双语文档、提交与 PR。

## Earlier integration checkpoint / 早期集成检查点

- Groups 1/3: adaptive schema-2 memory / schema-3 private disk store implemented. Metadata pages and streamed UTF-8 text preserve one event/ordinal; digest, text scan and build paths yield and cancel. Resource/cleanup fault injection passes. / 组 1/3 已实现内存／私有磁盘自适应存储、分段文本、事件身份、摘要及取消；资源／清理故障注入通过。
- Group 2: Claude and DeepSeek full text regressions pass through project queries and materialization; Codex follow-up found additional bounded producer/logical paths and is being fixed. Raw timeline DTOs no longer send internal full search text. / 组 2 Claude、DeepSeek 项目查询与物化全文回归通过；Codex 复查发现额外截断路径，正在修复。Raw 时间线 DTO 不再发送内部全文搜索副本。
- Groups 4/7: source-specific regressions pass, including valid plain/Zstd headers above 4 MiB. Static Claude tree with 65,794 entries succeeds in initial/reuse/rebuild paths; sampled RSS below 94 MB. See `capacity-source-evidence.md`. / 组 4/7 专属回归通过，包括超过 4 MiB 的合法普通／Zstd 头；65,794 树项首次／复用／重建成功。
- Group 5: exact HTTP/browser pagination checks pass; isolated 1,000,502-event timeline/file-activity experiment returns the exact final two rows at offset 1,000,500. See `capacity-pagination-evidence.md`. / 组 5 HTTP／浏览器与百万事件真实尾页验证通过。
- Group 6: real Codex metadata and Claude cwd descriptor regressions pass. A 200,001-file Codex analysis materializes with exact tail facts; the same analysis fails the old baseline contract. Dependency entry-count diagnosis corrected as unreachable in current three producers. See `capacity-contract-evidence.md`. / 组 6 大 metadata／cwd／200,001 文件分析通过，旧契约同输入失败；已修正三来源依赖项数可达性结论。
- First 5,000,001-row experiment failed after build/commit at query admission: `v8.serialize` is not a canonical manifest fingerprint. Replaced only the manifest fingerprint with stable streamed JSON; page checksums still hash the written bytes. Also removed repeated whole-project manifest hashing per shard (quadratic work). Both have regression coverage; the real experiment must be repeated before claiming success. / 首次 5,000,001 行实验在构建／提交之后的查询准入失败：V8 序列化不是稳定 manifest 编码。已换用流式稳定 JSON 摘要，并去掉逐 shard 重算全项目 manifest 的二次复杂度；回归通过，真实实验必须重跑后才能声称成功。
- Independent review caught initialization/fsync cleanup, old-revision retirement ordering, and cleanup errors masking failures. Fixed with candidate disposal, install-before-retire, warning/retry cleanup, and server-close build cancellation. / 独立复审发现初始化／刷盘清理、旧 revision 退休顺序及清理异常覆盖原始失败问题；已修正并覆盖故障注入。

Next: finish Codex/opaque-content search review, repeat isolated capacity evidence, run full integrated gates, inspect final diff and publish the authorized task PR. No final completion claim yet. / 下一步：完成 Codex／不透明内容搜索复核，重跑隔离容量实验，执行完整集成门槛，检查 diff 并创建已授权任务 PR；尚未宣称最终完成。

## Earlier validation checkpoint / 早期验证检查点

- Real query-store boundaries now pass: 5,000,001 rows, 2,786,493,028 encoded bytes, exact cold/warm scan hits, sampled RSS 381 MB, cancellation 12.2 ms, no remaining temporary entries; separately 8,595,127,698 encoded bytes (>8 GiB), 8,193 exact hits, sampled RSS 209 MB, cancellation 4.78 ms, no remaining temporary entries. See `capacity-query-storage-evidence.md` for commands, timings, units and failed attempts. / 真实查询存储边界已通过：分别超过旧行数及 8 GiB 编码字节上限，冷暖命中精确，取消和回收通过；命令、单位、时延及失败尝试见证据记录。
- Default temporary volume actually exhausted during the first >8 GiB run: accurate `PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED`, failed candidate cleaned. Repeated on G: with sufficient space and completed. / 首次超过 8 GiB 实验确实耗尽默认临时盘，准确报告并回收候选；在 G: 足够空间下重跑成功。
- Lead's first full Node run: 1,397 tests, 1,386 pass, 11 fail. Frozen old rejection/API/pack assertions updated with replacement success contracts; malformed-input error, builder one-shot finish and pure Codex builder injection regressions repaired. Focused direct-text 52/52 and package/profile 26/26 then passed. A new duplicate-after-spill cleanup regression was also repaired. / 负责人首次完整 Node 运行及后续聚焦修复如上；没有把失败计为通过。
- Browser full suite is running. Installed-package smoke passed all three sources before the final shared safe-JSON module addition, so it must be repeated for the final package. `build:check` passed. / 全量浏览器仍在运行；最终共享安全 JSON 模块加入前的三来源安装包 smoke 与生成资产检查通过，安装包需按最终状态重跑。
- Final text-domain review excludes opaque bytes from previews as well as search fields. New safe-JSON handling uses iterative traversal/encoding to preserve legal 6,000-level string-carried arguments and filter opaque payloads without an introduced call-stack cliff. / 最终文本域复审同时保护 preview 与 search 字段；安全 JSON 采用迭代遍历／编码，合法 6,000 层字符串参数不会因新处理路径出现调用栈上限。

## Local delivery gate / 本地交付门槛

The lead personally ran the final complete Node suite: **1,406/1,406 passed**, no skipped tests. Full Chromium suite: **303/303 passed**; this ran before the last server-only safe-JSON key hardening, covered by the subsequent full Node run and dedicated source regressions. `build:check` passed. Final installed-package smoke passed Codex, Claude and DeepSeek (plain and Zstd), including Timeline → Detail → Raw. One sandboxed package rerun was blocked by registry `EACCES`; its npm child was stopped and cleaned, and the network-authorized rerun passed. Serial `test:profile-coverage` ran after the suites stopped: three samples passed, minimum residual 0.67 ms against 5 ms. These are local working-tree results; current-commit cross-platform CI is still pending. / 负责人亲自执行最终完整 Node，1,406 项全通过且无跳过；完整 Chromium 303 项通过，运行于最后仅服务器端的安全 JSON 键处理之前，后续完整 Node 和专属来源回归覆盖该修正。生成资产、最终三来源安装包（含普通／Zstd）Timeline → Detail → Raw 均通过。一次 sandbox 安装包重跑被 registry EACCES 阻止，停止其 npm 子进程并清理后，在获准联网环境重跑成功。套件结束后独立运行串行 profile，三个样本通过，最小 residual 0.67 ms，阈值 5 ms。这些是本地工作区结果，当前提交跨平台 CI 尚待运行。

The existing development server was restarted with its original project and source arguments at `http://127.0.0.1:17890`: DeepSeek lab workspace, 23 sessions, zero diagnostics. Bounded HTTP reading verified an actual Main event, matching Detail identity and parsed exact Raw reference. No transcript content was committed or uploaded. / 现有开发服务按原项目／来源参数重启：DeepSeek lab workspace，23 个会话、零诊断；有界 HTTP 核验实际 Main 事件、Detail 身份及可解析的精确 Raw 引用。未提交或上传转录内容。

| Group / 组 | Conclusion / 结论 | Remaining boundary / 保留边界 |
| --- | --- | --- |
| 1 | Resolved: oversized records retain original IDs/owners, tail and cross-block matches. / 已解决：超大记录保留身份／归属及尾部、跨块命中。 | Runtime strings and individual source parsing still require memory. / 运行时字符串及单源解析仍需内存。 |
| 2 | Resolved: separate full searchable projections across three sources and Indexed/Materialized paths; legacy counts retained. / 已解决：三来源及索引／物化的完整搜索投影独立于展示，保留既有计数。 | Media/signatures/encrypted content excluded; Claude external results remain unread. Independent evidence validators still determine facts. / 排除媒体、签名、加密内容；不读取 Claude 外部结果；独立证据验证继续决定事实。 |
| 3 | Resolved: adaptive disk path, real >5 million rows and >8 GiB passes, cancellation and failed-replacement preservation. / 已解决：磁盘扩展路径、真实双边界通过、可取消及失败替换保全。 | Finite local disk, per-session source graphs and runtime address limits; precise resource error and rebuild recovery. / 有限磁盘、单会话对象及运行时寻址；准确资源错误，释放资源后重建。 |
| 4 | Resolved: incremental tree digest accepts 65,794 static entries while retaining change detection. / 已解决：增量树摘要接受 65,794 个静止树项并保留变化检测。 | Directory enumeration and source I/O still cost resources. / 目录枚举和来源 I/O 仍有成本。 |
| 5 | Resolved: exact safe-integer offset, bounded pages, illegal-value errors and revision binding; million-event tail proven. / 已解决：精确安全整数位置、有界页、非法值错误与 revision 绑定；百万事件尾页已证明。 | Offset maximum is JavaScript's safe-integer representation, not one million. / 上限来自 JavaScript 安全整数表示，而非一百万。 |
| 6 | Resolved reachable breadth/text budgets with streaming encoding; dependency-count hypothesis disproved for current producers. / 已解决可达宽度／文本预算并流式编码；当前生产者依赖项数量假设已证伪。 | Identity/plainness/depth/path/ownership checks retained; complete canonical objects remain resident. / 保留身份、普通数据、深度、路径及归属检查；完整规范对象仍常驻。 |
| 7 | Resolved: progressive plain/frame reads, distinct empty/uncommitted/corrupt/unsupported/resource outcomes. / 已解决：普通／压缩帧递进读取，准确区分空、未提交、损坏、不支持及资源耗尽。 | JSON.parse needs one complete header string; actual runtime exhaustion is explicit and artifact-local. / JSON.parse 仍需完整头部字符串；真实运行时耗尽明确报告并隔离工件。 |

## Delivery / 交付

Implementation commit: 9e738503af684df8c95236f3d449ca24b3c6d16c, [PR #73](https://github.com/Yijia-Zhou/session-analyzer/pull/73). Its [CI run 212](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/37010479730) passed every job: Ubuntu Node 22/24, Windows Node 24, both package platforms, Ubuntu browser, serial profile coverage and aggregate gate. This archival follow-up changes documentation only; the verified source tree is 3b580f9c16ae08822de2210ce8a9717cc40f564b. No implementation work remains. No merge, tag or package publication was performed. / 实现提交、PR 与完整 CI 如上；所有平台和汇总门禁通过。本次归档后续提交只改文档，已验证 src 树哈希如上。实现工作已完成；未合并、打标签或发布包.

The seven conclusions above are authoritative. Evidence notes: [query storage](capacity-query-storage-evidence.md), [source/header/search](capacity-source-evidence.md), [contracts and Codex search](capacity-contract-evidence.md), [pagination](capacity-pagination-evidence.md). Historical pending statements describe earlier checkpoints, not remaining work. The PR records the archive commit CI status separately. / 上述七组结论为最终结论；各证据记录链接如上。历史等待说明仅描述先前检查点，不代表剩余任务；归档提交自身 CI 状态单独记录在 PR 中。
