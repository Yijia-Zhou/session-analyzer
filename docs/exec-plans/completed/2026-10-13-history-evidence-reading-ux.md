# History reference reading UX / 历史引用阅读体验

Status: complete, 2026-10-13. Branch: `feat/history-evidence-open`; local, uncommitted. / 状态：已完成，沿用现有功能分支，尚未提交。

## Problem and outcome / 问题与目标

The first landing puts a large plain-text search excerpt above the actual record, repeats technical isolation warnings and gives Return and Continue equal priority. Readers cannot immediately tell what to read. Make the expanded record the primary reading surface, with one clear context-reading action and optional supporting excerpts. / 首次落地将大段纯文本命中摘录置于实际记录之前，重复解释内部隔离机制，且返回与继续按钮优先级相同，读者难以立即判断阅读入口。改为以展开的记录正文为主体，提供一个明确的前后文入口，辅助摘录按需展开。

## Work and validation / 实施与验证

- [x] Compact reference toolbar, conditional Return, readable labels, progressive disclosure and localized nearby roles. / 紧凑引用工具栏、按需显示返回、易懂文案、渐进展开及本地化附近记录角色。
- [x] Preserve visible long-output match access, disclosure state, cancellation, exact-target identity and independent reading preferences. / 保留长输出命中可见入口、展开状态、取消、准确目标身份及独立阅读偏好。
- [x] Update bilingual behavior/design documentation and generated assets. / 同步双语行为／设计文档与生成资产。
- [x] Focused browser/navigation/i18n checks and desktop/mobile visual inspection; verify the existing live URL serves the updated assets. / 聚焦浏览器／导航／多语言检查、桌面／移动端目视检查，核验原链接提供更新后的资产。

No snapshot, CLI or pagination contract change. / 不修改快照、CLI 或分页契约。

## Validation and review / 验证与审查

- Final focused run: `node --test test/history-evidence-navigation.test.js test/i18n.test.js e2e/history-evidence.test.js` passed 25/25; general `browser locale` scenarios passed 4/4. / 最终聚焦运行 25 项通过；普通浏览器语言场景 4 项通过。
- `npm run build`, `npm run build:check` and `git diff --check` passed. Full Node/browser/package suites were not repeated for this UI-only follow-up; the broader feature validation remains recorded in the [original plan](2026-10-13-history-evidence-open.md). / 构建、资产一致性及 diff 检查通过；本次 UI 后续调整未重跑全部 Node／浏览器／安装包套件，原功能完整验证见原计划。
- Desktop message toolbar measured below 160 px, mobile tool toolbar below 240 px in synthetic scenarios. Screenshots inspected under ignored output directories. The existing real-corpus URL still resolves the same assistant event with expanded body and collapsed support disclosures; it serves updated assets without restarting the snapshot owner. / 合成场景桌面消息工具栏低于 160 px，移动端工具工具栏低于 240 px；已检查忽略 output 目录中的截图。真实语料原链接仍定位同一助手事件，正文展开、辅助信息收起；静态资产直接更新，不重启快照拥有者。
- Review removed stale analysis cards and the misleading “Loaded 0” footer from isolated reading, retires prior analysis requests, and preserves exact isolated identity across language changes without fetching a prefix. / 审查移除了独立阅读中的旧统计及误导性的“已加载 0”页尾，退役旧统计请求，并确保切换语言保持准确独立身份、不获取前缀。
- No new blocking findings. Keep this change with the uncommitted history-open implementation; no commit or push performed. / 未发现新增阻塞问题。本轮与尚未提交的 history-open 实现一并保留，未提交或推送。
