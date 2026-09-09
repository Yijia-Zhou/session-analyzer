# Troubleshooting / 故障排查

This online guide describes the accompanying checkout. Use the matching release documentation for an installed package; the intended npm `0.2.0` and a checkout declaring `0.2.0` must still be matched by exact release source. See [agent startup and verification](agent-quickstart.md) for version identification and bounded internal-API checks. / 本在线指南描述所在 checkout。安装包应使用对应发布版文档；预期 npm `0.2.0` 与声明 `0.2.0` 的 checkout 仍必须通过精确 release source 匹配。版本识别与有界内部 API 核验见[启动与验收指南](agent-quickstart.md)。

## No projects, zero sessions, or missing history / 无项目、零会话或历史缺失

Check the active source in the project chooser, its root, and the selected repository. Codex defaults to `~/.codex` (`--codex-home`), Claude Code to `~/.claude` (`--claude-home`), and DeepSeek Harness to `~/.dsh/sessions` (`--dsh-home`, the sessions persistence root). An exported Claude project-container directory can be supplied with `--claude-home`. Only the active source is scanned; there is no mixed-source index. / 检查项目选择器中的当前来源、来源根及所选仓库。Codex 默认 `~/.codex`（`--codex-home`），Claude Code 默认 `~/.claude`（`--claude-home`），DeepSeek Harness 默认 `~/.dsh/sessions`（`--dsh-home`，即 sessions 持久化根）。导出的 Claude 项目容器目录也可传给 `--claude-home`。只扫描当前来源，不混合索引。

`--repo` selects the project recorded in session working directories, not the Analyzer install directory or transcript root. Check recorded paths, especially for moved projects, exports, or another machine. Confirm persisted transcripts exist and are readable by the server process; a running agent may not yet have persisted the work you expect. Then correct the source/root/project and retry. / `--repo` 选择会话工作目录所记录的项目，不是 Analyzer 安装目录或转录根。尤其在项目移动、导出或来自其他机器时，应核对记录中的路径。确认已持久化转录存在且服务进程可读；运行中的 agent 可能尚未持久化预期工作。修正来源／根／项目后重试。

Report zero explicitly even when indexing succeeded. Zero does not prove the user has no history, and an empty diagnostic list does not prove correct configuration or complete coverage. / 即使索引成功也应明确报告零会话。零会话不证明用户没有历史，诊断列表为空也不证明配置正确或覆盖完整。

## Indexing and source diagnostics / 索引与来源诊断

The browser error view and terminal indexing result retain failure information and retry/configuration actions. An accessible home page is only HTTP readiness; wait for indexing to finish. Preserve the job error and code on failure. Pending, cancelled, failed, and succeeded are distinct; an older retained index does not prove a refresh succeeded. / 浏览器错误界面与终端索引结果保留失败信息和重试／配置操作。首页可访问只证明 HTTP 就绪，应等待索引完成。失败时保留任务错误和错误码；等待、取消、失败、成功是不同结果，保留旧索引不证明刷新成功。

For DeepSeek, valid sessions can remain readable while problematic artifacts produce diagnostics. Use codes and sampled messages/paths to act; samples are bounded, so inspect counts and `truncatedCount` too. Diagnostic count is not necessarily the number of skipped artifacts. These root/artifact diagnostics do not equally cover all Codex/Claude failure paths. / DeepSeek 可在有问题工件产生诊断时继续提供有效会话。根据错误码与采样消息／路径采取操作；样本有上限，还应查看计数及 `truncatedCount`。诊断条数不一定等于跳过工件数。这些根／工件诊断不同等覆盖所有 Codex／Claude 失败路径。

| Diagnostic / 诊断 | Action / 操作 |
| --- | --- |
| `SOURCE_ROOT_NOT_FOUND`, `SOURCE_ROOT_NOT_DIRECTORY`, `SOURCE_ROOT_UNREADABLE` | Correct the sessions root and access permissions, then rediscover/select the project. / 修正 sessions 根及读取权限，再重新发现／选择项目。 |
| `SOURCE_ARTIFACT_UNREADABLE` | Inspect the sampled artifact's existence and permissions; keep readable sessions and report the gap. / 检查采样工件是否存在及读取权限，保留可读会话并报告缺口。 |
| `DEEPSEEK_ZSTD_UNAVAILABLE` | Restart with a Node runtime providing built-in Zstandard support; see below. / 使用具备内置 Zstandard 支持的 Node 重启，见下文。 |
| `DEEPSEEK_FORMAT_VERSION_UNSUPPORTED` | Preserve the artifact and check whether a newer Analyzer supports its format; do not rewrite its version header. / 保留工件，检查新版 Analyzer 是否支持其格式，不要改写版本头。 |
| `DEEPSEEK_STORAGE_INVALID` | Inspect the message and obtain a valid original/export; report corruption without modifying the transcript. / 查看消息并获取有效原件／导出；报告损坏，不修改转录。 |
| `DEEPSEEK_SOURCE_BUSY` | Let the writer finish or use a consistent copied snapshot, then retry. / 等待写入完成或使用一致的复制快照，再重试。 |

## DeepSeek compressed history / DeepSeek 压缩历史

`session.jsonl.zstd` requires Node's built-in `node:zlib` Zstandard API. It is available in Node 22 from 22.15.0, but actual capability is checked; use Node.js 24 as the recommended installed runtime. Uncompressed `session.jsonl` remains readable when that API is unavailable. Check the actual server's Node executable/version, then restart after changing runtimes. / `session.jsonl.zstd` 需要 Node 内置 `node:zlib` Zstandard API。Node 22 从 22.15.0 起提供该能力，但以实际能力检测为准；安装后运行推荐 Node.js 24。缺少该 API 时仍可读取未压缩的 `session.jsonl`。检查实际服务使用的 Node 可执行文件／版本，更换运行时后重启。

## Search gaps and long sessions / 搜索缺口与长会话

Search starts within the current session. Click the visible `session` scope pill to open Search options, then select Entire project to find another session; check the Layer, Touched file, Kind, and Status filters if expected hits are absent. Search input is a plain-text phrase, so `status:failed` searches that literal text; use the Status filter for filtering. Claude external `tool-results/*` payloads are not loaded or searched; source references remain available in Protocol/Raw views. / 搜索默认限当前会话。点击可见的 `session` 范围按钮打开 Search options，再选择 Entire project 查找其他会话；预期命中缺失时检查 Layer、Touched file、Kind 与 Status 筛选。搜索输入是纯文本短语，`status:failed` 会搜索该原文；筛选状态应使用 Status 控件。Claude 外部 `tool-results/*` 载荷不会加载或搜索，来源引用仍可在 Protocol／Raw 视图查看。

Trajectory shows currently loaded Main events. Use Load more to continue a long session; Protocol and Raw use Timeline. A large session's first opening can take longer than later openings. For measured environments, timing, memory ownership, and limitations, see the [Indexed/Materialized lifecycle](../design-docs/indexed-materialized-session-lifecycle.md) and [timeline performance design](../design-docs/timeline-loading-and-rendering-performance.md). / Trajectory 只显示当前已加载的主层事件，长会话可用 Load more 继续；Protocol 与 Raw 使用 Timeline。大型会话首次打开可能比后续更慢。量测环境、耗时、内存归属与局限见[索引／物化生命周期](../design-docs/indexed-materialized-session-lifecycle.md)及[时间线性能设计](../design-docs/timeline-loading-and-rendering-performance.md)。

## Large histories, logs, and heap recovery / 大历史、日志与堆内存恢复

Memory depends on matching transcript bytes, record/event shapes and counts, and unusually large individual sessions, rather than the source-code repository's size. The CLI's `[SESSION_ANALYZER_LARGE_TRANSCRIPT_HISTORY]` warning is informational and indexing continues normally. Attempt normal indexing first; do not change the heap if it succeeds. Claude's warning measures selected primary transcript bytes; derived subagent data can add workload and large-scale Claude capacity has not been calibrated. / 内存取决于匹配转录的字节数、记录／事件形态与数量、异常大的单个会话，而非源码仓库大小。CLI 的 `[SESSION_ANALYZER_LARGE_TRANSCRIPT_HISTORY]` 警告仅供提示，索引仍正常继续。先尝试正常索引，成功时不要调整 heap。Claude 警告按所选主转录字节量计算，派生 subagent 数据可能增加负载，尚未标定大规模 Claude 容量。

Use `--log-dir <path>` to collect aggregate indexing diagnostics. Logs contain bounded, throttled JSONL lifecycle records for counts, bytes, timing, heap limits, memory, and the warning signal; at most 20 indexing logs are retained. They omit repository/transcript paths, transcript text, prompts, commands, and source content. This exclusion applies to aggregate log records, not necessarily terminal stderr or source-diagnostic samples; review those before sharing. Fatal V8 OOM stderr is the authoritative crash evidence because termination may prevent a final log record. / 用 `--log-dir <path>` 收集聚合索引诊断。日志是有界且节流的 JSONL 生命周期记录，包含数量、字节量、耗时、堆上限、内存与警告信号；最多保留 20 份索引日志。不含仓库／转录路径、转录文本、提示词、命令或源码内容。此排除范围仅指聚合日志，不一定适用于终端 stderr 或来源诊断样本；分享前应检查这些内容。V8 致命 OOM 的 stderr 是权威崩溃证据，因为终止可能阻止写入最终日志。

Only after a V8 heap-exhaustion failure such as `JavaScript heap out of memory`, retry with a moderately larger temporary heap. This is a recovery workaround, not a product default. Preserve and restore existing `NODE_OPTIONS`; if it already contains a heap-size override, replace that flag temporarily instead of adding a second one. / 仅在发生 `JavaScript heap out of memory` 等 V8 heap 耗尽后，才用适度增大的临时 heap 重试。这是恢复措施，不是产品默认值。保存并恢复原 `NODE_OPTIONS`；如果其中已有 heap 大小参数，应临时替换该参数，而非重复添加。

Before running the PowerShell example, copy the failed invocation's executable and complete argument list into `$analyzerProgram` and `$analyzerArguments`. The sample values illustrate a DeepSeek source checkout: replace them with the actual executable, checkout or pinned installed version, source, repository, and source root used in the failed run. Keep any other original flags, and add `--log-dir` if needed. / 执行 PowerShell 示例前，将失败命令的可执行文件及完整参数列表填入 `$analyzerProgram` 与 `$analyzerArguments`。示例值演示 DeepSeek 源码 checkout；应替换为失败运行实际使用的可执行文件、checkout 或固定安装版本、来源、仓库与来源根。保留其他原始参数，需要时添加 `--log-dir`。

```powershell
$analyzerProgram = 'C:\Program Files\nodejs\node.exe'
$analyzerArguments = @(
    'C:\tools\session-analyzer\server.js',
    '--source', 'deepseek-harness',
    '--repo', 'C:\projects\target-project',
    '--dsh-home', 'C:\transcripts\sessions',
    '--log-dir', 'C:\logs\session-analyzer'
)
$previousNodeOptions = $env:NODE_OPTIONS
try {
    $env:NODE_OPTIONS = (($previousNodeOptions + ' --max-old-space-size=4096').Trim())
    & $analyzerProgram @analyzerArguments
} finally {
    if ($null -eq $previousNodeOptions) {
        Remove-Item 'Env:NODE_OPTIONS' -ErrorAction SilentlyContinue
    } else {
        $env:NODE_OPTIONS = $previousNodeOptions
    }
}
```

On POSIX shells, with no existing heap-size flag, scope the override to the original command. This also illustrates a DeepSeek checkout; substitute the complete failed invocation, including its executable/version, source and roots, before running: / POSIX shell 中，确认没有既有 heap 大小参数后，将覆盖限定在原命令。下例同样演示 DeepSeek checkout；执行前替换成完整失败命令，包括其可执行文件／版本、来源与各路径：

```sh
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=4096" \
  /path/to/node /path/to/analyzer-checkout/server.js \
  --source deepseek-harness --repo /path/to/target-project \
  --dsh-home /path/to/sessions --log-dir /path/to/session-analyzer-logs
```

Retest indexing and actual reading after recovery. Retained caches have bounded working-set policies, but their weights are not V8 heap or RSS ceilings; see the lifecycle design above for quantitative evidence rather than treating a warning or successful sample as a capacity guarantee. / 恢复后重新核验索引与实际阅读。保留缓存使用有界工作集策略，但权重不是 V8 heap 或 RSS 上限；量化证据见上述生命周期设计，不能把警告或成功样本当作容量保证。
