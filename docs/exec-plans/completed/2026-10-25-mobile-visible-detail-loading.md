# Mobile visible Detail loading / 移动端可见详情加载

Base: `0d4b79a9a91bbbb697a49d03e54f3f7351da0336` after PR #93, branch `fix/mobile-visible-detail-loading`, target `feat/pi-integration`. Status: implementation and local validation complete; exact review and hosted evidence are recorded with the commit/PR. / 基线为 PR #93 后的集成分支，功能分支及目标如上；状态：实施及本地验证完成，精确审查及 hosted 依据随提交／PR 记录。

## User-visible problem / 用户可见问题

A failed pi command is automatically expanded, but remains on the structured-detail loading placeholder after entering the mobile viewport. Collapsing and reopening loads the saved output. The private 390×844 Chinese review reproduced this on exact baseline `1398533`; the issue is in shared reading, not native statistics. / 失败的 pi 命令已自动展开，进入移动端视口后仍停在结构化详情加载提示；收起再展开才加载保存的输出。私有中文 390×844 验收已在精确基线复现，本问题属于共享阅读链路。

## Repair boundary / 修正边界

Observe actual document scrolling as well as desktop pane scrolling and schedule the existing visible-detail pass. Preserve viewport clipping, candidate-first geometry, request ownership/cancellation and bounded scheduling. Hidden mobile reading panes and offscreen cards must not cause eager hydration; passive/programmatic scrolling must not acquire user pagination intent. / 在桌面面板滚动之外观测实际文档滚动，调度现有可见详情扫描；保留视口裁剪、先筛候选再读几何、请求归属／取消及有界调度。隐藏移动阅读面板及屏外卡片不得触发提前加载；被动／程序滚动不得获得用户翻页意图。

## Acceptance / 验收

- Synthetic red/green tests for offscreen autoexpanded commands scrolling into view, source-independent scheduling, visible Code Mode, hidden panes and pagination isolation. / 合成红绿测试覆盖自动展开命令从屏外滚入、来源无关调度、可见 Code Mode、隐藏面板及翻页隔离。
- Actual private pi app reading at desktop/mobile sizes and English/Chinese locales, without the reopen workaround; retain source hashes and exact expected output. Keep transcripts/screenshots outside git. / 桌面／移动尺寸及英中语言实页阅读私有 pi 语料，直接加载而无需重新展开；保留源文件 hash 及预期输出，转录与截图留在 git 外。
- Rebuild/check generated assets, run affected suites, get fresh independent review of the exact diff before commit, and verify new-head CI/Codex review. / 重建并校验生成资产、运行受影响测试、提交前对精确 diff 做 fresh 独立审查，再核验新 head 的 CI／Codex 审查。

Shared query-text storage and subsequent capacity/real-corpus validation are the next separate increment. / 共享查询文本存储及对应容量／真实语料验证作为下一独立增量。

## Results / 结果

- A passive window scroll listener is gated to mobile width and active Events view, reusing `queueVisibleDetailLoad()`. Mobile ordinary-body settlement also preserves a visible surviving Timeline focus node's current viewport offset across late hydration. Desktop pane scrolling and pagination intent are unchanged. / 增加受移动宽度及事件界面激活条件约束的 passive window scroll 监听，复用现有调度；移动端普通正文更新还在迟到加载时保留当前可见、仍存续的时间线焦点节点视口偏移。桌面面板滚动及翻页意图保持原状。
- Corrected synthetic regression fails on original source at the missing Detail-request wait; the two pi locale cases fail on original generated assets while their autoexpanded cards are visibly on screen. All pass after rebuilding the fix. / 修正后的合成回归在旧源码等待 Detail 请求处失败；两项 pi 语言用例在旧生成资产上卡片已进入视口却未加载时失败，修正重建后均通过。
- Shared detail scheduling/ownership suite **28/28**, final strengthened mobile case **1/1**, pi native tools **6/6**, Claude/DeepSeek reading plus mobile collaboration return **8/8**, and history-evidence **42/42** pass. Geometry, request reuse, one presentation settlement, stale/cancelled ownership, hidden panes and no unintended page append are covered. / 共享详情调度／归属 **28/28**、最终加强的移动用例 **1/1**、pi 原生工具 **6/6**、Claude／DeepSeek 阅读及移动协作返回 **8/8**、历史证据 **42/42** 通过；覆盖几何、请求复用、一次呈现结束、过期／取消归属、隐藏面板及无意外追加分页。
- Actual source pi, project and agent roots are the unchanged private workflow corpus; indexing reports **7 branches / 0 diagnostics**. Chinese **390×844** baseline has a visible expanded failed command with **0** Detail requests and a loading placeholder; candidate makes **1** request and displays saved code/stdout without reopening. English **1440×1000** reads correctly with one request in both stages. Source SHA256 maps agree, document width fits, and both pages have no errors. Screenshot was visually inspected; private report is outside git under `mobile-visible-detail-review-2026-10-25`. / 对原私有工作流语料按准确 pi 来源、项目及 agent 根建索引，报告 **7 分支／0 诊断**。中文移动端基线卡片可见且展开，但请求为 **0** 并停在加载提示；修正后发出 **1** 次请求并直接显示保存的代码／stdout。英文桌面两阶段均以一次请求正常阅读。源文件 SHA256 相同、文档宽度适配、两页均无错误；截图完成目视检查，私有报告留在 git 外。
- Build/build-check, syntax and whitespace checks pass. Local browser uses system Chromium 154 via external preload; final new-head hosted CI is separate evidence. No provider/model calls or credential access. / 构建／一致性、语法及空白检查通过；本地浏览器通过外部 preload 使用系统 Chromium 154，新 head hosted CI 单独记录。本批不调用模型／provider、不访问凭据。

## Full-suite correction / 完整套件修正

Initial commit `4abf0cd` passed hosted Node/package jobs and GitHub Codex review, but Browser CI failed. Its log-storage endpoints returned proxy 403 and no diagnostic artifact was produced, so the hosted failure could not be attributed directly. A full local run passed 404/409, including all three new regressions. Four failures reproduce in baseline checks: the Chromium 154 diagnostic/data-URL and two layout differences, plus desktop search-scroll-guard pagination timeout. / 初始提交通过 hosted Node／package 和 GitHub Codex 审查，但 Browser CI 失败；日志存储端点被代理以 403 阻止，且没有诊断工件，因此不能直接归因该托管失败。本地完整运行 404/409 通过，含全部三项新增回归。四项失败在基线检查复现：Chromium 154 的诊断／data URL、两项布局差异，以及桌面搜索滚动保护期间分页超时。

The composed collaboration-return test established a real differential: exact `0d4b79a` passes, while `4abf0cd` consistently shifts the mobile originating action about 20 pixels. Diagnostics show correct initial restoration, followed by hydration of an unsaved preceding user card; its shorter body moves the action while settlement restores absolute document scroll. Preserve current visible focus geometry during mobile ordinary-body settlement and gate the late response after return focus in the regression. Keep the original 3-pixel assertion and request/DOM ownership contract. Corrective validation and exact review are recorded separately below and with the next commit/PR. / 组合协作返回用例证明真实差异：精确基线通过，初始提交稳定让移动端原操作偏移约 20 像素。诊断显示先正确恢复位置，再加载一张尚未保存详情的前置用户卡片；正文缩短使操作移动，而更新逻辑恢复绝对文档滚动量。修正在移动端普通正文更新时保留当前可见焦点几何，回归在返回焦点之后才释放迟到响应；保留原有 3 像素断言及请求／DOM 所有权契约。修正验证与精确审查另记录于下文及后续提交／PR。

The gated regression is red on `4abf0cd` assets and green after repair. Corrective checks passed **49/49** detail/collaboration cases, then **7/7** for the strengthened outside-Timeline absolute-scroll check and six pi native-tool cases, followed by **42/42** history-evidence cases; syntax, generated-asset and whitespace checks passed. / 门控回归在初始提交资产上失败、修正后通过。修正检查包括 **49/49** 项详情／协作用例，以及随后 **7/7** 项加强的时间线外焦点绝对滚动检查与六项 pi 原生工具用例，再通过 **42/42** 项历史证据检查；语法、生成资产及空白检查均通过。
