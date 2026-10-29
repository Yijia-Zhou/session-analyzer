# Release-only browser asset commits / 仅发布时提交浏览器资产

- Status: implementation under review / 状态：实现待审
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
- [ ] Open a separate PR to `v0.3.0-development`; require its CI before adoption. / 向开发分支建立独立 PR，采用前须通过该 PR 的 CI。

## Rollout / 切换

Merge the reconciled #97 first; submit this workflow separately, without generated-file changes. Existing #100 need not block adoption: when ready, sync it once to the migrated development branch and follow the new policy. Keep main and tags unchanged until an actual release is prepared. / 先合入整合后的 #97；本流程单独提交且不携带生成文件变更。已有 #100 不阻塞采用：准备好时一次同步已迁移开发分支，遵循新规则。实际准备发布前保持 main 和 tag 不变。

## Validation evidence / 验证依据

36 focused CI/package/publication contract tests passed, as did the five-source installed-package smoke, source `dev -- --help` forwarding, asset consistency, syntax, whitespace and 70 local Markdown links. The corrected CI tests passed again (11 tests). Local Chromium downloads were unavailable; require remote browser CI before adoption. / 36 项聚焦 CI／包／发布契约测试、五来源安装包 smoke、源码 dev 参数转发、资产一致性、语法、空白与 70 个本地 Markdown 链接检查通过。修正后 CI 测试再次通过（11 项）。本地 Chromium 下载不可用；采用前须通过远端浏览器 CI。
