# Thematic Browser CI experiment / Browser 主题矩阵实验

## Scope and baseline / 范围与基线

The user requested a real comparison of three thematic CI jobs after discussing the 423-item Browser inventory. Continue draft PR #105 on `perf/browser-ci-profile`, starting at `a368c95bf350158bd5d934c06e1424a153493883`. Keep two workers per runner and all browser test bodies, assertions, fixtures, resources and generated assets unchanged. / 用户在讨论 423 项 Browser 清单后要求实测三个主题 CI job。在所列基线上继续同一 draft PR；保持单 runner 两个 worker，以及全部测试正文、断言、fixture、资源隔离和生成资产不变。

The successful native two-shard baselines were [41171155733](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41171155733) and [41171757777](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41171757777). Both passed 423/423 and all nine CI jobs. Browser windows including setup were 248.450/249.308 s; summed job time was 488.211/434.618 s. The slower test stages were 215.233/217.392 s. Job-log estimates exclude runner queues, preceding scope classification and final aggregation. / 两次原生两分片基线均完整通过 423 项与全部九个 CI job。包含准备的 Browser 窗口为 248.450／249.308 秒，合计 job 时间为 488.211／434.618 秒，较慢测试阶段为 215.233／217.392 秒。日志估算不含 runner 排队、前置分类与最终聚合。

## Candidate / 候选方案

| Group / 主题 | Files / 文件 | Execution items / 执行项 | Coverage / 覆盖 |
| --- | ---: | ---: | --- |
| `reading-presentation` | 13 | 167 | Basic reading, Code Mode, Trajectory, Detail, rendering and all source-specific pi/OpenCode/WorkBuddy files / 基础阅读、Code Mode、Trajectory、详情、渲染及全部 pi／OpenCode／WorkBuddy 专项 |
| `search-loading` | 4 | 145 | Search, pagination, source configuration/recovery, request handoffs / 搜索、分页、来源配置与恢复、请求交接 |
| `navigation-evidence` | 4 | 111 | File/collaboration navigation, history evidence, turn lineage, recorded configuration / 文件／协作导航、历史依据、回合关系、已记录配置 |

The manifest is `scripts/browser-test-groups.json`. Each `--group` invocation validates every discovered `e2e/*.test.js` file appears exactly once, rejects stale entries and empty groups, then runs that group's alphabetically sorted files with the existing native profiler. A workflow contract keeps its matrix names equal to the manifest. New files require explicit assignment; full local commands still discover every file automatically. Group selection cannot combine with native sharding or explicit file arguments. Reports and artifacts identify the group. / 清单位于所列 JSON。每次主题执行先验证所有发现的测试文件恰好出现一次，拒绝失效项与空组，再由既有原生量测器按字母顺序运行所属文件。Workflow 契约保持矩阵名与清单一致。新文件须明确分组，本地全量命令仍自动发现全部文件。主题不能与原生分片或显式文件参数混用；报告和工件标识主题。

Retain `fail-fast: false`, full Node/package matrices, conservative docs-only classification, asset policy and final aggregate checks. All three Browser jobs must succeed. No framework migration, shared browsers/servers, test-body changes or time-based test selection is involved. / 保留关闭快速失败、完整 Node／安装包矩阵、保守文档分类、资产策略与最终聚合，三个 Browser job 必须全部成功。不迁移框架、不共享浏览器／服务、不改测试正文，也不按时间筛选测试。

## Prediction, not execution / 预测而非实测

An independent read-only replay used each historical file's process duration and two workers in alphabetic order. Counts and test identity multisets match across all inputs; the 423 total includes 418 top-level tests and five nested Code Mode subtests. / 独立只读回放以历史文件进程耗时和两个 worker 按字母顺序模拟调度。各输入计数与测试身份多重集合一致；423 项包括 418 项顶层测试及五项 Code Mode 子测试。

| Timing source / 耗时来源 | Reading / 阅读 | Search / 搜索 | Navigation / 导航 | Critical path / 关键路径 |
| --- | ---: | ---: | ---: | ---: |
| Single-runner sample 1 / 单 runner 样本 1 | 116.594 s | 114.924 s | 118.706 s | 118.706 s |
| Single-runner sample 2 / 单 runner 样本 2 | 145.866 s | 132.851 s | 144.144 s | 145.866 s |
| Native matrix sample 1 / 原生矩阵样本 1 | 145.641 s | 131.715 s | 140.612 s | 145.641 s |
| Native matrix sample 2 / 原生矩阵样本 2 | 117.677 s | 121.550 s | 119.719 s | 121.550 s |

These estimates exclude setup and queueing and assume per-file durations remain unchanged on new runners with different companion files. Summed predicted test time drops only 2.8/18.0 s relative to the two matrix samples; a third runner's preparation can exceed those savings. Measure actual latency and summed runner time separately before selecting the configuration. / 估算不含准备与排队，并假设新 runner 和并行伙伴改变后单文件时长仍不变。相对两次原生矩阵样本，预测合计测试时间仅减少 2.8／18.0 秒；第三个 runner 的准备可能超过这些节省。确定配置前须分别实测等待时间与合计 runner 时间。

## Validation / 验证

- Local: all 22 focused profiler/scope/asset checks passed on Node 24.19.0. Synthetic group executions prove complete/disjoint coverage, failure propagation and rejection of an unassigned new file; manifest checks reject duplicates, stale files, empty groups and conflicting selectors. / 本地 Node 24.19.0 的 22 项相关检查通过。合成主题执行验证完整无重复覆盖、失败传递与新增未分组文件拒绝；清单检查覆盖重复、失效文件、空组和冲突参数。
- Fresh independent precommit review: `/root/review_theme_matrix` reviewed all eight files against `a368c95`, exact diff SHA-256 `468873a87620965f66dab5033f6f18de0fb3769093297e552778d7ce134d4548`. A report-path issue was fixed before commit: validation must protect test files outside the selected group too. Its regression check passed, and no actionable findings remained. The reviewer independently passed all 22 focused checks on minimum-supported Node 22.22.2, plus syntax, YAML/JSON, links, whitespace, partition and historical-evidence checks. These were local/static checks; hosted evidence follows. / Fresh reviewer 审查所列基线上的精确八文件 diff。提交前修复报告路径问题：所属主题以外的测试文件也须受到覆盖保护；回归检查通过，最终无待处理发现。Reviewer 在最低支持的 Node 22.22.2 独立通过 22 项相关检查，以及语法、YAML／JSON、链接、空白、分组与历史证据检查。此处为本地／静态检查，hosted 依据如下。

## Hosted result / Hosted 结果

Implementation `d4a37c63e3c6a3317e99e253434ea646134833e5` passed [CI 41176247337](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41176247337), including all three Browser jobs and all ten CI jobs. Each Browser job used Node 24.22.1, Ubuntu 24.04 and locked Chromium 148.0.7778.96. / 实现提交通过所列 CI，包含三个 Browser job 在内的十个 CI job 全部成功。每项 Browser 使用 Node 24.22.1、Ubuntu 24.04 与锁定 Chromium 148.0.7778.96。

| Group / 主题 | Tests / 测试 | Test stage / 测试阶段 | Approximate whole job / 约整项 job | Artifact / 工件 |
| --- | ---: | ---: | ---: | --- |
| [reading-presentation](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41176247337/job/124464321888) | 167/167 | 145.879 s | 178.747 s | [Timing](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41176247337/artifacts/13033351988) |
| [search-loading](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41176247337/job/124464321870) | 145/145 | 134.780 s | 172.839 s | [Timing](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41176247337/artifacts/13032956482) |
| [navigation-evidence](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41176247337/job/124464321830) | 111/111 | 126.348 s | 157.220 s | [Timing](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41176247337/artifacts/13033341964) |

The downloaded reports conserve the exact `(file, name, nesting, type)` multiset of all 423 baseline execution items. The 21 files occur exactly once, each report matches its manifest group and declares all 21 input files, and there are no failures, skips or cancellations. / 下载报告的测试身份多重集合与基线全部 423 个执行项完全一致。21 个文件恰好各出现一次，每份报告匹配清单主题并声明完整 21 个输入文件，失败、跳过与取消均为零。

| Comparison / 对照 | Native sample 1 / 原生样本 1 | Native sample 2 / 原生样本 2 | Thematic sample / 主题样本 |
| --- | ---: | ---: | ---: |
| Slowest test stage / 最慢测试阶段 | 215.233 s | 217.392 s | 145.879 s |
| Browser window including setup / 含准备的 Browser 窗口 | 248.450 s | 249.308 s | 178.747 s |
| Summed test-stage time / 合计测试阶段时间 | 420.771 s | 376.981 s | 407.007 s |
| Summed whole-job time / 合计整项 job 时间 | 488.211 s | 434.618 s | 508.806 s |

The Browser window shortened by 28.1–28.3%, while summed runner time rose by 4.2–17.1% against the two observed baselines. Three-runner setup totaled about 96.1 s, versus 63.3/54.1 s previously; preparation is repeated for each job. Test-file timings also vary, so this is a latency/resource tradeoff across independent hosted samples, not a paired benchmark, statistical failure-rate estimate or billed-minute calculation. Browser windows exclude runner queues and the scope/final aggregate jobs. / 相比两次实测基线，Browser 窗口缩短约 28.1–28.3%，合计 runner 时间增加约 4.2–17.1%。三项准备合计约 96.1 秒，之前为 63.3／54.1 秒；各 job 都重复准备。单文件耗时也有波动，因此这是独立 hosted 样本的等待／资源权衡，不是同机配对、统计失败率或计费分钟计算。Browser 窗口不含排队与前后聚合 job。

## Decision / 决定

Retain three thematic groups with two workers each: this sample combines complete passing coverage, clear failure ownership and approximately three-minute Browser feedback, at the measured extra runner cost. Keep native `--shard` and full-suite commands for local use and future comparisons. Future file additions must update the manifest; do not rebalance by silently dropping tests or introducing a timed subset. / 保留三个主题、各两个 worker：本次样本完整通过，失败归属清楚，Browser 反馈约三分钟，代价为上述额外 runner 用量。保留原生分片和全量命令供本地使用与未来对照。后续新增文件须更新清单，不能通过遗漏测试或限时子集来平衡耗时。

The final documentation commit repeats full CI with identical implementation and browser test files. Hosted variability and pre-existing navigation races remain possible; the successful sample does not establish fixed latency or eliminate those races. / 最终文档提交以相同实现与浏览器测试文件再次执行完整 CI。Hosted 波动与既有导航竞态仍可能存在；成功样本不保证固定时延或消除这些竞态。
