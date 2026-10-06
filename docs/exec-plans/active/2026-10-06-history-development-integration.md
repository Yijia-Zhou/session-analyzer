# History integration into 0.3.0 development / History 整合进 0.3.0 开发线

Status: local implementation, review and validation complete; remote push, CI and merge pending. / 状态：本地实现、审阅与验证完成；远端推送、CI 与合并待完成。

## Scope / 范围

- Repair the development Windows release-guard test's npm identity, preserving npm 12.0.2, anonymous empty configuration, offline dry-run, exactly-once lifecycle and exit codes 0/42. / 修复开发线 Windows 发布 guard 测试的 npm 身份，保留 npm 12.0.2、匿名空配置、离线 dry-run、生命周期恰好一次及退出码 0／42。
- Integrate development `f577cf4` (parent `8a67e52`) into history `5e093dc`; retain v0.2.1 consumer documentation and history's development-only interface. / 将 development `f577cf4`（父提交 `8a67e52`）整合进 history `5e093dc`，保留 v0.2.1 消费端文档与 history 仅开发阶段的接口说明。
- Adapt matching, NOT terms, Raw hints, matched terms and bounded excerpts to disk text without joining full values. Preserve original UTF-16 offsets, Unicode normalization, line coordinates and pagination. Align the two native-command test expectations with current classification/details. / 匹配、排除词、Raw 提示、命中词及有界摘录适配磁盘文本，不拼接完整值；保持原始 UTF-16 偏移、Unicode 规范化、行坐标与分页。两条原生命令测试预期对齐当前分类／详情。
- No release, semantic retrieval expansion or new evaluation campaign. / 不发布版本，不扩展语义检索或新增评估轮次。

## Evidence / 证据

- Development baseline: Windows Node 24.18.1 / npm 12.0.2, direct guard test passed and `npm test` passed 1586/1586. / 开发基线：Windows Node 24.18.1／npm 12.0.2，直接 guard 测试通过，`npm test` 1586/1586 通过。
- Original history-service tests passed 26/26 after integration. New helper tests cover Unicode, split surrogate pairs, long whitespace/ignored-character runs, Raw hints and bounded CRLF excerpts. The real-index regression proves disk storage and cross-block text with a synthetic >4 MiB record, then verifies three-session pagination, grouped search, no `[object Object]` false hit, original coordinates/readback and all artifact policies. / 整合后原有 history-service 测试 26/26 通过。新增 helper 测试覆盖 Unicode、分割代理对、长空白／可忽略字符序列、Raw 提示及有界 CRLF 摘录。真实索引回归用超过 4 MiB 的合成记录证明磁盘存储与跨块文本，再核验三会话分页、分组搜索、无 `[object Object]` 伪命中、原始坐标／读取及全部工件策略。
- Final full Node suite: 1673/1673 passed. The initial run's single failure was the approved package-file list; adding the new runtime module fixed it. Focused text/service tests passed 31/31, including a long-line CRLF crop correction found during review. / 最终全量 Node 套件：1673/1673 通过。首轮唯一失败是安装包准入文件清单；补入新增运行时模块后已修复。文本／服务聚焦测试 31/31 通过，包括审阅发现的长行 CRLF 裁剪修正。
- npm identity adversarial check: prepend a failing `npm.cmd` to PATH while supplying the pinned absolute `npm_execpath`; the complete dry-run guard test still passed. / npm 身份对抗核验：在 PATH 首位放置必定失败的 `npm.cmd`，同时提供固定版本绝对 `npm_execpath`；完整 dry-run guard 测试仍通过。
- Generated assets are current; 21 changed-document local link targets and `git diff --check` passed. Installed-package smoke passed for Codex, Claude Code and DeepSeek viewer/history paths. Its first attempt encountered sandbox registry `EACCES`; the network-enabled retry passed without publication. / 生成资产一致；21 个变更文档本地链接目标及 `git diff --check` 通过。安装包 smoke 的 Codex、Claude Code、DeepSeek viewer／history 路径通过。首次尝试受沙箱 registry `EACCES` 阻塞；网络可用环境重跑通过，未发布 package。
- Final Windows browser suite: 313/313 passed. Package smoke was also rerun after the final CRLF repair and passed. No generated-asset, dependency, real-transcript, binary or archive additions. / 最终 Windows browser 套件：313/313 通过。最终 CRLF 修复后也重跑安装包 smoke，全部通过。未新增生成资产变更、依赖、真实转录、二进制或归档。

## Remaining gates / 剩余门槛

1. Obtain explicit approval for pushing the concrete commits to `git@github.com:Yijia-Zhou/session-analyzer.git`; automatic approval review rejected the first development push because it lacked explicit payload/destination authorization. / 获取向所列远端推送具体提交的明确授权；自动审批因缺少具体载荷／目标授权而拒绝首次 development 推送。
2. Push development and obtain hosted Windows baseline CI; push history, retarget PR #70 to `v0.3.0-development`, and obtain CI for the actual integrated head including browser/package jobs. / 推送 development 并取得 hosted Windows 基线 CI；推送 history，将 PR #70 改目标为 `v0.3.0-development`，取得实际整合 head 的 CI，含 browser／package job。
3. Merge only after the required checks succeed, sync the development checkout, restart the user's local server if active, and archive this plan when complete. / 必需检查通过后才合并，同步开发 checkout，如用户本地服务正在运行则重启，实际完成后归档本计划。
