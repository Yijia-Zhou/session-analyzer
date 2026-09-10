# Start for a user / 替用户启动

Use this guide to start the user's selected project and verify that its recorded work can actually be read. It documents the accompanying checkout; the CLI is the supported v0.2 interface, and the HTTP checks below are version-specific internal implementation checks, not a stable public API. / 本指南用于启动用户所选项目并核验记录中的工作确实可读。本文对应所在 checkout；v0.2 支持的接口是 CLI，下列 HTTP 检查属于版本相关内部实现核验，不是稳定公共 API。

This is an online guide, not a promised npm package file. npm `session-analyzer@0.2.0` is publicly available; see the [release record](https://github.com/Yijia-Zhou/session-analyzer/releases/tag/v0.2.0). Follow documentation at the installed release's tag or a matching immutable documentation revision. The original `v0.2.0` documentation snapshot retains pre-publication wording from release preparation; this paragraph corrects that publication status without changing the release tag, package, CLI, or verification contract. Still verify the actual installed executable and version rather than relying on a checkout's package version string. / 本文是在线指南，不承诺随 npm 包分发。npm `session-analyzer@0.2.0` 已公开，见[发布记录](https://github.com/Yijia-Zhou/session-analyzer/releases/tag/v0.2.0)。应阅读安装版本对应 tag 或匹配的不可变文档修订。原始 `v0.2.0` 文档快照保留了准备发布时的候选版本措辞；本段修正发布状态，不改变 release tag、安装包、CLI 或验收契约。仍需核验实际安装的可执行文件与版本，不能仅依赖 checkout 的包版本字符串。

## 1. Identify and start the intended program / 确定并启动目标程序

Record the actual installed package version and executable location, or checkout path plus `git rev-parse HEAD`; also record `node --version`, Transcript Source, target repository, transcript root, and local URL. Registry `latest` alone is not evidence of the running version. Check the installed CLI's `--help` before using a source or flag. For a global installation, `npm ls --global session-analyzer --depth=0` and `Get-Command session-analyzer` (PowerShell) help identify the package and executable; account for multiple installations on PATH. / 记录实际安装包版本与可执行文件位置，或 checkout 路径及 `git rev-parse HEAD`；同时记录 `node --version`、转录来源、目标仓库、转录根与本地 URL。Registry `latest` 不能单独证明运行版本。使用来源或参数前先检查已安装 CLI 的 `--help`。全局安装可用 `npm ls --global session-analyzer --depth=0` 与 PowerShell 的 `Get-Command session-analyzer` 辅助定位包和可执行文件；注意 PATH 上可能存在多份安装。

`--repo` is the user's project whose history they want to read. It is distinct from the Analyzer checkout/install directory and from the transcript root. Choose one active source; the app does not merge sources into one index. / `--repo` 是用户想查看历史的项目，与 Analyzer checkout／安装目录以及转录根分别独立。选择一个当前来源；应用不会将多个来源混合索引。

| Transcript Source / 转录来源 | Default root / 默认根 | Custom root flag / 自定义根参数 |
| --- | --- | --- |
| Codex (default / 默认) | `~/.codex` | `--codex-home` |
| Claude Code | `~/.claude` | `--claude-home` |
| DeepSeek Harness | `~/.dsh/sessions` | `--dsh-home` |

For the public release, start an explicitly selected version after checking its supported features, for example: / 对公开发布包，检查其支持能力后启动明确选定的版本，例如：

```sh
npx session-analyzer@0.2.0 --repo /path/to/target-project
```

For this checkout's features, complete the [source setup](../development.md), including the build, then run from that checkout. Replace the example paths with the user's target project and DeepSeek sessions persistence root: / 要使用此 checkout 的功能，先完成[源码配置](../development.md)及构建，再从该 checkout 运行。将示例路径替换为用户目标项目及 DeepSeek sessions 持久化根：

```powershell
git rev-parse HEAD
node --version
node server.js --source deepseek-harness --repo 'C:\projects\target-project' --dsh-home 'C:\transcripts\sessions'
```

For Codex or Claude Code, use `--source codex` or `--source claude-code` and the corresponding root flag only if needed. Without `--repo`, open `http://127.0.0.1:17890/` and select the source and project in the chooser; source roots can also be edited there. Keep a foreground terminal open, or use your environment's persistent background-process facility. / Codex 或 Claude Code 使用 `--source codex` 或 `--source claude-code`，仅在需要时指定对应根参数。未传 `--repo` 时打开 `http://127.0.0.1:17890/`，在选择器中选择来源与项目；也可在那里修改来源根。保持前台终端运行，或使用环境支持的持久后台进程方式。

## 2. Verify indexing with a deadline / 有界核验索引

An HTTP root response proves only HTTP readiness. For the accompanying checkout, run this PowerShell example in another terminal after a project has been selected or started with `--repo`. It pins the first observed job ID so another project selection cannot silently replace the job being verified. / 根 HTTP 响应只证明 HTTP 就绪。对本文对应 checkout，选好项目或以 `--repo` 启动后，在另一终端运行以下 PowerShell 示例。它固定首次观察到的任务 ID，防止另一次项目选择静默替换正在核验的任务。

```powershell
$baseUrl = 'http://127.0.0.1:17890'
$deadline = [DateTime]::UtcNow.AddSeconds(60)
$job = (Invoke-RestMethod "$baseUrl/api/project/status" -TimeoutSec 10 -ErrorAction Stop).job
if (-not $job.id -or -not $job.status) { throw 'Missing indexing job in status response / 状态响应缺少索引任务' }
$jobId = $job.id
$statusUrl = "$baseUrl/api/project/status?jobId=$jobId"
while ($job.status -in @('queued', 'running') -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $job = (Invoke-RestMethod $statusUrl -TimeoutSec 10 -ErrorAction Stop).job
    if ($job.id -ne $jobId -or -not $job.status) { throw 'Indexing job changed or missing / 索引任务已改变或缺失' }
}
$job | Select-Object id, repoRoot, status, error, errorCode
if ($job.status -eq 'succeeded') {
    $state = Invoke-RestMethod "$baseUrl/api/state" -TimeoutSec 10 -ErrorAction Stop
    $state | Select-Object projectSelected, repoRoot, sourceKind, sourceHome,
        @{Name='sessionCount'; Expression={$_.totals.sessionCount}}, sourceDiagnostics |
        ConvertTo-Json -Depth 8
}
```

The loop has a 60-second deadline plus at most one in-flight request timeout. Report `queued` or `running` if it expires; this is not failure or completion. HTTP/request errors must be reported as verification failures, not indexing outcomes. A status 404 means no matching job exists; inspect the browser before selecting/retrying, since a newer selection may have replaced it. Before project selection, `/api/state` returns HTTP 409; during indexing it may return HTTP 202. / 循环期限为 60 秒，另加最多一次进行中请求的超时。到期仍未结束则报告 `queued` 或 `running`，不等于失败或完成。HTTP／请求错误应报告为核验失败，不能当成索引结果。状态 404 表示不存在匹配任务；先查看浏览器再选择／重试，因为更新的选择可能已替换它。未选项目时 `/api/state` 返回 HTTP 409；索引期间可能返回 HTTP 202。

On success, compare `projectSelected`, `repoRoot`, `sourceKind`, and `sourceHome` with the intended values before trusting `totals.sessionCount`. A concurrent selection can change state after a successful status response. On failure, report both `job.error` and `job.errorCode` (including an empty code); a retained older index does not mean the attempted refresh succeeded. `cancelled` requires an explicit cancelled report and a new selection/retry if the task should continue. / 成功后先将 `projectSelected`、`repoRoot`、`sourceKind` 与 `sourceHome` 对照预期，再采用 `totals.sessionCount`。并发选择可能在状态成功响应后改变 state。失败时报告 `job.error` 与 `job.errorCode`（包括空错误码）；保留旧索引不代表本次刷新成功。`cancelled` 要明确报告取消；如需继续则重新选择／重试。

## 3. Read and report the result / 阅读并报告结果

Open an actual session in the browser and read a known segment in Main timeline. Inspect one recorded operation and its command/change/result, then return to surrounding messages. To verify finding older work, start in session A, click the visible `session` scope pill to open Search options, select Entire project, search a known phrase in session B, open that hit and continue reading there. Record the opened session and search hit; counts and an opened pane alone do not verify readable history. / 在浏览器实际打开会话并阅读主时间线的已知片段，查看一次记录中的操作及其命令／修改／结果，再返回周围消息。核验找回旧工作时，从会话 A 出发，点击可见的 `session` 范围按钮打开 Search options，选择 Entire project，搜索会话 B 中的已知短语，打开命中并继续阅读。记录实际打开的会话与搜索命中；只有数量或打开面板不能证明历史可读。

Report these separately: / 分别报告：

- **Identity / 身份**: actual version/commit and Node version; source, target repository, source root, URL. / 实际版本／commit、Node 版本、来源、目标项目、来源根与 URL。
- **Indexing / 索引**: succeeded, failed with error/code, cancelled, pending at deadline, or selection required. / 成功、失败及错误／错误码、取消、到期仍等待，或待选项目。
- **History / 历史**: session count and actual reading/search verification, or explicitly unverified reading. Zero sessions does not establish that the user has no history; check [source/root/project matching](troubleshooting.md). / 会话数与实际阅读／搜索核验，或明确阅读尚未核验。零会话不证明用户没有历史；检查[来源／根／项目匹配](troubleshooting.md)。
- **Diagnostics / 诊断**: `sourceDiagnostics.totalCount`, `counts`, `samples`, and `truncatedCount`; preserve codes and relevant messages. Readable sessions plus diagnostics are partial success. Diagnostic count is not skipped-artifact count; report skipped artifacts only when independently supported. No diagnostics means none observed within implemented coverage, not proof of correct configuration or complete coverage. Root/artifact diagnostics described here are DeepSeek-owned and do not cover every Codex/Claude failure path equally. / `sourceDiagnostics.totalCount`、`counts`、`samples` 与 `truncatedCount`，保留错误码和相关消息。有可读会话且有诊断属于部分成功。诊断条数不等于跳过工件数；仅有独立依据时报告跳过情况。没有诊断只表示实现覆盖内未观察到诊断，不证明配置正确或覆盖完整。这里的根／工件诊断由 DeepSeek 提供，不同等覆盖所有 Codex／Claude 失败路径。
