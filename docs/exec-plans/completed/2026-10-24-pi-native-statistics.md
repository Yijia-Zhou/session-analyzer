# pi whole-native statistics / pi 完整原生统计

## Goal and scope / 目标与范围

When one saved pi tree contains an abandoned approach and a successful continuation, shared ancestors should contribute once to whole-native counts and recorded usage. Keep each selected branch's timeline, search, file activity and outcome intact. / 同一 pi 保存树含放弃方案和成功续接时，共享祖先应只贡献一次完整原生记录数与已记录用量；所选分支的时间线、搜索、文件活动及结果保持不变。

This increment adds a bounded statistics DTO to the existing verified navigation read and a collapsed native overview disclosure. It does not change canonical Session fields, query schemas or physical search-hit semantics. Shared query text/storage and branch-qualified patch totals remain separate follow-ups. / 本批在现有已验证导航读取中增加有界统计 DTO，并在原生概览增加折叠统计；不改变 canonical Session 字段、查询 schema 或物理搜索命中语义。查询文本／存储共享及按分支准入的 patch 总量单独推进。

## Contract / 契约

- Count accepted nonblank physical records once per artifact. Include header in Raw count; count post-header rows as entries. Malformed JSON and rows without admitted entry identity remain physical evidence, with explicit excluded/unlinked coverage; no semantic contributions are inferred from them. / 每工件按已接纳非空物理行计一次；Raw 含 header，entry 为 header 后行。无效 JSON 与无准入 entry 身份的行保留物理依据并明确未关联覆盖，不从中推断语义贡献。
- User/assistant/system/tool-result/other message counts are physical message records, including empty, image-only and multiple-block messages. Direct shell records are separate. Each assistant toolCall block is one request record, independently of pairing or outcomes; sibling result records each count once. / 用户／助手／系统／工具结果／其他消息按物理消息计，含空、仅图片及多块消息；直接 shell 单列。每个助手 toolCall 块算一条请求记录，独立于配对或结果；不同兄弟结果各计一次。
- Reuse the existing five usage categories and field coverage. Preserve zero, unknown, invalid values and overflow distinctly; usage-property presence is not proof of a valid receipt. Category sums are partial and remain separate; subset token fields are not added again. No bill or provider-attempt count is inferred. / 复用现有五种用量类别及字段覆盖，区分零、未知、无效与溢出；存在 usage 属性不证明有效回执。类别部分和保持独立，子集字段不重复相加，不推断账单或 provider 尝试次数。
- Read accepted snapshot scope only. Appended bytes appear after rebuilding; stale prefixes fail closed; invalid trees expose no semantic native summary. / 仅读取已接纳快照；追加字节重建后进入统计，前缀变化拒绝读取，无效树不提供语义原生统计。
- Browser labels distinguish whole-native statistics from selected-branch models/usage. Statistics start collapsed; category coverage remains inspectable on English desktop and Chinese mobile. / 浏览器区分完整原生统计与所选分支模型／用量；统计默认折叠，英文桌面及中文移动端均可检查类别覆盖。

## Work and validation / 工作与验证

1. Add source-local physical contributor iteration and scope-neutral recorded-usage reduction; expose statistics through verified navigation and include the module in the installed package. / 增加来源内物理贡献项迭代与范围中立用量汇总，通过已验证导航暴露统计，并确保安装包包含模块。
2. Add scope-labelled readable browser disclosure, translations and synthetic workflow coverage. / 增加明确范围的可读折叠界面、翻译及合成工作流覆盖。
3. Verify shared requests with sibling results, over-100 leaves, missing/malformed/overflow usage, empty/image messages, direct shells, malformed and invalid trees, append/reindex/stale ownership. Preserve existing branch facts and query digests. / 核验共享请求与兄弟结果、超过百叶、缺失／无效／溢出用量、空／图片消息、直接 shell、畸形及无效树、追加／重建／过期归属，并保持已有分支事实及查询摘要。
4. Replay the two private corpora, compare an independently prepared physical census and all 14 branch baselines, inspect the actual app in desktop/mobile, and verify unchanged source bytes. Real transcripts and screenshots stay outside git. No new model calls. / 回放两批私有语料，对比独立物理普查与 14 条分支基线，在实际应用检查桌面／移动端并核验源字节不变。真实转录及截图保留于 git 外，不新增模型调用。
5. Run affected Node/browser checks, generated bundle and installed-package smoke. Obtain fresh independent review of the exact proposed diff before committing, and push a separate PR into feat/pi-integration. / 运行受影响 Node／浏览器检查、生成 bundle 及安装包冒烟；提交前由 fresh subagent 独立审查精确差异，再推送独立 PR 至集成分支。

## Evidence / 依据

Implementation and local validation are complete on `feat/pi-native-statistics`, based on PR #92 merge `1398533100a964711d48b39e9851073daa4b09fb`. PR #92 itself passed all eight hosted CI checks and exact-head GitHub Codex review before that merge; those results do not validate this new increment. / 本批基于 PR #92 合并提交，在原生统计分支完成实现及本地验证。#92 在合并前通过全部八项 hosted CI 与精确 head 的 GitHub Codex 审查；这些结果不验证本批新改动。

- Local Node: **136/136** all pi and adapter contract/conformance tests, **16/16** package contract tests and **15/15** i18n tests. / 本地 Node：全部 pi 与 adapter 契约／一致性 136/136、package 契约 16/16、i18n 15/15。
- Local browser: **13/13** navigation workflows, including English 1440px and Chinese 390px physical counts/usage coverage, sibling outcome separation, more-than-100 branch coverage and late overview ownership. Generated assets and whitespace checks pass. System Chromium uses an external preload. / 本地浏览器：13/13 导航工作流，含英文 1440px／中文 390px 物理计数／用量覆盖、兄弟结果区分、超过百分支及迟到概览归属；生成资产与空白检查通过，系统 Chromium 经仓库外 preload 使用。
- Installed-package UI/history smoke passes for Codex, Claude Code, DeepSeek Harness and pi. New statistics module appears in the exact approved package manifest. Linux Node **24.19.0**, npm **12.0.2**. / 四种来源的安装包 UI／history 冒烟通过；新统计模块在精确准入包清单中，环境为所列 Linux 工具链。
- Independent Python census versus reader API: **10 artifacts / 14 branches / 168 physical records / 14 assistant tool requests / 13 result messages / 7 direct shell records / 44 usage-property receipts**. Every containing branch returns identical native statistics for its artifact. Source hashes remain byte-identical and diagnostics are zero. / 独立 Python 普查与 reader API 对比得到所列计数；每个工件的所有所属分支返回相同原生统计，源摘要保持不变且诊断为零。
- All 14 pre-change branch baselines remain identical for counts, analysis, token fields, logical event identities/statuses and query projection digests. / 14 条分支变更前基线的计数、analysis、token 字段、逻辑事件身份／状态及查询投影摘要全部不变。
- Actual app at port 17893 indexes the newer private corpus as **5 files / 7 branches**, with zero diagnostics. English desktop 1440×1000 and Chinese mobile 390×844 show native assistant output **1364**, selected B branch output **887**, and separate branch-summary output **658**. Missing cacheWrite1h stays unknown and recorded cache reads stay zero. Native totals remain unchanged when moving from B to failed A; all expanded coverage is reachable without horizontal overflow. / 17893 端口实际应用索引新私有语料为五文件／七分支、零诊断；所列桌面／移动端显示原生助手输出 1364、所选 B 分支输出 887，摘要输出 658 单列。缺 cacheWrite1h 保持未知，记录缓存读取保持零；从 B 切到失败 A 原生总量不变，展开覆盖可访问且无横向溢出。
- Real mobile reading exposed an existing automatic-expansion loading issue: a failed command can remain on the loading placeholder until explicitly collapsed/reopened. The exact unmodified base `1398533` reproduces the same behavior against the same corpus; reopening reads the expected failure in both versions. This is a tracked pre-existing limitation, not a claim of fully clean mobile reading. / 真实移动端阅读发现既有自动展开加载问题：失败命令可能停在加载提示，须显式收起再展开；精确未改动基线在同一语料复现，两版本重开均能阅读预期失败。这是已跟踪既有限制，不声称移动端全部阅读问题已消除。
- Fresh independent precommit reviews record exact bases/diff hashes and their own executed checks in commit/PR evidence. No hosted CI result is claimed for this increment before push. / fresh 独立提交前审查的精确 base／diff 摘要及审查者实际检查随提交／PR 记录；推送前不声称本批 hosted CI 结果。

Real-corpus reports/screenshots remain in the external corpus workspace. Existing provenance is unchanged: pinned pi 1.4.0, live free-model diagnosis/summary/continuation, explicitly SDK-scripted A/B edits and writer-only boundaries. This increment makes no model calls and accesses no API credentials. / 真实语料报告／截图保留在仓库外语料工作区；沿用原有来源区分：固定 pi 1.4.0、免费模型实时诊断／摘要／续接、明确 SDK 脚本化 A／B 修改及纯 writer 边界。本批不调用模型、不访问 API 凭据。
