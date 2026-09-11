# Fingerprint textual hash batching / Fingerprint 文本 hash 批量写入

Base: `9c3ad1eba4b2fc5384e6450c372886006af57397`; branch `perf/fingerprint-hash-batching`. PR #55's attribution and #56's `73a6191` measurement anchor are on main. / 基线及分支如上；main 已包含 #55 归因结果及 #56 的测量锚点。

## Boundary and implementation / 边界与实现

Change only how existing textual SHA-256 input is submitted. Keep every input byte, traversal task and order, identity assignment, descriptors/prototypes/accessors, binary chunks, all seven invocations, mutation windows, 4,096-task and final yields, cancellation and error precedence. Do not optimize synchronous fingerprinting or the separate #20 reader. / 仅改变既有文本 SHA-256 输入的提交方式。保留每个输入字节、遍历 task 与顺序、identity 分配、descriptor／prototype／accessor、二进制块、七次调用、mutation 窗口、每 4,096 task 及末尾 yield、取消与错误优先级。不优化同步 fingerprint 或独立的 #20 reader。

Batch whole length-prefixed textual tokens up to 64 KiB of UTF-8 input; flush before binary updates and existing chunk boundaries. ASCII prefixes separate complete values, preventing new surrogate pairs across tokens. Oversized tokens use the existing direct prefix/value writes after flushing. Profile workload/input-byte counters retain their meanings; physical update accounting must reflect actual batches instead of assuming two calls per token. / 按完整的长度前缀文本 token 批量写入，UTF-8 输入批次上限 64 KiB；在二进制 update 和既有 chunk 边界前 flush。ASCII prefix 隔开完整 value，避免跨 token 产生新的 surrogate pair。超大 token 在 flush 后沿用既有 prefix／value 直接写入。Profile 工作量／输入字节指标含义保持不变；物理 update 计数反映真实批次，不再假定每 token 两次调用。

## Validation and experiment / 验证与实验

- Extend exact sync/async byte-stream tests across batching/Unicode/binary/chunk boundaries. Retain adapter, mutation, projection, cancellation and admission conformance tests. / 扩展同步／异步精确字节流测试，覆盖 batch／Unicode／二进制／chunk 边界，保留 adapter、mutation、projection、取消及准入测试。
- Run focused tests, build check and full Node suite after implementation; cleanup itself requires no full-suite rerun. / 实现后执行聚焦测试、build check 与完整 Node 套件；清理本身无需完整测试。
- Run quiet sequential real-HTTP before/after at exact main/candidate SHAs: 10k both plain shapes, 50k both plain shapes with repeated observations and a 50k message Zstd sanity case. Preserve cold 0→1, reading/count/source-identity invariants. Keep historical evidence untouched; do not infer improvement from historic latency alone. / 在确切 main／candidate SHA 上安静顺序进行真实 HTTP 前后比较：10k 两种 plain 形状、重复观测 50k 两种 plain 形状，以及 50k 消息 Zstd sanity；保留冷态 0→1、阅读／计数／来源身份不变量。保留历史证据，不仅凭历史时延推断改进。
- Record measured improvement, physical update reduction and limitations; keep #22 open unless its broader acceptance is satisfied. / 记录实测改进、物理 update 降幅与限制；除非满足更广验收，否则保持 #22 开放。

## Local cleanup / 本地收口

The main checkout is clean at the base above. Clean merged PR54/55 worktrees and the three named local branches were removed; no PR56 worktree or insurance branches existed. Only the verified stale push/auth process tree from this session was stopped to release an empty worktree directory. Raw evidence was moved to main-checkout `tmp/cold-attribution/` (12 files, 384,887 bytes) and `tmp/fingerprint-attribution/` (43 files, 2,104,106 bytes), with every file verified by SHA-256. Unrelated worktrees and remote branches were retained. / 主 checkout 在上述基线上干净。已移除 clean 且合并的 PR54／55 worktree 及三个指定本地分支；不存在 PR56 worktree 或保险分支。为释放空目录，仅停止已核验属于本会话的旧 push／认证进程树。原始证据迁至主 checkout 的两个 ignored 目录，逐文件 SHA-256 核验一致；保留无关 worktree 和远端分支。

## Progress / 进度

Cleanup complete; implementation and validation in progress. / 清理完成，实现与验证进行中。
