# Collaboration reading navigation / 协作阅读导航

- Baseline: `8bc4747`, newer than the proposal's `e76d508`; existing collaboration targets are still plain text. / 基线：`8bc4747`，晚于建议中的 `e76d508`；协作目标仍是纯文本。
- Scope: implement the proposal's first increment (A), using D's evidence discipline. B/C and E/F remain subsequent independent increments. / 范围：实现建议第一轮 A，遵守 D 的证据边界；B／C 与 E／F 留作后续独立增量。
- Evidence: existing adapter-produced collaboration target IDs/status identities, indexed session IDs and explicit parent metadata; no new upstream transcript parsing. / 依据：已有 adapter 产生的协作目标 ID／状态身份、索引会话 ID 和明确父元数据；不增加上游转录解析。

## Implementation / 实现

- [x] Scope-bound target resolution; missing/ambiguous/unconfirmed explanations. / 按范围解析目标；缺失／歧义／未确认说明。
- [x] Separate keyboard-accessible target buttons in Timeline and Trajectory detail. / Timeline 和 Trajectory 详情中的独立键盘可操作按钮。
- [x] Child Main entry, reading return stack, query/filter/view/selection/viewport restoration and request generations. / 子会话 Main 入口、阅读返回栈、查询／筛选／视图／选择／视口恢复及请求 generation。
- [x] Bilingual product/design contract. / 双语产品／设计契约。
- [x] Complete focused validation and regression review. / 完成聚焦验证与回归检查。
- [x] Rebuild/check generated bundle and restart the development server for acceptance. / 重建／核查生成 bundle 并重启开发服务供验收。

## Validation evidence / 验证证据

- Full Node run: 1,208 tests, 1,207 initially passed; the sole failure was the exact package manifest missing the new shared module. Updated the manifest expectation and reran all 16 package tests successfully. / 全量 Node：1,208 项，首次通过 1,207 项；唯一失败是精确打包清单未列出新增共享模块。补齐预期后全部 16 项 package 测试通过。
- Browser: confirmed-target round trips in Timeline/Trajectory, keyboard entry, late child requests versus newer selection, Chinese project-search/filter restoration, paginated source restoration and mobile detail return passed. Existing project-return and single-tool Code Mode regressions passed. / 浏览器：Timeline／Trajectory 确认目标往返、键盘进入、旧子会话请求与新选择隔离、中文项目搜索／筛选恢复、分页后来源恢复及移动端详情返回通过；既有项目返回与单工具 Code Mode 回归通过。
- `npm run build`, `npm run build:check`, and `git diff --check` passed. The full browser suite and release gates were not run. / 构建、生成资产核查及 diff 空白检查通过；未运行全量浏览器套件或发布门槛。
- Local development server restarted on port 17890 with the original Codex root. HTTP is ready; the bounded live-index check still reported `running`, with no job error/code, for approximately 2.5 GiB of candidate history. Real-history reading and final count remain unverified; synthetic browser acceptance is complete. / 本地开发服务已在 17890 端口重启并保留原 Codex 根。HTTP 就绪；有界真实索引检查仍为 `running`，任务错误／错误码为空，候选历史约 2.5 GiB。真实历史阅读及最终数量尚未核验；合成浏览器验收完成。

## Review follow-up / Review 跟进

Review follow-up: corrected scroll ownership (mobile document and desktop `.detailPane`), exposed the saved surface before scroll restoration, and suppressed intermediate smooth scrolling. Mobile Timeline destination now stays on Events; asynchronous Inspector navigation refresh also preserves that surface. Added browser regressions for visible child content, deep mobile Timeline document scroll, desktop Trajectory Inspector scroll, and mobile Trajectory document scroll. / Review 跟进：修正滚动归属（移动端文档与桌面 `.detailPane`），先显示原界面再恢复滚动，并抑制中途平滑滚动。移动端 Timeline 目标现在留在 Events；Inspector 导航异步刷新也保留该界面。新增浏览器回归覆盖子会话正文可见、移动端 Timeline 深处文档滚动、桌面 Trajectory Inspector 滚动及移动端 Trajectory 文档滚动。

Validation: 11 focused browser tests and 9 navigation/target-resolution Node tests passed, as did build, generated-asset and whitespace checks. The running development server serves the exact rebuilt bundle with `Cache-Control: no-store`; these browser-only fixes need a page refresh, not a server restart. Full suites were not repeated for this follow-up. / 验证：11 项聚焦浏览器测试和 9 项导航／目标解析 Node 测试通过，构建、生成资产及空白检查通过。运行中的开发服务返回与重建结果完全一致的 bundle，且使用 `Cache-Control: no-store`；这次纯浏览器修复只需刷新页面，不需重启服务。本次跟进未重复运行全量套件。

## Second review follow-up / 第二轮 Review 跟进

Fixed three asynchronous reading-state regressions: event-selection intent now prevents delayed child analysis/suggestions from overwriting a newer selection or close; temporary reference return retains its source anchor while fetching a fresh target envelope; return waits for Inspector navigation's success/error rendering before restoring focus/disclosures and stops if a newer selection intervenes. Synthetic browser tests hold analysis/navigation responses and cover success, failure, closing during restoration, and an out-of-prefix reference's unchanged insertion order. All 14 focused browser regressions passed. / 修复三项异步阅读状态回归：事件选择意图阻止迟到的子会话 analysis／候选加载覆盖新选择或关闭；临时引用返回保留来源锚点，并获取新的目标 envelope；返回等待 Inspector 导航成功／失败渲染后再恢复焦点／展开状态，期间有新选择则停止。合成浏览器测试暂缓 analysis／导航响应，覆盖成功、失败、恢复中关闭及前缀外引用的插入顺序不变，14 项聚焦浏览器回归全部通过。

The 19 focused navigation, detail-presentation and transition-safety Node tests and generated-asset check also passed. Full suites were not rerun for these browser-state changes. / 19 项聚焦导航、详情呈现与转换安全 Node 测试及生成资产核查也通过；本次浏览器状态修改未重跑全量套件。

## Third review follow-up / 第三轮 Review 跟进

Restored the source's cloned folding draft together with its profile ID and presentation revision, preserving clean rules, unsaved previews and manual overrides across child reading. Localization now preserves the machine `labelKind` discriminator for collaboration statuses instead of stripping it. Regression coverage uses real Codex detail/localization responses with status-only targets, confirmed and missing identities, and generic status labels in both locales and presentations. The 149 focused Node tests, 13 browser regressions, build and generated-asset checks passed; full suites were not repeated. / 返回时连同策略 ID 和呈现 revision 一起恢复来源的折叠草稿副本，跨子会话阅读保留干净规则、未保存预览和手动覆盖。本地化现在保留协作状态的机器判别字段 `labelKind`，不再删除。回归使用实际 Codex 详情／本地化响应，覆盖只有状态行的目标、确认与缺失身份、通用状态标签，以及中英文和两种呈现。149 项聚焦 Node 测试、13 项浏览器回归、构建及生成资产核查通过；未重复全量套件。

## Fourth review follow-up / 第四轮 Review 跟进

Session-list refresh now preserves the reading stack only when the existing selected session is retained in the same source/project/index scope; empty results, fallback selection and explicit selection still clear it. Focus restoration records the originating surface, event, collaboration-section index and target/status row action, then verifies the destination on that exact action. It never substitutes the first same-child link elsewhere. / 会话列表刷新现在仅在原所选会话及来源／项目／索引范围不变时保留阅读栈；空结果、回退选择和明确选择仍会清空。焦点恢复记录原表面、事件、协作 section 索引及目标／状态行动作，并核验该精确动作的目标，不使用别处第一个指向同一子会话的链接代替。

Both reported failures were reproduced before the fix. Regression coverage includes ordinary/project-search round trips after sorting, explicit reselection, disappearance of the selected session, repeated calls to the same child, repeated collaboration sections in one event, target versus status rows in Timeline/Trajectory, and a missing originating action. The 17 relevant browser regressions passed (including the focused rerun after tightening asynchronous focus assertions); 27 focused Node tests, build, generated-asset and whitespace checks passed. Full suites were not rerun. / 两项报告的问题均在修复前复现。回归覆盖排序后的普通／项目搜索往返、明确重选、所选会话消失、多个调用指向同一子会话、同一事件内多个协作 section、Timeline／Trajectory 的目标行与状态行，以及原入口缺失。17 项相关浏览器回归通过（包括完善异步焦点断言后的定向复测）；27 项聚焦 Node 测试、构建、生成资产及空白检查通过。未重跑全量套件。

## Fifth review follow-up and retrospective / 第五轮 Review 跟进与回顾

Reproduced both reported failures before changing production code. Search expansion now stores valid event IDs rather than an old context key, and restoration rebinds them to the current search context. Return now retains the snapshot until required loading and presentation settle; failures preserve it and both Return and timeline Retry restart the whole operation. Repeated clicks share the pending operation, and superseding event/profile/presentation/session choices stop the older restore. / 修改生产代码前复现两项报告问题。搜索展开现在保存有效事件 ID，而非旧上下文键；恢复时重新绑定到当前搜索上下文。返回保留快照直到必要加载与呈现结束；失败保留快照，返回与时间线重试均重新执行完整操作。重复点击共享进行中操作，新事件／策略／呈现／会话选择会停止旧恢复。

The earlier review bugs fall into incomplete snapshots (rules, temporary anchors), wrong surface ownership (mobile document, desktop Inspector), insufficient identity (localized status rows and repeated target actions), stale asynchronous work (selection and Inspector redraw), and derived-context/lifecycle mistakes (sorting and premature history removal). The implementation and tests had treated these concerns too independently. The design now records a boundary matrix for future navigation edits: distinguish reading intent from derived keys; retain exact action provenance; wait for presentation settlement; commit history last; combine search/folding/pagination/refresh with failures and newer user choices. / 此前 Review 问题可归为快照不完整（规则、临时锚点）、表面归属错误（移动端文档、桌面 Inspector）、身份不充分（本地化状态行、重复目标动作）、过时异步操作（选择、Inspector 重绘）以及派生上下文／生命周期错误（排序、过早移除历史）。实现与测试此前将这些问题看得过于独立。设计现已记录后续导航修改的边界矩阵：区分阅读意图与派生键，保留精确动作来源，等待呈现结束，最后提交历史，并组合搜索／折叠／分页／刷新、失败与新用户选择。

New synthetic browser coverage includes the combined hidden-search + pagination + child-sort + failed-return + full-retry path on desktop/mobile; failures in initial timeline, paginated prefix, analysis, suggestions and detail; nested history with repeated clicks; and delayed return superseded by an event, profile, presentation or explicit session. Existing localized status, temporary-reference, project-search, scroll-container, disclosure and exact-focus regressions remain in the suite. / 新增合成浏览器覆盖桌面／移动端的隐藏搜索＋分页＋子会话排序＋返回失败＋完整重试组合路径；首屏时间线、分页前缀、analysis、候选与详情失败；嵌套历史下重复点击；以及延迟返回被事件、策略、呈现或明确会话选择替代。既有本地化状态、临时引用、项目搜索、滚动容器、展开状态与精确焦点回归保留在套件中。

Validation: the full Node suite passed 1208/1208 and the full browser suite passed 268/268. Final hardening additionally waits for pending detail presentation, preserves the original detail error, and holds pagination/retry controls until sibling requests settle. The 35 affected browser regressions passed, counting the targeted rerun after replacing an inappropriate `networkidle` wait on an intentionally gated request with the specific response/paint boundary. Build, generated-asset and whitespace checks passed. The running server serves the exact final bundle with `no-store`; refresh is sufficient for these browser-only changes. Package/release gates and real-history indexing acceptance were not repeated. / 验证：完整 Node 套件 1208/1208、完整浏览器套件 268/268 通过。最后补强还等待进行中的详情呈现，保留原详情错误，并在并行请求结束前暂停分页／重试入口。35 项受影响浏览器回归通过，其中包括将不适用于刻意 gate 请求的 `networkidle` 等待改为指定响应／绘制边界后的定向重跑。构建、生成资产及空白检查通过。运行中的服务以 `no-store` 返回与最终构建完全一致的 bundle；这次纯浏览器修改刷新即可生效。未重复安装包／发布门槛和真实历史索引验收。

## Deliberate limits / 明确边界

After this follow-up, restarted the development server with the same project and Codex root to load server-side localization changes. HTTP and exact rebuilt-bundle delivery passed; the bounded indexing check remained `running` with empty error/code. Real-history reading and final session count were not reverified during this follow-up. / 本次跟进后以相同项目和 Codex 根重启开发服务，加载服务端本地化修改。HTTP 与重建 bundle 的精确一致性交付检查通过；有界索引检查仍为 `running`，错误／错误码为空。本次跟进未重新核验真实历史阅读与最终会话数。

Only exact Codex session identities with confirmed owner relations are linked. Task paths/nicknames, sibling switching, precise launch/result events, other source collaboration adapters, URL bookmarks, file activities and terminal reverse navigation are not added in this increment. Return is distinct from parent navigation. / 本轮只链接具备确认 owner 关系的精确 Codex 会话身份。不增加任务路径／昵称匹配、兄弟切换、精确发起／结果事件、其他来源协作适配、URL 书签、文件活动或终端反向导航。阅读返回与父会话导航不同。
