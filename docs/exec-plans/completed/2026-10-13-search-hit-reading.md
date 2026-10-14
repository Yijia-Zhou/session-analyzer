# Search hits beside their records / 命中片段随记录阅读

Status: completed locally, 2026-10-13, `feat/history-evidence-open`; not committed or published. / 状态：2026-10-13 本地完成，沿用现有功能分支，未提交或发布。

## Product decisions / 产品决定

- Place a conditional, closed “View match not shown in the record” disclosure inside the expanded Timeline card immediately before its body content. Do not add a global search panel at the top of `.timelinePane`. / 在展开的 Timeline 卡片内、正文内容之前按需显示默认收起的“查看正文未展示的命中片段”，不在 timelinePane 顶部增加全局搜索面板。
- Trajectory keeps its compact event buttons; its event Detail is the primary reading surface and receives the same conditional disclosure. Project search retains its existing snippets and uses this behavior after drilling into a Session. / Trajectory 保持紧凑事件按钮，事件 Detail 作为正文阅读区使用同样的按需入口；项目搜索保留既有摘要，下钻会话后沿用此行为。
- Move the history-reference excerpt into its event card too. Keep reference navigation and nearby records in the existing compact toolbar. / 历史引用片段也移入所属事件卡片；定位导航及附近记录留在现有紧凑工具栏。
- Compare the active manual query against readable source content; preserve conservative hit-line comparison for opaque history refs. Pending detail is undecided; errors and uncovered content retain the fallback. Exclude the supplemental excerpt itself from coverage. / 手动搜索以当前查询核对可读来源内容，不透明历史引用仍保守比较命中行。详情等待中暂不判断，失败及未覆盖内容保留补充；覆盖判断排除补充片段本身。
- Previous/next navigation reveals supplemental text when needed while retaining one canonical target per event and the original full-text counts. Search, session, layer, scope and presentation changes retire stale snippets. Opening a primary disclosure may remove a now-redundant supplement; ordinary scrolling does not. / 上下命中导航在需要时显露补充文本，保持每事件一个规范目标及原全文计数；搜索、会话、层、范围及呈现切换清理旧片段。展开主要内容后可移除已冗余补充，普通滚动不改变显隐。

## Implementation and gates / 实施及验证

- [x] Extract a reusable browser component for coverage, escaped snippet markup, disclosure state and localized copy. / 提取复用的正文覆盖、转义片段渲染、展开状态及本地化组件。
- [x] Integrate with Timeline body lifecycle and Trajectory Detail; keep local detail settlement and incremental append invariants. / 接入 Timeline 正文生命周期及 Trajectory Detail，保持局部详情更新和增量追加不变量。
- [x] Integrate search highlight/navigation without duplicate targets, stale query content or self-satisfying coverage. / 接入高亮／导航，不重复计算目标、不残留旧查询片段、不将补充文本误算为正文覆盖。
- [x] Migrate history landing; update specs/design and rebuild generated assets. / 迁移历史落地，同步规格／设计并重建生成资产。
- [x] Synthetic browser checks: readable/missing hits, Markdown links, folded and cropped content, delayed/failing detail, query changes, target counts/navigation, both presentations, project drilldown and narrow screens. Relevant lifecycle/performance regressions, build consistency, and live acceptance. / 合成浏览器核验：已显示／未显示命中、Markdown 链接、折叠及裁剪、延迟／失败详情、查询变化、目标计数与导航、两种呈现、项目下钻及窄屏；相关生命周期／性能回归、资产一致性及实页验收。

No source, snapshot, CLI or pagination protocol changes are planned. Reuse bounded search snippets. / 不计划修改来源、快照、CLI 或分页协议，复用有界搜索摘录。

## Review and evidence / 审查及证据

- Astra read-only review identified three Trajectory gaps, all repaired: current selected-Inspector event anchors, empty successful detail retaining the supplement container, and explicit target Detail materialization when navigation has no live mark. Event-level fallback uses ordinary selection, never a whole-card text highlight. / Astra 只读审查指出的三个 Trajectory 分支均已修复：当前已选 Inspector 事件锚点、成功但空详情仍保留补充容器，以及导航无有效标记时显式物化目标 Detail。事件级兜底使用普通选中样式，不将整张卡片染成文字命中高亮。
- 16 history/manual-search browser cases passed. 38 existing browser regressions passed, covering canonical target counts/identity, Trajectory/project drilldown, Code Mode previews, local body/Inspector settlement and suffix append. The phrase-removal case now expects the bounded excerpt to retain one binding on the same target while unrelated marks remain untouched. After the final selection-style fix, the seven affected browser cases passed again. / 16 项历史／手动搜索浏览器用例通过；38 项既有回归通过，覆盖规范目标计数／身份、Trajectory／项目下钻、Code Mode 预览、局部正文／Inspector 更新及后缀追加。正文移除命中词的用例更新为：有界补充在同一目标保留一个绑定，其他卡片标记不变。最终选中样式修复后再次通过 7 项受影响浏览器用例。
- 32 focused Node tests passed: evidence navigation/coverage, i18n, highlight and canonical search targets. Build and generated-asset consistency passed; no dependency changes. Full release/package gates were not repeated for this browser-only increment. / 32 项针对性 Node 测试通过，涵盖引用导航／覆盖、国际化、高亮及规范搜索目标；构建及生成资产一致性通过，无依赖变化。本轮仅修改浏览器行为，未重复全量发布／安装包门槛。
- Live acceptance used the existing fixed viewer on port 57172. A real reference displays its supplement in the event body; manual search for `952.9724` displays the actual hit there with two canonical targets and no top-level panel. Ignored screenshots are in `output/history-open-validation/real-event-local-excerpt.png` and `real-manual-search-local-excerpt.png`; no real transcript fixture is added. Static assets are read from disk, so page refresh applies this increment without replacing the snapshot service. / 实页验收复用 57172 固定快照查看服务。真实引用的补充位于事件正文；手动搜索 952.9724 同样显示实际命中，保持两个规范目标且不增加顶部面板。截图保存在忽略的 output/history-open-validation 下，不增加真实转录 fixture。静态资源按请求读盘，刷新页面即可使用本轮改动，无需替换快照服务。
