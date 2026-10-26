# pi query text sharing / pi 查询文本共享

## Boundary / 边界

Pi's branch Sessions repeat shared history in the query store. Once the existing memory budget spills to disk, preview and search text can occupy the same immutable range when their encoded bytes are equal. Row metadata stays branch-local: equal physical call IDs do not prove equal tool output, status, pairing or search text. / pi 的分支会话在查询存储重复共享历史。现有内存预算触发磁盘溢出后，preview 与 search text 若编码字节相同，可指向同一不可变范围。行 metadata 仍属于各自分支：物理调用 ID 相同并不能证明工具输出、状态、配对或搜索文本相同。

Only the pi builder enables `shareTextRanges`. Schema-2 memory packing and spill thresholds stay unchanged, as do schema-3's range format, row ordering, identities, projection digests and search contract. No source file is modified. Reuse can cross fields, layers and Sessions within one disposable store. / 仅 pi builder 启用所列选项。Schema-2 内存打包与溢出阈值保持不变，schema-3 范围格式、行序、身份、投影摘要及搜索契约也不变；不修改来源文件。单个临时存储内可跨字段、层和会话复用。

## Candidate index and equality / 候选索引与相等

A builder-local bounded index maps encoded byte length and SHA-256 to a candidate range. Hashes select candidates; exact chunked byte comparison decides reuse. A mismatch writes the ordinary new range, so a hash collision cannot alias different text. Preview and search text are considered independently. / builder 内有界索引将编码字节长度及 SHA-256 映射到候选范围；哈希选择候选，分块逐字节比较决定复用。不相等时正常写入新范围，哈希碰撞不会让不同文本共用范围；preview 与搜索文本分别判断。

The cache retains digest keys and numeric descriptors, without transcript strings or payload buffers. Defaults are 16,384 candidates and 4 MiB accounted descriptor/key data, using twice the key length plus 32 bytes per entry; the count cap separately bounds engine-specific object overhead. These are not an exact V8 heap limit. Internal validated nonnegative safe-integer controls permit zero/tiny budgets for disabled/eviction checks. Deterministic LRU eviction changes efficiency only. Encoding uses at most 65,536 UTF-16 code units per slice, keeps surrogate pairs together and bounds temporary buffers; hashing/comparison yield and check cancellation like writing. Clear candidate state on terminal builder paths and preserve existing resource exhaustion, cleanup and committed-store ownership. / 缓存只保留摘要键和数字描述符，不保留转录字符串或 payload buffer。默认上限为 16,384 个候选及 4 MiB 核算描述符／键数据，每项按键长度两倍加 32 字节计算，项数上限另约束引擎特有对象开销；这些并非精确 V8 堆上限。内部选项校验为非负安全整数，可用零／小预算检查禁用及淘汰。确定性 LRU 淘汰只影响效率。编码每片最多 65,536 个 UTF-16 code unit，保持代理对完整并约束临时 buffer；哈希／比较与写入一样让出执行并检查取消。builder 终止路径清理候选，保留现有资源耗尽、清理及已提交存储所有权。

## Cost and remaining work / 成本与剩余工作

Actual query file bytes remain the store's accounted bytes. Hashing and comparison add index CPU and read I/O; metadata pages and commit verification still scale with projected rows. Small stores receive no disk-sharing benefit. Do not infer proportional total-file savings, faster searches or real-corpus capacity guarantees from shared-prefix size. / 存储核算字节仍等于真实查询文件字节。哈希与比较增加索引 CPU 和读取 I/O；metadata 页与提交验证仍随投影行数增长，小存储不获得磁盘共享收益。不可从共享前缀规模推断等比例总文件节省、更快搜索或真实语料容量保证。

Request-level text-match caching and physical search-hit deduplication are separate decisions. This increment preserves repeated branch hits and performs existing searches over the shared ranges. Full recorded-context projection, native patch/project aggregation, extension rendering and cross-file navigation remain independent work. / 请求级文本匹配缓存及物理搜索命中去重单独决策。本批保留重复分支命中，沿用现有搜索读取共享范围。完整记录上下文投影、原生 patch／项目聚合、扩展渲染和跨文件导航另行推进。

Implementation, parity checks, matched capacity observations and review evidence belong in the [execution plan](../exec-plans/completed/2026-10-25-pi-query-text-sharing.md). / 实现、语义对照、匹配容量观测及审查依据见执行计划。
