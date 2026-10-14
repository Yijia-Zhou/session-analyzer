# Conditional history excerpt / 按需显示历史命中片段

Status: complete, 2026-10-13; local changes on `feat/history-evidence-open`, uncommitted. / 状态：已完成；沿用现有功能分支，尚未提交。

Show the search excerpt only when the target's readable body does not cover the hit. Loading detail is undecided; failed, cropped, folded or unproven text keeps the fallback. Label it “View match not shown in the record.” / 仅在目标记录可读正文未覆盖命中时显示搜索片段。详情加载中暂不判断；失败、裁剪、折叠或无法确认时保留补充入口，标为“查看正文未展示的命中片段”。

- [x] Compare only the exact target body, with conservative literal/Markdown handling. / 只比较准确目标正文，保守处理纯文本／Markdown。
- [x] Update after detail hydration and content disclosure without disturbing unrelated reading. / 详情加载及内容展开后更新，不干扰其他阅读。
- [x] Validate short Markdown messages, displayed/cropped tool output, delayed/failed detail and manual navigation; rebuild assets and update bilingual specs/design. / 验证短 Markdown 消息、已显示／裁剪的工具输出、延迟／失败详情及手动导航；重建资产并同步双语规格／设计。

Preserve reference identity, snapshot binding and existing context navigation. No backend or pagination change. / 保持引用身份、快照绑定及既有上下文导航，不修改后端或分页。

## Validation and limits / 验证与边界

- `node --test test/history-evidence-navigation.test.js test/i18n.test.js e2e/history-evidence.test.js`: 28/28 passed. Coverage includes readable short Markdown, complete tool results, truly cropped long output, pending/failed detail, Inspector-only text, closed/open sections and leaving the target. / 所列聚焦运行 28 项全通过，覆盖短 Markdown、完整工具结果、确实被裁剪的长输出、详情等待／失败、仅在 Inspector 中的文本、折叠区开合及离开目标。
- The earlier long-output fixture still fit the normal detail; its prefix was enlarged so the crop scenario now establishes actual missing body coverage. / 原长输出 fixture 仍可完整进入正常详情；已加长前缀，使裁剪场景真正覆盖正文缺失命中的情况。
- `npm run build`, `npm run build:check`, and `git diff --check` passed. The existing markdown-it dependency is now bundled for bounded Markdown comparison (client bundle about 587 KiB); no new package dependency. Full suites/package smoke were not repeated for this browser-only follow-up. / 构建、资产一致性及 diff 检查通过。浏览器打包既有 markdown-it 依赖作有界 Markdown 比较（bundle 约 587 KiB），未新增包依赖；本轮浏览器后续变更未重跑全套或安装包 smoke。
- Original live URL verified: exact expanded event unchanged, body contains the hit, excerpt and preview hidden, nearby records available. Static assets take effect on refresh; snapshot service was not restarted. / 原链接实页已核验：准确展开事件不变，正文包含命中，摘录及预览隐藏，附近记录可用。刷新即加载新静态资产，未重启快照服务。
- Coverage is conservative hit-line equivalence, not universal projection-to-rendered-character mapping. Hidden link/image destinations and unproven fragment rendering retain the fallback. / 覆盖判断是保守的命中行等价比较，不承诺通用投影到渲染字符映射；隐藏链接／图片目标及无法确认的片段渲染继续保留补充入口。
