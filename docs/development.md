# Develop from source / 源码开发

The installed CLI supports Node.js 22 or newer on a supported LTS line (Node.js 24 recommended). Source development and release work deliberately require **Node.js `^22.22.2 || ^24.15.0` and exactly npm `12.0.2`**, because npm 12 enforces the reviewed dependency install-script policy. DeepSeek compressed artifacts need built-in `node:zlib` Zstandard support, available on these development releases; uncompressed artifacts remain readable without it. / 安装后 CLI 支持仍受支持的 LTS 系列中的 Node.js 22 或更新版本（推荐 Node.js 24）。源码开发与发布有意严格要求 **Node.js `^22.22.2 || ^24.15.0` 与精确 npm `12.0.2`**，因为 npm 12 执行经过审查的依赖安装脚本策略。DeepSeek 压缩工件需要内置 `node:zlib` Zstandard 支持，这些开发版本均提供；未压缩工件在缺少该能力时仍可读。

## Toolchain and dependencies / 工具链与依赖

For a fresh 0.2.0 release-candidate checkout, install Git and clone the public branch into a new directory. These commands leave the terminal outside the checkout so the toolchain bootstrap below runs in the correct place. The accepted feature-freeze baseline is `e9b7a1923c12f18d2f283dacb998bc51a11cfa66`; record the actual commit after cloning because the branch can advance. / 首次试用 0.2.0 release candidate 时，准备 Git 并将公开分支克隆到新目录。以下命令不会进入 checkout，使后续工具链 bootstrap 在正确位置运行。已接受的功能冻结基线为 `e9b7a1923c12f18d2f283dacb998bc51a11cfa66`；分支可能推进，克隆后应记录实际 commit。

```sh
git clone --branch towards-0.2.0 https://github.com/Yijia-Zhou/session-analyzer.git
git -C session-analyzer rev-parse HEAD
```

Before any repository-local `npm install`, `npm ci`, or `npm run`, select supported Node.js and bootstrap the exact npm CLI globally **from a directory outside this checkout**. This first npm command updates the toolchain without installing project dependencies: / 执行仓库内任何 `npm install`、`npm ci` 或 `npm run` 前，先选择受支持 Node.js，并**从 checkout 之外的目录**全局 bootstrap 精确版本 npm。第一条 npm 命令只更新工具链，不安装项目依赖：

```sh
node --version
npm install --global npm@12.0.2 --ignore-scripts --registry=https://registry.npmjs.org/
npm --version
```

Return to the checkout only after the bootstrap. Do not continue unless Node satisfies `^22.22.2 || ^24.15.0` and npm prints exactly `12.0.2`. Install locked dependencies under the strict default-deny script policy: / 完成 bootstrap 后再返回 checkout。Node 不满足 `^22.22.2 || ^24.15.0` 或 npm 未输出精确 `12.0.2` 时不要继续。按严格默认拒绝脚本策略安装锁定依赖：

For the fresh clone above, enter it with `cd session-analyzer`; for an existing checkout, return to its own directory. / 对上述新克隆执行 `cd session-analyzer`；已有 checkout 则返回其实际目录。

```sh
npm ci --strict-allow-scripts --registry=https://registry.npmjs.org/
npm install-scripts ls --json
```

The final command must report no pending install scripts. `package.json#allowScripts` records reviewed allow/deny decisions and `.npmrc` enables strict enforcement; never use `--dangerously-allow-all-scripts` to pass a gate. See the [release runbook](design-docs/npm-release-runbook.md) for the full policy and publication procedure. / 最后一条命令必须报告没有待处理安装脚本。`package.json#allowScripts` 记录经过审查的允许／拒绝决定，`.npmrc` 启用严格执行；不得用 `--dangerously-allow-all-scripts` 让门槛通过。完整策略与发布流程见[发布运行手册](design-docs/npm-release-runbook.md)。

## Build, start, and verify / 构建、启动与核验

Build the browser bundle, then start the local server: / 构建浏览器 bundle，再启动本地服务：

```sh
npm run build
npm start
```

Or run the server directly with an explicit target project; record the checkout commit when verifying branch features: / 或直接运行 server 并指定目标项目；核验分支能力时记录 checkout commit：

```powershell
git rev-parse HEAD
node server.js --repo 'C:\projects\target-project'
```

Open `http://127.0.0.1:17890/`. Without `--repo`, select a project in the browser. The target project, Analyzer checkout, and transcript root are separate paths. Use [startup acceptance](usage/agent-quickstart.md) to check indexing outcome, source/root/project identity, session count, diagnostics, and actual reading; HTTP readiness alone is insufficient. Restart the local server when code changes require it for user acceptance. / 打开 `http://127.0.0.1:17890/`。未传 `--repo` 时在浏览器选择项目。目标项目、Analyzer checkout 与转录根是独立路径。按[启动验收](usage/agent-quickstart.md)核验索引结果、来源／根／项目身份、会话数、诊断与实际阅读；仅 HTTP 就绪不充分。代码修改需要重启才能供用户验收时，重启本地服务。

| Task / 任务 | Command / 命令 |
| --- | --- |
| Node tests / Node 测试 | `npm test` |
| Serial phase coverage measurement / 顺序阶段覆盖量测 | `npm run test:profile-coverage` |
| Install Chromium / 安装 Chromium | `npm run browser:install` |
| Browser coverage / 浏览器覆盖 | `npm run test:browser` |
| Installed-package smoke / 安装包 smoke | `npm run test:package` |
| Repeatable non-browser release gate / 可重复非浏览器发布门槛 | `npm run release:check` |

Package smoke packs the project, installs the tarball into a fresh temporary project, checks CLI help, and starts the packaged server. `release:check` checks generated assets, runs the full Node suite, and repeats package smoke; browser coverage remains a separate CI/local release requirement. Follow the release runbook for the remaining release gates. / Package smoke 打包项目，将 tarball 安装到全新临时项目，检查 CLI help 并启动包内服务。`release:check` 检查生成资产、运行全部 Node 测试并重复 package smoke；浏览器覆盖仍是独立的 CI／本地发布要求。其余发布门槛遵循发布运行手册。

<a id="validation-scope"></a>

## Validation scope / 验证范围

Choose checks for the affected behavior and risk; the command table is not a checklist for every edit. / 按受影响行为与风险选择检查；命令表不是每次编辑都要执行的清单。

Phase-accounting changes also require `npm run test:profile-coverage`, run with Node/browser suites paused. It measures three sequential 100-row real-HTTP samples and gates their minimum residual at an absolute 5 ms; ordinary concurrent Node tests enforce topology and semantic accounting without a one-shot residual gate. CI runs this separate step only on Node 24 / Ubuntu after `npm test`. See [measurement policy](design-docs/deepseek-readback-measurement.md#current-coverage-policy). / 阶段核算修改还需在暂停 Node／浏览器套件时执行 `npm run test:profile-coverage`。它顺序测量三次 100 行真实 HTTP 样本，以最小 residual 不超过绝对 5 ms 为门槛；普通并发 Node 测试严格检查拓扑与语义核算，不对单次 residual 设门槛。CI 仅在 Node 24／Ubuntu 的 `npm test` 之后执行该独立步骤。详见[量测策略](design-docs/deepseek-readback-measurement.md#current-coverage-policy)。

- Documentation or agent-instruction changes: inspect the diff, check local references and bilingual consistency, and run `git diff --check`. If a hook or helper changes, check its syntax and exercise its relevant behavior. / 文档或 agent 指令变更：审查 diff，检查本地引用与双语一致性，运行 `git diff --check`。若修改 hook 或辅助脚本，检查语法并实际验证相关行为。
- Code changes: run the affected `test/*.test.js` files with `node --test test/<affected>.test.js`. Parser/schema work retains the [schema runbook](design-docs/schema-update-runbook.md)'s evidence and focused-fixture requirements. Shared contracts or unresolved cross-source impact may require the full Node suite. / 代码变更：用 `node --test test/<affected>.test.js` 运行受影响测试。解析器／schema 工作保留 [schema 手册](design-docs/schema-update-runbook.md)的依据与聚焦 fixture 要求。共享契约或尚未排除的跨来源影响可能需要全部 Node 测试。
- Browser code changes: rebuild with `npm run build`, run `npm run build:check`, and verify the affected interaction; use browser tests when rendering or navigation behavior changes. Package/CLI/distribution changes need the relevant package checks. / 浏览器代码变更：执行 `npm run build` 重新构建及 `npm run build:check`，核验受影响交互；渲染或导航行为变更时使用浏览器测试。包／CLI／分发变更需要相关包检查。
- Release work follows the [release runbook](design-docs/npm-release-runbook.md)'s required gates and existing rules for reusing unchanged CI evidence. This scope guidance does not weaken release or CI requirements. / 发布工作遵循[发布手册](design-docs/npm-release-runbook.md)的强制门槛及已有的未变更 CI 证据复用规则。本范围指南不削弱发布或 CI 要求。

Inspect failures and fix regressions introduced by the change. Once the relevant checks pass, broaden or repeat them only for new changes, failures, or unresolved risks. Report what passed and what remains unverified. / 检查失败并修复变更引入的回归。相关检查通过后，仅因新修改、失败或未解决风险扩大或重复验证。报告已通过内容与尚未验证项。

## Repository layout / 仓库布局

| Path / 路径 | Role / 职责 |
| --- | --- |
| `server.js` | Local HTTP server and internal API routes / 本地 HTTP 服务与内部 API 路由 |
| `src/source-adapters.js` | Source selection and source-neutral dispatch / 来源选择与来源中立派发 |
| `src/codex*.js`, `src/claude*.js`, `src/deepseek-harness*.js` | Source discovery, parsing, indexing, mapping, and detail / 来源发现、解析、索引、映射与详情 |
| `src/folding.js` | Built-in timeline folding profiles / 内置时间线折叠配置 |
| `src/shared/` | Browser-and-Node shared logic / 浏览器与 Node 共享逻辑 |
| `src/browser/` | Browser UI source, state, rendering, and navigation / 浏览器 UI 源码、状态、渲染与导航 |
| `public/` | Static HTML/CSS and generated browser assets / 静态 HTML／CSS 与生成浏览器资产 |
| `test/`, `e2e/` | Node tests, synthetic transcript fixtures, and browser tests / Node 测试、合成转录 fixture 与浏览器测试 |
| `docs/` | Online usage/development guides, specs, designs, execution plans, and backlog / 在线使用／开发指南、规格、设计、执行计划与远期想法 |

Browser source lives in `src/browser/`; `public/assets/app.js` is generated and must not be edited directly. Transcript fixtures are synthetic and intentionally contain fake paths and sample shapes; do not add real user transcripts. Start with the [documentation map](README.md), [domain glossary](../CONTEXT.md), [architecture](design-docs/logical-event-timeline.md), and [performance design](design-docs/timeline-loading-and-rendering-performance.md) for further work. Usage/development guides are online-only and are not promised in the npm tarball. / 浏览器源码在 `src/browser/`；`public/assets/app.js` 为生成文件，不得直接编辑。转录 fixture 是合成数据，有意包含虚构路径与样本形态；不要加入真实用户转录。后续工作可从[文档地图](README.md)、[领域词汇表](../CONTEXT.md)、[架构](design-docs/logical-event-timeline.md)及[性能设计](design-docs/timeline-loading-and-rendering-performance.md)开始。使用／开发指南仅在线提供，不承诺进入 npm tarball。
