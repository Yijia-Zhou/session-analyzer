# Persisted Codex history / Codex 持久化历史

Status: implementation and local validation complete. / 状态：实现与本地验证完成。

## Base and scope / 基线与范围

Implementation base: `8310ae0b6d2fe17f924e59e16576e4497e6730c4`, tree `ab2956b2b1a8fd3833283fc18c172d98a5852770`. `git fetch origin main` confirmed no intervening commits. The initial clean checkout was PR #64 head `e9e7e6d683b9b2569aaf263e59a3448beef26587`, with the same tree; work switched to local `feat/codex-persisted-history` from merged `origin/main`. Default-branch README and AGENTS were read. The initial handoff authorized local implementation only; the subsequent user instruction authorized committing and pushing this feature branch. / 实现基线为上述合并提交，已 fetch 确认 main 无后续提交。初始工作区干净，位于同树的 #64 旧分支头；已从合并后的 origin/main 建立本地实现分支。已阅读默认分支 README 与 AGENTS；初始交接仅授权本地实现，后续用户指令已授权提交并推送此功能分支。

Support only persisted realtime segments/lifecycle/promotion references, nested applied settings, clarified recorded turn context, and positional configuration controls. Keep #64 readers, async messages, attachments, external input and source-backed hydration. / 仅支持已持久化的 realtime 片段／生命周期／推广引用、嵌套应用设置、轮次上下文说明及位置配置控制；复用 #64 reader、异步消息、附件、外部输入与源文件回读。

## Authority / 权威依据

- Codex `rust-v0.155.0`: annotated tag `799f378ee7f85c775dee82d9bc45cc2df8df18fb` → commit `f0a1b8f0849d90960bc406b848f32e5a129b0457`.
- Historical settings comparison / 历史设置对比：`rust-v0.154.0`, annotated tag `36eab01061df3cde5f95ec20a526777b430091ba` → `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`.
- Pinned source inventory and semantics are recorded in [protocol coverage](../../design-docs/codex-protocol-event-coverage.md#persisted-realtime-and-configuration). / 固定源码清单与语义见协议覆盖文档。

## Implementation and validation / 实现与验证

- [x] Add synthetic fixtures before semantic changes: initial two tests failed on missing messages and positional detail. / 先添加合成 fixture；初始两项测试复现消息缺失与位置控制详情缺口。
- [x] One source normalization helper; bounded compact facts, shared extraction, Protocol detail and source-location identity. / 单一来源归一化 helper、有界紧凑事实、共享提取、Protocol 详情与源位置身份。
- [x] Conservative promotion target lookup after ownership, exact opaque IDs, later completed targets, optional cross-layer reference navigation. / ownership 后保守查找推广目标，精确 opaque ID、支持后续完成目标及跨层导航。
- [x] Plain/compressed cold/warm source-backed tests, inherited-boundary and counterexample coverage. / 普通／压缩冷暖源文件测试、继承边界及反例覆盖。
- [x] Finish browser, full Node and installed-package gates; inspect final diff. / 完成浏览器、全量 Node、安装包门槛及最终 diff 审查。

Environment: Windows PowerShell, Node `v24.18.1`, npm `12.0.2`; existing installed dependencies, no policy changes. Initial focused `node --test` over `test/*codex*.test.js`: 437 passed after repairing compact-field expectations and retaining previous turn-context preview ordering. Initial `npm test`: 1199/1204 passed; repaired pure-builder dependency injection, package allowlist and localization; hydration FIFO test independently passed (concurrent first/second I/O completion ordering). Final results follow below. / 环境为上述 PowerShell 与合规 Node/npm，使用已有依赖，不改变策略。聚焦测试修复后 437 项通过；首轮全量 1204 项中 1199 通过，已修复构建器依赖注入、包清单与本地化，回读 FIFO 用例独立复跑通过（并发前两次 I/O 完成顺序）。最终结果见下文。

Final locally executed checks / 最终本地执行核验：

| Command / 命令 | Result / 结果 |
| --- | --- |
| `$tests = @(rg --files test -g '*codex*.test.js'); node --test @tests` | 437 passed at the earlier focused checkpoint / 早期聚焦检查 437 项通过 |
| `node --test test/codex-persisted-history.test.js` | Final 9 passed, including source-backed plain/zstd cold/warm, exact Raw, ownership, fallback and search / 最终 9 项通过，覆盖普通／压缩冷暖索引、精确 Raw、归属、兜底与搜索 |
| `npm test` | Final 1205 passed, 0 failed / 最终 1205 项通过，0 失败 |
| `npm run build`; `npm run build:check` | Generated assets rebuilt and current / 生成资产已重建且一致 |
| `node --test --test-name-pattern 'persisted realtime history\|Codex external inputs\|Main presentation switches' e2e/browser.test.js` | 4 passed; both locales, Timeline/Trajectory, Main/Protocol/Raw reference navigation and #64 reading / 4 项通过；双语、双主视图、三层引用导航与 #64 阅读回归 |
| `npm run test:package` | Installed Codex plain + realtime zstd, Claude Code, DeepSeek plain/zstd all passed Timeline → Detail → Raw / 安装后的五组来源均完成三层读取 |
| `git diff --check` | Passed / 通过 |

The initial sandbox package run failed with `EACCES` during temporary installation; the escalated run used the same existing strict installation policy and passed. No new GitHub CI run was requested or reused. Phase-accounting and reader implementations were unchanged, so serial profile measurement and broad reader benchmarking were not run. Browser validation was focused, not the entire browser suite. / 初始沙箱安装包运行在临时安装时 EACCES；提升权限后沿用既有严格安装策略并通过。未请求或借用新的 GitHub CI。未改变阶段核算或 reader，因此未运行顺序 profile 量测及广泛 reader 基准。浏览器验证为聚焦范围，非整个套件。

Local acceptance server: verified old PID `33292` on `127.0.0.1:17890` targeted this checkout; restarted as PID `25980`, retaining project `G:\vibe\session-analyzer`, source `codex`, home `C:\Users\Yijia\.codex`. Initial bounded checks reported job `1` running without error (about 2549 MiB across 746 candidate files). A subsequent bounded check confirmed `succeeded`, 746 sessions and zero source diagnostics. Actual Main timeline → Chinese detail → source Raw reading passed: one loaded message, one detail section, matching Raw identity and non-empty source row. No transcript content was emitted or saved. This real-history reading is separate from the synthetic feature fixtures and package smoke. / 本地验收服务已验证并重启，保留原项目／来源根。初始有界检查 job 1 仍运行且无错误（约 2549 MiB、746 候选文件）；后续有界检查确认 succeeded、746 个会话、0 条来源诊断。实际 Main 时间线 → 中文详情 → 源 Raw 读取通过：一条已加载消息、一段详情、Raw 身份匹配且源行非空。未输出或保存转录正文。真实历史阅读验证与合成功能 fixture／安装包 smoke 分开记录。

Changed runtime files: `src/codex-persisted-history.js`, `src/codex-source.js`, `src/codex-logical.js`, `src/codex-detail.js`, `src/codex.js`, `src/shared/i18n.js`, `src/shared/logical-detail-contract.js`, `src/browser/app.js`, `src/browser/renderers.js`, generated `public/assets/app.js`, `package.json`. Tests/distribution: `test/codex-persisted-history.test.js`, `test/codex-compaction.test.js`, `test/i18n.test.js`, `test/package.test.js`, `e2e/browser.test.js`, `scripts/package-smoke.js`. Docs: this plan plus protocol coverage, logical timeline design, Indexed/Materialized lifecycle design and product spec. / 运行时、测试／分发及文档变更清单如上，不包含真实转录数据。

## Retained limits / 保留限制

No full Paginated TurnItem support, history_base loading, revert-chain reconstruction, network capture, audio playback, visualization execution, effective-settings state machine, per-step settings attribution or request-effort pin reconstruction. Duplicate realtime identities conservatively remain separate Protocol evidence, even exact repeats; no arbitrary owner is selected before inherited-history reconciliation. Promotion navigation requires a unique completed item with explicit same-thread and turn identity; missing/foreign/ambiguous history stays unresolved. / 不实现完整分页 TurnItem、history_base 加载、回退链、网络采集、音频播放、可视化执行、有效设置状态机、逐步设置归属或请求 effort pin 重建。重复 realtime 身份即使内容相同也保守保留为独立 Protocol 证据，避免在继承历史协调前任意选 owner。推广导航要求唯一 completed item 及明确同线程／轮次身份；缺失、外部归属或有歧义时保持未解析。
