# Source onboarding reliability / 来源上手可靠性

Status: completed / 状态：已完成

## Objective / 目标

Address the external PR 23 review against `59a444f`: isolate malformed DeepSeek artifacts, expose capability and indexing failures, bound stable reads, and make all three sources directly selectable. / 处理基于 `59a444f` 的 PR 23 外部评审：隔离异常 DeepSeek 工件、展示能力与索引失败、限制稳定读取重试，并允许直接选择三个来源。

## Design / 设计

- Preserve the array return contract of adapter discovery. An optional `onDiagnostic` context callback reports source inspection failures; indexing retains its own summary. / 保持 adapter discovery 的数组返回契约；可选的 context `onDiagnostic` 回调报告来源检查失败，索引保留独立摘要。
- The additive `sourceDiagnostics` payload contains `totalCount`, per-code `counts`, at most 20 `samples` of `{code,path,message}`, and `truncatedCount`. It contains no transcript bodies. Discovery caching follows the source revision; committed index diagnostics follow the index revision. / 新增 `sourceDiagnostics` 包含 `totalCount`、按错误码分类的 `counts`、最多 20 条 `{code,path,message}` 样本及 `truncatedCount`，不含转录正文。发现缓存随来源 revision，已提交索引诊断随索引 revision。
- Both conflicting artifacts are excluded; future-format and unreadable artifacts are reported without guessing ownership. Valid siblings remain readable. Zero sessions with diagnostics is visibly different from an ordinary empty result. / 排除冲突的两个工件；对未来格式与不可读工件报告诊断，不猜测归属；有效的相邻会话仍可读。带诊断的零会话结果与普通空结果明确区分。
- Stable reads allow four attempts and check a 2-second elapsed budget between attempts. This bounds retries, not a single OS read. Exhaustion produces retryable `DEEPSEEK_SOURCE_BUSY`; cancellation and accepted-snapshot validation remain authoritative. / 稳定读取允许四次尝试，并在尝试间检查两秒耗时预算；限制的是重试，不是单次 OS 读取。耗尽预算产生可重试的 `DEEPSEEK_SOURCE_BUSY`；取消与 accepted-snapshot 校验仍具有最终约束力。
- `/api/state` returns a failed initial job with `projectSelected:false` and HTTP 200; running jobs remain HTTP 202 and genuinely unselected state remains HTTP 409. Failed refresh retains a usable previous index. CLI reports terminal indexing outcomes. / `/api/state` 以 HTTP 200、`projectSelected:false` 返回首次失败任务；运行中任务保持 HTTP 202，真正未选项目保持 HTTP 409。刷新失败仍保留可用的旧索引；CLI 报告索引终态。
- Source buttons name every supported source. Empty, clean startup switches directly; an existing returnable project or unsaved source configuration requires confirmation. Only the explicitly selected source is discovered. / 来源按钮明确列出所有受支持来源；空白且无草稿的启动状态直接切换；存在可返回项目或未保存来源配置时要求确认。仅发现明确选中的来源。

## Work and ownership / 工作与分工

- [x] Backend: artifact isolation, bounded diagnostics, discovery/index API, startup terminal state and CLI reporting. / 后端：工件隔离、有界诊断、发现／索引 API、启动终态与 CLI 报告。
- [x] Storage: bounded stable reads and cancellation/snapshot regressions. / 存储：有界稳定读取与取消／快照回归。
- [x] Browser: explicit source selection, diagnostics, startup failure recovery and browser regressions. / 浏览器：明确来源选择、诊断、启动失败恢复与浏览器回归。
- [x] Integration: review contracts, build generated assets, full Node/browser/package validation, restart local server and verify the target index. / 集成：审查契约、构建生成资源、完整 Node／浏览器／打包验证、重启本地服务并核验目标索引。
- [x] Docs: product/design contract, bilingual README runtime/onboarding, approval lifecycle scope, agent startup verification. / 文档：产品／设计契约、双语 README 运行时与上手说明、审批生命周期范围、agent 启动核验。
- [x] Measure the already tracked Detail/Raw cost using synthetic large sessions through actual APIs; record cold/warm/multiple-reference timing and memory scope without claiming a universal performance guarantee. / 通过真实 API 使用合成大会话量测已登记的 Detail／Raw 成本，记录冷／热／多引用耗时与内存证据范围，不声称普遍性能保证。

## Acceptance / 验收

Use real temporary artifacts for valid A plus conflicting/future B, injected missing Zstd for mixed/all-unreadable results, deterministic changing-file tests, API tests for prefailed startup and preserved old revisions, and browser tests for direct source selection and recovery. Existing green tests do not substitute for these scenarios. / 对有效 A 与冲突／未来格式 B 使用真实临时工件；以缺失 Zstd 注入测试混合及全不可读结果；对持续变化文件使用确定性测试；以 API 测试首次访问前失败与旧 revision 保留；以浏览器测试直接来源选择及恢复。已有绿色测试不能替代这些场景。

## Results / 结果

Completed 2026-09-08. All five review fixes are implemented; review also caught and fixed stale failed-job resurrection after switching away/back and loss of failure context on inactive-home edits. / 于 2026-09-08 完成五项评审修复；集成审查另发现并修复了切走再切回来源后复现旧失败，以及编辑 inactive-home 后丢失失败语境的问题。

- Full Node suite: 1044 passed, zero failures/skips. / 完整 Node：1044 项通过，无失败或跳过。
- Full browser suite: 214 passed, zero failures/skips; seven new onboarding scenarios cover direct selection, diagnostics, failure persistence, and successful retry. / 完整浏览器：214 项通过，无失败或跳过；七项新增上手场景覆盖直接选择、诊断、失败保留及成功重试。
- Generated asset check and installed-package smoke for Codex, Claude Code, and DeepSeek Harness passed. The first sandboxed package install hit registry EACCES; the same smoke passed with network-capable execution. / 生成资源检查及三个来源的安装包冒烟通过；首次沙箱安装遇到 registry EACCES，使用允许联网的相同检查后通过。
- Live local server at port 17890 completed indexing the intended checkout: 681 Sessions, zero source diagnostics. The root page, state payload, loaded history, visible three-source chooser, confirmation/cancel and return behavior were verified; browser console had zero errors/warnings. / 17890 本地服务完成预期 checkout 的索引：681 个会话、零来源诊断。已核验根页面、state payload、已加载历史、三个明确来源入口、确认／取消及返回行为；浏览器控制台无错误或警告。
- Reproducible synthetic HTTP measurement and a quieter 50k-record repeat are documented in `docs/design-docs/deepseek-readback-measurement.md`. Warm Detail/full Raw work remains debt 20. First Detail still took 25.71–28.08 seconds; first-materialization investigation is separately tracked in debt 22. No large-Session responsiveness acceptance is claimed. / 可复现合成 HTTP 量测及较安静的 50k 记录复测已记录；热态 Detail／全量 Raw 工作仍属于技术债 20。首次 Detail 仍需 25.71–28.08 秒，首次物化定位另记技术债 22；不声称大会话响应体验已验收。
- Source-root diagnostics are DeepSeek-owned; this change does not alter Codex/Claude root-discovery semantics. No transcript was repaired or modified. No release was made. / 来源根诊断由 DeepSeek 拥有，不改变 Codex／Claude 根发现语义；未修复或修改任何来源转录，未执行发布。

- Independent review: a fresh reviewer without conversation history found no confirmed new defects; 41 focused Node tests, generated-asset verification, and plain/Zstd profile smoke passed independently. The reviewer did not repeat the full browser suite or large performance matrix. / 独立评审：未继承对话的全新 reviewer 未发现确定性新缺陷；独立通过 41 项聚焦 Node 测试、生成资源检查及未压缩／Zstd 量测冒烟；未重复完整浏览器套件或大会话矩阵。
