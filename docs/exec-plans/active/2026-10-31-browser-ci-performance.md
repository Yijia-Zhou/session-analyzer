# Browser CI performance / 浏览器 CI 性能

Status: implementation and controlled validation in progress; hosted comparison pending. / 状态：实现与受控验证进行中，hosted 对照待完成。

## Scope and baseline / 范围与基线

- Branch `perf/browser-ci-profile` starts at `v0.3.0-development` commit `8c6917c1fb3ad2e00389b6554182d8f81acc0fc5`. This tree is identical to WorkBuddy head `1518682fa8b9c4259e627b2affed041737b658fd`. / 分支从所列开发提交开始，与 WorkBuddy 所列 head 的完整文件树一致。
- `main` at `a9b7f672` has one browser file. The development base already has 12, with 315 expanded tests still in the 16,433-line main file and 423 total tests. The existing command already uses Node's default multi-file concurrency. / main 只有一个浏览器文件，开发基线已有 12 个；其中 315 个展开后用例仍在大型文件内，总套件为 423 项。现有命令已使用 Node 默认多文件并发。
- [Base-equivalent successful CI](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/41163647037/job/124426452129): 423/423, 431.608 seconds in the suite; npm bootstrap about 3.434 s, `npm ci` 1.189 s and Chromium setup 19.252 s. [Earlier successful CI](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/40857344025/job/123391736376): 421/421, 528.473 s. Both used Ubuntu 24.04.5 and Node 24.22.1. Stage estimates use adjacent log timestamps; these are separate samples, not an average or controlled A/B result. / 两次成功 CI 的套件与阶段耗时如前；阶段取相邻日志时间戳，独立样本不作为均值或受控 A/B 结论。

## Implementation / 实现

- Mechanically group the 315 main-file cases into ten feature files; preserve expanded names, test options, callback source and per-test isolation. Keep the other eleven suites. / 将主体 315 项机械拆分至十个功能文件，保留展开名称、选项、回调源码与独立资源；其余十一套件保留。
- Use native file concurrency and a small timing reporter; retain all assertions, waits and full CI gates. Add optional common-helper phase diagnostics and a seven-day timing artifact. / 使用原生文件并发与轻量量测器，保留断言、等待与完整门槛，增加可选公共 helper 阶段诊断及七天报告工件。
- Document feature ownership and targeted local commands in [execution design](../../design-docs/browser-test-execution.md). Defer containers, sharding, reduced coverage and broader skipping until evidence warrants them. / 在执行设计中记录功能归属与本地入口；容器、分片、减少覆盖或扩大跳过规则留待证据支持。

## Validation and acceptance / 验证与验收

- Compare serial baseline and split 2/4-worker full runs without overlapping heavy suites. Record wall time, sampled process-tree RSS, complete counts and failures; repeat promising configurations. / 顺序比较基线与拆分后并行运行，避免重型套件重叠；记录耗时、进程树 RSS、完整计数与失败，并重复候选配置。
- Local environment: Node 24.19.0, npm 12.0.2, four-CPU cgroup quota and 16 GiB memory limit. Locked Chromium 148 download was denied by the managed network, so local exploratory runs use installed Chromium 154 through an uncommitted launcher override. These do not establish locked-browser compatibility. / 本地环境与限制如前；锁定浏览器下载被网络策略拒绝，本地探索通过未提交的启动覆盖使用预装 Chromium 154，不作为锁定版本兼容性证明。
- Run focused profiler/phase/CI contracts and inspect all test registrations; use the draft PR's full hosted CI for supported Node/platform/browser validation. / 运行量测器、阶段与 CI 契约聚焦检查并核对全部注册项，由 draft PR 的完整 hosted CI 验证受支持平台与浏览器。
- Before each commit, fresh independent review must name the exact base/diff and distinguish static review, executed local tests and hosted CI. / 每次提交前由独立 fresh review 标明精确 base／diff，并区分静态审查、本地执行与 hosted CI。
- Do not claim the proposed 3–5 minute goal until hosted measurement supports it. / Hosted 量测支持前，不声称已经达到 3–5 分钟目标。

## Results / 结果

- PASS: 38 focused checks across profiler (7), phase diagnostics (3), scope (7), asset policy (5) and package contracts (16). The first package-contract run inherited npm 11; rerunning with the required npm 12.0.2 passed all 16. YAML structure, documentation links and `git diff --check` passed. / 所列聚焦检查全部通过。首次包契约执行继承了 npm 11；改用要求的 npm 12.0.2 后 16 项全部通过。YAML、文档引用与 diff 检查通过。
- Static conservation: 276 registration statements and 315 expanded names/options/callbacks match the base exactly; all 71 helper declarations remain, with only `startServer` and `openApp` adding phase spans. / 静态守恒核验：注册语句与展开用例完全一致，71 项 helper 均保留，只有启动服务与应用两项增加阶段量测。
- Fresh independent pre-commit review found no actionable issues. Reviewed base `8c6917c1fb3ad2e00389b6554182d8f81acc0fc5`; tracked diff plus untracked files SHA256 `67917d069d94c8b35b3ff8e08d3eeb1b9eba2001237d5e611dcbb835857b147c` (before this evidence-only update). The reviewer independently ran 17 focused tests and four synthetic failure probes covering cleanup errors, nonzero exits, late unhandled errors and runner timeout; all behaved as required. This is static/local evidence, not browser or hosted evidence. / 独立提交前审查无有效问题；审查基线与 diff 指纹如前（不含本次仅证据文字更新）。审查者独立执行 17 项聚焦检查及四类失败探针，行为符合预期；此为静态／本地依据，不是浏览器或 hosted 依据。
- Full local measurements and hosted comparison remain pending in the initial draft. The serial local run records a diagnostic-fixture failure because managed Chromium rejects its `data:` URL; that environmental result is retained. / 初始 draft 的完整本地量测与 hosted 对照仍待完成。串行本地运行记录了诊断 fixture 的 data URL 被托管 Chromium 拒绝的失败，保留该环境结果。
