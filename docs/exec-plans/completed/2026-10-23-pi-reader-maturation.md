# pi reader maturation / pi 阅读体验完善

Status: completed and accepted into `feat/pi-integration` by [PR #90](https://github.com/Yijia-Zhou/session-analyzer/pull/90), merge `9ddc1ec`. Exact implementation head `ad18e93` passed all hosted CI checks. Original implementation: `7b5dcc3` against `209a8d1`, transplanted onto integration baseline `4550324`. Remaining work is tracked in the [native file-evidence plan](../active/2026-10-23-pi-native-file-evidence.md) and debt tracker. / 状态：已完成，经 PR #90 接纳到集成分支，合并提交为 9ddc1ec；精确实现 head ad18e93 的 hosted CI 全部通过。原实现以 209a8d1 为基线提交为 7b5dcc3，随后移植到集成基线 4550324。后续工作见原生文件依据计划及技术债跟踪器。

## Outcome and scope / 目标与范围

Make saved pi work understandable: which branch is being read, what tools requested and actually changed, what recorded configuration/context changed, and what persisted usage and Code Mode receipts prove. Preserve native read-only loading, branch ownership, exact Raw references and immutable indexed snapshots. / 让已保存的 pi 工作可理解：正在阅读哪个分支、工具请求及确认修改了什么、记录的配置／上下文发生何种变化、持久化用量及 Code Mode 回执能够证明什么。保留原生只读加载、分支归属、精确 Raw 引用及不可变索引快照。

Evidence is the official `@earendil-works/pi-coding-agent@1.4.0` npm artifact (session format v3), its session/message documentation, declarations and matching producer code. A version-3 header alone does not prove compatibility with future writers. The five private 2026-10-22 cases are replay evidence, never committed fixtures; SDK-generated transitions and harness-authored summaries are not human TUI or model-generated-summary evidence. / 依据为官方所列 npm 工件（session format v3）、其 session／message 文档、声明及对应生产代码。仅有 v3 header 不证明兼容未来 writer。五份私有真实案例只用于回放，不作为提交 fixture；SDK 驱动转换及测试程序编写的摘要不等同于人工 TUI 或模型生成摘要依据。

The first mature increment excludes arbitrary extension-specific UI, remote media retrieval, live monitoring, executing recorded tools, and reconstructing the exact final model request. Complete context projection and durable native-entry bookmarks require separately accepted contracts. / 首个成熟增量不包含任意扩展专用 UI、远程媒体读取、实时监听、执行历史工具及重建最终模型请求。完整上下文投影及持久原生 entry 书签需要单独接纳契约。

## Identity and accounting decisions / 身份与统计约定

- Keep canonical leaf Session IDs and existing snapshot-bound history references. Group the sidebar by `sourceKind` plus native `sourceSessionId`; grouping is presentation, not a parent/child or fork relation. An extended leaf may acquire a new Session ID after reindexing. No silent redirect to a guessed descendant. / 保留 canonical 叶 Session ID 与现有绑定快照的历史引用。侧栏按来源及原生会话 ID 分组；分组属于呈现，不是父子或 fork 关系。追加后的叶在重建后可能具有新 Session ID；不静默跳转至猜测的后代。
- Counts/search remain selected-branch facts and include its shared ancestry. Do not add branch totals into a native-session total. A future native total must deduplicate physical entry ownership, including usage contributors, independently of leaf IDs. / 计数及搜索继续属于所选分支，并包含共享祖先；不能将各分支总数相加作为原生会话总数。未来原生总量须独立于叶 ID，按物理 entry 归属去重，包括用量来源。
- Last persisted entry does not establish runtime active context. `parentSession` may originate from fork, clone or SDK creation and remains provenance unless stronger evidence proves a relationship. / 最后持久化 entry 不证明运行期活动上下文；parentSession 可来自 fork、clone 或 SDK 创建，在更强依据出现前仅为来源信息。
- Recorded configuration is distinguished from the responding model and from runtime request transforms. Context changes annotate history rather than deleting it. Usage categories and observation coverage remain explicit; missing fields are not zero, subsets are not additive, and recorded costs are not verified bills. / 区分记录配置、响应模型及运行期请求变换。上下文变化解释历史而不删除历史。明确用量类别及观测覆盖；缺失不等于零、子集不重复相加、记录费用不等于核验账单。

## Work packages / 工作包

1. **Coverage and contracts.** Publish the [pi protocol matrix](../../design-docs/pi-protocol-event-coverage.md), distinguishing modeled, generic, unverified and runtime-only shapes. / **覆盖与契约。** 发布 pi 协议矩阵，区分已建模、通用展示、未验证及仅运行期形态。
2. **Native tools.** Admit shape-checked read/write/edit and shell/query tools; promote successful result-owned unified edit patches through existing file/diff views; preserve failed, incomplete and unsupported evidence. Test file counts, search, detail and cold materialization together. / **原生工具。** 按形态接纳读写修改、shell 及查询工具；将成功结果所属的 unified edit patch 接入现有文件／diff 呈现；保留失败、未完成及不支持的依据，联合验证文件计数、搜索、详情及冷物化。
3. **Branch reading.** Group native sessions, preserve canonical branch selection, explain shared-prefix counts and verify keyboard/mobile/source isolation. / **分支阅读。** 原生会话分组、保留 canonical 分支选择、解释共享前缀计数，并验证键盘／移动端／来源隔离。
4. **Recorded state and usage.** Explain branch-owned model/thinking changes, system prompt/tool patches, compaction checkpoints and context edits. Show typed persisted usage by source category with explicit coverage. / **记录状态及用量。** 解释分支所属的模型／thinking 变化、系统提示／工具补丁、压缩检查点及上下文编辑；按来源类别展示结构化持久用量及覆盖情况。
5. **Code Mode receipts.** Present bounded recorded nested call identities, status, arguments and durations; keep absent result payloads and incomplete receipts explicit. Do not fabricate nested logical events. / **Code Mode 回执。** 有界展示已记录嵌套调用的身份、状态、参数及时长；明确缺失结果及不完整回执，不伪造嵌套逻辑事件。
6. **Acceptance.** Synthetic negative/positive fixtures, actual private-case detail/Raw replay, standalone capacity characterization, relevant browser/package checks and fresh independent review before each commit. / **验收。** 合成正负 fixture、真实私有案例详情／Raw 回放、独立容量量测、相关浏览器／安装包检查，以及每次提交前 fresh 独立审查。

Each package must have user-visible behavior, evidence, regression checks and updated bilingual contracts before being called complete. / 每个工作包完成前须具备可见行为、依据、回归检查及同步双语契约。

## Branch workflow / 分支工作流

`v0.3.0-development` → `feat/pi-integration` → `feat/pi-reader-maturation`

The integration baseline consolidates the first six pi commits through `209a8d1` into `4550324`, based on dev `b28ac37`. It preserves dev's history observation options alongside pi source options. The original `feat/pi-native-adapter` branch and PR #88 remain available for provenance; published history is not rewritten. / 集成基线将截至 209a8d1 的首轮六个 pi 提交整合为 4550324，基于 dev 的 b28ac37；同时保留 dev 的 history observation 参数与 pi 来源参数。原 native-adapter 分支及 PR #88 保留供追溯，不改写已发布历史。

The initial baseline reached dev through [PR #89](https://github.com/Yijia-Zhou/session-analyzer/pull/89), merge `cdf422c`. This maturation increment reached the integration branch through PR #90; it has not yet been merged into dev. Subsequent feature branches start from the latest accepted integration head and target `feat/pi-integration`. / 首轮基线经 PR #89 合入 dev，合并提交为 cdf422c；本完善增量经 PR #90 合入集成分支，尚未合入 dev。后续功能从最新已接纳集成提交创建分支，并以集成分支为 PR 目标。

The detailed validation below describes the original implementation before this transplant. Each reorganized commit records its exact independently reviewed base/diff and newly executed checks in its commit message; hosted CI has now verified the combined dev/pi tree as recorded below. / 下述详细验证对应移植前的原实现。整理后的每个提交在提交信息中记录独立审查的精确 base／diff 及新执行检查；hosted CI 现已完成 dev 与 pi 组合代码树验证，结果如下。

## Hosted acceptance / Hosted 验收

- [PR #90 CI run 39962469604](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/39962469604) passed all eight jobs on `ad18e9396cfafea11f37921f02d3fdcd1e5966bf`: Node 22/24 Ubuntu, Node 24 Windows, both package jobs, pinned-browser coverage, scope and aggregate gate. Fresh independent premerge review verified the exact head, base and merged tree. / PR #90 所列精确 head 的八项 CI job 全部通过，覆盖所列 Node 平台、双平台安装包、固定浏览器、scope 及总门槛；fresh 独立合并前审查核验精确 head、base 及合并代码树。
- The transplanted tree also passed local Node **1936/1936**, pi browser **10/10**, build consistency and four-source package smoke before publication. The system-Chromium failures below are historical local limitations; they are not failures of this successful hosted run. / 移植后代码树发布前也通过本地 Node **1936/1936**、pi 浏览器 **10/10**、构建一致性及四来源安装包检查；下方系统 Chromium 失败属于历史本地环境限制，并非本次成功 hosted 运行的失败。

## Original implementation validation / 原实现验证记录

- PASS: `npm test`, **1881/1881** on Node 24.19.0/npm 12.0.2. Initial checks exposed the expected runtime-file allowlist and pi brand localization allowlist updates; both were corrected before this clean run. After adding result-owned patch text to Main search, the affected native tools/reading evidence/recorded state/pi integration tests passed **23/23**. / PASS：所列环境全量 Node **1881/1881**；初检发现 runtime 文件清单及 pi 品牌本地化允许项需同步，修正后完整通过。随后将结果所属 patch 文本加入 Main 搜索，受影响四组聚焦测试 **23/23** 通过。
- PASS: `npm run build:check` and `npm run test:package`; packaged Timeline → Detail → Raw and history status/search/context/read/raw/open passed for Codex, Claude Code, DeepSeek Harness and pi. No dependency or lockfile update. / PASS：构建一致性及安装包检查；四来源的所列 UI／history 链路通过，无依赖或 lockfile 变更。
- PASS: focused pi browser tests **10/10**: existing branch/raw reading, native grouping, tools in both locales and desktop/mobile, recorded selections/usage, exact context target navigation and nested receipts. Tests remain portable; local execution used system Chromium through an external temporary preload because the pinned browser download was unavailable. / PASS：聚焦 pi 浏览器 **10/10**，覆盖既有分支／Raw、原生分组、双语及桌面／移动工具、记录选择／用量、精确上下文目标与嵌套回执。测试保持可移植；固定浏览器下载不可用，本地通过仓库外临时 preload 使用系统 Chromium。
- PASS: private replay reads **5 artifacts / 7 branches / 114 Details / 94 Raw records**, with zero diagnostics, projection parity and byte-identical source/copies. Real data and screenshots stay outside the repository; no new model calls or API keys. / PASS：私有回放读取所列数量，零诊断、投影一致且原件／副本字节不变；真实语料及截图保留仓库外，无新模型调用或 API key。
- PASS: browser reading of the private native-edit and Code Mode artifacts in isolated homes. Native edit renders a rich diff in Timeline and Trajectory Detail with Files=1; Code Mode renders nested statuses while retaining one outer operation. Both source SHA256 hashes are unchanged and no browser errors occurred. Screenshots were visually inspected outside the repository. / PASS：隔离根中的私有原生 edit 与 Code Mode 浏览器阅读；前者在 Timeline／Trajectory Detail 展示富 diff 且 Files=1，后者展示嵌套状态并仍为一个外层操作。两者源 SHA256 不变、无浏览器错误；截图在仓库外完成视觉检查。
- Capacity: fresh-process synthetic runs compare baseline `209a8d1` and the final sequential-branch projector. A 4 MiB linear history used 169/174 MiB process maximum RSS; a 1,000-entry shared prefix with 16 leaves used 301/274 MiB and preserved **16,032** projected Raw rows. This avoids retaining all full branch Sessions simultaneously; query-prefix duplication remains. Single samples are descriptive, not timing gates or general capacity promises. / 容量：独立新进程对比基线及逐分支投影；4 MiB 线性历史进程最大 RSS 为 169／174 MiB，1,000 条共享前缀、16 叶为 301／274 MiB，保留 **16,032** 条 Raw 投影。避免同时保留所有完整分支 Session；查询前缀重复仍存在。单样本仅描述，不作为时延门槛或普遍容量承诺。
- Independent review: a fresh 6.1-sol reviewed the runtime/frontend/tests/scripts against `209a8d1009ad51daf3ce24174bfecb670169184a`, found no actionable issue, ran **137** focused new/existing contract tests and checked generated assets. Final staged-diff confirmation is required before commit; the resulting commit records its reviewed diff SHA256. / 独立审查：fresh 6.1-sol 对照所列基线审查运行时／前端／测试／脚本，无有效问题，执行 **137** 项新旧聚焦契约测试并核验生成资产；提交前须确认最终暂存差异，提交信息记录已审查差异 SHA256。
- Cross-source browser suite: **384/387 passed** under system Chromium, with the three failures below independently reproduced on the untouched baseline. This run includes the original pi tests plus native branch/tool tests; the two later evidence-navigation tests passed separately as part of the **10/10** focused pi run. No hosted-CI result is claimed. / 跨来源浏览器：系统 Chromium 下 **384/387** 通过，以下三项失败均在未修改基线独立复现。本轮含原 pi 及新增分支／工具测试；较晚新增的两项依据导航测试另在聚焦 pi **10/10** 中通过。不声称 hosted CI 通过。
- Environment boundary: the browser diagnostics self-test cannot navigate its synthetic `data:text/html` page in managed Chromium (`ERR_BLOCKED_BY_ADMINISTRATOR`). The same isolated failure reproduces on untouched `209a8d1`. This is not waived as passing; hosted pinned-browser CI remains unrun. / 环境边界：受管理 Chromium 禁止诊断自测访问合成 data 页面，报所列错误；未修改基线同样独立复现。不将其视为通过，hosted 固定浏览器 CI 尚未执行。
- The two pre-existing narrow-desktop topbar alignment tests also fail under this Chromium. Both reproduce in an isolated run on untouched `209a8d1`; their assertions and unrelated layout code are unchanged. / 另两项窄桌面 topbar 对齐测试在此 Chromium 下失败；未修改基线隔离运行也复现，两项断言及无关布局代码保持原样。

## References / 引用

- [Native pi design](../../design-docs/pi-native-sessions.md)
- [Source adapters](../../design-docs/transcript-source-adapters.md)
- [Schema review workflow](../../design-docs/schema-update-runbook.md)
- [Product contract](../../product-specs/session-transcript-analyzer.md)
- [Validation scope](../../development.md#validation-scope)
