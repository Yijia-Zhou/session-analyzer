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
- Fresh independent precommit review: pending. / 提交前 fresh 独立审查待执行。
- Hosted comparison and final decision: pending. Download all three reports, verify their identity multiset against the successful 423-item baseline, inspect every CI result and retain failures. / Hosted 对照与最终决定待执行。下载三份报告，核对测试身份与成功基线一致，检查全部 CI 结果并保留失败。
