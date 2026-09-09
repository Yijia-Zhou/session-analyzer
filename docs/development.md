# Develop from source / 源码开发

The installed CLI supports Node.js 22 or newer on a supported LTS line (Node.js 24 recommended). Source development and release work deliberately require **Node.js `^22.22.2 || ^24.15.0` and exactly npm `12.0.2`**, because npm 12 enforces the reviewed dependency install-script policy. DeepSeek compressed artifacts need built-in `node:zlib` Zstandard support, available on these development releases; uncompressed artifacts remain readable without it. / 安装后 CLI 支持仍受支持的 LTS 系列中的 Node.js 22 或更新版本（推荐 Node.js 24）。源码开发与发布有意严格要求 **Node.js `^22.22.2 || ^24.15.0` 与精确 npm `12.0.2`**，因为 npm 12 执行经过审查的依赖安装脚本策略。DeepSeek 压缩工件需要内置 `node:zlib` Zstandard 支持，这些开发版本均提供；未压缩工件在缺少该能力时仍可读。

## Toolchain and dependencies / 工具链与依赖

For a fresh branch-preview checkout, install Git and clone the public branch into a new directory. These commands leave the terminal outside the checkout so the toolchain bootstrap below runs in the correct place. The branch was verified at `cc09021` on 2026-09-08; record the actual commit after cloning because the branch can advance. / 首次试用分支时，准备 Git 并将公开分支克隆到新目录。以下命令不会进入 checkout，使后续工具链 bootstrap 在正确位置运行。2026-09-08 核验的分支 commit 为 `cc09021`；分支可能推进，克隆后应记录实际 commit。

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
| Install Chromium / 安装 Chromium | `npm run browser:install` |
| Browser coverage / 浏览器覆盖 | `npm run test:browser` |
| Installed-package smoke / 安装包 smoke | `npm run test:package` |
| Repeatable non-browser release gate / 可重复非浏览器发布门槛 | `npm run release:check` |

Package smoke packs the project, installs the tarball into a fresh temporary project, checks CLI help, and starts the packaged server. `release:check` checks generated assets, runs the full Node suite, and repeats package smoke; browser coverage remains a separate CI/local release requirement. Follow the release runbook for the remaining release gates. / Package smoke 打包项目，将 tarball 安装到全新临时项目，检查 CLI help 并启动包内服务。`release:check` 检查生成资产、运行全部 Node 测试并重复 package smoke；浏览器覆盖仍是独立的 CI／本地发布要求。其余发布门槛遵循发布运行手册。

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
