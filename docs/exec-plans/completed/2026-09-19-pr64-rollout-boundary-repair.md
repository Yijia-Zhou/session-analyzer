# PR #64 boundary repair / PR #64 边界修复

Scope: repair R1 compressed chunk-boundary parsing and R2 ancestry only; retain the existing A–E compatibility scope and pinned upstream `openai/codex@e269f2164cbb9f499e4f22301c393500e2a831f3`. No full Paginated history implementation, merge or package publication. / 范围仅为 R1 压缩 chunk 边界解析和 R2 祖先链修复；保留现有 A–E 兼容范围与固定上游依据。不实现完整 Paginated history，不合并或发布包。

## Baseline and history / 基线与历史

- Initial checkout was clean at review head `6d9fe658528dc72cbcf5f78814c0f774af34fdaa`; origin is `git@github.com:Yijia-Zhou/session-analyzer.git`. Read current README, AGENTS and development requirements. Fetch confirmed main `4f319c51abf0e9f03d38386ec7655071807ba3ca` and unchanged remote feature head. / 起始工作树干净，已阅读当前 README、AGENTS 和开发要求；fetch 确认 main 与远端 feature head 如上。
- Verified `1526a52a185785bc5da498860da13585d7555944` and current main share tree `9b75c06024288fa41d8cb0735c6bf17d34e89336`. Preserved local branch `backup/pr64-before-repair-20260919`, then rebased only `b25a750` and `6d9fe65` onto main, producing `c985681` and `2073549`. Full tree diff against the backup was empty after transplant; old CI/AGENTS commits were not replayed. / 已核验旧起点与当前 main 的 tree 相同。保留本地备份后，仅迁移两个兼容提交；迁移后与备份的完整 tree diff 为空，没有重放旧 CI／AGENTS 提交。
- Remote PR readback at the start: head `6d9fe65`, mergeable false, description empty, no PR workflow runs for that head. This is not a passing CI result. Remote history rewrite requires additional explicit authorization and an exact expected-head lease. / 起始远端 PR 回读：旧 head、不可合并、描述为空、该 head 无 PR workflow run；这不是 CI 通过。远端改写历史需要额外明确授权及固定预期 head 的 lease。

## Repair and evidence / 修复与依据

- Added a descriptor-byte availability guard; no offset advance or undefined read when magic consumes the final byte. Reviewed counted header, block header, checksum, skippable and complete transitions: remaining counts preserve partial input, and zero-length final payloads complete without waiting for nonexistent bytes. Backpressure, cancellation, snapshot cleanup and source read-only policy are unchanged. / 加入 descriptor 字节可用性检查；magic 消费最后字节时不越界增加 offset 或读取 undefined。已审阅按计数的 header、block header、checksum、skippable 与 complete 转换：保留部分输入计数，零长度末尾 payload 无需等待不存在的字节即可完成。背压、取消、快照清理和来源只读策略保持不变。
- Actual checkout, Node `v24.18.1`, npm `12.0.2`: `node --test test/codex-rollout-chunk-boundaries.test.js` before fix **3 passed / 7 failed**, after fix **10 passed / 0 failed**. Native and whole-frame controls, content-size/checksum magic boundaries, two exact 65,532-byte-prefix/default-65,536-byte-read cases, all small chunk sizes, unknown-size/skippable/empty-block combinations, truncated input and checksum corruption. Fixtures are synthetic OS-temp files. / 实际 checkout 与上述工具链中，修复前 **3 通过／7 失败**，修复后 **10 通过／0 失败**。覆盖原生与完整帧对照、两类 magic 边界、精确默认文件读取边界、各小 chunk 大小及组合、截断与 checksum 损坏；fixture 均为 OS 临时目录中的合成数据。
- These are newly run repository tests, distinct from the reviewer's isolated Node 22 reproduction and the previous implementation's validation report. / 这些是本次新执行的仓库测试，与审查者隔离的 Node 22 复现及上一轮作者验收记录分开。

## Validation on 2026-09-19 / 2026-09-19 验证

All results below were run locally on Windows / Node 24.18.1 / npm 12.0.2 after this repair; none are reused from the prior implementation report. / 以下均为修复后在上述 Windows 工具链本地重新运行，不复用上一轮报告。

| Command / 命令 | Result / 结果 |
| --- | --- |
| `node --test test/codex-rollout-chunk-boundaries.test.js test/codex-rollout-storage.test.js test/codex-rollout-snapshots.test.js test/codex-rollout-acceptance.test.js test/codex-source.test.js` | 44 passed, 0 failed / 44 通过、0 失败 |
| `npm test` | 1196 passed, 0 failed, 0 skipped / 1196 通过、0 失败、0 跳过 |
| `npm run build` and `npm run build:check` | Passed; generated assets unchanged / 通过，生成资产未变化 |
| `npm run test:browser` | 245 passed, 0 failed, 0 skipped / 245 通过、0 失败、0 跳过 |
| `npm run test:package` | Passed; Codex plain/compressed, Claude and DeepSeek plain/compressed Timeline → Detail → Raw / 通过，覆盖各来源及压缩形式的读取链路 |
| `npm run test:profile-coverage` | Independent serial run after all suites ended; residuals 1.1635, 0.6113, 0.7779 ms; minimum 0.61 ms ≤ 5 ms / 所有套件结束后独立串行运行，最小 residual 满足门槛 |
| `git diff --check`, local Markdown references and bilingual review / 本地 Markdown 引用与双语检查 | Passed / 通过 |

The added adapter fixture discovers and indexes a synthetic concatenated rollout at the default file boundary, with no corrupt diagnostic, then verifies exact user/tool Raw records and logical Detail → Raw agreement. No real transcripts or exports were added. `git range-diff` confirms both transplanted patches are identical; README, AGENTS and CI workflow match current main. / 新增 adapter fixture 在默认文件边界发现并索引合成拼接 rollout，无损坏误报，随后核对用户／工具的精确 Raw 记录与逻辑 Detail → Raw 一致性。未添加真实转录或导出。range-diff 确认两个迁移补丁完全相同；README、AGENTS 与 CI workflow 均与当前 main 一致。

## Delivery and CI evidence / 交付与 CI 依据

The user subsequently explicitly authorized the exact-lease push and PR-description update. Pushed repair head `fc29e46461013d2282b7a2747a8f882e40aaf367` with expected remote head `6d9fe658528dc72cbcf5f78814c0f774af34fdaa`, then updated PR #64's bilingual description. GitHub reported `mergeable: true`; the PR remains open and unmerged. / 用户随后明确授权精确 lease 推送与 PR 描述更新。按上述远端预期 head 推送修复 head，并更新 PR #64 双语描述。GitHub 报告可合并；PR 仍打开且未合并。

[CI run 35426304623](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/35426304623) completed successfully for repair head `fc29e46461013d2282b7a2747a8f882e40aaf367`, testing merge SHA `c7319e5b2200bea6f52f1b40588f4dc326336fcb` against main `4f319c51abf0e9f03d38386ec7655071807ba3ca`. All three Node matrix jobs (22/Ubuntu, 24/Ubuntu, 24/Windows), both package jobs, Ubuntu browser and the aggregate CI gate passed. Node 22 logs independently confirm the test-merge checkout and 1196/1196 tests. The merge and repair-head trees both equal `13a6a532364c95918087ee0cbc75c4c63a718040`. / 上述 CI run 对修复 head 的测试合并 SHA 执行成功；三个 Node 矩阵任务、两个打包任务、Ubuntu 浏览器和汇总 CI 门槛全部通过。Node 22 日志独立确认测试合并 checkout 与 1196/1196 测试；测试合并和修复 head 的 tree 相同。

The existing checkout server was restarted with the corrected reader. Its selected Codex project index succeeded with 743 sessions and zero source diagnostics; actual real-history browser reading was not repeated in this repair session. No transcript/configuration writes, package publication or merge occurred. This archive records the repair-head CI above; any later documentation-only head must be checked separately and reported with its own CI identity. / 已重启原 checkout 服务以加载修正后的 reader。所选 Codex 项目索引成功，743 个会话、零来源诊断；本修复会话未重做真实历史浏览器阅读。未写入来源转录／配置，未发布包或合并。本归档记录上述修复 head 的 CI；后续纯文档 head 仍须单独检查并报告其 CI 身份。
