# Tech Debt Tracker / 技术债跟踪器

## Open items / 未关闭条目

### 1. Protocol label quality / 协议标签质量
- Status: open / 状态：开放
- Problem: some protocol event labels are still generic or mechanically derived / 问题：一些协议事件标签仍然很泛化，或是机械派生出来的
- Residual risk: future Codex protocol payloads can still fall back to mechanically derived labels until new subtype display metadata and fixtures are added. / 残余风险：未来 Codex 协议载荷仍可能回退到机械派生标签，直到为新的子类型补充展示元数据和 fixture。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 2. Historical transcript coverage / 历史转录覆盖
- Status: open / 状态：开放
- Problem: many older transcript shapes are only partially represented in fixtures / 问题：许多较旧的转录形态在 fixture 中只有部分表示
- Residual risk: fixture coverage is targeted rather than exhaustive; older call-only web search records, missing `event_msg:*_end` rows, sparse tool metadata, malformed JSONL, and new MCP or collaboration shapes may still need new fixtures as they appear. / 残余风险：fixture 覆盖是针对性的而非穷尽式的；较旧的仅调用 web search 记录、缺少 `event_msg:*_end` 的行、稀疏工具元数据、格式异常 JSONL，以及新的 MCP 或协作形态出现时仍可能需要新增 fixture。
- Related docs: / 相关文档：
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/exec-plans/completed/2026-04-21-transcript-normalization-followups.md`

### 3. Session title inference / 会话标题推断
- Status: open / 状态：开放
- Problem: fallback titles can still be noisy when thread naming is missing / 问题：缺少线程命名时，回退标题仍可能有噪声
- Residual risk: sessions without thread names and without a clean main-layer user task line can still fall back to generic or noisy text, especially command-only sessions, copied-context sessions, malformed records, or future fork metadata shapes. / 残余风险：没有线程名且缺少干净主层用户任务文本的 session 仍可能回退到泛化或带噪声的文本，尤其是纯命令 session、复制上下文 session、格式异常记录或未来 fork 元数据形态。
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
