# DeepSeek attempt search completeness / DeepSeek attempt 搜索完整性

Historical result: the bounded-search contract below was superseded by the October capacity work; Detail remains bounded, while admitted settled attempt text/reasoning are fully searchable. See [current design](../../design-docs/deepseek-format4-compatibility.md#replacement-bounds-and-completed-stream-blocks--替换边界与完整流块). / 历史结果：下述有界搜索契约已被十月容量工作替代；Detail 仍有界，允许的 settled attempt 正文／推理已可全文搜索。现行设计见链接。

- Status: completed / 状态：已完成
- Baseline: `feat/deepseek-latest-compatibility` at `5cb42d0d31ae8b35b213a0eb76337f763cc1e87d`. / 基线：上述分支及 commit。
- Scope: retain both already bounded attempt content projections in search; register range-expansion capacity work separately. / 范围：让已经有界的 attempt 两类内容投影均可搜索；另行登记区间展开容量工作。

## Findings and contract / 发现与契约

The shared stream extractor retains text and reasoning independently (16,000 JavaScript string code units each), but previously merged original block content into one competing 16,000-unit search budget. Protocol prefixing and logical construction truncate again. Synthetic normal-path probes reproduced lost search matches for both block orders, completed/open blocks, and a single projection's tail after prefixing. Detail and exact Raw retained those values; no Main message or execution was introduced. / 共享提取器对正文与推理分别保留 16,000 个 JavaScript 字符串 code unit，但此前将原块内容合并到同一竞争预算；Protocol 前缀和逻辑构造再次截断。正常路径合成探针复现两种顺序、完整／未闭合块及前缀挤掉单投影尾部的搜索漏报；详情和 Raw 保留内容，未引入 Main 消息或执行。

Search must combine the final retained text and reasoning projections without further loss, bounded by their two limits plus a separator and event-type prefix. Other Protocol events keep their existing search budget. Preview selects visible text first, with reasoning fallback. Source assembly, first completed block precedence, per-kind order, sanitization, Protocol placement, and Raw ownership remain intact. No full-content search, canonical DTO change, range-decoder rewrite, or arbitrary expansion cutoff is part of this fix. / 搜索必须合并最终保留的正文／推理投影而不再次丢失，上限由两类预算、分隔符及事件类型前缀组成；其他 Protocol 事件沿用既有预算。预览优先正文、无正文时使用推理。保持来源组装、首个完整块优先、同类型顺序、脱敏、Protocol 归属与 Raw ownership。不扩展全文搜索、canonical DTO、区间解码器或任意展开阈值。

## Execution / 执行

- [x] Reproduce with focused synthetic regressions before implementation. / 先通过聚焦合成回归复现。
- [x] Fix extraction, preview, Raw search and Logical search without downstream recutting. / 修复提取、预览、Raw 搜索及逻辑搜索，避免下游再次截断。
- [x] Document the product/design contract and range capacity matrix with measured-evidence boundaries. / 同步产品／设计契约，登记区间容量矩阵及实测证据边界。
- [x] Run affected tests, full Node suite and build check; inspect query/Detail/Raw parity. / 执行受影响测试、完整 Node 及构建检查，核验查询／详情／Raw 一致性。
- [x] Review, refresh the local acceptance server and archive the completed plan. / 复核、刷新本地验收服务并归档。

## Implementation and validation / 实现与验证

`embeddedStreamFacts()` concatenates the final independently bounded projections. Attempt preview independently prefers text, and Protocol construction allows the derived 32,019-code-unit bound including prefix and separator. Other event limits are unchanged. Six new tests plus one strengthened existing test cover both block orders, closed/open blocks, over-budget same-kind blocks, prefix displacement, both full projections, index/materialized parity, Session/project Protocol/Raw queries, Detail and exact Raw. All fixtures are synthetic. / 提取器拼接最终独立有界投影；attempt 预览独立优先正文，Protocol 构造允许包含前缀与分隔符的 32,019 code unit 推导上限。其他事件预算不变。新增六项并加强一项既有测试，覆盖两种顺序、闭合／未闭合块、同类超预算块、前缀挤占、两类满预算投影、索引／物化一致性、会话／项目 Protocol／Raw 查询、详情与精确 Raw。Fixture 均为合成。

Executed locally on 2026-09-30 / 2026-09-30 本地实际执行：

- Before the fix, all seven affected regressions failed; after the fix, `node --test test/deepseek-harness-format4-detail.test.js` passed **15/15**. / 修复前七项相关回归均失败；修复后详情测试 15/15 通过。
- `node --test test/deepseek-harness*.test.js test/session-query-store.test.js test/trajectory-presentation.test.js test/i18n.test.js`: **231/231 passed**. / 聚焦测试 231/231 通过。
- `npm test`: **1305/1305 passed**. / 全套 1305/1305 通过。
- `npm run build:check`: passed; generated assets current. No browser/shared source or new runtime source file was added. / 构建检查通过，生成资产最新；未修改 browser/shared，也未新增运行时源码文件。
- `git diff --check`: passed. / 空白检查通过。
- Browser acceptance against three ignored synthetic Sessions: five project Protocol queries each returned exactly one Session/event, including long text/reasoning tails and a short second projection; navigation displayed `VISIBLE_TEXT_NEEDLE` as preview, expanded Detail displayed both retained projections, and Raw search matched the same record. One automation attempt failed because the CLI VM lacked global `URL`; a corrected string-based response matcher completed successfully. / 浏览器对三个忽略目录中的合成会话验收：五个项目 Protocol 查询各命中一个会话／事件，包含长正文／推理尾部及第二类短投影；跳转后短正文可见于预览，展开详情显示两类投影，Raw 搜索命中同一记录。一次自动化因 CLI VM 无全局 URL 失败，改用字符串响应匹配后成功完成。
- Restarted the original lab Analyzer at `http://127.0.0.1:17890/`: intended workspace/source root, **23 Sessions, zero diagnostics**, successful indexing, prior real rc.2 late reply still passes Main, bilingual Detail, search and Raw checks; source hashes unchanged. This re-reads existing writer evidence and is **not a new DSH writer run** for the long-content boundary. / 重启原 lab Analyzer：目标项目／来源根正确，23 个会话、零诊断、索引成功；此前真实 rc.2 late reply 的 Main、双语详情、搜索与 Raw 回归仍通过，来源哈希未变。这是重读已有 writer 证据，**不是本次长内容边界的新 writer 实验**。

Local ignored logs: `tmp/dsh-attempt-search-{red,green,focused,full,build-check}.log`; lab HTTP report: `tmp/dsh-rc2-lab-http.json`. No GitHub CI claim is made. / 本地忽略日志与 lab HTTP 报告如前；不声称 GitHub CI 已通过。

## Remaining boundary / 剩余边界

Full over-budget search remains deferred. Range decoding is unchanged; [debt 30](../tech-debt-tracker.md) records the observed allocation/work growth, admission constraints, bounded probe results and follow-up capacity matrix. There is no arbitrary expansion cap and no claim of completed large-scale stress validation. / 超预算全文搜索留待后续；区间解码不变，债务 30 记录已观察分配／工作增长、准入约束、有界探针结果及后续容量矩阵。不添加任意展开上限，不声称完成大规模压力验收。
