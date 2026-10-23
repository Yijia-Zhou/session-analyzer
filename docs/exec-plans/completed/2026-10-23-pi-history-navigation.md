# pi history workflows / pi 历史工作流

Base: `24f0da4` (PR #91 integrated). Branch `feat/pi-history-navigation`, target `feat/pi-integration`. User authorized the reviewed three-part roadmap, limited free-model corpus generation and actual browser UX inspection. / 基线为 PR #91 集成提交；功能分支及目标如上。用户授权已审视的三批路线、有界免费模型语料生成及实际浏览器体验检查。

## Work and acceptance / 工作与验收

1. Native-session navigation, stable physical-entry references, cross-branch summaries/labels, explicit branch selection and grouped project-search counts. Accept by following A failure → summary → B success, reopening an old entry after append/reindex, and preserving sibling isolation/ambiguous ownership. / 原生会话导航、稳定物理 entry 引用、跨分支摘要／标签、明确分支选择及项目搜索分组计数；以 A 失败→摘要→B 成功、追加重建后重开旧记录及兄弟隔离／歧义归属验收。
2. Readable model/context/usage evidence, native read/write/truncation details and bounded saved-image previews. Keep exact Raw and the distinction between recorded selections, physical results and missing evidence. / 可读模型／上下文／用量依据、原生读写／截断详情及有界保存图片预览；保留精确 Raw，区分记录选择、物理结果及缺失依据。
3. Workflow fixtures, live pi SDK corpus, actual desktop/mobile browser inspection and separate serial capacity characterization. / 工作流 fixture、真实 pi SDK 语料、实际桌面／移动端浏览器检查及独立串行容量量测。

Design: [history navigation](../../design-docs/pi-history-navigation.md). Whole-native deduplicated statistics, full context projection/provider replay, inferred extension collaboration graphs and cross-file ownership remain deferred. / 设计见所列文档；去重完整原生统计、完整上下文投影／provider 重放、推断扩展协作图及跨文件归属继续延后。

## Decisions / 决策

- Current-history bookmarks preserve an exact entry digest and admitted artifact/root/project scope while allowing descendant leaf identities to change. Snapshot-bound history links keep their existing contract. / 当前历史书签保留精确 entry 摘要及准入工件／根／项目范围，允许后代叶身份改变；绑定快照链接保持原契约。
- Native names/labels use whole-artifact metadata; canonical historical branch titles stay branch-local. Empty-string labels now explicitly display clearing in Detail. / 原生名称／标签按整工件元数据处理，canonical 历史分支标题仍限于分支；空字符串标签在详情明确显示清除。
- Direct user shell executions remain counted as command/tool operations. Actual browser inspection found that cancellation was mislabeled as failure: explicit `cancelled: true` now gets Cancelled status and does not increase failed-command counts. Recorded exit code stays available. `!!` changes context inclusion, not historical visibility. / 用户直接 shell 执行继续按命令／工具操作计数。实际浏览器检查发现取消误标为失败：明确 cancelled:true 现显示已取消且不增加失败命令计数，原始退出码仍可查看。`!!` 改变上下文参与，不改变历史可见性。
- Private corpus generation uses pinned pi 1.4.0 outside the checkout, only a verified zero-price model and a bounded attempt budget. Credentials are ephemeral, never included in fixtures, logs or screenshots. Live model output is distinguished from SDK-scripted tool execution and writer-only boundary cases. / 私有语料在 checkout 外使用固定 pi 1.4.0，仅调用已核验零价格模型并限制尝试次数；凭据临时使用，不进入 fixture、日志或截图。实时模型输出与 SDK 脚本化工具执行、纯 writer 边界样例明确区分。

- Follow-up review correction: the overview now labels the number of rendered branches, rather than the larger native total, as visible. The 205-branch English and 103-branch Chinese fixtures assert 100 overview rows and a matching visible-count label; all nine navigation browser tests pass again. / 后续审查修正：概览的可见数量现按实际呈现分支计数，不再使用较大的原生总数。205 分支英文及 103 分支中文 fixture 断言概览为 100 行且可见数量标签相符；九项导航浏览器测试再次全部通过。

## Validation / 验证

- PR #92 review correction: the original 100-branch chooser cap made later containing branches unreachable while the modal kept the sidebar inert. The chooser now appends bounded index-revision-bound pages and retains the pending entry and selected branch; explicit choices retain ancestry validation. Regression fixtures cover 205 containing branches and late-page cancellation/session/source/reindex races. Correction validation is recorded separately from the original full-suite evidence below. / PR #92 审查修正：原选择器 100 分支上限使后续所属分支无法选择，且弹窗使侧栏不可操作。选择器现追加有界、绑定索引 revision 的分页，保留待选 entry 及当前分支；显式选择继续校验祖先关系。回归 fixture 覆盖 205 个所属分支及迟到分页响应的取消／会话／来源／重建竞态。此次修正验证与下列原全量检查依据分开记录。
- Correction checks: pi navigation/i18n Node tests **23/23**, navigation browser tests **9/9**, generated assets and `git diff --check` pass on Linux Node 24.19.0/npm 12.0.2 (browser uses the external system-Chromium preload). Hosted CI [run 39982462363](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/39982462363) passed all eight checks on the preceding head `d40a96b1370ab1e0c7db0aae583a56a172dce9ba`; that result does not validate this correction, which still requires fresh review and CI. / 修正检查：pi 导航／i18n Node **23/23**、导航浏览器 **9/9**、生成资产及 `git diff --check` 在所列 Linux 环境通过（浏览器使用仓库外系统 Chromium preload）。所列 hosted CI 在前一 head 通过全部八项检查；该结果不验证本次修正，修正仍须新的审查与 CI。

- PASS: final full Node **1967/1967**, generated bundle check and packaged UI/history smoke for Codex, Claude Code, DeepSeek Harness and pi on Linux Node 24.19.0/npm 12.0.2. / PASS：所列环境最终全量 Node **1967/1967**、生成资产检查及四种来源的安装包 UI／history 冒烟检查。
- PASS: affected pi/history browser tests **56/56**; after the final context-JSON disclosure adjustment, navigation tests **4/4** and source-conformance/recorded-state/i18n tests **38/38**. Readable context retains its `json/context` DTO semantics; only pi inspector HTML folds it. / PASS：受影响 pi／history 浏览器 **56/56**；最终上下文 JSON 折叠调整后，导航浏览器 **4/4**、来源契约／记录状态／i18n **38/38**。可读上下文保留 json/context DTO 语义，仅 pi 检查器 HTML 折叠展示。
- Full local browser run: **390/395** before the final disclosure adjustment. A fresh agent reproduced all five failures on exact base `24f0da4`: Chromium blocks a diagnostic `data:` navigation; two topbar assertions observe exactly 4 px; scroll pagination and context-owner assertions also fail on base but pass in a focused current rerun. This is baseline comparison, not a full green browser claim or a guarantee against flakes. System Chromium used an external preload. / 最终折叠调整前全量本地浏览器 **390/395**；fresh agent 在精确基线复现全部五项失败：诊断 data: 导航被 Chromium 阻止、两项顶栏断言恰差 4 px、滚动分页及 context owner 断言。后两项当前聚焦重跑通过；这只证明基线可复现，不声称全量浏览器通过或消除偶发性。系统 Chromium 通过仓库外 preload 使用。
- Private source readback: previous corpus **5 files / 7 branches / 114 Details / 94 Raw**; new corpus **5 files / 7 branches / 126 Details / 100 Raw / 119 entry references / 1 image**. Both have zero diagnostics, matching query projections and byte-identical source files. / 私有语料回读覆盖所列数量；两批均零诊断、查询投影一致且源字节不变。
- Actual desktop **1440×1000** and Chinese mobile **390×844** inspection followed A failure → summary → B success, shared-entry choice, project search into resumed B, direct excluded-shell links, cancellation and decoded saved images. It found and drove branch-count wording, readable-first usage and cancellation fixes. Final report/screenshots stay outside the repository; no blocking UX finding remains. / 实际桌面及中文移动端检查走通所列路径，驱动分支计数用语、可读用量优先及取消状态修复；报告／截图在仓库外，最终没有阻断性体验发现。
- Two fresh GPT-6.1-sol agents independently reviewed the proposed backend and browser/presentation changes without implementation history. The conformance correction and final delta are re-reviewed; exact base/diff hashes are recorded with the commit and PR. Static review, executed local checks and hosted CI remain separate. No hosted CI result is claimed in this pre-push record. / 两位不继承实现历史的 fresh GPT-6.1-sol 独立审查后端及浏览器／展示变更，并复审契约修正与最终增量；精确 base／diff 摘要随提交及 PR 记录。静态审查、本地实际检查与 hosted CI 分开，此推送前记录不声称 CI 结果。

## Corpus provenance / 语料来源

Pinned pi SDK **1.4.0** and `cohere/north-mini-code:free` produced diagnosis, analysis, a branch summary and continuation. Attempt budget was ten; nine attempts included two DNS failures and seven HTTP responses. Saved public model metadata reports zero prices and successful receipts report zero cost. The invoice example deliberately scripts A/B edits and actual local tests through the SDK: A rounds each line and fails; B rounds the discounted subtotal and passes all three tests. These edits are not claimed as autonomous model tool choices. Separate genuine failure histories and writer-only boundary fixtures cover cancellation, `!!`, context edits, compaction, labels/name clearing, saved images and linked forks. The official reader validates all five files. / 固定 SDK 与所列免费模型产出诊断、分析、分支摘要及续接；最多十次尝试，实际九次包含两次 DNS 失败及七次 HTTP 响应，保存的公开模型资料价格为零、成功回执费用为零。发票案例通过 SDK 明确脚本化 A／B 修改与真实本地测试：逐行取整 A 失败，折扣小计取整 B 三项测试通过；不声称修改来自模型自主选工具。另含真实失败历史及纯 writer 边界 fixture，覆盖所列场景；官方 reader 校验五个文件通过。

Temporary credentials were removed after an exact-value scan found no credential in corpus artifacts/logs and no persisted auth file. No real transcript or screenshot is committed. / 精确值扫描确认语料工件／日志不含凭据、无持久 auth 文件后删除临时凭据；不提交真实转录或截图。

## Capacity observations / 容量观察

Eleven synthetic cases ran serially in fresh child processes with other suites paused. These single Linux/Node samples do not flush OS caches, force GC, measure navigation endpoints or establish capacity limits. RSS is process high-water usage, not per-operation allocation. / 十一个合成案例在暂停其他套件时串行使用新进程运行；单次 Linux／Node 样本不清 OS 缓存、不强制 GC，不量测导航接口，也不建立容量上限。RSS 是进程高水位，不是单操作分配。

| Case / 案例 | Raw rows / 投影行 | Amplification / 放大 | Max RSS MiB | Cold index ms / 冷索引 | First/repeated search ms / 首次／重复搜索 |
| --- | ---: | ---: | ---: | ---: | ---: |
| linear 4 MiB | 1042 | 1.00 | 195.0 | 104.9 | 4.9 / 1.8 |
| linear 8 MiB | 2081 | 1.00 | 329.6 | 174.8 | 7.5 / 8.2 |
| shared 1000 × 2 | 2004 | 2.00 | 138.8 | 103.1 | 4.9 / 2.6 |
| shared 1000 × 16 | 16032 | 15.76 | 263.2 | 584.0 | 23.5 / 16.9 |
| shared 1000 × 32 | 32064 | 31.04 | 382.9 | 1820.9 | 256.9 / 240.5 |

The 32-branch case uses **70,836,419 actual query temporary-file bytes**, while the 16-branch case stays in memory. One 1 MiB media record uses 67.9 MiB maximum RSS; it remains excluded from text search. Shared-prefix projection duplication is the clearest measured follow-up. This increment adds characterization, not deduplicated storage. / 32 分支案例产生所列真实查询临时文件字节，16 分支案例仍驻内存；单条 1 MiB 媒体记录 RSS 高水位 67.9 MiB，继续排除于文本搜索。共享前缀投影重复是最明确的量测后续，本轮增加量测而非去重存储。
