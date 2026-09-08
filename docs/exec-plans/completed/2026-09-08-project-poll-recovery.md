# Project status polling recovery / 项目状态轮询恢复

Status: completed / 状态：已完成

## Objective / 目标

Fix the existing browser polling interruption identified in PR 40 acceptance: a transient status-query failure must not strand initial project loading or create another indexing job. / 修复 PR 40 验收发现的存量浏览器轮询中断：临时状态查询失败不得使首次项目加载失去后续推进，也不得创建另一个索引任务。

## Design / 设计

- Keep the original job and query it with GET. Retry network failures and HTTP 408/429/5xx after 500, 1000, and 2000 ms; a successful valid status read resets consecutive failure accounting. / 保留原任务并通过 GET 查询；网络失败及 HTTP 408/429/5xx 按 500、1000、2000 ms 重试；成功读取有效状态后重置连续失败计数。
- Exhaustion or non-transient query/protocol errors pause automatic observation with a localized explanation and an explicit Continue checking status action. This action resets the budget and queries the same job, unlike the existing retry-index action for a confirmed failed job. / 预算耗尽或非临时查询／协议错误暂停自动观察，显示本地化说明和“继续检查状态”入口；此入口重置预算并查询原任务，与确认任务失败后的重新索引入口区分。
- Initial queries from startup and selection use the same recovery path. Task creation failures and later UI application failures remain separate from status-query recovery. / 启动与选择后的首次查询采用同一恢复路径；任务创建失败、后续 UI 应用失败与状态查询恢复分别处理。
- Observation ownership guards timers and every asynchronous result. Cancelling, abandoning, completing, or replacing a job invalidates old results. A failed DELETE resumes GET observation without automatically repeating DELETE. / 观察所有权保护计时器及每个异步结果；取消、放弃、完成或替换任务使旧结果失效；DELETE 失败后恢复 GET 观察，不自动重复 DELETE。
- Preserve existing source-switch restrictions while indexing. This does not optimize materialization or alter the server job lifecycle. / 保留索引期间现有来源切换限制；本项不优化物化，也不改变服务器任务生命周期。

## Ownership and acceptance / 分工与验收

- Implementation agent: browser state, localized controls, generated assets and browser regressions. / 实现 agent：浏览器状态、本地化控件、生成资源及浏览器回归。
- Parent: design, bilingual product/design documentation, integration review, validation and local service acceptance. / 主 agent：设计、双语产品／设计文档、集成审查、核验及本地服务验收。
- Browser regressions: running → transient failure → succeeded with exactly one POST; exhaustion → manual GET recovery; first-query failure; non-transient/malformed response; failed cancellation; abandoned or cancelled late response. / 浏览器回归：运行→临时失败→成功且仅一次 POST；耗尽→手动 GET 恢复；首次查询失败；非临时／异常响应；取消失败；放弃或取消后的迟到响应。
- Run relevant existing project selection, source-switch, startup recovery and localization/build checks; record actual results before archiving. / 执行相关已有项目选择、来源切换、启动恢复及本地化／构建检查；归档前记录实际结果。

## Review and evidence / 审查与证据

- A fresh independent reviewer found missing HTTP status preservation for non-JSON and JSON-null error bodies. Both were fixed and covered by browser regressions; the final review reported no remaining findings. The reviewer inspected source/tests and did not independently rerun the suites. / 全新独立 reviewer 发现非 JSON 及 JSON-null 错误正文会丢失 HTTP 状态；两项均已修复并补充浏览器回归；最终复核无剩余问题。Reviewer 审查源码／测试，未独立重复运行套件。
- Fourteen new browser cases passed, including startup adoption, initial/scheduled failure, retry exhaustion, manual continuation, consecutive-budget reset, malformed/unknown/wrong-job responses, cancellation failure, DELETE 404 with object/null bodies, and delayed status/fallback success after cancellation. / 十四项新增浏览器场景通过，覆盖启动接管、首次／定时失败、预算耗尽、手动继续、连续失败预算重置、异常／未知／错误 job 响应、取消失败、对象／null 正文的 DELETE 404，以及取消后的迟到状态／fallback 成功响应。
- Full Node suite: 1044 passed, zero failures/skips. Generated assets and diff whitespace checks passed. / 完整 Node 套件：1044 项通过，无失败或跳过；生成资源及 diff 空白检查通过。
- Full browser suite: 228 passed, zero failures/skips, including the fourteen new polling cases (322.9 seconds). / 完整浏览器套件：228 项通过，无失败或跳过，包含十四项新增轮询场景（322.9 秒）。
- Manual Chromium acceptance used browser-only route injection against the existing local service: four failed status GETs produced a Chinese paused notice; the fifth GET after Continue entered the existing project, with zero POSTs and the notice cleared. Error markup appeared as literal text. The injected HTTP failures generated expected browser resource errors. Routes were removed afterwards. / 手动 Chromium 验收在现有本地服务上仅通过浏览器路由注入：四次失败 GET 后出现中文暂停说明；点击继续后的第五次 GET 进入已有项目，零 POST 且说明清除；错误标记按字面文本显示。注入的 HTTP 失败产生预期浏览器资源错误；验收后已移除路由。
- Local service remains available on port 17890 with the intended repository and 681 indexed Sessions. Static assets are read on each request with no-store, so a browser refresh applies this browser-only change without restarting/reindexing. / 本地 17890 服务保持可用，目标仓库已有 681 个索引 Session；静态资源逐请求读取并使用 no-store，因此本次仅浏览器变更通过刷新生效，无需重启／重新索引。
- No server job lifecycle or performance changes; first-materialization and Detail/Raw performance debt remain separate. / 未改变服务器任务生命周期或性能；首次物化及 Detail／Raw 性能债务继续独立跟踪。
