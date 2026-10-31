# Browser CI performance / 浏览器 CI 性能

Status: experiment complete; retain two workers in [draft PR #105](https://github.com/Yijia-Zhou/session-analyzer/pull/105). / 状态：实验完成，在所列 draft PR 保留两个 worker。

## Scope and baseline / 范围与基线

Branch `perf/browser-ci-profile` starts at `v0.3.0-development` commit `8c6917c1fb3ad2e00389b6554182d8f81acc0fc5`, whose tree equals WorkBuddy head `1518682fa8b9c4259e627b2affed041737b658fd`. Main at `a9b7f672` has one browser file; development already has 12. The original 16,433-line main file contains 315 expanded cases, with 423 tests across the suite. Node already runs different files concurrently by default, so the large file was the main structural limit. / 分支起点与 WorkBuddy 完整文件树一致。Main 只有一个浏览器文件，开发分支已有 12 个；大型主体包含 315 个展开用例，全套共 423 项。原命令已默认跨文件并行，大文件仍是主要结构限制。

The main file is now ten feature files, for 21 files overall. All 276 registration statements and 315 expanded names/options/callbacks are unchanged, including parameterized loops and group-local order. Conservation checks compare AST registration-source multisets and capture expanded registrations through a VM test recorder. All 71 original helpers remain exactly once; only `startServer` and `openApp` add phase spans, with seven shared fixture exports optionally measured. Runtime reports also confirm the same 423 test-name multiset for every completed local and hosted case. / 主体拆成十个功能文件，全套共 21 个。所有注册语句、展开用例、参数化循环与组内顺序均保留；守恒检查比较 AST 注册源码多重集并通过 VM 记录展开注册。原 71 项 helper 均唯一保留，仅两项启动 helper 增加阶段量测，七项共享 fixture 出口提供可选量测。全部已完成运行的 423 项名称多重集一致。

Per-test browsers/contexts, dynamic ports and temporary directories remain isolated. Full Node/package/browser gates, docs-only classification, asset policy and install-script enforcement remain intact. See [execution design](../../design-docs/browser-test-execution.md) for feature ownership and local/profile commands. / 每项测试的浏览器、动态端口与临时目录保持隔离；完整门槛、文档分类、资产与安装脚本策略均保留。功能归属及执行入口见所列设计。

## Hosted evidence / Hosted 依据

These runs use Ubuntu 24.04.5, Node 24.22.1 and locked Playwright Chromium 148. They are separate runner samples, not paired measurements on one machine. / 以下运行使用相同工具链，但属于独立 runner 样本，不是同机成对量测。

| Configuration / 配置 | Browser seconds / 秒 | Result / 结果 | Evidence / 依据 |
| --- | ---: | --- | --- |
| Unchanged-tree development baseline / 同代码树开发基线 | 431.608 | 423/423 | [Run 41163647037](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41163647037/job/124426452129) |
| Split, 2 workers / 拆分后双 worker (`2f877df`) | 336.121 | 423/423; all CI jobs passed / 全部 CI 通过 | [Run 41165859662](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41165859662), [timing artifact](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41165859662/artifacts/13028433196) |
| Split, 4 workers / 拆分后四 worker (`5725b76`) | 361.661 | 422/423; required gate failed / 必需门槛失败 | [Run 41166429389](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41166429389), [timing artifact](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41166429389/artifacts/13029423764) |

The two-worker sample is 22.1% shorter than the unchanged-tree baseline. Four workers are 7.6% slower than two in these hosted samples and fail the composed collaboration-return test: the captured departure coordinate is `undefined`, so its comparison to restored position fails. The unchanged callback installs a listener on a DOM node before a locator click; a precise cause is not established by this assertion alone. No timeout or assertion is relaxed to accept it. / 双 worker 样本相对基线缩短 22.1%。四 worker hosted 样本反而慢 7.6%，并在组合协作返回场景失败：离开坐标为 undefined，无法与恢复位置比较。未修改的回调先在节点安装监听器再通过 locator 点击，仅凭该断言不能确定唯一原因；没有放宽超时或断言来接受失败。

The longest hosted files show the contention tradeoff: navigation takes 118.7 s at two workers and 225.8 s at four; search takes 84.7/162.7 s, and history evidence 90.6/137.0 s. The two-worker phase report records 297 common-helper setups: page readiness totals 114.8 s, browser launch 22.0 s and browser cleanup 9.5 s; 135 measured fixtures total 5.1 s. These partial, overlapping operation sums are not complete phase accounting or elapsed wall time. / 最慢文件显示资源竞争代价，导航、搜索与历史依据在四 worker 下均明显变慢。双 worker 的部分阶段总量如前；这些操作时长可能重叠，不能作为完整阶段核算或墙钟时间。

An earlier [421/421 run](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40857344025/job/123391736376) took 528.473 s, illustrating sample variation. Baseline npm bootstrap, dependency installation and Chromium preparation took approximately 3.434/1.189/19.252 s by adjacent log timestamps, so installation tuning is not the leading opportunity. / 更早的成功样本耗时不同，表明存在波动。基线安装阶段耗时如前，取相邻日志时间戳近似，因此安装优化不是首要机会。

## Local exploration / 本地探索

Node 24.19.0, npm 12.0.2, four-CPU cgroup quota and 16 GiB limit. Managed networking denied the locked Chromium download, so an uncommitted launcher override used installed Chromium 154 for all local runs. The serial baseline uses the original layout; 2/4-worker cases use the split layout. They run sequentially, with no other browser suite overlapping; occasional short static/unit checks are not excluded from these exploratory measurements. / 本地工具链与配额如前。锁定浏览器下载被网络策略拒绝，所有本地运行均通过未提交的启动覆盖使用 Chromium 154。串行基线为原布局，双／四 worker 为拆分布局；顺序执行，无其他浏览器套件重叠，期间少量静态／单元检查未从探索性量测中排除。

| Configuration / 配置 | Seconds / 秒 | Pass/fail / 通过/失败 | Sampled tree RSS, MiB / 采样进程树 RSS |
| --- | ---: | --- | ---: |
| Original, 1 worker / 原布局单 worker | 761.736 | 420/3 | 3699.5 |
| Split, 2 workers / 拆分双 worker | 478.143 | 419/4 | 4843.7 |
| Split, 4 workers / 拆分四 worker | 406.606 | 420/3 | 6414.3 |

Every run contains all 423 tests, with zero skips/cancellations. All share the unmodified baseline's data-URL policy failure and two topbar geometry failures. The two-worker local run additionally reproduces the previously documented late-search-response focus race: the focused Inspector article is replaced after `networkidle` has already fired, then Enter targets BODY. See the [updated diagnostics plan](../active/2026-10-09-ci-collaboration-navigation-diagnostics.md). These failed exploratory runs are not supported-browser pass evidence, and their raw times include the failure costs. / 每轮完整运行 423 项，无跳过或取消；均包含未修改基线的页面策略与两项布局失败。双 worker 额外重现已记录的迟到搜索响应焦点竞态，详见诊断计划。这些失败的探索运行不作为受支持浏览器通过依据，原始时长包含失败成本。

RSS sums descendants including Chromium at a nominal 500 ms polling interval, with scan/scheduling overhead and shared-page double counting; peaks may be missed. It is not unique physical memory or a hosted memory measurement. Four workers increase this local sampled peak by 32.4% over two. A second queued local four-worker repeat was cancelled before launch after the hosted four-worker failure; no result is invented for it. / RSS 按名义 500 ms 间隔采样 Chromium 等子进程，存在扫描／调度开销、共享页重复计数与漏掉瞬时峰值的可能，不是唯一物理内存或 hosted 内存。四 worker 比双 worker 的本地采样峰值增加 32.4%。Hosted 四 worker 失败后取消了尚未开始的第二轮本地四 worker，不为其生成结果。

## Decision and follow-up / 决策与后续

Retain **two native file workers** in both full commands and normal CI. Four remains available through an explicit profile argument/manual workflow input for future investigation. The final implementation files match the successful two-worker commit `2f877df`; only documentation/evidence differs. Final-head checks are visible on [PR #105](https://github.com/Yijia-Zhou/session-analyzer/pull/105/checks). / 全量入口与常规 CI 保留两个原生文件 worker。四 worker 仍可通过显式量测参数或手动 workflow 输入用于后续调查。最终实现文件与已通过的双 worker 提交一致，仅文档／证据不同；最终 head 的检查见 PR。

The 3–5 minute browser target is **not established** by the accepted 336.1 s sample. Do not claim a statistical flake rate or a universal optimum from this small set. Further work should first address the measured navigation/history/search costs and the documented setup races. Containers, sharding, shared browsers, a reduced fast suite and broader skip rules are deferred. Feature-specific file commands already provide shorter local feedback while preserving the full gate. / 已接受的样本尚未证明达到 3–5 分钟目标；小样本不支持统计失败率或普遍最优并行度结论。后续先处理已量测的导航／历史／搜索成本及记录的准备阶段竞态。容器、分片、共享浏览器、缩减快速集与扩大跳过规则暂缓；按功能文件执行已能缩短本地反馈，并保留全量门槛。

## Verification and review / 验证与审查

- Initial focused checks: profiler 7, phase diagnostics 3, scope 7, assets 5, package 16: **38 passed**. An initial package check inherited npm 11; the required npm 12.0.2 rerun passed all 16. YAML, document references and diff checks passed. / 初始聚焦检查共 38 项通过；首次包检查继承 npm 11，改用要求版本后全部通过，YAML／文档／diff 检查亦通过。
- Fresh independent implementation review: base `8c6917c1fb3ad2e00389b6554182d8f81acc0fc5`, tracked-diff plus untracked-content SHA256 `67917d069d94c8b35b3ff8e08d3eeb1b9eba2001237d5e611dcbb835857b147c`, excluding its subsequent evidence-only note. No actionable findings. Reviewer independently ran 17 checks plus four synthetic probes for cleanup errors, nonzero exits, late unhandled errors and runner timeout; failures propagated correctly. / 独立实现审查基线与指纹如前，不含后续证据文字；无有效问题，独立执行的检查与失败探针符合预期。
- Fresh independent four-worker review: base `2f877df52455aee85c31e4dbeef61843becd161f`, six-file diff SHA256 `a60205f907793aa2802fa83e10e84069a11a683e53024452e82dd755732a8c14`; 14 affected checks passed, no findings. This review established implementation coherence, not performance acceptance. / 四 worker 独立审查与 14 项检查通过；仅证明实现一致性，不作为性能验收。
- Fresh independent final-selection review: base `5725b76bf78f9b04f9512e6254e0e80994d36d2e`, combined tracked-diff/untracked-plan SHA256 `d8435ee8c655121dbf6a92c4ef7914f73561931cd35eae6ba88029ca0ea13b6f` (before this evidence-only note). No findings; 14 checks passed. Reviewer verified non-document equality with the successful two-worker commit, all five reports' 423-name multisets, figures, failure trace, YAML and 29 local links/anchors. Final-head hosted CI is a subsequent check, not part of this static/local review. / 最终选择的独立审查基线与组合指纹如前（不含本条证据文字），无有效问题，14 项检查通过；审查者核对实现一致性、五份报告的完整名称与数值、失败 trace、YAML 及 29 项本地引用。最终 head 的 hosted CI 是后续检查，不归入本次静态／本地审查。
- Static reviews, executed local checks and hosted CI evidence above are deliberately distinguished. All timing artifacts use seven-day retention; the profiler emits the complete report and slowest 20 on every run. / 上文区分静态审查、本地执行与 hosted 依据。时长工件保留七天，量测器每轮输出完整报告及最慢 20 项。
