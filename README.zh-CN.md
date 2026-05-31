# Codex Session Analyzer

[English README](README.md)

Codex Session Analyzer 是一个用于查看 Codex 会话转录的本地 Web 工具。它把嘈杂的 JSONL 转录历史整理成按仓库过滤的会话列表、可搜索时间线、结构化工具调用详情，以及可下钻的原始记录。

这个应用面向本地使用。它从你自己的 Codex home 目录读取转录文件，在内存中完成分析，不会上传转录内容。

## 功能

- 从 Codex 会话工作目录中发现项目，也可以启动时直接指定目标仓库。
- 只显示与所选仓库匹配的会话。
- 浏览三种层级：去重后的主时间线、协议事件、原始 JSONL 记录。
- 搜索消息、命令、文件、输出、状态、事件类型和层级。
- 检查消息、命令、补丁、计划、MCP/工具调用、Web 搜索、生命周期事件和原始记录的结构化详情。
- 从逻辑事件跳回精确的源 JSONL 行。
- 使用适合叙事阅读、问题排查、改动审查、工具检查和紧凑浏览的折叠策略。
- 安全渲染转录中的 Markdown：禁用原始 HTML，并拒绝危险链接协议。

## 隐私模型

本项目刻意采用本地优先设计：

- 服务器默认绑定到 `127.0.0.1`。
- 转录文件只从磁盘读取，不会被修改。
- 派生索引只保存在内存中。
- 原始转录下钻需要用户显式打开，所以敏感内容不会被应用隐藏，但本应用也不会把它发送到外部。

Codex 转录可能包含提示词、命令输出、文件路径、环境详情以及其他私有材料。不要把真实的 `.codex/sessions` 目录或导出的转录数据提交到公开仓库。

## 环境要求

- Node.js 18 或更高版本
- npm

## 安装

```sh
npm install
```

## 运行

不指定仓库启动，然后在浏览器中从发现的项目里选择：

```sh
npm start
```

或者启动时显式指定仓库：

```sh
node server.js --repo /path/to/project
```

Windows 示例：

```powershell
node server.js --repo 'C:\path\to\project'
```

默认情况下，应用会从 `~/.codex` 读取 Codex 转录。如果你的转录在其他位置，可以使用 `--codex-home`：

```sh
node server.js --repo /path/to/project --codex-home /path/to/.codex --port 17890
```

然后打开：

```text
http://127.0.0.1:17890/
```

## 使用方式

1. 选择目标项目，或在启动服务器时传入 `--repo`。
2. 从左侧面板选择一个会话。
3. 使用 `Main timeline` 进行日常阅读，使用 `Protocol layer` 查看注入上下文和生命周期记录，使用 `Raw records` 查看精确转录行。
4. 使用普通文本或筛选条件搜索，例如 `file:src/parser.js`、`kind:command`、`status:failed` 和 `layer:raw`。
5. 打开事件以检查结构化详情和原始引用。

## 测试

```sh
npm test
```

`test/fixtures/codex-home` 下的测试 fixture 是合成转录数据。它们有意包含假的 Windows 路径和示例转录形态，用于覆盖解析器行为。

## 仓库结构

- `server.js`：本地 HTTP 服务器和 API 路由。
- `src/codex.js`：转录解析、项目发现、索引、逻辑时间线构建和事件详情提取。
- `src/folding.js`：内置时间线折叠策略。
- `public/folding.js`：浏览器与 Node 共用的折叠规则求值。
- `public/`：浏览器 UI、搜索解析、渲染器和样式。
- `test/`：Node 测试套件和合成转录 fixture。
- `docs/`：产品规格、设计文档、执行计划和 backlog 笔记。

## 安全说明

这个工具是本地查看器，不是托管的多用户分析服务。如果你把服务器暴露到 localhost 之外，任何能访问该服务的人都可能读取当前进程可访问的转录内容。

发布 fork、issue 复现或示例数据之前，请确认附带的转录样本是合成的或已脱敏。

## 许可证

BSD 3-Clause。见 [LICENSE](LICENSE)。
