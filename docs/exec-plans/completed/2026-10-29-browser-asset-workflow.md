# Release-only browser asset commits / 仅发布时提交浏览器资产

- Status: completed and adopted on 2026-10-29 / 状态：已于 2026-10-29 完成并采用
- Adoption: [PR #103](https://github.com/Yijia-Zhou/session-analyzer/pull/103), merged as `98d6da1b497923fdd9d84fe6d8dc2b9be4fc5bd5`; its tree exactly matches the fully validated head `b83d31945cf6094adf83258bd9a2c8186d6fb717`. / 采用：PR #103 已按所列提交合并，文件树与完整验证的 head 完全一致。
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
- [x] Validate revised head `b83d31945cf6094adf83258bd9a2c8186d6fb717` with full [CI run 40846061270](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40846061270), then merge #103 and adopt the policy. / 修复后的所列 head 通过完整 CI，再合并 #103 并采用策略；精确 head 与运行链接已记录。

## Rollout / 切换

The reconciled #97 merged first, followed by the independent #103 without generated-file changes. The policy is now active on `v0.3.0-development`. Existing #100 did not block adoption: when ready, sync it once to the migrated development branch and follow the new policy. Main and tags remain part of separate release preparation. / 已先合入整合后的 #97，再合入不携带生成文件变更的独立 #103；策略现已在开发分支生效。已有 #100 未阻塞采用：准备好时一次同步已迁移开发分支，遵循新规则。Main 与 tag 仍按独立的发布准备流程处理。

## Validation evidence / 验证依据

Initial implementation validation passed 36 focused CI/package/publication contract tests, the five-source installed-package smoke, source `dev -- --help` forwarding, asset consistency, syntax, whitespace and 70 local Markdown links. The corrected CI tests passed again (11 tests). Local Chromium downloads were unavailable; browser execution was verified remotely before adoption as recorded below. / 初始实现的 36 项聚焦 CI／包／发布契约测试、五来源安装包 smoke、源码 dev 参数转发、资产一致性、语法、空白与 70 个本地 Markdown 链接检查通过。修正后 CI 测试再次通过（11 项）。本地 Chromium 下载不可用；采用前已完成下述远端浏览器验证。

Full [PR CI run 40836845885](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40836845885) passed for the initially reviewed head `351d0f8d4a1b826ca66e109699dc52ecb5a6f3dc`, including all three Node jobs, both package jobs, browser, scope and final `ci`. The merged #97 baseline also passed [push CI run 40836470418](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40836470418). These are historical evidence; the revised head was revalidated below. / 初审 head 的上述完整 PR CI 已通过，覆盖三项 Node、双平台安装包、浏览器、scope 与最终 ci；#97 合并基线的上述 push CI 也已通过。这些是历史依据；修复后的 head 已按下述记录重新验证。

For the retargeting follow-up, the new workflow-trigger regression failed against the original workflow and passed after adding the event types. All 12 focused asset/scope tests passed, along with independent YAML parsing, local Markdown references, JavaScript syntax and whitespace checks. No generated assets changed. / 改目标分支修复中，新增 workflow 触发回归测试在原配置下失败，添加事件类型后通过；全部 12 项资产／scope 聚焦测试，以及独立 YAML 解析、本地 Markdown 引用、JavaScript 语法和空白检查通过。没有修改生成资产。

At implementation head `91b82b3afd3fe2b5c936d5cda4c190cb6cd01bf3`, [run 40840704692](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40840704692) passed scope, all Node jobs and both package jobs. Browser attempt 1 failed the project-search expansion click; attempt 2 repeated it and exposed a pi snapshot taken before native-entry actions finished loading. Browser source, assets, E2E files and dependency lockfiles were unchanged from the earlier passing head. The subsequent work investigated test readiness and added bounded failure tracing; its search-expansion assumption was corrected from the trace below. / 在上述实现 head 上，该运行的 scope、全部 Node 与双平台安装包通过。浏览器首次运行在项目搜索展开点击处失败，第二次重复该问题，并暴露 pi 快照早于原生条目动作加载完成的问题；相关源码、资产、E2E 文件及依赖锁定与此前通过的 head 相同。后续工作检查了测试就绪条件并补充有界失败 trace；搜索展开假设依据下述 trace 得到修正。

At follow-up head `b131d67a4626d555bdabf6c37ca11d1929c7d751`, [run 40843911683](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40843911683) passed all non-browser jobs and 420/421 browser cases, including both pi gated-Back/Forward cases. Its retained trace disproved the automatic-expansion assumption: the collapsed preview already contains the active search mark, so expansion remains a manual action. It also recorded continuing viewport movement and hundreds of HTTP detail loads over synthetic prefix records. The final test fix restores the original expansion click after the existing readable-target viewport check, retains the original content/return assertions, and uses a bounded 30-second click budget (45-second case budget) only for this 480-prefix scenario. Pi tests await rendered native-entry actions before taking complete snapshots. Both scenarios retain failure diagnostics. Runtime code and the global action timeout are unchanged. / 上述后续 head 的 CI 通过全部非浏览器任务及 420/421 项浏览器用例，包括两项 pi 延迟 Back／Forward 场景。保存的 trace 否定了自动展开假设：折叠预览已有活动匹配标记，仍需手动展开；同时记录到视口持续移动和数百个合成前缀记录的 HTTP 详情加载。最终修正在现有目标可读视口检查之后恢复原来的展开点击、保留原有内容／返回断言，并仅为这个 480 条前置记录场景设置 30 秒点击预算和 45 秒用例预算；pi 测试等待原生条目动作呈现后再保存完整快照。两个场景均保留失败诊断。运行时代码与全局动作超时未变。

Final [CI run 40846061270](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40846061270), bound to `b83d31945cf6094adf83258bd9a2c8186d6fb717` and base `78857f767a808e1d41b25aa6d64591997b06a5a9`, passed scope, all three Node jobs, Linux/Windows package smoke, all 421 browser tests and final `ci`. The project-search scenario completed in 14.73 seconds; both pi gated-Back/Forward cases passed. Only after verifying this result was #103 marked ready and merged. / 最终所列 CI 绑定精确 head 与基线，scope、三项 Node、双平台安装包 smoke、全部 421 项浏览器测试与最终 ci 均通过。项目搜索场景耗时 14.73 秒，两项 pi 延迟 Back／Forward 场景通过；核实该结果后才解除 #103 的 Draft 并合并。
