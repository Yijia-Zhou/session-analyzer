# Code Mode detail-presentation contract convergence / Code Mode detail 展示契约收敛

## Objective / 目标

Audit the existing Code Mode detail-presentation vocabulary, classify every produced, admitted, documented, or rendered value, then extract the stable `variant`, request-evidence, and result-association semantics into one shared contract consumed by producers, the detail sanitizer, and browser presentation code. Preserve the separate timeline-fact and detail DTO boundaries and leave canonical kind, query facets, and presentation context unchanged.

审计现有 Code Mode detail 展示词汇，对所有会被生成、准入、记录或渲染的值进行分类，再把稳定的 `variant`、请求证据与结果关联语义提取为由 producer、detail sanitizer 和浏览器展示代码共同消费的一份共享契约。保持 timeline fact 与 detail DTO 的独立边界，不改变 canonical kind、查询 facet 或 presentation context。

## Status and ownership / 状态与负责人

- Owner: repository maintainers / 负责人：仓库维护者
- Status: completed / 状态：已完成
- Started: 2026-07-30 / 开始日期：2026-07-30
- Completed: 2026-07-30 / 完成日期：2026-07-30
- Related design: `docs/design-docs/cross-surface-contract-consistency-tech-debt.md` / 相关设计：`docs/design-docs/cross-surface-contract-consistency-tech-debt.md`
- Domain language: `CONTEXT.md` / 领域语言：`CONTEXT.md`

## Fixed scope / 固定范围

1. Classify `single_tool`, `multi_tool`, `raw_code_mode`, `declared_source`, `observed_lifecycle`, `exact`, `exact_identity`, `bounded`, `bounded_order`, and `none`. / 对 `single_tool`、`multi_tool`、`raw_code_mode`、`declared_source`、`observed_lifecycle`、`exact`、`exact_identity`、`bounded`、`bounded_order` 与 `none` 进行分类。
2. Add one browser-safe shared contract for stable presentation values, validation, sanitizer vocabulary projection, and semantic badge identity. / 增加一份浏览器安全的共享契约，集中管理稳定展示值、校验、sanitizer 词汇投影与语义 badge identity。
3. Make declared-call producers, timeline request facts, detail presentation, browser app, and section renderer consume the stable contract where their meanings are identical. / 让声明调用 producer、timeline request fact、detail presentation、浏览器 app 与 section renderer 在含义相同时消费稳定契约。
4. Keep timeline facts and detail presentation as distinct DTOs and sanitizers. / 保持 timeline fact 与 detail presentation 为不同 DTO 和 sanitizer。
5. Do not consolidate `code_mode_operation`, `code_mode_script_operation`, or `enclosed_by_code_mode_operation`. / 不收敛 `code_mode_operation`、`code_mode_script_operation` 或 `enclosed_by_code_mode_operation`。

## Implementation phases / 实施阶段

### Phase 1: vocabulary audit / 第一阶段：词汇审计

- Trace each value through current producers, sanitizer admission, domain documentation, browser consumers, and repository history. / 追踪每个值的当前 producer、sanitizer 准入、领域文档、浏览器消费方与仓库历史。
- Record each value as producer-supported, compatibility/reserved, or rejected with a concrete rationale. / 将每个值记录为 producer-supported、compatibility/reserved 或 rejected，并给出具体理由。

### Phase 2: bounded contract extraction / 第二阶段：有界契约提取

- Add shared constants and predicates without creating a catch-all Code Mode registry. / 增加共享常量和谓词，不创建包罗万象的 Code Mode registry。
- Centralize badge eligibility and semantic identity while retaining renderer-owned markup and layout. / 集中管理 badge 资格与语义 identity，同时保留 renderer 自有的 markup 与布局。
- Remove rejected aliases from sanitizer and renderer recognition. / 从 sanitizer 与 renderer 识别中移除 rejected alias。

### Phase 3: proof and closeout / 第三阶段：证明与收口

- Add table-driven vocabulary, sanitizer, producer, renderer, rejection-fallback, and DTO-ownership tests. / 增加表驱动的词汇、sanitizer、producer、renderer、拒绝回退与 DTO ownership 测试。
- Regenerate the browser asset, run focused and full validation, update the design record and tracker, then archive this plan only after all checks pass. / 重新生成浏览器资产，运行聚焦与完整验收，更新设计记录与 tracker，并且只在全部检查通过后归档本计划。

## Acceptance criteria / 验收标准

1. Every audited value has one documented lifecycle classification. / 每个已审计值都有一项记录在案的生命周期分类。
2. The detail sanitizer accepts exactly the stable producer-supported and reserved values and rejects stale aliases. / Detail sanitizer 只接受稳定的 producer-supported 与 reserved 值，并拒绝陈旧 alias。
3. Browser app and section renderer derive badge eligibility from the same contract. / 浏览器 app 与 section renderer 从同一契约派生 badge 资格。
4. `declared_source` is shared without merging timeline and detail DTO ownership. / 共享 `declared_source`，但不合并 timeline 与 detail DTO ownership。
5. Generated assets, Node tests, browser tests, package smoke, build check, and diff check pass. / 生成资产、Node 测试、浏览器测试、package smoke、build check 与 diff check 全部通过。

## Progress log / 进度日志

- 2026-07-30: Started the bounded implementation after design review selected the extended option A. Repository history confirms `exact` is a documented reserved association because no persisted identity edge currently exists; the remaining aliases require explicit classification before extraction. / 2026-07-30：设计复核选择扩展版方案 A 后开始有界实现。仓库历史确认：由于当前不存在持久化 identity 边，`exact` 是已有文档定义的 reserved 关联；其余 alias 必须在提取前明确分类。
- 2026-07-30: Completed the vocabulary audit. `single_tool`, `multi_tool`, `raw_code_mode`, `declared_source`, `bounded`, and `none` are producer-supported; `exact` is reserved and intentionally admitted; `observed_lifecycle`, `exact_identity`, and `bounded_order` are rejected because they have no producer, persisted compatibility requirement, or canonical documented meaning, and `observed_lifecycle` would blur independent Observed Nested Activity ownership. / 2026-07-30：完成词汇审计。`single_tool`、`multi_tool`、`raw_code_mode`、`declared_source`、`bounded` 与 `none` 属于 producer-supported；`exact` 属于有意准入的 reserved 值；`observed_lifecycle`、`exact_identity` 与 `bounded_order` 因没有 producer、持久化兼容要求或 canonical 文档语义而被拒绝，并且 `observed_lifecycle` 会模糊独立的 Observed Nested Activity ownership。
- 2026-07-30: Added `src/shared/code-mode-presentation-contract.js`, moved producer and sanitizer vocabulary decisions plus semantic badge identity onto it, removed rejected renderer aliases and dormant UI resources, retained separate timeline/detail DTO ownership, and regenerated the browser bundle. / 2026-07-30：增加 `src/shared/code-mode-presentation-contract.js`，把 producer 与 sanitizer 的词汇决策以及语义 badge identity 收敛到该契约，移除被拒绝的 renderer alias 与休眠 UI 资源，保持 timeline/detail DTO ownership 分离，并重新生成浏览器 bundle。
- 2026-07-30: Validation passed with focused tests 75/75, full Node tests 301/301, browser tests 83/83, package smoke, generated-asset build check, `git diff --check`, and a restarted default local server returning HTTP 200 on port 17890. / 2026-07-30：验收通过聚焦测试 75/75、完整 Node 测试 301/301、浏览器测试 83/83、package smoke、生成资产 build check、`git diff --check`，并且默认本地服务已重启且在 17890 端口返回 HTTP 200。
