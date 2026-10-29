# OpenCode compatibility maintenance / OpenCode 兼容维护

## Contract and ownership / 契约与职责

This maintenance tool feeds the common [schema update runbook](schema-update-runbook.md). It does not change adapter admission, install OpenCode during ordinary PR tests, or automatically accept a candidate. The supported native profile remains **2.1.4**, commit **68bc26b7da1990ce10ffecfbc1e09eb13aa5d824**; see [native reader design](opencode-native-sessions.md). / 本维护工具向共用 schema 更新手册提供依据，不改变 adapter 准入、不在普通 PR 测试中安装 OpenCode、不自动接纳候选。原生支持 profile 仍为所列 **2.1.4** 与固定提交，详见原生阅读器设计。

The executable reports its version; source evidence is read from the matching `vX.Y.Z` Git tag's commit, never from uncommitted checkout files. The accepted 2.1.4 tag must still resolve to the recorded SHA. Reports record the executable hash and source hashes separately: matching version labels are not reproducible-build authentication. / 可执行程序报告版本；源码依据来自对应 Git tag 的提交，不读取 checkout 中未提交的修改。已接纳 2.1.4 tag 必须仍指向记录的 SHA。报告分别记录二进制与源码摘要，版本标签一致不等于可复现构建认证。

## Evidence matrix / 证据矩阵

Local producer evidence collected on 2026-10-28 / 2026-10-28 本地 producer 实测：

| Version / 版本 | Source commit / 源码提交 | Observed result / 实测结果 | Support / 支持 |
| --- | --- | --- | --- |
| 2.1.4 | `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824` | Ten named checks passed; independent repeat produced equal source/schema/shape fingerprints / 十项具名检查通过，独立复跑源码／schema／形态摘要一致 | Existing accepted native profile / 既有已接纳原生 profile |
| 2.2.0 | `1097e2668b1e08ad63bdf0b1c4860b9bc01e420c` | Session creation and shell writer worked; adapter capture rejected with `OPENCODE_SCHEMA_UNSUPPORTED`; subsequent checks unrun. Real DB adds `blob` and `blob_ref` tables / 会话创建与 shell writer 可用，adapter 捕获拒绝，后续未运行；实际库新增两个 blob 表 | Candidate requires storage adaptation review; not accepted / 候选需要存储适配评审，未接纳 |

These are local executions, not a claim that the new manual GitHub workflow has already run. The candidate's incomplete message-shape inventory is reported as uncomparable (`null`), not as evidence that unrun message families changed. / 这些是本地执行，不声称新手动 GitHub workflow 已运行。候选不完整的消息形态集合标记为不可比较（null），不能据此推断未运行消息族发生变化。

| Area / 范围 | Evidence / 依据 | Boundary / 边界 |
| --- | --- | --- |
| Storage layout / 存储布局 | Real producer-created SQLite columns, keys and indexes; fixed SQL/projector/migration source hashes / 实际建库的列、键、索引及固定 SQL／projector／迁移源码摘要 | Fresh database only; no user DB migration / 仅新建库，不迁移用户库 |
| Create, rename, metadata, delete / 创建、改名、metadata、删除 | Real HTTP handlers → producer → SQL → adapter snapshots / 真实 handler 写入，再由 SQL 与 adapter 快照核验 | Synthetic isolated project / 隔离合成项目 |
| Shell running → exited / shell 从运行到结束 | Real shell writer, fixed message ID, nonzero exit, ordered API/SQL equality / 真实 shell writer、固定消息 ID、非零退出及有序 API／SQL 比较 | No assistant/model execution / 不执行 assistant／模型 |
| Export filtering / export 过滤 | Running shell absent from export but present in SQL and captured Raw; completed export equals SQL / 运行中 shell 在 export 缺失、SQL 与 Raw 保留，完成后 export 与 SQL 相符 | Does not prove every interrupted assistant shape / 不证明所有中断 assistant 形态 |
| Message mapping / 消息映射 | Imported hand-authored user/assistant messages; actual importer persistence, Logical/Detail/Raw/search checks / 导入手写 user／assistant，核验真实 importer 落盘、呈现与搜索 | Import evidence is not a model-writer capture / 导入依据不等于模型 writer 采集 |
| Parent and fork / 父子与 fork | Real child creation and fork; SQL relationship and adapter evidence / 真实创建子会话及 fork，核验 SQL 关系与 adapter 依据 | Does not cover every inherited-context variant / 不覆盖所有继承上下文变体 |
| Snapshot preservation / 快照保留 | Same-ID completion and deletion keep an already captured revision readable / 同 ID 完成与删除后，已捕获版本仍可读 | Full budget/WAL/permission matrix stays in offline tests / 完整预算／WAL／权限矩阵仍由离线测试覆盖 |
| Other semantics / 其他语义 | [Existing fixture provenance](../../test/fixtures/opencode/README.md) and offline suites / 既有 fixture 来源与离线套件 | Model tools, retry, interruption and compaction producer probes remain gaps / 模型工具、重试、中断与 compaction producer 探针仍有缺口 |

## Running the probe / 运行探针

First use the repository's [supported development toolchain](../development.md). The producer probe currently runs on Linux only; this restriction does not narrow the product's separately tested platform matrix. / 首先使用仓库支持的开发工具链。Producer 探针当前仅在 Linux 执行，此限制不缩小产品独立测试的平台矩阵。

Install an exact producer into a disposable directory outside this checkout. The Linux x64 baseline package contains the executable directly, so installation scripts are unnecessary. Fetch the exact release tag into a separate source repository. / 将精确 producer 安装到 checkout 之外的临时目录；Linux x64 baseline 包直接含有可执行程序，无需安装脚本。将精确发布 tag 拉取到独立源码仓库。

```sh
npm install --prefix /tmp/oc-producer-2.1.4 --ignore-scripts --no-audit --no-fund --package-lock=false --registry=https://registry.npmjs.org/ @opencode/cli-linux-x64-baseline@2.1.4
git init /tmp/oc-source-2.1.4
git -C /tmp/oc-source-2.1.4 fetch --depth=1 https://github.com/anomalyco/opencode.git refs/tags/v2.1.4:refs/tags/v2.1.4
node scripts/opencode-compatibility.js --version 2.1.4 \
  --binary /tmp/oc-producer-2.1.4/node_modules/@opencode/cli-linux-x64-baseline/bin/opencode \
  --source-checkout /tmp/oc-source-2.1.4 --output /tmp/oc-baseline-report
```

Run the npm installation command from outside the checkout. Paths above are examples; each report directory must be new and its parent must exist. The probe never accepts a user database path. / npm 安装命令从 checkout 之外执行。上述路径仅为示例；每个报告目录必须是新目录且父目录已存在。探针不接受用户数据库路径。

For a candidate, install its exact version and fetch its corresponding tag, then supply `--baseline-report /tmp/oc-baseline-report/report.json`. Baseline and candidate must use the same Analyzer commit, actual runtime digest (`src/` plus package manifests), Node version, platform and exact probe digest. Repeating 2.1.4 with this option is a useful comparison self-check. The ordinary offline tests also inject changed source hashes, SQL layouts, message shapes, missing rows, bad cursors and incomplete evidence. / 候选版本需精确安装并拉取对应 tag，再提供 baseline-report 参数。两次运行须使用相同 Analyzer 提交、实际运行代码摘要（src/ 与包清单）、Node 版本、平台及精确探针摘要；以相同参数复跑 2.1.4 可自检比较稳定性。普通离线测试另注入源码、SQL、消息形态变化、缺行、异常游标与不完整依据。

## Reports and failures / 报告与失败

Each run writes only `report.json` and `report.md` to the chosen output directory. Reports include producer version/source commit/binary hash, Analyzer commit/worktree state/runtime digest, Node version/platform, probe digest, selected source and full migration-tree digests, database schema, value-free message shapes, ten named checks and explicit gaps. They contain no raw message payloads, database copies, producer logs, server passwords or API credentials. / 每轮仅在所选目录写入 JSON 与 Markdown 报告，包含 producer 版本／源码提交／二进制摘要、Analyzer 提交／工作区状态／运行代码摘要、Node 版本／平台、探针摘要、选定源码与完整迁移树摘要、数据库结构、无字段值的消息形态、十项具名检查及明确缺口。不保存原始消息正文、数据库副本、producer 日志、服务密码或 API 凭据。

| Exit / 退出码 | Outcome / 结果 | Action / 处理 |
| --- | --- | --- |
| 0 | `passed` | Bounded checks passed; support decision remains unchanged / 有界检查通过，支持决策不变 |
| 2 | `review-required` | Behavior check failed or source/schema/shape drift observed; apply runbook decision tiers / 行为检查失败或发现源码／schema／形态变化，按手册分层评审 |
| 1 | `probe-failed` | Startup/provenance/baseline/cleanup problem; repair evidence collection before drawing compatibility conclusions / 启动／来源／基线／清理问题，先修复采集再判断兼容性 |

Checks after a failure are `not-run`, never silently passed. A source hash difference may be comments only; reviewers inspect the actual pinned diff before choosing `docs-only`, `fixture TODO / coverage update`, or a behavior-change proposal. A green candidate probe alone cannot accept unsupported message families or a new storage profile. / 失败后的检查标记为未运行，不视为通过。源码摘要差异可能仅来自注释；评审须阅读固定版本差异再选择三类决策。候选探针通过本身不能接纳未覆盖的消息族或新存储 profile。

The process uses fresh XDG/config/data directories and a private local server password. Provider keys and inherited config/launch hooks are excluded; managed HTTP proxy and CA trust settings are retained. Model downloads/free providers/automatic updates are disabled. Hosts with `/etc/opencode` are rejected because the CLI can load system plugins. The shell is bounded and released on ordinary failures; the producer is stopped before snapshots and temporary data are removed. Abrupt machine termination may leave temp files; reports never advertise cleanup success before it completes. / 进程使用新建 XDG／配置／数据目录及私有本地服务密码；不继承 provider key、配置覆盖及启动 hook，保留托管 HTTP proxy 与 CA 信任。关闭模型目录下载、免费 provider 与自动更新；存在系统配置目录的主机会被拒绝。Shell 有时限且普通失败时释放；先停 producer，再清理快照与临时数据。机器异常终止仍可能留下临时文件，报告只有在清理完成后才声明成功。

## CI boundary / CI 边界

`.github/workflows/opencode-compatibility.yml` is **workflow_dispatch only**. It runs baseline 2.1.4 first, then an optional exact stable candidate, and uploads only the four explicitly named report files for 14 days. It neither reads repository secrets nor calls a model. No cron is enabled in this increment. GitHub exposes dispatch after the workflow exists on the repository's default branch; the CLI is usable before that. / 独立 workflow 仅支持手动触发，先跑 2.1.4 基线，再跑可选的精确稳定候选，且仅上传四个明确报告文件、保留 14 天。不读取仓库 secrets、不调用模型；本轮不启用定时任务。Workflow 进入默认分支后 GitHub 才提供 dispatch；CLI 可提前使用。

Ordinary CI only executes `test/opencode-compatibility.test.js` with local synthetic inputs; it does not install the producer or access a model/network service for these tests. / 普通 CI 仅用本地合成输入执行维护工具测试，不因此安装 producer 或访问模型／网络服务。
