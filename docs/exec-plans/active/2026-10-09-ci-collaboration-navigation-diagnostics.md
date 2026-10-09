# Collaboration navigation CI diagnostics / 协作导航 CI 诊断

Status: instrumentation implemented and locally validated; hosted failure capture and root-cause confirmation remain pending. / 状态：诊断已实现并完成本地验证；hosted 失败捕获与根因确认仍待完成。

## Scope / 范围

- Diagnose [CI 37493424048](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/37493424048) on `322707f`: Browser passed 311/313; keyboard child-session activation and mobile document scroll restoration timed out. All Node/package jobs and serial phase coverage passed. / 诊断所列提交上的 CI：Browser 311/313，键盘打开子会话与移动端文档滚动恢复超时；全部 Node／package job 与顺序阶段覆盖通过。
- Preserve the original navigation inputs, timeouts and assertions. Add failure evidence to these two tests before selecting a production or test fix. / 保留原导航输入、超时与断言；先为这两个测试补充失败证据，再选择产品或测试修复。
- Capture bounded focus/input/scroll/DOM-removal events, request lifecycle and checkpoints, plus screenshot/trace on failure. Preserve the original test error if capture fails. Discard passing traces and retain CI artifacts for seven days. Use synthetic fixtures only. / 捕获有界的焦点／输入／滚动／DOM 移除事件、请求生命周期与检查点，失败时附截图／trace。捕获失败时保留原测试错误；成功丢弃 trace，CI 工件保留七天。仅使用合成 fixture。

## Evidence and validation / 证据与验证

- The same keyboard wait failed in PR #70's first CI attempt and passed in its second attempt. The passing PR tree and current tree differ only in two execution-plan documents; browser/runtime/dependency files match. / 同一键盘等待在 PR #70 的 CI 首轮失败、第二轮通过。通过的 PR 文件树与当前文件树仅差两份执行计划文档；浏览器／运行时／依赖文件一致。
- Before instrumentation, both target tests passed ten consecutive local repetitions and a sixfold CPU-throttled run. Expanded throttled collaboration coverage passed 20/21: a different test timed out waiting for the Retry timeline button to become stable, then passed at normal speed. This does not reproduce either original failure. / 加入诊断前，两项目标测试本地连续十轮及六倍 CPU 降速均通过。扩大的降速协作覆盖 20/21：另一测试等待 Retry timeline 按钮稳定时超时，正常速度重跑通过；这不构成原始两项失败的复现。
- PASS: `node --test --test-name-pattern='collaboration|browser navigation diagnostics' e2e/browser.test.js`, 22/22 on Windows Node 24.18.1 / npm 12.0.2. The synthetic failure exercise verifies the actual Enter target, removal of its focused action, JSON/PNG/trace output, successful trace disposal and original-error preservation after page closure. After bounding each capture operation to six seconds, the diagnostic exercise passed again. / PASS：上述命令在 Windows Node 24.18.1／npm 12.0.2 上 22/22 通过。合成失败验证实际 Enter 目标、焦点入口移除、JSON／PNG／trace 输出、成功 trace 丢弃与页面关闭后保留原错误。捕获操作逐项增加六秒上限后，诊断验证再次通过。
- PASS: `node --test test/ci-scope.test.js test/package.test.js`, 23/23; the CI contract's additional artifact assertions also passed in a focused 7/7 rerun. Workflow YAML parsing and `npm run build:check` passed. Documentation references, bilingual consistency and `git diff --check` were checked. / PASS：上述 CI／package 契约测试 23/23；CI 契约新增工件断言在聚焦重跑中 7/7 通过。Workflow YAML 解析与生成资产检查通过；已核对文档引用、双语一致性及 diff 检查。
- The full Node/browser suites and hosted artifact upload were not run for this test/workflow-only change. No production code, generated assets, dependencies or transcript data changed. The original CI failures remain unconfirmed locally; successful instrumentation checks are not root-cause evidence. / 本次仅测试／workflow 变更未运行全量 Node／browser 套件及 hosted 工件上传。未变更产品代码、生成资产、依赖或转录数据。原 CI 失败仍未在本地确认；诊断验证成功不作为根因证据。

## Hosted follow-up / Hosted 后续

- After the instrumented change reaches CI, inspect a failing artifact's actual key/click target, removed focused action, departure checkpoints and return geometry. Distinguish lost input, late layout changes and capture-before-click differences using evidence. A passing run alone does not confirm the root cause. / 诊断变更进入 CI 后，核对失败工件中的实际按键／点击目标、被移除的焦点入口、离开检查点与返回几何位置。根据证据区分输入丢失、延迟布局变化及点击前采样差异；仅有通过运行不能确认根因。

## References / 引用

- [Development CI diagnostics](../../development.md#ci-execution-scope)
- [History integration evidence](../completed/2026-10-06-history-development-integration.md)
