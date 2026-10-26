# History reference navigation race / 历史引用导航竞态

Base: `7ef88a9817918a1ba797484c287be9255a4c1c19`, branch `feat/pi-native-statistics`, PR #93 targeting `feat/pi-integration`. Status: implementation and local validation complete; fresh review and new-head hosted results are recorded with the commit/PR. / 基线、分支及 PR 目标如上；状态：实施及本地验证完成，fresh 审查及新 head 的 hosted 结果随提交／PR 记录。

## Evidence and cause / 依据与原因

The user supplied the original browser failure from CI run 40057194115: `nearby cards and raw references keep their exact identities; stale reference reports its code`, at `e2e/history-evidence.test.js:253`, timed out after 10 seconds selecting `other-browser-session:logical:protocol:1`. The earlier M1 test-observation fix is independent. Ordinary focused execution and all 40 history-evidence tests pass on the current base; passing reruns alone do not close this issue. / 用户补充了原始 CI 的浏览器失败：所列用例在第 253 行等待 other-browser-session:logical:protocol:1 选中，10 秒超时。先前 M1 测试观察修正与此独立。当前基线的普通聚焦运行及全部 40 项历史证据测试均通过；仅凭重跑通过不能关闭本项。

A probe holds two successful real HTTP responses: the old Main record's Detail and the new Protocol reference resolution. Releasing the old Detail while the new resolution remains held reproduces the same missing-selection timeout on both this base and exact pre-statistics base `1398533100a964711d48b39e9851073daa4b09fb`. The URL contains the requested Protocol reference and no new user input occurs, but its resolve request is aborted and the Timeline becomes empty. The original CI did not retain this ordering trace; the probe proves a matching pre-existing product race. / 探针延迟两个真实 HTTP 成功响应：旧 Main 记录的 Detail 及新 Protocol 引用解析。在继续保持新解析响应时释放旧 Detail，会在当前基线及统计功能前的精确基线均复现同样的选中超时。URL 含目标 Protocol 引用，期间无新用户输入，但其解析请求被中止、时间线变空。原始 CI 未保留此时序 trace；探针证明存在症状匹配的既有产品竞态。

`openHistoryEvidence` replaced the old evidence before retiring the old selected Detail. Its late response could trigger a full render; passive detail convergence then found the old event missing and closed its view, cancelling the new reference operation. / openHistoryEvidence 在退役旧选中详情前替换了旧证据；迟到详情触发完整重绘，被动详情收敛发现旧事件缺失并关闭视图，误取消新的引用操作。

## Repair and acceptance / 修正与验收

Retire the old Inspector selection and its pending request synchronously before replacing evidence or awaiting the new resolution. Preserve explicit cancellation, newer user input, return focus, errors/retry, and exact session/layer/event identity. Add a real-response-gated regression with bounded waits and cleanup; preserve the original test's input, timeout and identity assertions. / 在替换证据或等待新解析前同步退役旧 Inspector 选中状态及其请求；保留显式取消、新用户输入、返回焦点、失败重试及准确会话／层／事件身份。增加真实响应 gate 回归，限定等待并清理；保留原测试的输入、超时及身份断言。

Validation records below distinguish deterministic red/green tests, full affected suites, fresh independent review and new-head hosted CI. / 下列验证记录区分确定性红绿对照、完整受影响测试集、fresh 独立审查及新 head 的 hosted CI。

## Validation / 验证

- The two committed response-gated regressions execute real successful HTTP responses and observe the held Detail transaction's actual client settlement before releasing the new resolution. The final tests fail on unchanged `1398533` at the original 10-second target-selection wait, and pass with the fix. They do not infer client settlement from response arrival, animation frames or elapsed sleep. / 两项提交中的响应 gate 回归使用真实 HTTP 成功响应，在释放新解析前观察被延迟 Detail 事务实际在客户端结束。最终测试在未修改基线于原有 10 秒目标选中等待失败，在修正后通过；不从响应抵达、动画帧或休眠推断客户端已结束处理。
- The full history-evidence suite passed **42/42** with the product fix. After refining only the new test's settlement synchronization, the original nearby/Protocol/Raw scenario and two regressions passed **3/3**. Existing return/cancel/retry, button focus, presentation changes and mobile reading cases remain. / 产品修正通过完整历史证据测试 **42/42**；仅细化新增测试的结束同步后，原附近记录／Protocol／Raw 场景及两项回归 **3/3** 通过，保留返回／取消／重试、按钮焦点、展示切换及移动端阅读覆盖。
- pi navigation and turn-lineage browser suites passed **23/23**; history navigation Node tests passed **4/4**; rebuilt assets and `build:check` passed. Local browser evidence uses system Chromium 154 via an external preload, distinct from CI's pinned Chromium. / pi 导航及 turn-lineage 浏览器测试 **23/23**、历史导航 Node 测试 **4/4**、重建资产及 build:check 均通过。本地浏览器通过外部 preload 使用系统 Chromium 154，与 CI 固定 Chromium 分开记录。
- Original scenario and both regressions now reuse the existing bounded diagnostics recorder, capturing checkpoints, request failures, screenshot and trace before fixture cleanup; successful traces are discarded. All data is synthetic and CI uses the existing navigation-failure artifact upload. / 原场景及两项回归复用现有有界诊断记录器，在 fixture 清理前捕获检查点、请求失败、截图及 trace；成功时丢弃 trace。全部为合成数据，CI 沿用现有导航失败工件上传。
- Exact reviewed base/diff, independent executed checks and new-head CI/Codex review are recorded separately in commit/PR evidence. Earlier green runs at `cf04a7c` and `7ef88a9` do not validate this repair. / 精确审查 base／diff、独立执行检查及新 head 的 CI／Codex 审查分别记录在提交／PR 依据中；早前 cf04a7c 和 7ef88a9 的绿色运行不验证本修正。
