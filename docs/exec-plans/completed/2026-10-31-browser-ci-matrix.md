# Browser CI matrix experiment / 浏览器 CI 矩阵实验

## Scope and baseline / 范围与基线

The user requested a sensible matrix after the initial file split and 1/2/4-worker comparison. Continue draft PR #105 on `perf/browser-ci-profile`, based on `f6e0f6e86713b062aa92e9e4991ca4abb5200909`. The 21 files contain 423 tests. No browser test bodies, fixtures, isolation rules or production code change in this experiment. / 用户在初始文件拆分与并行对照后要求评估合理矩阵。在所列提交上继续同一 draft PR；21 个文件共 423 项测试。本次实验不修改测试正文、fixture、隔离规则或产品代码。

The two successful single-runner/two-worker runs were [41165859662](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41165859662) at 336.121 s and [41167560004](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41167560004) at 408.871 s. The four-worker run was slower than the first sample and failed one navigation assertion; retain two workers per machine. / 两次单 runner、双 worker 成功样本分别为 336.121 秒与 408.871 秒。单机四 worker 比第一次样本更慢且有一项导航断言失败，因此维持单机两个 worker。

## Design and predictions / 设计与预测

Use GitHub's native two-entry matrix with `fail-fast: false`, and Node's native `run({ shard })` on a complete sorted file list. The profiler validates shard bounds, records only assigned files and retains fail-closed handling of empty/crashed/incomplete files. New test files join automatically; there is no manually maintained partition manifest or timing database. / 使用 GitHub 原生两项矩阵，关闭快速失败，并对完整排序文件列表使用 Node 原生分片。量测器验证边界、只记录所属文件，并保留空文件、崩溃及不完整结果的失败语义。新增测试自动纳入，不维护人工分组清单或耗时数据库。

Both shards prepare their own dependencies, assets and locked Chromium. Artifact names include the shard and run attempt. The final `ci` job still requires the aggregate Browser result; only explicitly classified docs-only PRs may skip it. / 两个分片各自准备依赖、资产与锁定 Chromium。工件名称包含分片与运行次数。最终门槛仍要求整个 Browser 结果通过；仅明确分类的纯文档 PR 可跳过。

The native alternating split gives the following predictions from each successful run's measured file-process durations. Simulate two free workers, scheduling each sorted file when a worker is available. These are estimates, not new execution measurements; they exclude runner queueing and setup and assume unchanged individual file durations. / 原生交替分配根据两次成功样本的文件进程耗时得到下表预测：模拟两个空闲 worker 按排序列表调度。此处是估算而非新实测，不含排队和准备时间，并假设单文件耗时不变。

| Shard / 分片 | Files / 文件 | Tests / 测试 | File-work sums / 文件耗时总和 | Predicted wall / 预测墙钟时间 |
| --- | ---: | ---: | ---: | ---: |
| 1/2 | 11 | 198 | 330.9 / 409.9 s | 195.9 / 243.1 s |
| 2/2 | 10 | 225 | 333.5 / 398.6 s | 167.4 / 202.4 s |

Shard 1 includes search, pagination, trajectory, history evidence and smaller suites; shard 2 includes navigation, source switching, basic reading, Detail and other suites. This is a file-order partition, not a permanent functional ownership boundary. It balances total work closely but leaves a tail in shard 1. More shards are deferred: each runner repeats setup, and three-way native partitioning is much less balanced with today's files. / 第一项包含搜索、分页、Trajectory、历史依据与若干小套件；第二项包含导航、来源切换、基础阅读、Detail 等。这是按文件排序的分片，不是永久功能边界。总工作量接近，但第一项有较长尾部。暂不增加分片：每个 runner 都重复准备，当前文件的原生三分片也明显失衡。

Judge elapsed latency separately from runner-seconds: two jobs can finish sooner while consuming more total runner time. Compare the slower shard and combined job preparation costs, retain all failures and verify the union of actual test identities against the 423-test baseline. / 分开评估等待时间与 runner 秒数：两个 job 可缩短等待，但可能消耗更多总 runner 时间。比较较慢分片与合计准备开销，保留所有失败，并核对实测测试身份并集与 423 项基线一致。

## Validation and review / 验证与审查

- Local: `node --test test/browser-test-profile.test.js test/ci-scope.test.js test/ci-assets.test.js` passed all 20 checks on Node 24.19.0. These exercise native shards on synthetic files, including one failing shard, disjoint complete coverage, invalid bounds, unchanged full-suite behavior and affected scope/asset contracts. YAML parsing, local documentation links, script syntax and `git diff --check` also passed. / 本地所列命令的 20 项检查全部通过，覆盖合成文件原生分片、失败分片、无重复完整覆盖、无效边界、原全量行为与相关 scope／资产契约。YAML 解析、文档本地链接、脚本语法和 diff 空白检查也通过。
- Independent precommit review: fresh reviewer `/root/review_browser_matrix` found no actionable issues in the seven-file change against `f6e0f6e`. Exact combined diff SHA-256: `3989543f9211ee95e67194ff2489404ff83e38db5a39277cefd3bdba02e8c2e8`. The reviewer independently passed all 20 checks on both minimum-supported Node 22.22.2 and Node 24.19.0, plus syntax/YAML/link/whitespace checks and a replay of the predictions. This was static and local evidence; hosted verification followed separately. / Fresh reviewer 对所列基线和精确七文件 diff 未发现需处理问题，并在最低支持的 Node 22.22.2 与 Node 24.19.0 独立通过全部 20 项检查，以及语法、YAML、链接、空白与预测复算。此处为静态／本地依据，hosted 验证另行执行。

## Hosted result and decision / Hosted 结果与决定

Implementation commit `eb08435597b59d9491379c9a0f061f92d802e303` passed [CI 41171155733](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41171155733): all nine jobs, including both Browser shards and the final aggregate, succeeded. Both used Node 24.22.1, Ubuntu 24.04 and locked Chromium 148. / 实现提交通过所列 CI，两个 Browser 分片及最终门槛在内的九个 job 全部成功。两项均使用 Node 24.22.1、Ubuntu 24.04 与锁定 Chromium 148。

| Shard / 分片 | Test stage / 测试阶段 | Coverage / 覆盖 | Approximate whole job / 约整项 job 时间 | Timing artifact / 时长工件 |
| --- | ---: | --- | ---: | --- |
| [1/2](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41171155733/job/124449259904) | 215.233 s | 198/198, 11 files / 文件 | 248.4 s | [Report](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41171155733/artifacts/13031212868) |
| [2/2](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41171155733/job/124449259867) | 205.538 s | 225/225, 10 files / 文件 | 239.9 s | [Report](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41171155733/artifacts/13030903535) |

The downloaded reports contain 423 passed tests with zero failures, skips or cancellations. Their `(file, name, nesting, type)` identity multiset equals the last successful full-suite baseline, and their 21 file results are disjoint and complete. This verifies actual execution, beyond the static matrix definition. / 下载报告合计 423 项通过，失败、跳过和取消均为零。测试身份多重集合与上一次成功全量基线一致，21 个文件结果完整且无重复；此为实测执行依据，不只是矩阵静态定义。

The slower shard's test stage is 36–47% shorter than the two single-runner/two-worker samples (336.121/408.871 s). These are separate hosted runs, not a paired same-machine or statistical comparison. Per-file times varied: navigation took 140.6 s, search 97.9 s and history evidence 93.7 s. / 较慢分片的测试阶段比两次单 runner、双 worker 样本缩短约 36–47%。这些是独立 hosted 样本，不是同机配对或统计对照。单文件耗时存在波动：导航 140.6 秒、搜索 97.9 秒、历史依据 93.7 秒。

Log timestamps give a Browser execution window of about 248.5 s, including each runner's roughly 31–32 s preparation. The last single-runner baseline used about 440.3 s from its first to last job log. Summed runner time rose to about 488.2 s, approximately 11% more than that baseline, while user waiting time fell by about 44%. These estimates exclude queueing, preceding scope classification and final aggregation; they are not billed-minute measurements or whole-workflow duration. / 日志时间戳显示 Browser 执行窗口约 248.5 秒，其中每个 runner 各需约 31–32 秒准备。上一次单 runner 基线首尾日志相隔约 440.3 秒。合计 runner 时间增至约 488.2 秒，比该基线多约 11%，用户等待则缩短约 44%。估算不含排队、前置范围分类与最终聚合，也不是计费分钟或整个 workflow 时长。

Retain two shards with two workers each. This sample meets the 3–5 minute Browser target without changing assertions or coverage; variation and pre-existing navigation races remain possible. Further runner expansion or maintained duration-based partitions are unwarranted by this result. The final documentation commit repeats CI with identical implementation and browser test files. / 保留两个分片、各两个 worker。本次样本在不改变断言和覆盖的前提下达到 3–5 分钟 Browser 目标；时长波动与既有导航竞态仍可能出现。当前结果不支持继续增加 runner 或维护按耗时分组的清单。最终文档提交将以完全相同的实现和浏览器测试再次运行 CI。
