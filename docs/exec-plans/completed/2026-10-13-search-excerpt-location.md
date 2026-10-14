# Reliable excerpt positions / 可信的摘录位置

Status: completed locally on `feat/history-evidence-open`, 2026-10-13; uncommitted. / 状态：2026-10-13 在现有功能分支本地完成，未提交。

Show a muted location row only inside an expanded search supplement, immediately above its text. Use existing, internally consistent `search_projection` line coordinates: “Search text · Lines 128–132 · Match on line 130”, or just “Search text · Match on line 130” for a single-line excerpt. Clarify the coordinate basis in the row's tooltip. These are event search-text lines, not transcript-file or rendered-body lines. Do not infer tool-result fields or line numbers for ordinary manual snippets. / 仅在展开的搜索补充内、摘录文本正上方显示弱化的位置行。使用既有且相互一致的 search_projection 行坐标，如“搜索文本 · 第 128–132 行 · 命中第 130 行”；单行摘录简化为“搜索文本 · 命中第 130 行”。位置行提示说明坐标依据。这些是事件搜索文本的行号，不是转录文件或页面正文行号；不推断工具结果字段，也不为普通手动搜索片段推算行号。

- [x] Add guarded localized metadata without changing disclosure order or search targets. / 增加经校验的本地化元信息，不改变展开顺序或搜索目标。
- [x] Update bilingual product/design contracts. / 同步双语产品／设计契约。
- [x] Check valid, missing and inconsistent coordinates, narrow-screen reading, existing coverage/navigation, and built assets; refresh the live viewer. / 核验有效、缺失及不一致坐标、窄屏阅读、既有覆盖／导航及构建资源，并刷新实页。

No new search protocol or server-side indexing work in this increment. / 本轮不增加搜索协议或服务端索引工作。

Validation: 25 focused Node tests and six browser scenarios passed, covering coordinate rejection, bilingual labels, metadata excluded from highlights, narrow-screen hit visibility, redundant excerpts, failed/delayed detail and manual snippets without fabricated locations. Build/check and whitespace checks passed. The existing viewer on port 57172 was refreshed; a real reference displays “搜索文本 · 第 3–6 行 · 命中第 6 行” only after expansion. Its 390px viewport has no location-row overflow. Ignored screenshots: `output/history-open-validation/excerpt-location-desktop.png` and `excerpt-location-mobile.png`. Full release/package suites were not repeated for this presentation increment. / 验证：25 项针对性 Node 测试及 6 项浏览器场景通过，覆盖无效坐标拒绝、双语标签、元信息不参与高亮、窄屏命中可见、冗余摘录、失败／延迟详情及手动片段不推算位置。构建／一致性及空白检查通过。刷新 57172 现有查看页后，真实引用在展开时显示“搜索文本 · 第 3–6 行 · 命中第 6 行”；390px 视口内位置行无溢出。截图保存于忽略的 output/history-open-validation 目录。本次呈现层增量未重复全量发布／安装包测试。
