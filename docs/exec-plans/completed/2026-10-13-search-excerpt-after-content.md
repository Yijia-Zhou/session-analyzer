# Read the event before its search excerpt / 先读事件，再核对命中片段

Status: completed locally on `feat/history-evidence-open`, 2026-10-13; uncommitted. / 状态：2026-10-13 在现有功能分支本地完成，未提交。

## Reading order / 阅读顺序

- Timeline: event header, ordinary body, conditional search supplement, existing footer actions. Keep the supplement inside the single `.eventBody` so local detail updates retain their ownership. / Timeline 依次显示事件头、正常正文、按需搜索补充及既有底部操作。补充仍在唯一 eventBody 内，保持局部详情更新的归属。
- Trajectory: preserve leading context, then primary detail, conditional search supplement, supplemental detail and existing metadata/Raw references. Failed detail presents the error/retry before its excerpt. / Trajectory 保留前置上下文，随后显示主体详情、按需搜索补充、补充详情及既有元数据／原始引用。详情失败时先显示错误／重试提示，再显示摘录。
- Normal selection/expansion starts with event content and keeps a new supplement closed. Explicit previous/next search navigation still reveals and scrolls to the available hit, including an excerpt after a long body. Coverage, target identity/counts, retained disclosure state and user-navigation ownership stay unchanged. / 正常选择／展开优先阅读事件内容，新补充默认收起；显式上下命中导航继续展开并滚到可用命中，包括长正文末尾的摘录。正文覆盖、目标身份／计数、已保存展开状态及用户导航所有权保持一致。
- History-reference landing follows the same order and initially shows the record; no extra top-level panel or new automatic scroll is introduced. / 历史引用落地遵循同样顺序，初始展示记录，不增加顶部面板或新的自动滚动。

## Work and validation / 实施与验证

- [x] Reorder both reading surfaces and check empty/error paths. / 调整两个阅读区的顺序，核对空详情及错误路径。
- [x] Update the current bilingual product/design contracts; preserve prior plans as history. / 同步当前双语产品／设计契约，保留此前计划作为历史记录。
- [x] Verify existing synthetic browser flows with long-output navigation, content/disclosure order, both presentations, narrow screens and local detail settlement. / 用既有合成浏览器流程核验长输出导航、正文／补充顺序、两种呈现、窄屏及局部详情更新。
- [x] Build/check generated assets and inspect the refreshed real viewer with Playwright. / 构建并检查生成资产，用 Playwright 查看刷新后的真实页面。

No source/API/CLI or pagination changes. Full release gates are outside this layout increment. / 本轮不修改来源／API／CLI 或分页；不重复完整发布门槛。

## Results / 结果

- 16 history/manual-search browser cases and six existing search/local-settlement regressions passed. The existing cropped-output case now verifies that explicit search navigation brings the actual excerpt mark inside both the excerpt viewport and Timeline viewport. / 16 项历史／手动搜索浏览器用例及 6 项既有搜索／局部更新回归通过。原长输出用例新增核验：显式搜索导航使摘录中的实际命中同时进入摘录视口和 Timeline 视口。
- Live inspection found the absolute-positioned collapse button overlapped the new final block. A Timeline-only bottom margin now reserves room for it; four affected narrow-screen, long-output and Trajectory cases passed again. / 实页检查发现绝对定位的收起按钮与新的末尾区块重叠，已为 Timeline 补充入口增加底部留白；再次通过 4 项受影响的窄屏、长输出及 Trajectory 用例。
- Build, generated-asset consistency and whitespace checks passed. The fixed-snapshot viewer on port 57172 was fully refreshed and verified using a real reference and manual search. Normal reference landing starts with command/result content; its closed excerpt follows that content. Manual-search Trajectory orders the excerpt before operation metadata. Presentation switches still leave active history-reference mode; this increment preserves that existing ownership rule. / 构建、生成资产一致性及空白检查通过。完整刷新 57172 固定快照查看页，用真实引用和手动搜索验收：正常引用落地首先展示命令／结果，收起的摘录位于其后；手动搜索的 Trajectory 摘录位于操作元数据之前。切换呈现仍会退出当前历史引用模式，本轮保留既有所有权规则。
- Ignored screenshots: `output/history-open-validation/excerpt-after-body-arrival.png`, `excerpt-after-body-footer.png`, `excerpt-after-body-trajectory.png`. No real transcript fixture or server restart was needed; existing services serve the rebuilt assets on refresh. / 截图位于忽略的 output/history-open-validation 目录，分别记录初始落地、卡片末尾及 Trajectory。未增加真实转录 fixture；无需重启服务，刷新即可读取新资源。
