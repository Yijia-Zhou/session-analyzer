# pi query text sharing / pi 查询文本共享

## Goal and scope / 目标与范围

Reduce disposable disk query text duplicated by pi branch projections without changing any branch's visible results. Base: `0d4b79a9a91bbbb697a49d03e54f3f7351da0336` on `feat/pi-integration`. The mobile loading fix is an independent increment. / 减少 pi 分支投影重复写入的临时磁盘查询文本，不改变任何分支的可见结果。基线为所列 integration commit；移动端加载修复为独立增量。

Pi opts into exact encoded-text range reuse in schema-3 query storage. Keep schema-2 packing and spill thresholds, metadata rows, identities, ordering, projection digests, query results and native statistics unchanged. A bounded builder-local digest/range index selects candidates; bounded byte comparison authorizes reuse. Retain no transcript strings in that index. / pi 对 schema-3 查询存储启用精确编码文本范围复用。保持 schema-2 打包与溢出阈值、metadata 行、身份、顺序、投影摘要、查询结果及原生统计；builder 内有界摘要／范围索引选择候选，分块字节比较决定复用，不在该索引中保留转录字符串。

Request-level search caching, search-hit deduplication, native patch/project aggregation, complete recorded-context projection, extension semantics and cross-file navigation remain separate. Sharing text does not collapse branch rows or turn physical call identity into proof of equal projected output. / 请求级搜索缓存、搜索命中去重、原生 patch／项目聚合、完整记录上下文投影、扩展语义及跨文件导航分别推进。共享文本不折叠分支行，也不把物理调用身份视为投影输出相等的证明。

## Work and acceptance / 工作与验收

1. Implement pi-only opt-in and bounded descriptors, exact UTF-8 equality, deterministic eviction, cooperative cancellation and cleanup. Preserve existing resource-error and committed-index ownership. / 实现 pi 专用启用、有界描述符、精确 UTF-8 相等、确定性淘汰、协作取消与清理，保留资源错误和已提交索引所有权。
2. Compare enabled/disabled storage for decoded rows, digests and searches; cover UTF-8 boundaries, eviction, failure/cancellation, spill and sibling result/duplicate-identity ambiguity. / 对照启用／禁用共享的解码行、摘要与搜索，覆盖 UTF-8 边界、淘汰、错误／取消、溢出，以及兄弟分支结果／重复身份歧义。
3. Run focused query/pi checks and the full Node suite. Pause suites for serial matched capacity runs in fresh processes; report actual/accounted bytes, timings and maximum RSS, without one-shot timing gates. / 运行查询／pi 聚焦检查与完整 Node 套件；容量量测时暂停套件，在新进程顺序运行匹配案例，报告真实／核算字节、耗时与最大 RSS，不设单次时延门槛。
4. Compare complete branch/query contracts for shared-1000x32 and the existing private corpus; verify source hashes, diagnostics, native statistics and Detail readback. Real transcripts/reports remain outside git. / 对照 shared-1000x32 及既有私有语料的完整分支／查询契约，核验源哈希、诊断、原生统计和 Detail 回读。真实转录与报告留在 git 外。
5. Obtain fresh independent review of the exact final diff before commit/push. Distinguish local checks from hosted CI and GitHub Codex review; assess integration into development after both independent increments. / 提交／推送前对精确最终 diff 做全新独立审查，区分本地检查与托管 CI、GitHub Codex 审查，两项独立增量后评估进入开发分支。

## Evidence / 依据

Implementation and local validation are complete; independent review and hosted checks are recorded separately in commit trailers and the PR. Eight focused new regressions and the affected query disk/capacity/lifecycle/direct-text/session-query and pi accounting/review/adversarial suites passed **118/118** locally. The full Node suite then passed **1,986/1,986**, with no skipped tests, using npm 12.0.2 / Node 24.19.0. / 实现与本地验证完成，独立审查及托管检查另记录于 commit trailer 和 PR。八项新增聚焦回归及受影响查询磁盘／容量／生命周期／直接文本／会话查询、pi 核算／审查／对抗套件在本地共 **118/118** 通过；随后完整 Node 套件 **1,986/1,986** 通过，无跳过，使用 npm 12.0.2／Node 24.19.0。

Exact baseline source was exported to an isolated checkout. Run the unchanged `node scripts/pi-session-profile.js --suite capacity --reader-root <checkout>` against baseline then candidate, with other local suites paused: all eleven cases completed serially in fresh processes on Linux x64 / Node 24.19.0. Reports remain outside git at `/tmp/pi-query-sharing-{baseline,candidate}-capacity.json`. These are descriptive single samples; OS caches were not flushed and maximum RSS includes fixture/transient allocations. / 精确基线导出为隔离 checkout，暂停其他本地套件，以所列未修改脚本依次运行基线及候选；十一项案例均在 Linux x64／Node 24.19.0 的新进程中顺序完成。报告位于所列 git 外路径；均为描述性单样本，未清理 OS cache，最大 RSS 包含 fixture／瞬态分配。

| Workload / 负载 | Query disk bytes, before → after / 查询磁盘字节 | Cold index ms / 冷索引 | Max RSS MiB / 最大 RSS |
| --- | ---: | ---: | ---: |
| linear-1mib | 0 → 0 | 37.0 → 37.4 | 108.8 → 106.5 |
| linear-4mib | 0 → 0 | 104.6 → 108.4 | 193.1 → 204.3 |
| linear-8mib | 0 → 0 | 181.4 → 189.5 | 330.8 → 327.8 |
| shared-1000x2 | 0 → 0 | 102.9 → 107.9 | 138.3 → 139.2 |
| shared-1000x16 | 0 → 0 | 599.2 → 610.2 | 259.2 → 264.7 |
| shared-1000x32 | 70,836,419 → 33,422,808 | 1,748.0 → 1,900.4 | 381.6 → 384.7 |
| shared-100x16 | 0 → 0 | 94.1 → 83.3 | 83.0 → 93.1 |
| large-text-record-1mib | 0 → 0 | 17.4 → 17.7 | 76.4 → 77.2 |
| media-record-1mib | 0 → 0 | 9.9 → 10.5 | 70.6 → 69.9 |
| artifacts-1x1024 | 0 → 0 | 68.2 → 72.3 | 116.7 → 113.2 |
| artifacts-8x128 | 0 → 0 | 65.3 → 74.1 | 87.3 → 85.1 |

Only shared-1000x32 spills to schema 3 in this matrix. Its actual and accounted disk bytes agree: **37,413,611 bytes (52.8%) saved** with unchanged 32 branches / 32,064 projected Raw rows. First/repeated search measured 248.7/237.6 ms before and 245.1/257.9 ms after; there is no search-speed claim. Cold indexing increased 8.7% in this sample. The other cases remain schema 2; random temporary paths can change their compressed accounted bytes slightly despite unchanged packing. Complete semantic parity uses fixed-path inputs separately. / 本矩阵仅 shared-1000x32 溢出到 schema 3；真实与核算磁盘字节一致，**节省 37,413,611 字节（52.8%）**，32 个分支／32,064 条投影 Raw 不变。首次／重复搜索为修改前 248.7／237.6 ms、修改后 245.1／257.9 ms，不声称搜索加速；本样本冷索引增加 8.7%。其他案例仍为 schema 2，随机临时路径可能让压缩核算字节略有变化，打包未变；完整语义对照另使用固定路径输入。

Separate fixed-path baseline/candidate replay matched complete decoded row and projection digests across **46 branches / 64,562 rows**: 32 synthetic branches plus ten private artifacts / fourteen branches. The finite query sets compared 225 complete project-search results and 774 fully paged branch timeline/query results, including IDs, snippets, totals and ordering. Private readback checked 240 logical details, 194 exact Raw records, 226 references, one image and native statistics; original and copied source hashes were unchanged and diagnostics stayed zero. / 独立固定路径基线／候选回读在 **46 个分支／64,562 行** 的完整解码行及投影摘要上完全相同：32 个合成分支，加十份私有工件／十四个分支。有界查询集比较 225 份完整项目搜索结果及 774 份遍历全部分页的分支时间线／查询结果，包含 ID、片段、总数和顺序。私有回读检查 240 项逻辑详情、194 条精确 Raw、226 个引用、一张图片及原生统计；原始与复制来源哈希不变，诊断保持为零。

The external replay report's complete semantic hash is `532f97a328ed8106977faf3b5db506764205914db29b891c25521e8d6d5118ce` for both readers. Its synthetic fixture has different paths from the capacity probe, yielding 70,196,195 → 32,781,539 disk bytes (53.30% saved), with exact actual/accounted agreement. Private cases remain schema 2 and do not establish real-corpus disk-sharing performance. Existing writer/SDK-scripted corpus provenance is unchanged; no model calls or credentials were needed. / 外部回读报告的完整语义哈希在两版均为所列值；其合成 fixture 路径与容量探针不同，磁盘字节为 70,196,195 → 32,781,539（节省 53.30%），真实／核算精确一致。私有案例仍为 schema 2，不能据此声称真实语料磁盘共享性能。既有 writer／SDK 脚本驱动语料的来源性质不变，本次无需模型调用或凭据。
