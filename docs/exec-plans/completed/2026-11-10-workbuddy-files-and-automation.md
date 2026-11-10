# WorkBuddy file references and scheduled input / WorkBuddy 文件引用与定时输入

Base: `094adca`; retain the existing uncommitted real-case checklist. / 基线如上，保留既有未提交案例清单。

## Evidence and scope / 依据与范围

Two new desktop inputs persist uploaded files as quoted path mentions corroborated by `attached_files` context, with/without human text. A real scheduled run persists ordinary user-role JSONL without a schedule discriminator; the desktop SQLite `sessions` and `automation_runs` tables independently identify its origin. Installed WorkBuddy 5.9.4 writer source corroborates attachment context, background-session tags and run metadata. / 两条新桌面输入将上传文件保存为带引号路径引用及 attached_files 上下文，分别带／不带人工文字。实际定时运行的 JSONL 只有普通 user 角色，没有定时判别标记；桌面 SQLite 的 sessions 与 automation_runs 表独立记录来源。已安装 WorkBuddy 5.9.4 writer 源码佐证附件上下文、后台会话标签及运行 metadata。

Implement conservative path-reference presentation without loading files. Capture bounded, optional, read-only SQLite origin facts into copied-value dependencies; use exact session/project/automation/run agreement to place the initial scheduled input in Protocol, preserving later user input. Retain exact JSONL Raw and copied provenance inspection. Missing/unsupported database evidence cannot trigger text-based identity inference. / 实现保守路径引用展示，不加载文件；将可选、只读、有界 SQLite 来源事实采入 copied-value 依赖，凭精确会话／项目／自动化／运行对应将首次定时输入置于 Protocol，保留后续用户输入。保留精确 JSONL Raw 和已复制来源检查；缺失／未支持数据库依据不得触发按正文推断身份。

## Validation / 验证

Use minimized synthetic positive/negative file and SQLite fixtures, including ambiguity, mismatch, absent/invalid source, copied-value replay and literal text. Verify real Detail/search/Raw/counts, browser reading and unchanged source bytes; independent fresh review before commit. No real transcript, database or attachment enters repository history. / 使用最小化合成文件与 SQLite 正反 fixture，覆盖歧义、不匹配、缺失／异常来源、复制值重放及字面文字；核验真实详情／搜索／Raw／计数、浏览器阅读及源字节不变；提交前独立 fresh 审查。真实转录、数据库与附件均不进入仓库历史。

## Results / 结果

- Node 24.22.2: initial related adapter, canonical/ownership, history-service and Detail regression passed 217 tests. After review corrections, all 56 focused WorkBuddy tests passed; four desktop/mobile browser tests passed. Build, generated-asset freshness and local documentation link checks passed. Full repository suite and CI were not run. / 所列 Node 版本下，初轮适配器、canonical／ownership、history-service 与详情相关回归 217 项通过；审查修正后全部 56 项 WorkBuddy 聚焦测试及四项桌面／移动浏览器测试通过。构建、生成资产一致性与本地文档链接检查通过，未运行全仓库套件及 CI。
- Real readback verified both path-reference inputs and the actual scheduled run, plus the human scheduling request as a negative control. Each file input remains one user message; the automatic run has zero user messages/turns, while the human scheduling request retains one of each. Search, Detail and exact JSONL Raw passed. The final capture compared database, WAL/SHM side-file bytes and membership plus selected transcript bytes: unchanged. Local scripts/reports are under `/tmp`. / 真实回读核验两条路径引用输入、实际定时运行，并以人工创建请求作反例。每条文件输入仍是一条用户消息；自动运行的用户消息／回合均为零，人工创建请求各保留一个。搜索、详情与精确 JSONL Raw 通过。最终采集比较数据库、WAL／SHM 旁文件字节与目录成员及选定转录字节，均未变；本地脚本／报告位于 /tmp。
- Preview restarted at `http://127.0.0.1:17892`. The evolving corpus grew from 12 to 14 sessions; final indexing succeeded with zero diagnostics. A real browser searched/read both file inputs in Main and the scheduled input in Protocol, inspected copied provenance and opened Raw without page errors. / 预览在所列地址重启；演进语料从 12 增至 14 个会话，最终索引成功、零诊断。真实浏览器搜索／阅读两条主层文件输入及协议层定时输入，检查已复制来源并打开 Raw，无页面错误。

## Independent review and completion / 独立审查与完成

Fresh reviewer `/root/review_files_automation` reviewed base `094adcace4a549c556d8fba8163ea03a9f9ebd5a`. Initial findings were SQLite read-only side-file creation and process-cwd-dependent relative path markers. Corrections moved all SQLite access onto a private stable DB+WAL copy and required absolute query markers, with regressions for closed/live WAL preservation and relative markers. Re-review found no further actionable issue, independently passed 56 tests and diff checks, and additionally exercised active-journal rejection and temporary-copy cleanup on cancellation/corruption. / fresh 审查者按所列基线发现 SQLite 只读仍创建旁文件及相对路径标记依赖进程 cwd 两项问题。修正为 SQLite 仅访问私有稳定 DB＋WAL 副本，查询标记必须绝对路径，并加入关闭／活动 WAL 保留及相对标记回归。复审无其他可操作问题，独立通过 56 项测试与差异检查，另行执行活动 journal 拒绝及取消／损坏时临时副本清理检查。

Reviewed final diff SHA-256: `32ce7b6f3f01aa0f90a6b91c81a890e536f732a7c4314352d5629d13760ebf59` (64,860 bytes): HEAD binary diff excluding generated assets, followed by sorted no-index binary patches for this then-active plan and the new origin reader/test. Subsequent plan-only changes record results and archive completion; implementation is unchanged. Reviewer did not independently execute browser/real readback or CI. / 最终已审查 diff 的 SHA-256 与字节数如上：排除生成资产的 HEAD binary diff，再拼接按路径排序的当时 active 计划与新增来源 reader／test 的 no-index binary 补丁。后续仅补记结果并归档，实现未变。审查者未独立执行浏览器／真实回读或 CI。

Implementation and scoped acceptance are complete. The file-only, file-plus-text and actual scheduled-trigger requests are closed; only successful native teammate delivery remains deferred pending tool availability. / 实现与限定范围验收完成；仅文件、文件加文字及实际定时触发三项需求关闭，仅成功原生队友投递待工具可用后再补。
