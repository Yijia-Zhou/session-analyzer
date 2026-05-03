# Tech Debt Tracker / 技术债跟踪器

## Open items / 未关闭条目

### 1. Protocol label quality / 协议标签质量
- Status: open / 状态：开放
- Problem: some protocol event labels are still generic or mechanically derived / 问题：一些协议事件标签仍然很泛化，或是机械派生出来的
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

### 2. Historical transcript coverage / 历史转录覆盖
- Status: open / 状态：开放
- Problem: many older transcript shapes are only partially represented in fixtures / 问题：许多较旧的转录形态在 fixture 中只有部分表示
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

### 3. Session title inference / 会话标题推断
- Status: open / 状态：开放
- Problem: fallback titles can still be noisy when thread naming is missing / 问题：缺少线程命名时，回退标题仍可能有噪声
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/exec-plans/active/2026-04-21-transcript-normalization-followups.md`

### 4. Optional persistent index / 可选持久索引
- Status: deferred / 状态：已推迟
- Problem: startup cost may grow once the local transcript corpus becomes much larger / 问题：一旦本地转录语料变得大得多，启动成本可能增长
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/design-docs/logical-event-timeline.md`
