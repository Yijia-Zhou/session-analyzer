# Tech Debt Tracker / 技术债跟踪器

## Open items / 未关闭条目

### 1. Protocol label quality / 协议标签质量
- Status: open / 状态：开放
- Problem: some future protocol event labels can still be generic or mechanically derived / 问题：一些未来协议事件标签仍可能很泛化，或是机械派生出来的
- Residual risk: current high-value protocol events now have focused labels and fixtures, but future Codex protocol payloads can still fall back to mechanically derived labels until new subtype display metadata is added. / 残余风险：当前高价值协议事件已有聚焦标签和 fixture，但未来 Codex 协议载荷仍可能回退到机械派生标签，直到为新的子类型补充展示元数据。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 2. Historical transcript coverage / 历史转录覆盖
- Status: open / 状态：开放
- Problem: many older transcript shapes are only partially represented in fixtures / 问题：许多较旧的转录形态在 fixture 中只有部分表示
- Residual risk: fixture coverage is targeted rather than exhaustive; current incomplete tool begin/declined rows are covered, but sparse metadata, malformed JSONL, and new MCP, collaboration, hook, approval, dynamic tool, or image generation shapes may still need new fixtures as they appear. / 残余风险：fixture 覆盖是针对性的而非穷尽式的；当前不完整工具 begin/declined 行已有覆盖，但稀疏 metadata、格式异常 JSONL，以及新的 MCP、协作、hook、approval、dynamic tool 或图像生成形态出现时仍可能需要新增 fixture。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 3. Session title inference / 会话标题推断
- Status: open / 状态：开放
- Problem: fallback titles can still be noisy when indexed or configured thread naming is missing / 问题：缺少索引或 configured thread naming 时，回退标题仍可能有噪声
- Residual risk: `session_configured.thread_name` now improves current transcripts, but sessions without indexed/configured thread names and without a clean main-layer user task line can still fall back to generic or noisy text. / 残余风险：`session_configured.thread_name` 已改进当前转录，但没有索引/configured 线程名且缺少干净 main 层用户任务文本的 session 仍可能回退到泛化或带噪声的文本。
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 4. Optional persistent index / 可选持久索引
- Status: deferred / 状态：已推迟
- Problem: startup cost may grow once the local transcript corpus becomes much larger / 问题：一旦本地转录语料变得大得多，启动成本可能增长
- Residual risk: startup remains in-memory and full-scan based; larger transcript corpora may need a local cache with invalidation, versioning, and migration rules. / 残余风险：启动仍基于内存中的全量扫描；更大的转录语料可能需要带失效、版本和迁移规则的本地缓存。
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/design-docs/logical-event-timeline.md`

### 5. Review finding real-data validation / Review finding 真实数据验证
- Status: open / 状态：开放
- Problem: review lifecycle parsing is covered by official core protocol schema and artificial fixtures, but local real-world transcripts observed so far only include empty `review_output.findings` arrays. / 问题：review 生命周期解析已有官方 core protocol schema 和人工 fixture 覆盖，但目前观察到的本地真实转录只包含空的 `review_output.findings` 数组。
- Residual risk: rendering of non-empty `review_output.findings[]` may need adjustment once a real transcript with findings is available, especially for field presence, priority/confidence formatting, and code location shapes. / 残余风险：一旦拿到包含 findings 的真实转录，非空 `review_output.findings[]` 的渲染可能仍需调整，尤其是字段存在性、priority/confidence 格式和代码位置形态。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/product-specs/session-transcript-analyzer.md`
