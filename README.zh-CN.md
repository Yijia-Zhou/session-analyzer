# Session Analyzer

[English README](README.md)

Session Analyzer 是一个用于查看 Codex 与 Claude Code 会话转录的本地 Web 工具。它把嘈杂的 JSONL 转录历史整理成按仓库过滤的会话列表、可搜索时间线、结构化工具调用详情，以及可下钻的原始记录。

这个应用面向本地使用。它只从你显式选择的来源 home 目录读取转录文件，在内存中完成分析，不会上传转录内容。

## 功能

- 从 Codex 或 Claude Code 会话工作目录中发现项目，也可以启动时直接指定目标仓库。
- 只显示与所选仓库匹配的会话。
- 保持 Claude Code subagent 可单独选择；区分物化式与指针式 fork，并在不重复指标或原始记录的前提下展示归父会话所有的继承上下文。
- 浏览三种层级：去重后的主时间线、协议事件、原始 JSONL 记录。
- 搜索消息、命令、文件、输出、状态、事件类型和层级。
- 检查消息、命令、补丁、计划、MCP/工具调用、Web 搜索、生命周期事件和原始记录的结构化详情。
- 从逻辑事件跳回精确的源 JSONL 行。
- 使用适合叙事阅读、对话回顾、错误聚焦、改动审查、计划阅读、搜索聚焦和紧凑浏览的折叠策略。
- 安全渲染转录中的 Markdown：禁用原始 HTML，并拒绝危险链接协议。

## 隐私模型

本项目刻意采用本地优先设计：

- 服务器默认绑定到 `127.0.0.1`。
- 转录文件只从磁盘读取，不会被修改。
- 派生索引只保存在内存中。
- 原始转录下钻需要用户显式打开，所以敏感内容不会被应用隐藏，但本应用也不会把它发送到外部。

Agent 转录可能包含提示词、命令输出、文件路径、环境详情以及其他私有材料。不要把真实的 `.codex/sessions`、`.claude/projects` 目录或导出的转录数据提交到公开仓库。

## 环境要求

- 已安装 CLI：受支持的 Node.js LTS，最低 Node.js 22（推荐 Node.js 24），以及用于安装的 npm
- 源码开发与发布工作：Node.js `^22.22.2 || ^24.15.0`，并且 npm 必须精确为 `12.0.2`

## 通过 npm 运行

不指定仓库启动，然后在浏览器中从发现的项目里选择：

```sh
npx session-analyzer
```

或者启动时显式指定仓库：

```sh
npx session-analyzer --repo /path/to/project
```

Windows 示例：

```powershell
npx session-analyzer --repo 'C:\path\to\project'
```

默认情况下，应用会从 `~/.codex` 读取 Codex transcript。如果你的 transcript 在其他位置，可以使用 `--codex-home`：

```sh
npx session-analyzer --repo /path/to/project --codex-home /path/to/.codex --port 17890
```

Claude Code 支持需要显式启用。除非选择 Claude Code 来源，否则应用不会扫描 `~/.claude`：

```sh
npx session-analyzer --source claude-code --repo /path/to/project
```

如果 Claude home 不在默认位置，或者要检查导出的 project-container 目录，可以使用 `--claude-home`：

```sh
npx session-analyzer --source claude-code --claude-home /path/to/.claude
```

`--source claude` 是 `--source claude-code` 的别名。0.1.3 版本的每个 server 进程只选择一种来源，不会构建 Codex 与 Claude 的混合索引。

然后打开：

```text
http://127.0.0.1:17890/
```

也可以全局安装 CLI：

```sh
npm install -g session-analyzer
session-analyzer --repo /path/to/project
```

默认 host 是 `127.0.0.1`。`--host` 是高级选项；绑定到 localhost 之外可能让网络上的其他机器读取当前进程可访问的 transcript 内容。

### 大型 transcript 历史与 Node/V8 内存

索引内存主要取决于与所选仓库匹配的 transcript 历史总量和形态，而不是源码仓库本身的大小。Candidate transcript 字节数、Raw Record 与 Logical Event 数量、记录组成，以及尤其异常庞大的单个 Session，都会影响内存使用。

以当前实现的近似实测锚点为例：约 250 MB 匹配的 Codex JSONL 达到约 0.7 GB V8 heap 峰值；约 850–900 MB、约 250,000 条 Raw Record 达到约 1.9 GB V8 heap 峰值。接近约 1 GB 匹配 transcript 数据的历史应视为高内存工作负载。这些实测数据只是指导，不是保证、预测公式、内存耗尽边界或硬性容量上限；实际使用量会随记录形态、事件数量、Node 版本而变化，异常庞大的单个 Session 尤其会产生影响。

当匹配历史达到经验性的 800 MiB 警告阈值时，CLI 会输出一次 `[SESSION_ANALYZER_LARGE_TRANSCRIPT_HISTORY]`，然后照常继续索引。该警告只为用户和 agent 提供信息：应先尝试普通索引；若索引成功，无需调整 heap。它不会修改 `NODE_OPTIONS`、重启进程或改变退出码。

只有当索引因 `JavaScript heap out of memory` 等 V8 heap exhaustion 错误终止时，才使用适度增大的临时 heap 重试。这是为异常庞大历史提供的临时规避方式，不是新的产品默认值。PowerShell 示例：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
npx session-analyzer --repo 'C:\path\to\project' --log-dir '.\session-analyzer-logs'
Remove-Item 'Env:NODE_OPTIONS'
```

在 POSIX shell 中，把覆盖限制在单条命令内：

```sh
NODE_OPTIONS='--max-old-space-size=4096' npx session-analyzer --repo /path/to/project --log-dir ./session-analyzer-logs
```

调查问题时，推荐使用 `--log-dir <path>` 收集聚合索引诊断。Session Analyzer 会写入经过节流、有界的 JSONL 生命周期记录，其中包含 candidate 文件／字节数、Session／Raw／Logical 数量、耗时、V8 heap limit、当前与进程内峰值内存，以及稳定的容量警告信号。这些记录不包含仓库路径、transcript 路径、transcript 正文、提示词、命令或源码内容，并且最多保留 20 份索引日志。Fatal V8 OOM 的 stderr 仍是权威的最终崩溃证据；进程发生 fatal termination 时，诊断 logger 可能来不及写入最终记录。

大型 transcript 历史的内存效率仍是持续改进方向。未来版本可能进一步降低索引与运行时内存使用量，因此以上数据描述的是当前实现，而不是永久的产品容量上限。

## 从源码开发

已发布 CLI 继续采用上文 Node.js 22 或更高版本的宽泛运行时要求。源码 checkout 有意采用更严格的工具链，因为 npm 12 会执行经过审查的依赖 install-script 策略。在运行仓库内任何 `npm install`、`npm ci` 或 `npm run` 前，先选择受支持的 Node.js 版本，并从源码 checkout 之外的目录全局 bootstrap 精确的 npm CLI。下面第一条 npm 命令只更新工具链，不安装项目依赖：

```sh
node --version
npm install --global npm@12.0.2 --ignore-scripts --registry=https://registry.npmjs.org/
npm --version
```

完成 bootstrap 后才能返回源码 checkout。只有 Node.js 满足 `^22.22.2 || ^24.15.0` 且 `npm --version` 精确输出 `12.0.2` 时才能继续。随后在 strict 默认拒绝脚本策略下安装 lockfile 固定的依赖：

```sh
npm ci --strict-allow-scripts --registry=https://registry.npmjs.org/
npm install-scripts ls --json
```

最后一条命令不得报告 pending install script。

从源码仓库启动：

```sh
npm start
```

或者直接运行 server 文件：

```powershell
node server.js --repo 'C:\path\to\project'
```

构建浏览器 bundle：

```sh
npm run build
```

运行测试：

```sh
npm test
```

安装 Chromium 并运行浏览器覆盖：

```sh
npm run browser:install
npm run test:browser
```

发布打包前运行 package smoke 验证：

```sh
npm run test:package
```

package smoke 命令会执行 `npm pack`，把 tarball 安装到全新的临时项目中，检查已安装 CLI 的 help，并启动打包后的 server。

运行可重复的非浏览器 release gate：

```sh
npm run release:check
```

Release gate 会检查生成资产、运行完整 Node 测试，并重复执行安装后 package smoke。Browser coverage 继续作为独立的 CI 与本地发布要求。

`test/fixtures/codex-home` 下的 fixture 以及 `test/claude.test.js` 中的内联 Claude fixture 都是合成转录数据。它们有意包含假的路径和示例转录形态，用于覆盖解析器行为。

浏览器 JavaScript 源码位于 `src/browser/`，浏览器与 Node 共用逻辑位于 `src/shared/`。生成的运行时 bundle 是 `public/assets/app.js`；不要直接编辑它。

## 使用方式

1. 先在 CLI 选择转录来源，再在浏览器中选择目标项目，或在启动服务器时传入 `--repo`。Codex 是默认来源。
2. 从左侧面板选择一个会话。
3. 使用 `Main timeline` 进行日常阅读，使用 `Protocol layer` 查看注入上下文和生命周期记录，使用 `Raw records` 查看精确转录行。
4. 在搜索 HUD 中输入忽略大小写的普通文本短语；短语中的空白可以匹配空格、Tab 或换行。打开“搜索选项”可在当前 session 与整个项目之间切换，编辑始终可见的“涉及文件”“类型”或“状态”筛选，查看完整计数，或跳到相邻的全局层级选择器。`status:failed` 等类似操作符的输入仍按字面文本搜索。
5. 打开事件以检查结构化详情和原始引用。

npm 包不承诺稳定的程序接口。v0.1 支持的接口是 `session-analyzer` CLI。

## 已知限制

- 0.1.3 版本的每个 server 进程只选择一种转录来源；暂不支持 Codex 与 Claude 混合索引或来源筛选。
- Claude Code 外置的 `tool-results/*` payload 暂不加载或搜索；其来源记录和引用仍可通过 protocol/raw 兜底查看。
- 未来或未知的 Codex 与 Claude Code protocol event 仍可通过 protocol/raw 兜底视图检查，但并非每个事件族都有完整精致的结构化渲染器。
- Transcript fixture 覆盖是有重点的，不是穷尽式的；后续观察到新的历史形态时，可能仍需要补充 fixture 和展示调整。
- Review finding 渲染已有 synthetic 覆盖，本地也已观察到真实的非空 `review_output.findings[]` 示例；后续仍适合补充脱敏 fixture 来防止回归。

## 仓库结构

- `server.js`：本地 HTTP 服务器和 API 路由。
- `src/source-adapters.js`：来源选择与来源中立的分派边界。
- `src/codex*.js`：Codex 解析、发现、逻辑映射、索引和详情构建。
- `src/claude*.js`：Claude Code 发现、解析、逻辑映射、索引和详情构建。
- `src/folding.js`：内置时间线折叠策略。
- `src/shared/`：浏览器与 Node 共用逻辑，例如折叠规则求值和命令高亮元数据。
- `src/browser/`：浏览器 UI 源码、搜索控件与状态模型、渲染器、导航和应用接线。
- `public/`：静态 HTML/CSS 和生成的浏览器运行时资产。
- `test/`：Node 测试套件和合成转录 fixture。
- `docs/`：产品规格、设计文档、执行计划和 backlog 笔记。

## 安全说明

这个工具是本地查看器，不是托管的多用户分析服务。如果你把服务器暴露到 localhost 之外，任何能访问该服务的人都可能读取当前进程可访问的转录内容。

发布 fork、issue 复现或示例数据之前，请确认附带的转录样本是合成的或已脱敏。

## 许可证

BSD 3-Clause。见 [LICENSE](LICENSE)。
