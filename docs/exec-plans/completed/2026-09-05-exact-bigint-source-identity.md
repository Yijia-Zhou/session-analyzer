# Exact BigInt Codex Source Identity / Codex 精确 BigInt 来源 Identity

## Status / 状态

Completed and merged. The Exact BigInt Codex source-identity fix is present in `towards-0.2.0`; exact-head PR CI and the refreshed PR #23 synthetic-merge CI both passed. The Windows source-identity incident is closed, and the associated S3/S5 local cleanup completed successfully. / 已完成并合并。Exact BigInt Codex source-identity 修复已存在于 `towards-0.2.0`；exact-head PR CI 与刷新后的 PR #23 synthetic-merge CI 均通过。Windows source-identity incident 已关闭，相关 S3/S5 本地 cleanup 已成功完成。

## Objective / 目标

Preserve exact Codex file identity across indexing, accepted-prefix materialization, whole-index reuse, and compact reuse without retaining native BigInt `Stats` objects or changing external DTOs. / 在 indexing、accepted-prefix materialization、whole-index reuse 与 compact reuse 中保留精确 Codex 文件 identity，同时不保留 native BigInt `Stats` object，也不改变 external DTO。

## Frozen scope / 冻结范围

- Added the closed six-function helper in `src/shared/codex-source-stat.js`; it normalizes `dev`, `ino`, `size`, and `mtimeNs` from BigInt Stats, retains only ephemeral snapshot fields, and preserves the existing Number/Date timestamp semantics. / 已在 `src/shared/codex-source-stat.js` 增加封闭的六函数 helper；该 helper 从 BigInt Stats 规范化 `dev`、`ino`、`size` 与 `mtimeNs`，只保留瞬态 snapshot 字段，并保持既有 Number／Date 时间语义。
- Replaced the eight Codex lifecycle observations with one BigInt acquisition each; the three discovery/directory ordinary Stats observations remain unchanged. / 已将八处 Codex lifecycle observation 各替换为一次 BigInt acquisition；三处 discovery／directory 普通 Stats observation 保持不变。
- Retained identity is explicit `{ device, inode }` decimal strings, accepted bytes are safe Numbers, and metadata continuity uses `mtimeMs` equality. Historical malformed or lossy retained identities rebuild safely; same-content physical replacement remains stale for an accepted snapshot. / retained identity 是显式的 `{ device, inode }` 十进制字符串，accepted bytes 是安全 Number，metadata continuity 使用 `mtimeMs` equality。历史畸形或有损 retained identity 会安全 rebuild；accepted snapshot 的同内容 physical replacement 仍保持 stale。
- Relationship inference, hydration, canonical schema, query-store schema, adapter error ownership, cancellation points, and S3/S5 work were unchanged. / relationship inference、hydration、canonical schema、query-store schema、adapter error ownership、cancellation point 与 S3／S5 工作均未改变。

## Implementation record / 实现记录

- Candidate / 候选：`57a42791fd33e12f052961f98214633c025beadd`
- Merge / 合并：`fa5775c130cfc34e623ef83981393977f61b2792`
- Tree / 树：`f369581387f6b0b649f07d80ca8875728cad65d5`
- PR：`#37`
- Production: `src/codex.js` imports the helper, removes duplicate identity helpers, and uses one BigInt stat per identity-sensitive lifecycle observation at parse, LIGHT, whole-index reuse, and compact-reuse sites. Exact `device` and `inode` decimal strings are retained without changing the schema; accepted-prefix and timestamp semantics are preserved. / 生产代码：`src/codex.js` 引入 helper，删除重复 identity helper，并在 parse、LIGHT、whole-index reuse 与 compact-reuse 位置为每个 identity-sensitive lifecycle observation 使用一次 BigInt stat。保留精确的 `device` 与 `inode` 十进制字符串且不改变 schema；accepted-prefix 与 timestamp 语义保持不变。
- The compact-reuse physical identity continuity is repaired, and historical lossy retained identity safely rebuilds. `makeEmptySession()` remains free of Stats objects. / compact-reuse physical identity continuity 已修复，历史有损 retained identity 会安全 rebuild。`makeEmptySession()` 仍不接收 Stats object。
- Tests: `test/codex-source-identity.test.js` covers helper/time/size behavior and compact migration; `test/codex-indexed-materialization.test.js` covers strict migration and canonical dependency identity; existing replacement premises use direct BigInt filesystem observations. / 测试：`test/codex-source-identity.test.js` 覆盖 helper／time／size 行为与 compact migration；`test/codex-indexed-materialization.test.js` 覆盖 strict migration 与 canonical dependency identity；既有 replacement premise 使用测试侧直接 BigInt filesystem observation。

## Validation / 验证

Final recorded local evidence / 最终记录的本地证据：

- Local focused: 52/52 PASS. / 本地聚焦：52/52 PASS。
- Targeted lifecycle: 152/152 PASS. / 定向 lifecycle：152/152 PASS。
- Package unit: 14/14 PASS. / Package unit：14/14 PASS。
- Full `npm test`: 1,018/1,018 PASS. / 完整 `npm test`：1,018/1,018 PASS。
- Build check: PASS. / Build check：PASS。
- Diff check: PASS. / Diff check：PASS。
- Independent correctness review: PASS. / 独立 correctness review：PASS。

Final recorded remote evidence / 最终记录的远程证据：

- PR #37 exact-head CI: run `33967905211` / run `#113`, PASS. / PR #37 exact-head CI：run `33967905211`／run `#113`，PASS。
- Node 22 Ubuntu: PASS. / Node 22 Ubuntu：PASS。
- Node 24 Ubuntu: PASS. / Node 24 Ubuntu：PASS。
- Node 24 Windows: PASS. / Node 24 Windows：PASS。
- Browser Ubuntu: PASS. / Browser Ubuntu：PASS。
- Package smoke Ubuntu: PASS. / Package smoke Ubuntu：PASS。
- Package smoke Windows: PASS. / Package smoke Windows：PASS。

Post-merge closure / 合并后闭环：PR #23 received a newly generated synthetic-merge CI after PR #37 merged. Synthetic merge `f7ab95cc948282bd969399ec54d96932e2562ab0` passed CI run `33968411580` / `#114`; this was new closure evidence, not a rerun of the historical failing workflow. / PR #23 在 PR #37 合并后收到新生成的 synthetic-merge CI。Synthetic merge `f7ab95cc948282bd969399ec54d96932e2562ab0` 对应的 CI run `33968411580`／`#114` 已通过；这是新生成的闭环证据，不是历史失败 workflow 的 rerun。

## Root-cause and S5 disposition / 根因与 S5 处置

- `ROOT_CAUSE: DEFAULT_FS_STAT_NUMBER_PRECISION_ALIAS` / `ROOT_CAUSE：DEFAULT_FS_STAT_NUMBER_PRECISION_ALIAS`
- `S5_REGRESSION: NO_EVIDENCE` / `S5_REGRESSION：NO_EVIDENCE`
- `S5: CLOSED_UNCHANGED` / `S5：CLOSED_UNCHANGED`

The Exact BigInt issue is resolved as a default filesystem stat Number-precision alias; there is no evidence that S5 caused the bug. / Exact BigInt 问题已归因于默认 filesystem stat Number precision alias；没有证据表明 S5 导致了该 bug。

## Cleanup / Cleanup

- Local cleanup: PASS. / Local cleanup：PASS。
- S5 worktrees removed: 6. / 已移除 S5 worktree：6 个。
- source-identity worktrees removed: 3. / 已移除 source-identity worktree：3 个。
- Obsolete local feature branches removed: `perf/server-s5-pqs-direct-text-encoding`, `fix/exact-bigint-source-identity`. / 已移除 obsolete local feature branch：`perf/server-s5-pqs-direct-text-encoding`、`fix/exact-bigint-source-identity`。
- Sealed corpus deleted: 604 files / 1,922,027,069 bytes. / 已删除 sealed corpus：604 个文件／1,922,027,069 bytes。
- Retained compact closeout archive: `G:\vibe\session-analyzer-archives\S5-source-identity-closeout-2026-09-05`. / 保留的 compact closeout archive：`G:\vibe\session-analyzer-archives\S5-source-identity-closeout-2026-09-05`。
- Manifest SHA-256: `7d43d5e22880c25e07493069edc223213af0065fbe8215c16eacef632589decb`. / Manifest SHA-256：`7d43d5e22880c25e07493069edc223213af0065fbe8215c16eacef632589decb`。

## Final frozen result / 最终冻结结果

```text
EXACT_BIGINT_SOURCE_IDENTITY:
CLOSED

WINDOWS_SOURCE_IDENTITY_INCIDENT:
CLOSED

S5:
CLOSED_UNCHANGED

CLEANUP:
COMPLETE
```
