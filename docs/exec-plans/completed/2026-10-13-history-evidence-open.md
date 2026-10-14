# Open verified historical evidence / 打开可核验历史证据

Base: `v0.3.0-development` at `9adc4956b1403e0218605b459b04ec3d75722f9f`; branch: `feat/history-evidence-open`. / 起点为该开发分支最新 head；实施分支如上。

Status: implementation and validation complete, 2026-10-13; uncommitted local feature branch. / 状态：实现与验证已完成；尚未提交的本地功能分支。

## Outcome and scope / 目标与范围

An Agent explicitly opens one verified historical event in Session Analyzer. The viewer shows the exact session/layer/event, bounded search-hit text and nearby excerpts, then offers continuous reading. Search itself never launches a browser. / Agent 显式打开一条已核验历史事件；查看页显示精确会话／层／事件、有界命中片段及附近摘录，并提供连续阅读入口。搜索本身不启动浏览器。

This increment uses event-direct landing. Arbitrary timeline windows, bidirectional loading, universal character mapping, remote-browser control and multi-evidence comparison are separate future work. / 本轮采用事件直达；任意时间线窗口、双向加载、通用字符映射、远端浏览器控制和多证据对照另行规划。

## Contract / 契约

- `history open --endpoint <original-service> --ref <reference> [--context <contextRef>] [--no-browser]` accepts exactly one event reference. Compact handles require their original context; ranges must first be read to select an event. / 命令仅接受单事件引用；短句柄要求原 context，范围引用先读取并选择事件。
- The history instance lazily owns one loopback viewer using its original fixed index; the viewer borrows query storage and cannot switch source/root/project or reindex. Close viewer requests before disposing history resources. / 检索实例按需持有一个使用原固定索引的回环查看服务；查看服务借用查询存储，不能切换来源／根／项目或重建索引，关闭请求后才释放检索资源。
- Durable references live in URL fragments; page refresh revalidates source evidence. Report target verification, viewer readiness and browser invocation separately; browser launch failure preserves the usable URL. / 持久引用放在 URL fragment，刷新重新核验；分别报告目标核验、入口就绪和浏览器调用，启动浏览器失败保留可用 URL。
- Landing is temporary Timeline presentation with readable content and exact identity. Search-projection excerpts have explicit representation/omission labels. Continuous reading retains the target during prefix loading, provides progress/cancel/retry and never substitutes a neighboring event. Manual navigation invalidates old requests. / 落地临时采用 Timeline，内容可读且身份准确；搜索投影摘录明确标识表示与省略。连续阅读加载前缀时保留目标，提供进度／取消／重试，不以邻近事件替代；手动导航使旧请求失效。

## Implementation / 实施

- [x] Central reference resolution, fixed snapshot viewer, resource ownership and HTTP boundary.
- [x] Browser startup/hash navigation, readable target, excerpts and guarded continuous reading.
- [x] CLI open/no-browser, safe platform opener, capabilities, installed-package workflow and bundled skill.
- [x] Bilingual specs/design/usage updated; generated assets rebuilt.
- [x] Focused tests, browser acceptance, installed-package smoke and final regression review.

上述步骤依次覆盖统一解析与资源生命周期、浏览器定位与续读、CLI 与安装包闭环、双语文档及生成资产、验证与回归审查。

## Validation / 验证

Use minimized synthetic Codex/Claude/DeepSeek fixtures. Verify cold viewer startup; concurrent reuse; far-tail event without downloading the prefix; folded/Protocol/Raw content; long-output hit; ordinary Web isolation; navigation races and cancellation; append/restart/rewrite/delete semantics; exact-target continuation; refresh/reopen; failed opener with usable URL. Run affected Node tests, browser scenarios, generated asset check and package smoke. Broaden Node coverage for shared server/index ownership changes. / 使用最小化合成三来源 fixture，覆盖冷启动、并发复用、远端事件无需下载前缀、折叠及各层、长输出命中、普通 Web 隔离、导航竞态与取消、来源生命周期、准确续读、刷新重复打开及浏览器失败保留 URL。执行相关 Node／浏览器／生成资产／安装包检查；共享服务及索引所有权变更补充完整 Node 覆盖。

## Evidence and decisions / 依据与决定

- 2026-10-13: fetched origin and confirmed latest head; clean worktree; created feature branch. No scope objection to the proposed first increment. / 已 fetch 并确认最新 head，工作区干净，已建立功能分支；同意建议的首版范围。
- Astra review identified existing Web shutdown disposal and unguarded prefix navigation as required adaptations. Parent implements CLI/docs/package integration; Astra workers implement backend and browser independently. / Astra 审查确认需适配 Web 关闭释放与前缀加载竞态；主代理负责 CLI／文档／包集成，Astra 分别负责服务与浏览器。
- Independent review repairs include canonical `#ref` agreement, hosted-chat link navigation, return-link coherence, nested cancellation, referenced-session Main navigation and evidence-preserving retry. Verified-session fallback remains distinct from event success. / 独立审查修复包括统一 fragment、托管聊天链接导航、返回链接一致性、嵌套取消、返回原会话主时间线和保留证据的重试；已核验会话回退始终独立于事件成功。
- Mobile visual inspection led to an explicit projection `hitLine` and initial excerpt-local positioning, with saved manual scroll preserved. Synthetic screenshots are under ignored `output/history-open-validation/`. / 移动端目视检查促成明确投影命中行与首次摘录内定位，并保留后续手动滚动；合成截图位于忽略的 output 目录。
- Full Node validation passed 1688/1688. First run exposed one new untranslated display term (fixed) and an existing overstrict concurrent-I/O assertion; the latter now permits either callback order for the two admitted slots while retaining FIFO queue/cancellation assertions. / 完整 Node 验证 1688 项全部通过。首轮暴露一处新文案未翻译（已修复）及既有并发 I/O 断言过严；后者允许两个已准入槽位回调互换，保留 FIFO 排队与取消断言。
- Final focused history browser validation passed 7/7; the final navigation/i18n/browser run passed 24/24. Three-source installed-package smoke passed again after the last bundle rebuild, including installed CLI open and viewer resolution. Generated assets pass build:check. / 最终聚焦浏览器场景 7 项全通过；最终导航／i18n／浏览器运行 24 项全部通过。最后一次 bundle 重建后的三来源安装包复验通过，含已安装 CLI open 及查看页解析；生成资产一致性检查通过。
- Full browser run: 246/320 passed initially; 73 fixtures failed to write with ENOSPC while a separate large local index consumed the system temporary volume, and one collaboration keyboard test hit the timing-sensitive focus issue recorded in the [existing diagnostics plan](../active/2026-10-09-ci-collaboration-navigation-diagnostics.md). After the failed index released storage, all 74 failed tests passed a focused rerun. The seventh final history scenario adds nested-reopen cancellation coverage. These results do not claim that the inherited intermittent focus issue is fixed. / 完整浏览器首轮 246/320 通过；独立的大型本地索引耗尽系统临时卷时，73 个 fixture 因 ENOSPC 写入失败，另一个协作键盘测试命中原诊断计划记录的时序敏感焦点问题。失败索引释放空间后，全部 74 个失败项复测通过。最终第七个历史场景补充嵌套重新打开的取消覆盖；不据此声称既有间歇性焦点问题已修复。
- Local acceptance server was restarted with the same repository/Codex root. The first real-corpus index failed explicitly with PROJECT_QUERY_STORAGE_RESOURCE_EXHAUSTED (ENOSPC). A new server uses process-local TEMP/TMP under ignored `output/history-open-runtime-temp/` on the roomier G volume; system environment and transcripts are unchanged. At the bounded startup check it was still indexing, so real-corpus UI reading is not claimed. Synthetic event reading and installed-package reading are verified separately. / 本地验收服务按原项目与 Codex 根重启；首次真实语料索引明确因存储空间不足失败。新服务仅在本进程将临时目录置于 G 盘忽略的 output 目录，不修改系统环境或转录。有界启动检查时仍在索引，不声称已核验真实语料 UI 阅读；合成事件阅读及安装包阅读已分别验证。

## Next milestone / 下一里程碑

True neighborhood landing requires an independent design and implementation for nonzero window starts, bidirectional pagination, prepend viewport preservation and search/Trajectory state reconciliation. This increment deliberately retains the contiguous-prefix model; no such window work is marked complete here. / 真实邻域直达需要独立设计并实现非零窗口起点、双向分页、前插时保持视口，以及搜索／Trajectory 状态协调。本轮保留连续前缀模型，不将窗口改造标记完成。

References: [history spec](../../product-specs/history-retrieval.md), [history design](../../design-docs/history-retrieval.md), [Web spec](../../product-specs/session-transcript-analyzer.md), [development validation](../../development.md#validation-scope). / 参见所列契约、设计与验证指引。
