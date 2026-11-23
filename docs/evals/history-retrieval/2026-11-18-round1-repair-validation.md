# Round 1 repair validation / 第一轮修复验证

The three repair checks use synthetic fixtures. The [original comparison](2026-11-15-round1-comparison.md) and its [closeout supplement](2026-11-18-round1-closeout-supplement.md) are separate evidence. / 三处修复使用合成 fixture 验证。[原对照](2026-11-15-round1-comparison.md)及其[收尾补充](2026-11-18-round1-closeout-supplement.md)是单独的依据。

| Boundary / 边界 | Reproduced before the fix / 修复前复现 | Focused check after the fix / 修复后定向检查 |
| --- | --- | --- |
| Raw association continuation / Raw 关联续读 | Two distinct Raw Records were mapped to one synthetic physical position. Continuing the second Raw's associations after `limit:1` switched to the first Raw. / 两个不同 Raw 映射到同一个合成物理位置，以 `limit:1` 到达第二个 Raw 后续读关联，错误地切到第一个。 | Replaying the returned object through HTTP keeps the second Raw and reaches its remaining associations without duplicates or gaps. Invalid or mismatched references fail. / 经 HTTP 原样回送续读对象，继续读取第二个 Raw 的剩余关联，无重复或遗漏。无效或错绑引用明确失败。 |
| Continuation request size / 续页请求大小 | A 262,112-byte UTF-8 JSON search returned a 262,363-byte continuation. Its response fit `maxBytes` and the CLI rejected the replay with `BODY_TOO_LARGE`. / 262,112 字节的 UTF-8 JSON 搜索返回了 262,363 字节的续页请求。响应符合 `maxBytes`，CLI 回送时以 `BODY_TOO_LARGE` 拒绝。 | Single and grouped search return `CONTINUATION_TOO_LARGE` on the producing request (HTTP 413). A complete page at the same input size succeeds. Shorter searches start anew and their returned continuations replay unchanged. / 单查询及分组搜索在生成该页的请求返回 `CONTINUATION_TOO_LARGE`（HTTP 413）。同样输入大小且无需续页时成功。用较短的查询重新搜索后，返回的续页可原样提交。 |
| Evaluation service exit / 评估服务退出 | After simulated exits before readiness (17) and after readiness (0), the gate returned successful `indexing:"pending"`. / 门禁在模拟就绪前退出（17）与就绪后正常退出（0）时均成功返回 `indexing:"pending"`。 | Both return `SERVICE_EXITED` with state and available exit details, without a pending indexing state. / 两者均返回 `SERVICE_EXITED`，带状态和已有退出信息，不报告索引等待。 |

## Validation inputs and commands / 验证输入与命令

Windows, Node.js 24.18.1, npm 12.0.2. Source base `7012f9fbca41626f3ac842437bfe3c38f8aa5fd2` plus exact worktree bytes. The validation input SHA-256 is `6d6906fd34d19560a18b5985ab1de6bf157348e85128ab06860f8f0f7d736984`, computed over HEAD and sorted Git-visible changed paths with their SHA-256, size and file type/mode. This record is omitted from its own digest. The isolated copy matched all 820 Git-scoped files before rebuilding. After rebuild, only the two allowed generated asset paths could differ from the working tree. / Windows、Node.js 24.18.1、npm 12.0.2。输入以源码基点 `7012f9fbca41626f3ac842437bfe3c38f8aa5fd2` 及确切工作区字节标识。验证输入 SHA-256 为 `6d6906fd34d19560a18b5985ab1de6bf157348e85128ab06860f8f0f7d736984`，按 HEAD 加排序后的 Git 可见改动路径及其 SHA-256、大小、文件类型／模式计算。本记录不计入自身摘要。隔离副本在构建前匹配全部 820 个 Git 范围文件。重建后，只有两个允许生成的资产路径可与工作区不同。

Tests use explicit synthetic sources and temporary working directories. Source defaults resolve only inside an empty subprocess profile. / 测试使用明确指定的合成来源和临时工作目录。来源默认路径只会指向子进程的空白用户目录。

| Commands / 命令 | Result / 结果 |
| --- | --- |
| `node --test --test-name-pattern <three new regressions>` on history-service, history-presentation-flow and history-eval-mcp / 对三个定向回归执行所列测试文件 | The cases reproduced all three symptoms before repair. After repair 5/5 test entries passed, including the two separate exit cases. / 修复前复现三处症状。修复后 5/5 项通过，含两种独立退出情形。 |
| `node --test` on the 15 affected files listed below / 对下列 15 个受影响文件运行 | 174/174 passed / 通过. |
| `npm install-scripts ls --json` | No pending installation scripts. / 无待处理安装脚本。 |
| `npm run build` then `npm run build:check` in the isolated copy / 隔离副本 | Build and asset identity check passed. / 构建和资产一致性检查均通过。 |
| `node --test --test-concurrency=4 "test/*.test.js"` in the rebuilt copy / 重建后的隔离副本 | 2,492 passed, 23 skipped, and 2 tests could not find development dependencies at the copy's local path (2,517 total). The two cases passed when rerun with the locked dependencies accessible. Combined coverage is 2,494 passed and 23 platform or symlink skips. / 2,492 项通过、23 项跳过，2 项因副本本地路径找不到开发依赖而失败（共 2,517 项）。接入锁定依赖后定向重跑这两项，均通过。合计验证 2,494 项通过，23 项按平台或符号链接条件跳过。 |
| `node --test --test-name-pattern "development rebuild uses current source&#124;packaged third-party notice" test/ci-assets.test.js test/package.test.js` | 2/2 passed in the rebuilt copy with the locked development dependencies attached. / 重建副本接入锁定开发依赖后，定向重跑 2/2 通过。 |
| `npm run test:package` in the rebuilt copy / 重建后的隔离副本 | Installed-package smoke passed for all seven synthetic source adapters and the history workflow. The package used public registry dependencies. / 七种合成来源 adapter 及 history 流程的安装包冒烟通过。安装包依赖从公开 registry 获取。 |

Affected test files / 受影响的测试文件

- `test/history-service.test.js`
- `test/history-source-locator.test.js`
- `test/history-cli-input.test.js`
- `test/history-presentation-flow.test.js`
- `test/history-presentation.test.js`
- `test/history-read-budget.test.js`
- `test/history-transport.test.js`
- `test/history-diversity.test.js`
- `test/history-eval-mcp.test.js`
- `test/history-eval-transport.test.js`
- `test/history-eval-scope.test.js`
- `test/history-eval-supervisor.test.js`
- `test/run-history-codex-eval.test.js`
- `test/probe-history-codex-tools.test.js`
- `test/import-history-codex-usage.test.js`

## Environment adjustments and limits / 环境调整与边界

The worktree asset check found the saved app bundle stale. The build and package checks used the rebuilt copy. The initial worktree runs hit fixture-directory permissions, repository-external temporary directory requirements, and the npm executable path under the isolated profile. Those checks passed with repository-external scratch space, the pinned npm CLI, and fresh test output paths in the isolated copy. The first package install was blocked by the sandbox registry restriction; the authorized registry run passed. The final two targeted tests used the same source bytes and rebuilt assets with the locked esbuild and Highlight.js dependency paths available. / 工作区的资产检查发现保存的 app bundle 落后，构建及安装包验证使用重建副本。初次工作区测试遇到 fixture 目录权限、仓库外临时目录要求和隔离用户目录中的 npm 路径问题；使用仓库外临时目录、固定 npm CLI 和隔离副本中的新测试输出路径后，这些检查通过。首次安装包安装受沙箱 registry 限制阻断，获准访问公开 registry 后通过。最后定向重跑的两项使用相同源码字节和重建资产，并接入锁定的 esbuild 和 Highlight.js 依赖路径。

Browser E2E and cross-platform CI were outside this local verification. The package smoke and retrieval endpoint checks use synthetic data. D07 was not recaptured. There was no new end-to-end agent comparison. Whether the two product defects occurred in the formal trials remains unknown. / 浏览器 E2E 及跨平台 CI 不在本次本地验证范围内。安装包冒烟和检索入口检查使用合成数据。D07 未补拍。本次无新的 agent 整题对照。两处产品问题是否在原正式试验中触发仍未知。

## Pre-commit service status re-review / 提交前服务状态复审

Independent re-review checked the boundaries between index verification, HTTP startup, process exit and capture closure. The gate preserves terminal scope refusal for failures reported by the service child before the index audit completes, including file I/O failures during scope verification. A bind failure after verification is a service failure. The supervisor's observed process exit triggers `SERVICE_EXITED` with available details, including before capture pipes close. Capture setup failure, a spawn error or unconfirmed cleanup without an observed exit produces `SERVICE_UNAVAILABLE` with available diagnostics. / 独立复审检查了索引核验、HTTP 启动、进程退出和捕获关闭之间的边界。门禁对服务子进程在索引审计完成前报告的故障保留终止试验的 scope 拒绝，包括范围核验期间的文件 I/O 失败。核验完成后的绑定失败归为服务故障。监督器观测到进程退出即返回 `SERVICE_EXITED` 及可用信息，覆盖捕获管道关闭前的时段。捕获准备失败、子进程启动错误或清理未获确认且未观测到退出时，返回 `SERVICE_UNAVAILABLE` 及可用诊断信息。

- `node --test --test-name-pattern "status reports an exited service" test/history-eval-mcp.test.js` reproduced the findings with synthetic cases in both review passes. The final run passed all 8 test entries, including the parent test. / 两次复审均以合成用例复现了发现的问题。最终运行的 8 个测试项全部通过，含父测试。
- `node --test test/history-eval-mcp.test.js test/history-eval-transport.test.js test/history-eval-supervisor.test.js test/history-eval-scope.test.js test/run-history-codex-eval.test.js` passed 70/70 with the same isolated source defaults and explicit synthetic fixtures. / 使用同样隔离的默认来源与显式合成 fixture，70/70 通过。

The revised source input SHA-256 is `ac54dfcd0c658ba6cd1d0fe6478bb3adfec873aae84bb19bb60b768312eb3f52` under the same digest rule. Compared with the earlier source input, only the evaluation gate and its regression test changed. The full-suite run, its two environment-adjusted reruns, and the build and package results above retain their earlier source identity. The revised gate is covered by the targeted results here. / 修订后按同一规则计算的源码输入 SHA-256 为 `ac54dfcd0c658ba6cd1d0fe6478bb3adfec873aae84bb19bb60b768312eb3f52`。与上文的源码输入相比，仅评估门禁与其回归测试有变更。上文全量运行、修正环境后的两项重跑及构建与安装包结果仍绑定此前的源码身份。修订后的门禁由本节的定向结果覆盖。
