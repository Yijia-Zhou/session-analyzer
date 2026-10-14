# Read nearby evidence in the timeline / 在时间线中阅读附近证据

Status: completed locally on `feat/history-evidence-open`, 2026-10-13; uncommitted. / 状态：2026-10-13 在现有功能分支本地完成，未提交。

The referenced event opens expanded, with a bounded set of nearby records in summary form before/after it. Real sequence gaps show explicit omitted-event counts; outer boundaries identify earlier/later unloaded records only when present. Initial navigation still lands on the exact target. Nearby cards expand in place without changing the original reference, durable folding preferences or canonical prefix pagination. Remove the permanent top evidence panel; keep continuation, return, loading/cancellation and errors in a modest footer after the records. / 引用事件展开，少量附近记录按顺序在前后显示摘要；真实间隔标明省略事件数，存在更早／更晚记录时才显示外侧边界。初始仍定位准确目标。附近卡片原地展开，不修改原引用、持久折叠偏好或规范前缀分页。移除常驻顶部证据面板，续读、返回、加载／取消及错误置于记录之后的轻量操作区。

- [x] Add explicit layer-relative event positions and gap endpoint IDs; never parse references in the browser. / 提供层内事件位置和间隔两端 ID，浏览器不拆引用。
- [x] Keep a separate bounded excerpt group; reuse exact-event summaries/details, shared Inspector and normal cards with temporary display states. / 保留独立有界节选组，复用准确事件摘要／详情、共享 Inspector 和普通卡片，使用临时展示状态。
- [x] Block automatic prefix loading in excerpt mode. Continue loads the existing prefix in the background, then switches once all group IDs are available, preserving selection, expanded records and viewport. / 节选模式禁止自动加载前缀；续读在后台加载既有前缀，组内 ID 全部可用后一次切换，保留选中、展开记录及视口。
- [x] Preserve cancellation/context guards, failure/retry, language changes and reading return. / 保持取消／上下文保护、失败／重试、语言切换及阅读返回。
- [x] Update bilingual specs/design, focused browser/server validation, rebuild/check assets and provide a current local viewer for acceptance. / 同步双语规格／设计，执行针对性浏览器／服务端验证，重建／检查资源并提供当前本地查看入口验收。

Gap markers are explanatory, not range-load controls. Arbitrary bidirectional windows remain a separate milestone. / 省略标记仅作说明，不作为区间加载控件；任意位置双向窗口仍另立里程碑。


Implementation notes: the first automatic scroll waits for target detail height and rechecks navigation ownership. Mobile summary taps expand in Events. After explicit continuation, a small sticky return action stays reachable even as the timeline grows; initial excerpts keep the normal footer. / 实施补充：首次自动滚动等待目标详情高度，并重新核验导航所有权。手机点摘要在事件界面原地展开。显式续读后用轻量吸底返回操作保证长时间线中的可达性；初始节选仍用普通组后操作区。

Validation: service/open/search tests 50/50, i18n 15/15, ordinary navigation/return/append/detail browser regressions 15/15. All 24 history-reading browser scenarios passed across the final suite and focused rerun after replacing an obsolete success-copy assertion with the visible return control. Build/check and whitespace checks passed. Independent Astra read-only review reported no blocking findings. Full release/package suites were not repeated for this increment. / 验证：服务／打开／搜索测试 50/50、本地化 15/15、普通导航／返回／追加／详情浏览器回归 15/15。历史阅读全部 24 项浏览器场景通过最终全组及针对性复跑；复跑前将已过时的成功提示文字断言改为可见返回控件断言。构建／一致性及空白检查通过。独立 Astra 只读审查未发现阻塞问题。本增量未重复全量发布／安装包测试。

A mobile delayed-detail test previously used 480 unrelated expanded prefix messages; their asynchronous hydration caused unstable click geometry. Its fixture now uses eight prefix messages while retaining the delayed failure/query-supersession assertions. Dedicated deep-prefix scenarios retain 480 records. / 一项手机延迟详情测试原先使用 480 条无关的展开前缀消息，异步详情加载导致点击几何位置不稳定；该用例改用 8 条前缀，仍保留延迟失败／查询取代断言。专门的深前缀场景仍保留 480 条记录。

Live acceptance scope: a fresh full-source index was blocked by duplicate Codex Session IDs across three rollout files (PROJECT_QUERY_STORE_CONTRACT_VIOLATION), recorded in the debt tracker. Original source files and the old services remain intact. The current viewer uses an unmodified historical-session copy under ignored output/history-context-preview, with one indexed Session and zero diagnostics, on history port 17892 / viewer port 63207. Screenshots are ignored output/history-open-validation/nearby-timeline-desktop.png and nearby-timeline-mobile.png. / 实页验收范围：新建全来源索引因三份 rollout 共用 Codex 会话 ID 报 PROJECT_QUERY_STORE_CONTRACT_VIOLATION，已记入技术债。原始来源文件及旧服务保持不变。当前查看入口使用忽略目录 output/history-context-preview 内未改写的历史会话副本，索引 1 个会话、诊断 0，history 端口 17892／viewer 端口 63207。桌面及手机截图位于忽略的 output/history-open-validation 目录。

The live example displays four records with exact gaps of 321 and 13 events, no top evidence panel, and a readable initial target on desktop and 390px mobile without horizontal overflow. Mobile summary selection stays in Events; continuation preserves the selected nearby record and removes gaps. The sticky return remained visible in a 543-card loaded timeline and restored the original target and four-record group. / 真实示例展示 4 条记录及准确的 321／13 条省略间隔，无顶部证据面板；桌面及 390px 手机首次打开均可读到目标，手机无横向溢出。手机选中附近摘要保持事件界面；续读保留该选中记录并移除省略标记。加载出 543 张时间线卡片后，吸底返回仍可见，点击恢复原目标及 4 条记录的节选组。
