# Codex materialized fork ownership and Earlier Branch folding / Codex 物化分叉 ownership 与较早分支折叠

## Objective / 目标

Recognize copied-prefix Codex Fork Sessions conservatively, separate inherited context from continuation-owned activity on every Logical surface, preserve the physical Raw transcript, and collapse one provably inactive source Session beneath its continuing fork without hiding ambiguous branches. / 保守识别带复制前缀的 Codex 分叉会话，在所有 Logical 表面把继承上下文与续写自有活动分开，同时保留物理 Raw 转录；在不隐藏歧义分支的前提下，把唯一且可证明不再活跃的来源会话折叠到续写 fork 下方。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-08-09 / 开始日期：2026-08-09
- Completed: 2026-08-10 / 完成日期：2026-08-10
- Related context: `CONTEXT.md` / 相关上下文：`CONTEXT.md`
- Related product spec: `docs/product-specs/session-transcript-analyzer.md` / 相关产品规格：`docs/product-specs/session-transcript-analyzer.md`
- Related design: `docs/design-docs/logical-event-timeline.md`, `docs/design-docs/transcript-source-adapters.md` / 相关设计：`docs/design-docs/logical-event-timeline.md`、`docs/design-docs/transcript-source-adapters.md`

## Implementation / 实施

1. Added `src/codex-forks.js` with timestamp-insensitive, null-normalizing canonical Raw digests; unique-parent and embedded-metadata checks; linear copied-prefix matching; cross-segment Logical-reference rejection; inherited-context projection; and timestamp-only Earlier Branch inference. / 新增 `src/codex-forks.js`，实现忽略 timestamp、规范化 null 的 canonical Raw digest、唯一 parent 与嵌入 metadata 校验、线性复制前缀匹配、跨区段逻辑引用拒绝、继承上下文投影，以及只依据时间戳的较早分支推断。
2. Preserved full Raw and private Logical payloads for reindex reuse, delayed every owned title/count/analysis/catalog/total computation until after inference, and kept Main/Protocol search and file suggestions on the public continuation projection. / 保留完整 Raw 与内部逻辑载荷供 reindex 复用，把所有自有标题／计数／分析／目录／总计计算延迟到推断之后，并让 Main／Protocol 搜索与文件建议只使用公开续写投影。
3. Added additive fork evidence, inherited context, Raw segment, and supersession DTO fields without changing canonical schema version 1. / 在不改变 canonical schema version 1 的前提下，增加 additive 的 fork evidence、继承上下文、Raw 区段与 supersession DTO 字段。
4. Unified Derived and Earlier hierarchy rendering, kept project search flat, added source-neutral inherited-context copy and exact fork-point navigation, and inserted non-repeating Raw segment headings. / 统一 Derived 与 Earlier 层级呈现，保持项目搜索平铺，增加来源中立的继承上下文文案与精确分叉点导航，并插入不重复的 Raw 区段标题。
5. Review follow-ups moved digest computation before image externalization, preserved parser-established ordinary fork ancestry across inference reset, temporarily revealed hidden fork-point targets without rewriting saved folds, and replaced per-card reverse-supersession scans with one cached linear index. / Review follow-up 将 digest 计算移到图片外置之前，跨 inference reset 保留解析器建立的普通 fork ancestry，在不改写已保存折叠偏好的前提下临时显示隐藏的 fork-point target，并用一次缓存的线性索引替代逐卡 reverse-supersession 扫描。
6. A second review follow-up made canonical object construction prototype-independent so own `__proto__` data remains significant, and rebuilt review-marker caches from owned Raw Records before temporal parent inference on both cold indexing and reindex. / 第二轮 review follow-up 让 canonical object 构造不受 prototype 影响，使自有 `__proto__` 数据继续参与比较，并在冷索引和 reindex 中都先根据自有 Raw Record 重建 review-marker cache，再进行基于时间的 parent 推断。
7. Real-history verification distinguished a structurally different earlier-fork boundary from a same-envelope interrupted copy, allowing the parent to retain its pre-creation older-branch tail without weakening image, structured-field, or message-content fail-closed behavior. / 真实历史验证进一步区分“结构不同的较早分叉边界”和“相同 envelope 内中断的副本”，允许 parent 保留 child 创建前的旧分支尾部，同时不放宽图片、结构化字段或消息内容差异的 fail-closed 行为。
8. Cross-source review follow-ups gave Claude pointer forks the same Main-first, exact-Raw-fallback fork-point target contract, preserved search/filter/layer state for defensive targetless parent navigation, and recorded both user-visible changes in the bilingual changelog. / 跨来源 review follow-up 为 Claude 指针式分叉补齐同样的 Main-first、精确 Raw fallback 分叉点 target 契约，在防御性的无 target 父会话导航中保留搜索／筛选／层级状态，并把两项用户可见变化写入双语 changelog。
9. Paired cold-index measurement rejected unconditional per-Raw canonical hashing. Candidate selection now enables pre-externalization digests only for potential materialized children and their unique retained parents; newly eligible unchanged files reparse once and then reuse their complete digest sets. / 配对冷索引测量否决了对所有 Raw 无条件执行 canonical 哈希。候选筛选现在只为潜在物化 child 及其唯一保留 parent 启用外置前 digest；此前未变化但新近符合条件的文件会重解析一次，之后复用完整 digest 集合。

## Acceptance record / 验收记录

- Canonicalization covers timestamp replay, recursive object `null` removal, missing fields, array preservation, and a 3,001-record copied prefix. / Canonicalization 覆盖 timestamp replay、递归 object `null` 删除、missing 字段、array 保留，以及 3,001 条记录的复制前缀。
- Fail-closed tests cover missing/duplicate parents, metadata mismatch, interrupted prefixes, and cross-boundary Logical Raw References. / Fail-closed 测试覆盖 parent 缺失／重复、metadata 不匹配、前缀中断与跨边界逻辑 Raw Reference。
- Ownership tests prove inherited activity is excluded from child title, counts, analysis surfaces, Main search, and Logical totals while Raw remains complete and searchable. / Ownership 测试证明继承活动不会进入 child 标题、计数、分析表面、Main 搜索与逻辑总计，同时 Raw 保持完整且可搜索。
- Folding tests cover inactive chains, active parents, shared parents, automatic ancestor expansion, mixed Derived/Earlier groups, flat project search, reindex retraction, bounded context, Raw sections, bilingual copy, and exact fork-point navigation. / 折叠测试覆盖 inactive chain、active parent、共享 parent、自动祖先展开、Derived／Earlier 混合组、平铺项目搜索、reindex 撤销、有界上下文、Raw 区段、双语文案与精确分叉点导航。
- Review regression tests cover equal and differing pre-externalization image payloads, ordinary ancestry from leading configuration or non-leading metadata on first parse and reindex, and navigation to a profile- plus override-hidden fork point without mutating the saved override. / Review 回归测试覆盖外置前相同与不同的图片 payload、首次解析与 reindex 时来自开头配置或非首行 metadata 的普通 ancestry，以及在不修改已保存 override 的情况下导航到同时被 profile 与 override 隐藏的 fork point。
- Additional review regressions prove own `__proto__` differences cannot form a materialized prefix and inherited ownerless review lifecycle rows cannot participate in temporal review-parent inference, including reindex reuse. / 新增 review 回归测试证明自有 `__proto__` 差异不能形成物化前缀，并且继承的无 owner review lifecycle 行不会参与基于时间的 review-parent 推断，同时覆盖 reindex 复用。
- Real-history boundary regression covers a child copied from an earlier parent point followed by structurally distinct continuation setup, while the parent's discarded tail predates child creation. / 真实历史边界回归覆盖 child 从 parent 较早位置复制、随后以结构不同的续写设置开始，而 parent 被舍弃的尾部早于 child 创建的情形。
- Claude pointer regressions verify exact Main selection, exact parent Raw fallback, and state-preserving targetless navigation. Digest-planning regressions prove ordinary sessions avoid canonical hashes and a newly eligible parent/child pair reparses once before both files become reusable. / Claude 指针式分叉回归验证精确 Main 选择、精确父会话 Raw fallback，以及保留状态的无 target 导航。Digest 规划回归证明普通会话不会生成 canonical 哈希，且新近符合条件的一对 parent／child 只重解析一次，随后两份文件都可复用。
- Read-only paired cold-index measurement reduced live-corpus wall regression from +17.17% to +2.34% after candidate bounding; no-fork image and long-text fixtures retained zero digest arrays and measured -0.36% and -0.87% wall differences, with no retained-memory growth. / 只读配对冷索引测量显示，候选范围收窄后真实语料 wall 回归从 +17.17% 降至 +2.34%；无 fork 的图片与长文本 fixture 均保留零个 digest array，wall 差异分别为 -0.36% 与 -0.87%，且没有 retained-memory 增长。
- Final verification: generated assets are current; `npm test` passes 409/409, `npm run test:browser` passes 105/105, package smoke passes for Codex and Claude Code, `npm run release:check` passes, and `git diff --check` is clean. / 最终验证：生成资产为最新；`npm test` 通过 409/409，`npm run test:browser` 通过 105/105，Codex 与 Claude Code package smoke 均通过，`npm run release:check` 通过，且 `git diff --check` 干净。
