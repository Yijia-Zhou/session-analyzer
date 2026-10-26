# pi reading follow-ups / pi 阅读收尾修复

Base: `726b0e20bf2bf59c66a7536475df038641cb2094` on `v0.3.0-development`; branch `fix/pi-reading-followups`. Status: implementation and local acceptance complete; exact independent review and hosted CI/Codex evidence are recorded with the commit and PR. / 基线与分支如上；状态：实现与本地验收完成，精确独立审查及 hosted CI／Codex 依据记录于提交与 PR。

## Scope / 范围

Four independently reproduced defects: silent 100,000-character tool-output slicing, retained image bytes in context-edit display copies, browser Back from a native-entry destination failing to restore ordinary reading, and POSIX literal backslashes rewritten as separators. Output/path defects predate #96. Preserve exact Raw, search ownership, tool status, branch projections and physical statistics. No context replay, cross-file navigation or search deduplication. / 四项均已独立复现：工具输出无提示截取至 100,000 字符，context edit 展示副本保留图片 bytes，原生 entry 目标后退不能恢复普通阅读，以及 POSIX 字面反斜杠被改写为分隔符。输出／路径问题早于 #96。保持精确 Raw、搜索归属、工具状态、分支投影及物理统计，不扩展到上下文重放、跨文件导航或搜索去重。

## Implementation / 实现

- Let shared Detail budgets mark long result text; retain native truncation evidence separately. / 由共享 Detail 限额为长结果添加省略标记，独立保留原生截断依据。
- Sanitize known replacement content and reuse that parsed copy in logical facts; leave exact Raw and search policy intact. / 清理已知 replacement 内容，逻辑依据复用该解析副本；保持精确 Raw 与搜索规则。
- Associate scoped reading positions with browser history and restore through existing reading machinery without consuming its in-app history stack. / 将绑定范围的阅读位置关联到浏览器历史，通过现有阅读机制恢复，不消耗应用内历史栈。
- Normalize only host path separators; prove distinct POSIX backslash/slash paths through discovery, indexing, Detail, Raw and native bookmarks. / 仅规范化运行平台分隔符，验证 POSIX 反斜杠／斜杠不同路径的发现、索引、Detail、Raw 和原生书签往返。

## Validation / 验证

- Synthetic regressions first fail on the accepted dev implementation. Display boundaries cover exact-limit and over-limit output, unique/ambiguous/sibling result ownership, tail search, exact Raw, image replacement branches and malformed shapes. / 合成回归先在 dev 原实现上失败；展示边界覆盖恰好限额／超限输出、唯一／歧义／兄弟结果归属、尾部搜索、精确 Raw、图片替换分支及畸形结构。
- Browser checks must cover ordinary A → native entry B → Back → Forward, event/layer/viewport and constant history length, plus stale-scope and superseded restoration. Existing entry-to-entry and shared reading workflows remain regression gates. / 浏览器覆盖普通 A → 原生 entry B → 后退 → 前进，事件／层／视口及历史长度不变，并覆盖失效范围和被替代的恢复；现有 entry 间往返及共享阅读流程继续作为回归门槛。
- Use existing Node 24.19.0 / npm 12.0.2; local browser uses system Chromium through the external preload. Record local checks, fresh independent exact-diff review and hosted CI/Codex evidence separately. No private fixtures or credentials enter git. / 使用现有工具链；本地浏览器通过外部 preload 使用系统 Chromium。分别记录本地检查、fresh 独立精确 diff 审查与 hosted CI／Codex 依据；私有 fixture 和凭据不进入 git。

## Results / 结果

- Display regressions first failed for missing omission markers and retained replacement PNG bytes; all three pass after repair. Path regression discovered four distinct artifacts but indexed only two before repair, then proved all four through Detail, exact Raw and native bookmarks. Pi Node coverage passes **117/117**. / 展示回归先因缺少省略标记及 replacement PNG bytes 未清理而失败，修正后三项均通过；路径回归在修正前发现四个不同工件但只索引两个，修正后四个均通过 Detail、精确 Raw 与原生书签验证。Pi Node 覆盖 **117/117** 通过。
- Ordinary-page Back failed before repair. Six new browser cases cover desktop event/layer/viewport and the independent in-app return stack, mobile document position, a gated Back superseded by Forward, changed index revision, snapshot-bound excerpts, and native locator resolution after 40-entry snapshot eviction. Pi navigation/reading evidence/turn lineage passed **31/31**; the final cancellation guard then passed all **4** directly affected cases. / 普通页面后退在修正前失败；六项新浏览器用例覆盖桌面事件／层／视口及独立应用内返回栈、移动文档位置、门控后退被前进替代、索引 revision 变化、快照证据片段，以及超过 40 项快照缓存淘汰后的原生定位解析。Pi 导航／阅读依据／turn lineage **31/31** 通过；最后取消保护修改后，直接受影响的 **4** 项全部通过。
- Final combined checks passed generated-asset consistency, **1,991/1,991** Node tests with no skips, installed-package UI/history reading for Codex/Claude Code/DeepSeek Harness/pi, **47/47** shared reading/collaboration browser cases and **42/42** history-evidence browser cases. Local browser evidence uses system Chromium 154; full hosted browser CI is a separate gate. / 最终组合检查通过生成资产一致性、无跳过的 **1,991/1,991** Node 测试、四来源安装包 UI／历史读取、**47/47** 共享阅读／协作浏览器用例及 **42/42** 历史证据浏览器用例。本地浏览器依据使用系统 Chromium 154，完整 hosted 浏览器 CI 为独立门槛。
- Restarted the acceptance server on the unchanged private pi corpus: intended source/root/project, **7 branches / 0 diagnostics**, readable saved command/result in Chinese **390×844** and English **1440×1000**, one Detail request per page, no page errors, and identical source hashes. Visually inspected the mobile screenshot; screenshots/reports stay outside git. / 在原私有 pi 语料上重启验收服务：核对来源／根／项目，**7 分支／0 诊断**，中文移动端及英文桌面可读保存的命令／结果，各页面一次 Detail 请求，无页面错误，来源哈希一致。完成移动截图目视检查，截图／报告保留在 git 外。
