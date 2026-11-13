# Codex oversized-record crash / Codex 超大记录崩溃

## Status and baseline / 状态与基线

Root cause reproduced on 2026-11-13 at `9e352ad1f0ed79785ad3980818d73d9e4fc5d086`, Node `24.22.2`, Linux. Investigation and remediation plan only; no runtime fix has been implemented. / 2026-11-13 在所列提交、Node 24.22.2 和 Linux 环境复现根因；本文件记录调查及修复方案，尚未实现运行时修复。

Related work: [optional Qoder titles](2026-11-13-qoder-desktop-titles.md). The crash occurs in existing Codex discovery, independently of Qoder title metadata or SQLite reads. / 相关工作为所链 Qoder 可选标题方案；本次崩溃发生在既有 Codex 项目发现路径，与 Qoder 标题元数据或 SQLite 读取无关。

## Reproduced cause / 已复现原因

The user switched to Codex and saw the project list before its statistics finished. The browser's `refreshProjectList()` first requests `/api/projects?summary=1`, then `/api/projects`. The first response uses configured/cached projects; the second calls `discoverProjects()` and `inspectSessionFile()` for the source's rollouts, before a project is selected. / 用户切换到 Codex 后已看到项目列表，但统计尚未完成。浏览器 refreshProjectList 先请求 summary，再请求完整项目列表；前者使用已配置／缓存项目，后者在选择项目之前就通过所列函数逐一检查来源下的 rollout。

The selected Linux Codex home contains an older plain JSONL transcript of 1,526,600,716 bytes and 3,218 physical lines. Its newline-terminated line 16 alone contains 1,516,023,436 bytes; the inspected prefix identifies a `response_item` / `function_call_output`. Streaming UTF-8 decoding measured 1,516,020,958 UTF-16 code units for that line. The active Node runtime's `buffer.constants.MAX_STRING_LENGTH` is 536,870,888. No private payload or identifying path is retained in this document. / 选定 Linux Codex home 中的一份旧普通 JSONL 转录共有 1,526,600,716 字节、3,218 个物理行；有换行终止的第 16 行单独占 1,516,023,436 字节，所查前缀为 response_item／function_call_output。流式 UTF-8 解码测得该行含 1,516,020,958 个 UTF-16 码元，当前 Node 的字符串长度上限为 536,870,888。本文件不保留私人正文或可识别路径。

`inspectSessionFile()` passes the full input to `readline.createInterface()`, with no per-record bound. `readline` concatenates fragments until a line ending; its internal `data` callback throws `RangeError: Invalid string length` at `node:internal/readline/interface:652`. This synchronous event-callback throw escapes the surrounding async iterator/request catch and terminates the server. / inspectSessionFile 将完整输入交给 readline，未限制单条记录长度；readline 在遇到换行前持续拼接片段，其内部 data 回调在所列位置抛出字符串长度异常。这种同步事件回调异常绕过外层异步迭代／请求 catch，导致整个服务退出。

An isolated invocation of the unchanged public `discoverProjects({ codexHome })` against the same source reproduced the identical uncaught stack and process exit 1 in 1.99 seconds, with maximum RSS 746,900 KiB. A caller-level Promise catch did not receive it. Repeated source switching is not necessary to reproduce this incident. Increasing the JS heap would not change the string-length ceiling. This evidence does not establish the absence of separate memory or cancellation issues. / 在隔离进程对同一来源调用未修改的公开 discoverProjects，1.99 秒内复现相同未捕获堆栈并以状态 1 退出，峰值 RSS 746,900 KiB；调用方 Promise catch 未接到该异常。本次问题无需反复切换即可触发，增大 JS 堆也不会改变字符串长度上限；该证据不代表已排除其他内存或取消问题。

## Affected boundaries / 受影响边界

- `src/codex.js`: discovery inspection, full parsing, relationship projection and source-backed Raw verification use `readline`. Fixing only the project chooser could leave another crash on project indexing or materialization. / 项目发现检查、完整解析、关系投影及源文件 Raw 核验使用 readline；只修项目选择器，仍可能在索引或物化时崩溃。
- `src/codex-rollout-storage.js`: `readLogicalLine()` grows its own string without a record bound. Plain and Zstandard inputs need the same decoded-record policy; a small compressed file can contain a huge logical line. / readLogicalLine 自行增长字符串且无单条上限。普通与 Zstandard 输入需要一致的解码后记录策略，小型压缩文件也可能包含超大逻辑行。
- `server.js`: project discovery checks source revision after scanning but does not currently pass request/source cancellation into its adapter context. This is a separate static finding that can leave obsolete scans running; it is not required to explain the reproduced crash. / 项目发现目前在扫描结束后检查来源 revision，未将请求／来源取消传入 adapter 上下文；这是可能导致过期扫描继续运行的独立静态发现，并非解释已复现崩溃所必需。

## Remediation plan / 修复方案

1. Introduce bounded decoded-line reading in the Codex storage boundary. Check byte length before converting/concatenating a whole record, use async iteration/backpressure, destroy streams in all exit paths, and propagate a typed capacity error through normal Promise rejection. Select and document a practical per-record budget after checking existing large-record fixtures; do not use Node's maximum string size as the working budget. / 在 Codex 存储边界引入有界解码行读取；在完整记录解码／拼接前检查字节长度，使用异步迭代／背压，所有退出路径销毁流，并通过正常 Promise rejection 传播有类型的容量错误。核对既有大记录 fixture 后选定并记录实际单条预算，不把 Node 字符串上限当作工作预算。
2. Route all affected Codex entry points through the same bound. Preserve logical line numbers, UTF-8 and line-ending behavior, accepted-prefix hashes, truncation detection, history boundaries and compressed-frame validation. Do not silently truncate JSON, fabricate Raw content, or continue a partially parsed Session as if it were complete. / 全部受影响 Codex 入口使用同一限制；保持逻辑行号、UTF-8／换行行为、已接纳前缀 hash、截断检测、历史边界及压缩帧验证。不静默截断 JSON、伪造 Raw 或把部分解析的会话当作完整结果继续使用。
3. During project discovery, diagnose and exclude an unreadable oversized artifact while continuing independent artifacts. During index construction, avoid committing partial Sessions/query shards; preserve normal healthy-source behavior. For explicitly requested unreadable content, return a structured capacity error. Report incomplete counts through existing source diagnostics rather than claiming complete coverage. / 项目发现中诊断并排除不可读超大工件，继续其他独立工件；索引中不得提交部分会话／查询 shard，正常来源行为保持不变。对显式请求的不可读内容返回结构化容量错误；通过既有来源诊断说明计数覆盖不全，不声称完整覆盖。
4. Separately connect project-discovery cancellation to request disconnect and source revision retirement, with cleanup and stale-result protection. Preserve other adapters' contracts; test this change independently from oversized-record handling. / 单独把项目发现取消连接到请求断开及来源 revision 退休，处理清理及过期结果；保持其他 adapter 契约，并独立于超大记录处理测试该改动。
5. Update the relevant product capacity/diagnostic contract and Codex storage design documentation in both languages. Keep the unrelated Qoder title implementation separate. / 同步更新双语产品容量／诊断契约及 Codex 存储设计文档，将无关的 Qoder 标题实现保持独立。

## Validation and completion / 验证与完成

- Use minimized synthetic inputs with a small injectable test budget: exactly-at-limit and over-limit lines, multiple chunks, multibyte UTF-8, CRLF, missing final newline, first versus later oversized records, malformed JSON, cancellation and underlying I/O errors. Exercise both plain and compressed artifacts and all shared consumers. / 使用可注入小预算的最小合成输入，覆盖等于／超出上限、多 chunk、多字节 UTF-8、CRLF、缺少末尾换行、首行／后续行超限、异常 JSON、取消及底层 I/O 错误；验证普通／压缩工件及全部共用入口。
- Include process-level HTTP regression coverage: a project summary followed by full statistics must produce diagnostics without killing the server; a subsequent health/healthy-source read must succeed. Do not allocate a 1.5 GB fixture in ordinary CI. / 包含进程级 HTTP 回归：项目概要之后的完整统计产生诊断但不杀死服务，随后健康检查／正常来源读取成功；普通 CI 不构造 1.5 GB fixture。
- Run focused Codex storage, snapshot/history, source-capacity, source-switch and onboarding tests, plus affected browser source-switch tests. Broaden to shared lifecycle tests if integration changes affect them. / 运行受影响 Codex 存储、快照／历史、来源容量、切换及 onboarding 测试，以及浏览器来源切换测试；若接线影响共享生命周期，则扩大到相关测试。
- Re-run bounded read-only discovery of the real problematic source; confirm an explicit oversized-record diagnostic, completion of other files and unchanged source data. Verify selecting a healthy project, cancellation during statistics and repeated source changes in the rebuilt local service. / 对真实问题来源重跑有界只读项目发现，确认明确超大记录诊断、其他文件完成及源数据不变；在重建本地服务中验证选择正常项目、统计中取消及反复来源切换。
- Obtain a fresh independent review of the exact changes before any commit. Record base/diff, executed local checks, unrun platform checks and final-SHA CI separately. Restart the user preview only with the tested build and report any remaining capacity limitations. / 提交前对精确改动进行 fresh 独立审查，分别记录基线／diff、本地实测、未运行平台检查及最终 SHA CI；以已测试构建重启用户预览，并报告剩余容量限制。

## Progress / 进度

- 2026-11-13: Original crash stack captured; physical line lengths and decoded character counts measured read-only; one-call process reproduction matched the original stack. Runtime changes, capacity regressions, browser acceptance and CI remain unperformed. / 已取得原崩溃堆栈，只读测量物理行长度及解码字符数，单次调用的进程复现与原堆栈一致；尚未执行运行时修改、容量回归、浏览器验收及 CI。
