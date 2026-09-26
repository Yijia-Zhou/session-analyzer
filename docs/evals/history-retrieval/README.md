# History retrieval evaluation / 历史检索评估

This document defines the synthetic task protocol and local measurement tools. The corpus is deliberately small enough to inspect and does not support production-scale performance or recall claims. The separate [real-history and efficiency report](2026-09-23-real-history.md) records the frozen real-history comparison, payload measurements and failed trials. / 本文定义合成任务协议与本地量测工具。语料有意保持可检查的小规模，不支持生产规模性能或召回率声明。独立的[真实历史与效率报告](2026-09-23-real-history.md)记录冻结真实历史对照、载荷量测及失败试验。

The [2026-09-23 pilot report](2026-09-23-pilot.md) records actual initial trials, failures, repairs and fresh post-repair checks, separately from the full matrix below. Use `node scripts/record-history-eval.js <trial-id> <history operation and flags>` to capture enhanced-condition calls outside the corpus. / [2026-09-23 试跑报告](2026-09-23-pilot.md)记录实际初始试验、失败、修正及全新修复后检查，与下文完整矩阵分开。可用 `node scripts/record-history-eval.js <trial-id> <history 操作与参数>` 在语料范围之外记录增强条件调用。

## Materials and isolation / 材料与隔离

- [tasks.json](tasks.json): 12 worker-facing tasks. Supply only the selected task, not all answers or developer analysis. / 12 个面向 worker 的任务。仅提供所选任务，不提供答案或开发分析。
- [answer-key.json](answer-key.json): coordinator/scorer-only evidence requirements, forbidden conclusions and unknowns. Event ordinals count source records after session metadata, not canonical IDs. / 仅供协调者／评分者使用的证据要求、错误结论及未知项。事件序号是 metadata 之后的来源记录序号，不是规范 ID。
- [Synthetic Codex source](../../../test/fixtures/history-retrieval-eval/codex/sessions/): seven fictional sessions with requirements, patches, failures, a later change, direct retrieval echoes, counterexamples, Unicode output and an unrelated project. / 七个虚构会话，包含要求、补丁、失败、后续变化、直接检索回声、反例、Unicode 输出和无关项目。
- [Packaged skill](../../../skills/history-retrieval/SKILL.md): the only additional procedural guide for the enhanced condition. / 随包 skill：增强条件唯一新增操作指南。

Copy the source into an isolated temporary directory outside live transcript roots. Create two empty temporary project directories. Rewrite only each metadata `cwd`: `/synthetic/history-eval/workspace` becomes the target project; `/synthetic/history-eval/other` becomes the unrelated project. Preserve every other record byte-for-byte where possible. Record the resulting corpus hash and exact source/target paths. Start the fixed Codex service using the copied home. Never index trial transcripts/reports or another worker's outputs. / 将来源复制到真实转录根之外的隔离临时目录，创建两个空临时项目目录。只改写 metadata 的 `cwd`：`/synthetic/history-eval/workspace` 替换为目标项目，`/synthetic/history-eval/other` 替换为无关项目。尽可能逐字节保留其余记录。记录最终语料 hash 及精确来源／目标路径，使用复制后的 Codex home 启动固定服务。不要索引试验转录／报告或其他 worker 输出。

Before trials, the coordinator verifies six target sessions and one excluded unrelated session, readable messages/tools, and reference resolution. Keep the original fixtures immutable. For T12 only, a coordinator mutates a separate per-trial copy on request; workers never change the corpus. Raw-source baselines receive the same snapshot and allowed parsing tools. / 试验前由协调者核验六个目标会话及一个排除的无关会话、消息／工具可读性和引用解析。原 fixture 保持不变。仅 T12 由协调者按请求修改独立的单次试验副本；worker 不改语料。原始来源对照组获得相同快照及允许的解析工具。

## Worker contract / Worker 契约

Prepare a fresh trial with `node scripts/prepare-history-eval.js <new-destination>` from the checkout (default: `tmp/history-eval`). The helper refuses an existing destination, creates both projects, rewrites only metadata directories, and prints/writes a manifest containing `repo`, `codexHome` and `corpusHash`. Then run `node server.js history serve --repo <manifest.repo> --source codex --codex-home <manifest.codexHome> --port 17891`. Keep reports beside the manifest, outside `codex/`. / 在 checkout 执行 `node scripts/prepare-history-eval.js <新目标目录>` 准备新试验（默认 `tmp/history-eval`）。助手脚本拒绝既有目标，创建两个项目，仅改写 metadata 目录，打印并写入包含 `repo`、`codexHome` 及 `corpusHash` 的 manifest。随后执行 `node server.js history serve --repo <manifest.repo> --source codex --codex-home <manifest.codexHome> --port 17891`。报告放在 manifest 旁、`codex/` 以外。

Start each worker without inherited development history, reference answers, known event IDs or another worker's results. Give it one task, allowed project/source paths, a read-only scope, a budget and the required result format. Enhanced workers receive service endpoint and skill; baseline workers receive raw source paths and normal search/parse tools. Either may inspect current project material when the task permits it. Do not require a particular search sequence or unnecessary reads. / 每个 worker 启动时不继承开发历史、参考答案、已知事件 ID 或其他 worker 结果。提供一个任务、允许的项目／来源路径、只读范围、预算及要求的结果格式。增强组获得服务 endpoint 和 skill；对照组获得原始来源路径及普通搜索／解析工具。任务允许时均可检查当前项目材料。不规定固定搜索顺序或不必要的读取。

Ask for: conclusion, supporting references/excerpts, explicit unknowns, unsuccessful searches, tool calls and errors. Coordinator records actual model/version, harness, condition, task/trial IDs, corpus hash, cold indexing time separately from warm task time, output bytes and available token counts. Unavailable metrics remain `null`, not estimates presented as measurements. Preserve failed and interrupted attempts. / 要求输出结论、支撑引用／摘录、明确未知项、未成功搜索、工具调用及错误。协调者记录实际模型／版本、harness、条件、任务／试验 ID、语料 hash、与暖任务耗时分开的冷索引耗时、输出字节及可用 token 数。不可获取指标保持 `null`，不把估算当量测。保留失败和中断尝试。

## Scoring and cadence / 评分与节奏

Score evidence recall, conclusion correctness, unsupported completion/merge claims, citation resolvability, later-reversal detection, and scope/instruction safety separately. Map baseline physical records and enhanced evidence refs to the same source evidence. Multiple valid evidence combinations are acceptable. Inspect important failures against source records; model agreement does not substitute for evidence. Classify failures as implementation, retrieval design, guide, model use, task/scoring, or environment. / 分别评分证据找回、结论正确性、无依据完成／合并声明、引用可解析性、后续推翻发现及范围／指令安全。将对照组物理记录及增强组证据引用映射到相同来源证据。允许多种有效证据组合。重要失败需对照来源核查，模型一致不能替代证据。失败归因为实现、检索设计、指南、模型使用、任务／评分或环境。

Run small clean-agent smoke trials after retrieval/guide changes. For MVP and major iterations, the target matrix is 12 tasks × 2 actual models × 2 independent trials per condition (48 trials per condition). Run both raw-source and enhanced conditions with matching budgets; optionally add an internal-API baseline as a separately labeled condition. Record any reduced matrix explicitly. T12 is principally deterministic lifecycle acceptance and must not be scored as a lexical recall question. / 检索／指南变化后运行小型干净 agent 冒烟。MVP 及大版本目标矩阵为每条件 12 任务 × 2 个实际模型 × 2 次独立试验（每条件 48 次）。原始来源和增强条件采用一致预算；可另加明确标记的内部 API 对照。缩减矩阵需明确记录。T12 主要是确定性生命周期验收，不能当成词法召回题评分。

An actual multi-model run requires explicitly recorded distinct model configurations. Same-model workers are independent repetitions only. Keep models/harness and the core task set fixed when comparing product versions; report model changes as separate variables. This small corpus exercises evidence discipline, not exhaustive cross-source adapter compatibility or realistic project-scale retrieval quality. / 实际多模型运行必须记录明确不同的模型配置；同模型 worker 仅算独立重复。比较产品版本时固定模型／harness 和核心任务集；模型变化作为独立变量报告。小语料检验的是证据使用规范，不是穷尽跨来源 adapter 兼容性或真实项目规模检索质量。

## Planned final-status regression group / 计划中的最终状态回归组

Keep these three cases fixed for the next independent cross-model guide evaluation. They are planned scenarios, not executed tests or demonstrated failures of the current implementation; they do not expand the completion claim of this increment or replace full-worktree merge acceptance. / 下一轮独立跨模型指南评估固定保留以下三个场景。它们是计划场景，不是已执行测试或当前实现已证实的失败；不扩大本轮增量的完成声明，也不替代完整 worktree 合并验收。

| Case / 场景 | Required behavior / 预期行为 |
| --- | --- |
| Earlier unmerged record, later reliable merge evidence / 早期未合并，后续有可靠合并证据 | Identify the state change and cite the later evidence. / 识别状态变化，引用后续证据。 |
| Earlier unmerged record, later unverified merge claim / 早期未合并，后续仅有未经核实的已合并陈述 | Retain the later lead and uncertainty; assert neither merged nor finally unmerged. / 保留后续线索与不确定性，既不断言已合并，也不回退为最终未合并。 |
| Later message quotes an older unmerged report / 较晚消息引用更早的未合并报告 | Distinguish message time from the described state's time; a newer quotation does not establish a newer state. / 区分消息时间与所述状态时间，较新引用不证明较新状态。 |

Use synthetic evidence with explicit dates and independent source support; keep answer keys separate from worker material. Assess conclusion support and chronology separately from citation resolution and payload size. Preserve failed trials and use the same enforced budgets across models; the full 96-trial matrix remains a later target. / 使用带明确日期和独立来源支撑的合成证据，答案键与 worker 材料分开。结论支撑和时序判断应与引用可解析性、载荷大小分别评估。保留失败试验，跨模型采用相同强制预算；完整 96 次矩阵仍为后续目标。

## Payload and frozen-corpus tooling / 载荷与冻结语料工具

`freeze-history-eval.js` prepares an explicitly selected local Codex snapshot. It only accepts uncompressed `.jsonl` files whose first nonblank record is `session_meta` with `cwd`; it preserves every byte and the original project directories. It does not discover history, rewrite paths, redact data, or enforce a time cutoff. Select eligible files before freezing; inspect and record any task-specific temporal boundary separately. / `freeze-history-eval.js` 准备显式选择的本地 Codex 快照。它仅接受首个非空记录为带 `cwd` 的 `session_meta` 的未压缩 `.jsonl` 文件，逐字节保留内容及原项目目录。它不发现历史、不改写路径、不脱敏，也不执行时间截断。冻结前选择合格文件，并另行检查、记录任务所需的时间边界。

```powershell
node scripts/freeze-history-eval.js --target tmp/frozen-case-a --repo 'C:/projects/example' --input 'C:/history/rollout-selected.jsonl'
```

Repeat `--input` for additional files. The destination must be new and below this checkout's ignored `tmp/`. The manifest contains `corpusHash`, `sourceRoot`/`codexHome`, original paths, per-file SHA-256 and byte counts; private paths and raw data therefore stay local. Duplicate basenames, directories, known trial-output roots, and non-session inputs are rejected. No other file beside the explicit inputs is copied. Start the service with the manifest's original `repo` and copied `codexHome`. Keep worker output outside `codex/`, and verify the selected corpus before trials; the helper does not detect a trial transcript disguised as a normal session or prevent later edits to the copy. / 多文件重复使用 `--input`。目标必须是本 checkout 被忽略的 `tmp/` 下的新目录。Manifest 包含 `corpusHash`、`sourceRoot`/`codexHome`、原始路径、逐文件 SHA-256 与字节数，因此私有路径和原始数据均留在本地。重复文件名、目录、已知试验输出根及非会话输入会被拒绝；只复制显式输入。使用 manifest 的原始 `repo` 和复制后的 `codexHome` 启动服务。Worker 输出放在 `codex/` 外，试验前核验所选语料；助手不能识别伪装成普通会话的试验转录，也不阻止之后修改副本。

The recorder supports any explicitly named condition (use `raw`, `structured`, `summary`, and `hybrid` for the comparison matrix), with one log per condition/trial. Use a fresh trial ID for a changed task, model, harness or manifest. The recorder rejects identity changes before running the command and serializes concurrent access with a lock. / 记录器支持显式命名的条件（对照矩阵使用 `raw`、`structured`、`summary`、`hybrid`），每个条件／试验单独写日志。任务、模型、harness 或 manifest 改变时使用新试验 ID。记录器在执行命令前拒绝身份变化，并通过锁防止并发写入。

Optional `--max-retrieval-calls N` (1–1,000,000) refuses further `retrieval` calls before execution under the trial lock; `setup` and `memory-build` do not consume this count. A refused attempt is logged with `executed:false` and an error. Optional `--max-output-bytes N` (256–33,554,432) forwards at most N combined bytes per command, reserving space for an OUTPUT_TRUNCATED stderr notice when needed, then taking stdout before child stderr. Valid UTF-8 characters remain whole; base64 retains the exact delivered bytes. Truncated JSON is not repaired. Pass the same budget flags on every call in a trial, including setup and later retrieval: supplied budgets become immutable trial identity. Omitting both flags retains the legacy identity and unbounded forwarding. These recorder caps do not control what a separate model harness later includes in its context. / 可选 `--max-retrieval-calls N`（1–1,000,000）在试验锁内、执行前拒绝超额的 `retrieval` 调用；`setup` 和 `memory-build` 不占用次数。拒绝尝试仍写入日志，带 `executed:false` 和错误。可选 `--max-output-bytes N`（256–33,554,432）每次命令最多转发 N 个合计字节，需要截断时先为 stderr 的 OUTPUT_TRUNCATED 提示预留空间，再依次取 stdout 和子进程 stderr。完整保留有效 UTF-8 字符；base64 保留精确转发字节，不修复被截断的 JSON。同一试验的每次调用（包括 setup 和之后的 retrieval）都应传入相同预算参数：已提供的预算成为不可变试验身份。两项均省略时保持旧身份和无限制转发。这些记录器上限不控制独立模型 harness 最终纳入上下文的内容。

```powershell
node scripts/record-history-eval.js trial-a --condition structured --corpus-manifest tmp/frozen-case-a/manifest.json --task T03 --model actual-model-id --harness actual-harness -- search --query 'cache' --endpoint http://127.0.0.1:17891
node scripts/record-history-eval.js trial-b --condition raw --corpus-manifest tmp/frozen-case-a/manifest.json --task T03 --model actual-model-id --harness actual-harness --exec -- rg -n -F 'cache' tmp/frozen-case-a/codex/sessions
```

Without `--exec`, the command after `--` is passed to the shipped `history` CLI. With `--exec`, it is an executable and argument list, run without a shell; on Windows use `node.exe` or `pwsh.exe -File <script>` when needed. Logs are `tmp/history-eval-results/<condition>/<trial>.jsonl`. Legacy `<trial> <history args>` remains accepted under condition `legacy`, with unknown metadata left null. `--phase setup|retrieval|memory-build` separates preparation and summary creation from retrieval; default is `retrieval`. Record summary generation/maintenance in `memory-build` and its actual model usage separately. / 不带 `--exec` 时，`--` 后的命令交给随包 `history` CLI；带 `--exec` 时，按可执行文件及参数列表执行，不经过 shell；Windows 必要时使用 `node.exe` 或 `pwsh.exe -File <script>`。日志位于 `tmp/history-eval-results/<condition>/<trial>.jsonl`。兼容旧 `<trial> <history 参数>`，条件为 `legacy`，未知元数据保持 null。`--phase setup|retrieval|memory-build` 将准备和摘要创建与检索分开，默认 `retrieval`；摘要生成／维护记录为 `memory-build`，实际模型 usage 另行提供。

Each call records exact executable/args/cwd, manifest identity, elapsed child-process time, exit/signal/error, stdout/stderr bytes and hashes, UTF-8 text and lossless base64. Nonzero exits are retained; timeout/spawn/buffer errors mark capture incomplete. The current command limits are 125 seconds and 32 MiB captured output; a killed recorder may leave a lock requiring manual inspection. A manifest hash identifies the declared snapshot, but the recorder does not rehash source files or enforce worker context isolation. / 每次调用记录精确可执行文件／参数／cwd、manifest 身份、子进程耗时、退出码／信号／错误、stdout/stderr 字节数及哈希、UTF-8 文本和无损 base64。保留非零退出；超时／启动／缓冲区错误标为捕获不完整。当前命令上限为 125 秒和 32 MiB 捕获输出；记录器被终止后可能留下需要人工检查的锁。Manifest 哈希标识声明的快照，但记录器不重新计算源文件哈希，也不强制隔离 worker 上下文。

Captured streams remain complete up to the child-process capture limit. `deliveredStdout*` and `deliveredStderr*` record the exact recorder-forwarded text, bytes, hash and base64; `outputTruncated` reports a smaller delivery. Recorder diagnostics after a failed child or refused call are included in delivered stderr, while the captured stderr fields remain child output only. / 捕获流在子进程捕获上限内保持完整。`deliveredStdout*` 与 `deliveredStderr*` 记录记录器实际转发的文本、字节数、哈希及 base64；`outputTruncated` 表示转发遭截断。子进程失败或调用被拒绝后的记录器诊断计入转发的 stderr，而捕获的 stderr 字段仅包含子进程输出。

```powershell
node scripts/aggregate-history-eval.js --report tmp/comparison-report.json tmp/history-eval-results/raw/trial-b.jsonl tmp/history-eval-results/structured/trial-a.jsonl
node scripts/aggregate-history-eval.js --tokenizer-module tmp/history-token-analysis/node_modules/js-tiktoken --encoding o200k_base --usage tmp/usage.json --report tmp/comparison-with-usage.json tmp/history-eval-results/raw/trial-b.jsonl
```

The tokenizer is optional, locally installed by the operator, and adds no project dependency. It must export `getEncoding(name)` (as `js-tiktoken` does). The report records its package/version, entry-module hash and encoding. Tokens count each captured UTF-8 stdout/stderr and JSON argument list separately, retaining repeats and failures; base64 preserves non-UTF-8 bytes but token counts describe decoded text. Without a tokenizer, token fields stay null. These payload counts are not actual model messages or billable usage, and cannot establish model-specific tokenization or dollar savings. Child-call elapsed totals exclude model deliberation and idle time. / Tokenizer 可选，由操作者在本地安装，不增加项目依赖；须导出 `getEncoding(name)`（如 `js-tiktoken`）。报告记录其包名／版本、入口模块哈希及编码。对逐次捕获的 UTF-8 stdout/stderr 和 JSON 参数列表分别计 token，保留重复和失败；base64 保留非 UTF-8 字节，但 token 统计描述解码文本。未提供 tokenizer 时 token 字段保持 null。这些载荷计数不是实际模型消息或计费用量，不能证明特定模型 tokenizer 或美元节省。子调用耗时总和不包含模型思考与空闲时间。

The report also counts recorder-delivered stdout/stderr bytes and reference tokens separately, and reports `executedCalls`, `refusedCalls` and `truncatedCalls` per trial and phase. For older logs without delivery fields, delivery is treated as equal to capture. These are recorder measurements, not provider or model usage; a harness may filter output further. / 报告另外单独统计记录器转发的 stdout/stderr 字节及参考 token，并按试验和阶段报告 `executedCalls`、`refusedCalls` 和 `truncatedCalls`。对没有转发字段的旧日志，按转发等于捕获处理。这些是记录器量测，不是 provider 或模型用量；harness 可能继续过滤输出。

Usage input is an explicit JSON array, keyed by condition/trial/corpus hash, for example: / Usage 输入为显式 JSON 数组，按条件／试验／语料哈希匹配，例如：

```json
[
  {
    "condition": "raw",
    "trial": "trial-b",
    "corpusHash": "<manifest corpusHash>",
    "source": "harness",
    "scope": "trial-total",
    "provenance": "operator-exported usage record",
    "inputTokens": 1200,
    "outputTokens": 250,
    "cachedInputTokens": null,
    "reasoningTokens": null,
    "totalTokens": null,
    "costUsd": null
  }
]
```

Use `source: provider|harness`; use either one `trial-total` record or nonoverlapping `phase` records with `phase: setup|retrieval|memory-build`. Duplicate or overlapping records and unmatched identities fail. Missing fields remain null; totals and cost are never inferred. Cached input and reasoning counts can be subsets of provider totals and are not added to them. Preserve usage provenance and its coverage limits; these records are operator-supplied, not fetched or independently audited. The report keeps phase costs separate without automatically amortizing memory creation; any repeated-query amortization must state the denominator and include maintenance cost. Explicit `--report` targets must be new ignored files below `tmp/`; stdout also contains the report and should remain local. / 使用 `source: provider|harness`；每次试验提供一个 `trial-total`，或互不重叠且带 `phase: setup|retrieval|memory-build` 的 `phase` 记录。重复、重叠和无法匹配身份的记录报错。缺失字段保持 null，绝不推算总量或费用。缓存输入与推理计数可能是 provider 总量的子集，不额外相加。保留 usage 来源及覆盖限制；记录由操作者提供，并非自动获取或独立审计。报告分别保留阶段费用，不自动摊销记忆生成；重复查询摊销须声明分母并计入维护费用。显式 `--report` 目标必须是 `tmp/` 下被忽略的新文件；stdout 也含报告，应留在本地。
