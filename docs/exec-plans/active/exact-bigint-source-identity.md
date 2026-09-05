# Exact BigInt Codex Source Identity / Codex 精确 BigInt 来源 Identity

## Status / 状态

Implementation candidate is complete locally and frozen for independent review. Remote review, CI, package smoke, and the post-merge cleanup decision remain pending. / 实现候选已在本地完成并冻结，等待独立评审。远程 review、CI、package smoke 与合并后的 cleanup 决策仍待完成。

## Objective / 目标

Preserve exact Codex file identity across indexing, accepted-prefix materialization, whole-index reuse, and compact reuse without retaining native BigInt `Stats` objects or changing external DTOs. / 在 indexing、accepted-prefix materialization、whole-index reuse 与 compact reuse 中保留精确 Codex 文件 identity，同时不保留 native BigInt `Stats` object，也不改变外部 DTO。

## Frozen scope / 冻结范围

- Add the closed six-function helper in `src/shared/codex-source-stat.js`; normalize `dev`, `ino`, `size`, and `mtimeNs` from BigInt Stats, retain only the ephemeral snapshot fields, and preserve the existing Number/Date timestamp semantics. / 在 `src/shared/codex-source-stat.js` 增加封闭的六函数 helper；从 BigInt Stats 规范化 `dev`、`ino`、`size` 与 `mtimeNs`，只保留瞬态 snapshot 字段，并保持既有 Number／Date 时间语义。
- Replace the eight Codex lifecycle observations with one BigInt acquisition each; keep the three discovery/directory ordinary Stats observations unchanged. / 将八处 Codex lifecycle observation 各替换为一次 BigInt acquisition；保持三处 discovery／directory 普通 Stats observation 不变。
- Keep retained identity as explicit `{ device, inode }` strings, accepted bytes as safe Numbers, and metadata continuity as `mtimeMs` equality. Historical malformed or lossy retained identities must rebuild safely; same-content physical replacement must remain stale for an accepted snapshot. / retained identity 保持为显式 `{ device, inode }` 字符串，accepted bytes 保持为安全 Number，metadata continuity 使用 `mtimeMs` equality。历史畸形或有损 retained identity 必须安全 rebuild；accepted snapshot 的同内容 physical replacement 仍必须 stale。
- Do not change relationship inference, hydration, canonical schema, query-store schema, adapter error ownership, cancellation points, or S3/S5 work. / 不改变 relationship inference、hydration、canonical schema、query-store schema、adapter error ownership、cancellation point 或 S3／S5 工作。

## Implementation record / 实现记录

- Production: `src/codex.js` imports the helper, removes duplicate identity helpers, uses closed snapshots at parse/LIGHT/whole-reuse/compact-reuse sites, and keeps `makeEmptySession()` free of Stats objects. / 生产代码：`src/codex.js` 引入 helper，删除重复 identity helper，在 parse／LIGHT／whole-reuse／compact-reuse 位置使用封闭 snapshot，并保持 `makeEmptySession()` 不接收 Stats object。
- Tests: `test/codex-source-identity.test.js` covers helper/time/size behavior and compact migration; `test/codex-indexed-materialization.test.js` covers strict migration and canonical dependency identity; existing replacement premises use direct BigInt filesystem observations. / 测试：`test/codex-source-identity.test.js` 覆盖 helper／时间／size 行为与 compact migration；`test/codex-indexed-materialization.test.js` 覆盖 strict migration 与 canonical dependency identity；既有 replacement premise 使用测试侧直接 BigInt filesystem observation。
- Documentation: the product and lifecycle design docs record exact identity, safe accepted-size, migration, and stale semantics in synchronized English/Chinese text. / 文档：product 与 lifecycle design 文档以同步的中英文记录 exact identity、safe accepted-size、migration 与 stale 语义。

## Validation / 验证

Fresh local validation after the package allowlist/dependency-junction correction passed: focused Codex files 52/52, direct lifecycle files 152/152, package tests 14/14, and full `npm test` 1,018/1,018; build check and diff check also exited 0. Raw output and exit codes are recorded under the worktree-local ignored `tmp/validation/final-*` files. Independent review round 1 reported no blocking findings; root acceptance remains pending this replacement-premise correction and the remote gates below. / package allowlist／dependency junction 修正后的 fresh 本地验证已通过：Codex 聚焦文件 52/52、直接 lifecycle 文件 152/152、package tests 14/14、完整 `npm test` 1,018/1,018；build check 与 diff check 也均以 0 退出。原始输出与退出码记录在 worktree-local、被忽略的 `tmp/validation/final-*` 文件中。独立评审第 1 轮没有发现阻断问题；root acceptance 仍等待本次 replacement premise 修正与下述 remote gate。

## Review and release gates / Review 与 release 门槛

1. An independent reviewer verifies the eight one-stat observations, closed snapshot fields, negative timestamp floor, safe-size/prefix separation, retained-state boundaries, compact/strict migration behavior, replacement premises, and frozen diff scope. / 独立 reviewer 逐项确认八处一次 stat observation、封闭 snapshot 字段、负时间戳 floor、safe-size／prefix 分离、retained-state 边界、compact／strict migration 行为、replacement premise 与冻结 diff 范围。
2. Run the prescribed Node 22 Ubuntu, Node 24 Ubuntu, Node 24 Windows, browser, and Ubuntu/Windows package-smoke CI. / 运行规定的 Node 22 Ubuntu、Node 24 Ubuntu、Node 24 Windows、browser 与 Ubuntu／Windows package-smoke CI。
3. After the fix is merged into `towards-0.2.0`, verify the current PR #23 synthetic-merge CI against the latest base/head; an old workflow rerun is not sufficient closure evidence. / 修复合并到 `towards-0.2.0` 后，针对最新 base/head 验证 PR #23 synthetic-merge CI；旧 workflow rerun 不足以作为关闭证据。
4. Keep `CLEANUP_STATE: DEFERRED_PENDING_SOURCE_IDENTITY_FIX_MERGE_AND_CI` until review and CI acceptance are complete. / 在 review 与 CI 接受完成前保持 `CLEANUP_STATE: DEFERRED_PENDING_SOURCE_IDENTITY_FIX_MERGE_AND_CI`。
