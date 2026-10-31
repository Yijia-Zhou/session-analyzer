# Browser test execution / 浏览器测试执行

## Coverage and isolation / 覆盖与隔离

The browser suite uses Playwright as an automation library and Node's native test runner. `npm run test:browser` runs every `e2e/*.test.js` file with two concurrent file workers. Tests within each file remain sequential. The profiling command discovers the same files; it never selects a smaller regression subset. / 浏览器套件使用 Playwright 自动化库与 Node 原生测试运行器。上述命令以两个文件 worker 运行全部匹配文件，文件内测试仍顺序执行。量测命令发现相同的文件，不筛选较小的回归子集。

The former large `browser.test.js` is organized into these feature groups. Existing source-specific and history suites retain their own files. / 原大型文件按下表组织；已有的来源专项与历史测试仍保留独立文件。

| File / 文件 | Coverage / 覆盖 |
| --- | --- |
| `browser.test.js` | Basic reading, locale, folding, fork ownership, cache evidence / 基础阅读、语言、折叠、分叉归属、缓存依据 |
| `browser-code-mode.test.js` | Code Mode and terminal presentation / Code Mode 与终端呈现 |
| `browser-navigation.test.js` | File, collaboration and reading return / 文件、协作导航与阅读返回 |
| `browser-trajectory.test.js` | Trajectory layout, selection and overview / Trajectory 布局、选中与概览 |
| `browser-source-switching.test.js` | Source choice, hydration and polling recovery / 来源选择、水合与轮询恢复 |
| `browser-search.test.js` | Search controls, filters, marks and navigation / 搜索控件、过滤、标记与导航 |
| `browser-handoffs.test.js` | Stale responses and competing reading intents / 失效响应与竞争阅读意图 |
| `browser-pagination.test.js` | Pagination, search append and mutation bounds / 分页、搜索追加与变更边界 |
| `browser-rendering.test.js` | Render coalescing, lifecycle and bounded DOM work / 渲染合并、生命周期与 DOM 工作边界 |
| `browser-detail.test.js` | Detail hydration and transitions / 详情水合与切换 |

`e2e/browser-helpers.js` contains shared synthetic fixtures and setup helpers. Every test still owns its browser/context, dynamically allocated server port and temporary directories. No browser, server or mutable fixture is pooled between tests. The source-bundle promise is process-local; splitting can repeat its one-time build in more than one worker. / 公共 helper 保存合成 fixture 与启动辅助代码。每项测试仍拥有独立浏览器／context、动态端口与临时目录，不跨测试复用浏览器、服务或可变 fixture。源码 bundle promise 仍局限于进程，拆分后不同 worker 可能分别构建一次。

Keep new tests in the appropriate feature file. A new top-level `e2e/*.test.js` file is automatically included in both full commands; helpers must not use the `.test.js` suffix. Targeted file runs shorten development feedback but do not replace the full merge/release gate. / 新测试加入对应功能文件；新增顶层匹配测试文件会被两个全量入口自动纳入，helper 不应使用测试后缀。开发时按文件验证可以缩短反馈，但不能替代完整合并／发布门槛。

## Measurements / 量测

After the pinned toolchain/dependency setup and a fresh browser asset build: / 完成固定工具链、依赖设置及浏览器资产构建后：

```sh
# One feature / 单项功能
node --test e2e/browser-search.test.js
# Full native suite / 原生全量套件
npm run test:browser
# Full suite with per-test/file timing / 含逐项、逐文件耗时的全量套件
npm run test:browser:profile -- --concurrency=2
# Repeat serially with 1, 2, 4; use distinct report paths / 顺序比较并保留独立报告
npm run test:browser:profile -- --concurrency=4 --output=work/browser-profile-4.json
```

The profiler uses the native runner's file-process isolation, failures and timeouts. JSON records each test, the slowest 20, each file's process elapsed time, child-suite elapsed time and summed top-level test time, plus total wall time and pass/fail/skip/cancel counts. File times overlap under concurrency; their sum is not the total wall time. A failed, interrupted, crashed or empty test file cannot produce a successful profile. / 量测器使用原生运行器的文件进程隔离、失败与超时语义。JSON 记录各项测试、最慢 20 项、各文件进程耗时、子套件耗时与顶层测试时长之和，以及整体墙钟时间和各类结果计数。并发时文件时长重叠，不能将其相加视为总耗时。失败、中断、崩溃或空文件不会生成成功量测。

Set `BROWSER_TEST_PHASES=1` to collect optional phase diagnostics in the shared helpers. These describe fixture construction, server/browser startup, page readiness and cleanup where instrumented. They cover only the common helper paths, not every fixture or interaction; missing spans mean unmeasured work, not zero cost. Test duration remains the authoritative end-to-end measurement. / 设置所列环境变量可收集公共 helper 中的可选阶段诊断，描述已埋点的 fixture 构造、服务／浏览器启动、页面就绪与清理。覆盖仅限公共 helper 路径，缺少阶段表示未量测，不代表零成本。测试总时长仍是端到端依据。

`server-start` measures listening readiness after server construction; `browser-context` measures context creation only. `page-ready` includes `beforeGoto`, navigation and the existing readiness waits, while later page interactions remain in total test time. Seven shared `make*` fixture helpers are measured; local fixtures and `buildFixtureIndex` are not. / 服务启动阶段从构造后开始量测监听就绪，context 阶段只量测创建。页面就绪阶段包含导航前回调、导航与既有等待；后续交互仍计入测试总时长。七项共享 fixture helper 有量测，文件内局部 fixture 与索引构造 helper 没有。

Measure memory with a process-tree sampler that includes Chromium children; the reporting process's RSS alone is insufficient. Report sampling interval and whether shared pages are double-counted. Run comparisons sequentially on the same machine with the same Node, browser, lockfile and source assets, retaining failures and repeated samples. Do not turn descriptive timings into flaky hard thresholds. / 内存量测应包含 Chromium 子进程，仅报告进程自身 RSS 不够；注明采样间隔及共享页面是否重复计数。在同机、相同 Node／浏览器／lockfile／源码资产下顺序比较，保留失败与重复样本，不把描述性耗时变成易抖动的硬阈值。

## CI policy / CI 策略

CI retains one Browser job and the existing full Node/package matrix, conservative docs-only classification, asset policy and final `ci` gate. The Browser job profiles the full suite and uploads `browser-timing-<attempt>` for seven days on success or failure. Navigation failure diagnostics retain their existing artifact. Main/development pushes, manual dispatches and code PRs still require the full browser suite. / CI 保留一个 Browser job、完整 Node／安装包矩阵、保守文档分类、资产策略与最终门槛。Browser job 量测全量套件，成功或失败均上传时长报告并保留七天；导航失败诊断保留原有工件。Main／开发分支 push、手动执行与代码 PR 仍要求全量浏览器测试。

The existing manual workflow accepts `browser_concurrency` values `1`, `2` or `4` for controlled comparisons on the same commit. Normal CI and the local full command use two workers. Increase this only after checking complete test counts, failures and memory on the hosted runner; more workers can make individual tests slower through CPU and I/O contention. No tests are moved to nightly, no skip allowlist is expanded, and no cross-runner sharding or browser container is introduced. / 既有手动 workflow 接受三种并行度，用于同提交对照。常规 CI 与本地全量命令使用两个 worker；提高前须检查 hosted runner 上的完整计数、失败与内存，因为 CPU／I/O 竞争可能使单项更慢。测试不会移至 nightly，跳过白名单不扩大，也不引入跨 runner 分片或浏览器容器。
