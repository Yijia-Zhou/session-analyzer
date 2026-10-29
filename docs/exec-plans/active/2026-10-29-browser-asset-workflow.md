# Release-only browser asset commits / 仅发布时提交浏览器资产

- Status: review follow-up; awaiting current-head CI before adoption / 状态：审查修复；等待当前 head CI 后采用
- Integration baseline: merged PR #97 `78857f767a808e1d41b25aa6d64591997b06a5a9`, tree `bcb3816766bf00d9ef27964cb2e69a42afdbd9b6`. / 整合基线：PR #97 对应提交与文件树。
- Durable policy: [browser asset workflow](../../design-docs/browser-asset-workflow.md). / 长期规则见所列设计文档。
- Publication remains a separate authorized task under the [release runbook](../../design-docs/npm-release-runbook.md). / 发布仍是按发布手册另行授权的任务。

## Scope / 范围

Keep generated files tracked, omit daily PR changes, rebuild every ordinary CI lane, retain committed-asset checks for main/releases, and provide a source-preview command. Preserve installed CLI behavior and existing publication gates. / 保留生成文件跟踪，普通 PR 不提交变更，每个普通 CI job 重建，main／发布检查已提交资产，并提供源码预览命令。保留安装后 CLI 行为和现有发布门槛。

## Progress / 进度

- [x] Reconcile the reviewed UI and OpenCode changes before migration. / 迁移前整合已审 UI 与 OpenCode 改动。
- [x] Implement developer entry, CI policy/routing and bilingual guidance. / 实现开发入口、CI 策略／路由与双语指引。
- [x] Verify actual stale-source development and non-mutating release failure paths. / 验证真实的落后资产开发路径与发布非修改式失败路径。
- [x] Run affected package, CI and documentation contracts and source-start smoke. / 运行受影响的安装包、CI、文档契约与源码启动 smoke。
- [x] Independent fresh review identified CRLF handling, main-backmerge mode and historical setup documentation issues; all were corrected and sent for final recheck. / 独立 fresh 审查发现 CRLF 处理、main 回灌模式与历史版本配置文档问题；三项均已修正并交回复核。
- [x] Open separate [PR #103](https://github.com/Yijia-Zhou/session-analyzer/pull/103) to `v0.3.0-development`; the initial head passed full remote CI. / 已向开发分支建立独立 PR #103，初始 head 已通过完整远端 CI。
- [x] Address the retargeting review: explicitly subscribe CI to PR `edited` events and guard the trigger, unconditional policy evaluation and dependent-job wiring with a regression test. / 处理改目标分支审查意见：显式订阅 PR edited 事件，回归测试约束触发配置、无条件策略执行与后续 job 连线。
- [ ] Require the revised PR head's full CI before merging and adopting the policy; record its exact head and run in the PR validation record. / 修复后的 PR head 须通过完整 CI 才能合并并采用策略；在 PR 验证记录中保存精确 head 与运行链接。

## Rollout / 切换

Merge the reconciled #97 first; submit this workflow separately, without generated-file changes. Existing #100 need not block adoption: when ready, sync it once to the migrated development branch and follow the new policy. Keep main and tags unchanged until an actual release is prepared. / 先合入整合后的 #97；本流程单独提交且不携带生成文件变更。已有 #100 不阻塞采用：准备好时一次同步已迁移开发分支，遵循新规则。实际准备发布前保持 main 和 tag 不变。

## Validation evidence / 验证依据

36 focused CI/package/publication contract tests passed, as did the five-source installed-package smoke, source `dev -- --help` forwarding, asset consistency, syntax, whitespace and 70 local Markdown links. The corrected CI tests passed again (11 tests). Local Chromium downloads were unavailable; require remote browser CI before adoption. / 36 项聚焦 CI／包／发布契约测试、五来源安装包 smoke、源码 dev 参数转发、资产一致性、语法、空白与 70 个本地 Markdown 链接检查通过。修正后 CI 测试再次通过（11 项）。本地 Chromium 下载不可用；采用前须通过远端浏览器 CI。

Full [PR CI run 40836845885](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40836845885) passed for the initially reviewed head `351d0f8d4a1b826ca66e109699dc52ecb5a6f3dc`, including all three Node jobs, both package jobs, browser, scope and final `ci`. The merged #97 baseline also passed [push CI run 40836470418](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40836470418). These are historical evidence; the retargeting fix requires a new run on its new head. / 初审 head 的上述完整 PR CI 已通过，覆盖三项 Node、双平台安装包、浏览器、scope 与最终 ci；#97 合并基线的上述 push CI 也已通过。这些是历史依据；改目标分支修复需要在新 head 上重新运行。

For the retargeting follow-up, the new workflow-trigger regression failed against the original workflow and passed after adding the event types. All 12 focused asset/scope tests passed, along with independent YAML parsing, local Markdown references, JavaScript syntax and whitespace checks. No generated assets changed. / 改目标分支修复中，新增 workflow 触发回归测试在原配置下失败，添加事件类型后通过；全部 12 项资产／scope 聚焦测试，以及独立 YAML 解析、本地 Markdown 引用、JavaScript 语法和空白检查通过。没有修改生成资产。

At implementation head `91b82b3afd3fe2b5c936d5cda4c190cb6cd01bf3`, [run 40840704692](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40840704692) passed scope, all Node jobs and both package jobs. Browser attempt 1 failed the project-search expansion click; attempt 2 repeated it and exposed a pi snapshot taken before native-entry actions finished loading. Browser source, assets, E2E files and dependency lockfiles were unchanged from the earlier passing head. The follow-up makes these tests wait for the actual auto-expanded match and completed native-entry actions, preserves their original content/return/snapshot assertions and adds failure tracing. A new full CI run is required before adoption. Local headless Chromium installation again returned an invalid archive, so browser execution remains remote. / 在上述实现 head 上，该运行的 scope、全部 Node 与双平台安装包通过。浏览器首次运行在项目搜索展开点击处失败，第二次重复该问题，并暴露 pi 快照早于原生条目动作加载完成的问题；相关源码、资产、E2E 文件及依赖锁定与此前通过的 head 相同。后续修正让测试等待自动展开的匹配及完整条目动作，保留原有内容／返回／快照断言，并补充失败 trace。采用前须通过新的完整 CI。本地无界面 Chromium 下载仍返回无效压缩包，因此浏览器执行继续依赖远端。
