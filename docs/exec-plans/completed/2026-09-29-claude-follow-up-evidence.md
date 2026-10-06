# Claude follow-up evidence / Claude 后续依据采集

## Scope / 范围

Collect the three outstanding cases from the [2.1.283 review](../../design-docs/claude-2.1.283-compatibility.md): real-client local MCP background lifecycle, auto-mode hand-back and Monitor, and fork parent evidence. Use disposable projects, the existing configured provider, bounded runs and minimized synthetic fixtures. Do not fabricate transcript evidence, change accounts, or publish a release. / 补采 [2.1.283 审查](../../design-docs/claude-2.1.283-compatibility.md)的三项缺口：真实客户端调用本地 MCP 的后台生命周期、自动模式回传与 Monitor，以及分叉父级依据。使用临时项目、现有提供方、有界执行和最小合成 fixture；不伪造转录依据、不切换账号、不发布版本。

## Steps / 步骤

- [x] Verify client and existing sampling tools; establish isolated reproducible probes. / 核验客户端及已有采集工具，建立隔离可复现探针。
- [x] Capture MCP success/failure/progress and inspect actual persisted ownership and terminal records. SDK progress was not persisted in project JSONL. / 采集 MCP 成功／失败／进度，检查实际持久化归属和终态；SDK 进度未持久化到项目 JSONL。
- [x] Probe exposed auto-mode and Monitor capabilities; record concrete availability limits. / 探测自动模式与 Monitor，记录具体可用性限制。
- [x] Generate CLI sibling/continued forks and probe interactive fork. The client refused `/fork` because launch restrictions would not carry into the copy; no safeguards were removed and interactive storage remains uncollected. / 生成 CLI 兄弟／续接分叉并探测交互式分叉；客户端因副本无法继承启动限制而拒绝 `/fork`，没有移除防护，交互式存储仍未采到。
- [x] Implement only evidence-backed changes with synthetic regressions; update bilingual decisions and debt. / 仅实现有依据的变更及合成回归，同步双语决策与技术债。
- [x] Run scoped validation, inspect the final diff and report evidence and remaining limits. / 执行范围匹配的验证，检查最终 diff，报告依据和剩余限制。

## Baseline / 基线

Started with a clean worktree on `claude/latest-compatibility-20260927`; installed Claude Code remains `2.1.283`. Existing real samples stay outside Git. This follow-up does not assume that every announced feature is exposed by the configured third-party model. / 从 `claude/latest-compatibility-20260927` 的干净工作树开始，客户端仍为 `2.1.283`；已有真实样本保留在 Git 之外。本次不假定所配置第三方模型可使用每项已发布功能。

## Outcome and validation / 结果与验证

- Implemented exact MCP background and Monitor launch/terminal lifecycles without changing event kinds or shared DTO contracts. A launch no longer implies success; final output and all accepted Raw References stay on the owning operation. / 实现精确 MCP 后台与 Monitor 启动／终态生命周期，不改变事件 kind 或共享 DTO 契约；启动不再意味着成功，最后输出及全部接纳原始引用保留在所属操作上。
- Auto-mode hand-back ownership already worked; protected it with a regression. Added rewritten-ID sibling/continued/missing/conflicting-parent regressions without guessing a new fork rule. / 自动模式回传归属原已正确，添加回归保护；增加改写 ID 的兄弟／续接／父级缺失／副本冲突回归，不猜测新分叉规则。
- Final combined Node validation: **160 passed** across all Claude files plus source-adapter contract/conformance and canonical contracts, including append/reindex and source-backed materialization. Earlier 79/98/69-test runs overlap with this total. / 最终组合 Node 验证：全部 Claude 测试、来源 adapter 契约／一致性及 canonical 契约共 **160 项通过**，包含追加／重建索引和来源驱动物化；此前 79／98／69 项运行与本总数重叠。
- Two new bilingual browser regressions passed. The initial browser run could not find the default browser cache; rerunning with the existing temporary browser installation passed, without installing dependencies. Browser assets rebuilt and `npm run build:check` passed with Node `24.21.0` / npm `12.0.2`; `git diff --check` and local doc-reference checks passed. / 两项新增双语浏览器回归通过。首次运行找不到默认 browser cache，指定已有临时浏览器安装后通过，未安装依赖。以 Node `24.21.0`／npm `12.0.2` 重建浏览器资产并通过一致性检查，diff 格式及本地文档引用检查通过。
- Final local server: `http://127.0.0.1:17890`, source `claude-code`, new disposable sampling project, existing Claude home. Index succeeded with **12 Sessions, 283 Raw Records, 268 Logical Events**, 0 observed source diagnostics. Browser read MCP failure, Monitor success/failure, their Raw References and a project-search hit; no page errors. / 最终本地服务地址如上，来源为 `claude-code`，目标为新临时采样项目及既有 Claude home；索引成功，**12 个会话、283 条原始记录、268 个逻辑事件**，未观察到来源诊断。浏览器实际阅读 MCP 失败、Monitor 成功／失败、对应原始引用及项目搜索命中，无页面错误。
- Full cross-source Node/browser suites and release gates were not run. Initial collection and repair were left uncommitted for review; after the review repair, the user explicitly authorized commit and push of the verified increment to the existing independent branch. No main-branch merge or package publication is in scope. / 未运行全部跨来源 Node／浏览器套件和发布门禁。初次采集及修复先保留未提交状态供审查；审查修复后，用户明确授权将核验后的增量提交并推送至既有独立分支，不包含合并主线或发布包。

This bounded collection and justified implementation is complete; remaining evidence limits are explicitly retained in the [review](../../design-docs/claude-2.1.283-compatibility.md) and [debt tracker](../tech-debt-tracker.md), especially the restricted interactive fork, unknown stored hand-back call and non-authoritative Monitor deadline text. / 本次有界采集及有依据的实现已完成；剩余依据限制明确保留在[审查](../../design-docs/claude-2.1.283-compatibility.md)及[技术债](../tech-debt-tracker.md)，尤其是受限交互式分叉、未知持久化独立回传调用及不具权威性的 Monitor 截止文本。

## Review repair / 审查修复

Confirmed and repaired P2: Monitor progress containing literal `<status>` or `<tool-use-id>` inside `<event>` was mistaken for malformed terminal evidence and suppressed later valid completion. Terminal-candidate detection now walks outer fields, skipping opaque field contents; genuine malformed outer terminal fields and duplicate/conflicting terminal sets still fail closed. A new regression failed before the repair and passed afterwards, covering both success and failure, queue/user progress mirrors, nested/unclosed literal output tags, retained Protocol visibility and Raw ownership. / 已确认并修复 P2：Monitor 进度 `<event>` 中的字面 `<status>` 或 `<tool-use-id>` 被误判为畸形终态依据，抑制后续有效完成。候选检测现遍历外层字段、跳过不透明字段内容；真正畸形的外层终态字段和重复／冲突终态集合仍 fail closed。新增回归在修复前失败、修复后通过，覆盖成功及失败、queue/user 进度镜像、嵌套／不闭合的输出字面标签、Protocol 可见性及 Raw 归属。

Post-review validation: **162 Node tests passed**, including all Claude and shared contract/conformance tests; **2 bilingual browser tests passed** with XML-like progress before the real terminal. Generated-asset and diff checks passed. This is a parser-only correction with no additional shared or product contract change; no full cross-source/browser or release gates were run. / 审查后验证：全部 Claude 及共享契约／一致性共 **162 项 Node 测试通过**；加入真实终态前的 XML 式进度后，**2 项双语浏览器测试通过**。生成资产及 diff 检查通过。本次仅修正 parser，不另改共享或产品契约；未执行全部跨来源／浏览器或发布门禁。
