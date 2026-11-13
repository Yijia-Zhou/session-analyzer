# UNC project interpretation implementation / UNC 项目解释实施

Base: `v0.3.0-development@64f5b3ab351c3be6840396ddb1e8194ab102b4dc`, fetched again 2026-11-12. Branch: `fix/unc-project-path-context`. Independent worktree: `/tmp/session-analyzer-unc-implementation`. / 基线于所列日期重新 fetch；在独立 worktree 实施。

Local cross-platform acceptance was completed on 2026-11-13 for candidate `e09575700cf5191fbdc4fc613173650a9a54e2f7`, tree `491cf5303718fedf77452fba0f7c1cf99cc868b4`. WSL and Windows execution evidence and subsequent PR scope changes are recorded below. / 所列候选已于 2026-11-13 完成双平台本地验收；WSL／Windows 执行依据及后续 PR 范围调整见后文。

## Scope and accepted decisions / 范围与决策

Implement D1–D5 and the P/S/L/F/Q matrix in the user-provided decision, represented by the [versioned design](../../design-docs/project-path-interpretation.md). WSL is the production implementation owner; Windows performs independent native acceptance of the same candidate content. Communication is in `E:\tasks\tmp\codex_exchange`. All fixtures are synthetic; local candidate and pull-request work follow the user’s authorization. On 2026-11-13 the user authorized local candidate commits on the isolated branch, superseding the earlier no-commit restriction for that action. Windows native revalidation passed on `e095757`. / 实施用户决策 D1 至 D5 与验收矩阵，设计见链接。WSL 为主实施者，Windows 独立验收同一候选内容，在指定目录交接。使用合成 fixture，本地候选与 PR 工作按用户授权执行。用户于 2026-11-13 授权在隔离分支创建本地候选提交，就此动作解除此前不提交限制；Windows 原生复验已在 e095757 通过。

## Milestones / 里程碑

- [x] Record decisions and establish failing target assertions. Eight actual cross-source failures were observed before migration: UNC split, absent compatibility evidence, Claude 1-vs-3 and false inference after dropping invalid cwd. / 已记录决策并实际观察迁移前八项目标失败。
- [x] Complete the scoped-interpretation vertical product flow through HTTP selection, reading and restoration. / 已完成有范围解释的 HTTP 选择、阅读及恢复闭环。
- [x] Migrate all six applicable source consumers, preserving their admission and physical reader boundaries. / 已迁移六来源适用消费者，保留准入及读取边界。
- [x] Run Linux native and complete Node/browser/package acceptance with pinned toolchain. / 已用固定工具链完成 Linux 原生及 Node／浏览器／安装包验收。
- [x] Obtain fresh independent review of the proposed diff and substantive corrections; verify the final content manifest in the handoff before any commit. / 已完成拟议 diff 及实质修订的 fresh 独立审查；任何提交前在交接中核验最终内容清单。
- [x] Exchange candidate `f4494a4762cba1853f5bc5f1662527a665a4d809` and cross-review the first Windows native results, keeping its lifecycle failure explicit. / 已交接所列候选并交叉审查首轮 Windows 原生结果，明确保留其生命周期失败。
- [x] Repair equivalent native source-home state regression, accept reviewed test portability corrections and obtain Windows revalidation on `e095757`. / 已修复本机等价来源根状态回归，接纳已审查的平台测试修正，并取得 e095757 的 Windows 复验通过证据。
- [x] Audit final native artifacts, record same-candidate results and archive this plan without changing production content. / 已审计最终原生工件、记录同候选结果，并在不修改生产内容的情况下归档本计划。

## Initial candidate verification record / 首个候选验证记录

This section describes the first candidate, before the Windows-discovered home regression was repaired. Final `e095757` counts are recorded below. / 本节记录修复 Windows 发现的来源根回归之前的首个候选；最终 e095757 的计数见后文。

Toolchain: Node `v24.22.2`, npm `12.0.2` bootstrapped outside checkout under `/tmp/session-analyzer-unc-toolchain`; `npm ci --strict-allow-scripts` installed lockfile dependencies and `npm install-scripts ls --json` reported `allowScripts: []`. / 工具链在 checkout 外 bootstrap，严格安装锁定依赖，安装脚本检查无待处理项。

Complete Node suite after the final context/configuration corrections: 2,375 tests, 2,374 passed, one Windows-only skip, zero failures/cancellations. The pinned command and log are recorded under `output/unc-implementation/evidence/node-full-candidate.log`. The final CLI/lifecycle/context focused run passed 21/21. / 最终上下文／配置修订后完整 Node 共 2,375 项，2,374 通过，1 项仅 Windows 场景跳过，无失败／取消；固定命令与日志保存在所列证据目录。最终 CLI／生命周期／上下文聚焦运行 21 项全部通过。

New target evidence covers the five JSONL sources through discovery, indexing, materialization, Detail and exact Raw, plus OpenCode host admission and OR selection. Native Linux tests create distinct case-sensitive paths, literal-backslash names, configured source-home symlinks and an escaping symlink; lexical tests are not reported as Windows filesystem evidence. / 新目标测试覆盖五 JSONL 来源的发现、索引、物化、Detail 和精确 Raw，并覆盖 OpenCode 宿主准入及 OR 筛选。Linux 原生检查实际创建大小写不同路径、字面反斜杠名称、配置来源根别名及越界 symlink；词法测试不当作 Windows 文件系统依据。

Independent review found and verified corrections for native namespace history compatibility and relative `projectPathScopeRoot` borrowing process cwd. The latter now requires a native canonical absolute locator without replacing configured aliases by realpath. Browser corrections preserve rules across same-process A→B→A, explicit empty rules, physical scope edge spaces and omitted-rule lost responses. Seventeen browser target tests pass, including a second browser that cannot override a first explicit empty rule set, and English/Chinese namespace notices that do not misreport readable history as unreadable. / 独立审查发现并核验修复了原生 namespace 历史兼容及相对 projectPathScopeRoot 借用进程 cwd 的问题；该字段现要求宿主规范绝对 locator，不以 realpath 替换配置别名。浏览器修正保留同进程 A→B→A 的规则、显式空规则、物理范围边缘空格，以及省略规则字段时的丢响应核验。17 项浏览器目标通过，包含第二浏览器不能覆盖首次显式空集，以及英中 namespace 提示不把可读历史误报为不可读。

The first complete browser run passed 440/441; its sole search-scroll/pagination failure was independently reproduced on a fully rebuilt, unmodified base. A separate repair was later extracted from the UNC PR at the user’s request; see the scope follow-up below. The original test and timeout remain unchanged. / 首次完整浏览器 440／441 通过，唯一搜索滚动／分页失败在完整重建的未改基线上独立复现。其独立修复后来按用户要求从 UNC PR 中拆出，见后文范围调整；原测试及超时保持不变。

The final fresh review also closed an eager `process.cwd()` default for already absolute project inputs and a no-op mutation that discarded the first explicit empty rule field. Empty declarations now advance configuration/discovery generation without retiring an unchanged active Index/job. Absolute captured project materialization remains valid after cwd removal; separate Raw checks retain their documented host boundary. / 最终 fresh 审查还关闭了绝对项目输入仍提前读取 process.cwd()，以及语义未变时丢弃首次显式空规则字段的问题。空集声明会推进配置／发现代次，但不退役语义未变的活跃 Index／作业。绝对捕获项目在 cwd 删除后仍可物化；独立 Raw 检查保留已记录的宿主边界。

Synthetic preview HTTP acceptance switches all six sources and verifies 11 Sessions through Detail/Raw, preserving all 13 source/configuration files byte-for-byte. The preview uses only isolated fixtures; recorded UNC strings on Linux are not native UNC filesystem evidence. / 合成预览 HTTP 验收切换六来源，核验 11 条会话的 Detail／Raw，全部 13 份源／配置文件字节不变。预览仅使用隔离 fixture，Linux 上的 UNC 记录字符串不作为原生 UNC 文件系统依据。

Final build/check and installed-package smoke pass. The package is installed into a fresh temporary project; all six source UI and history status/search/context/read/Raw/open chains pass. Browser shared/i18n Node checks also pass 19/19 after the notice correction. / 最终构建／检查及安装包 smoke 通过；包安装到全新临时项目后，六来源 UI 及 history 状态／搜索／上下文／读取／Raw／open 链路均通过。提示文案修正后的浏览器共享／i18n Node 检查另有 19 项全部通过。

At the first handoff, Windows same-commit acceptance was pending. Local candidate commit authorization was received on 2026-11-13; the handoffs record exact SHAs, reviewed diffs and content verification. Final Windows revalidation is recorded below. Remote SMB, Windows file symlinks and case-sensitive directories remain outside new support claims. / 首次交接时 Windows 同提交验收尚待进行。本地候选提交授权已于 2026-11-13 收到，交接记录精确 SHA、已审查 diff 及内容核验；最终 Windows 复验见后文。远端 SMB、Windows file symlink 和大小写敏感目录不新增支持承诺。

### Windows first-round cross-review / Windows 首轮交叉审查

On 2026-11-13, Windows delivered native results on exact commit `f4494a4`: F01 126 builds, 313 exact Raw calls, 34 unchanged main source files; 40 positive matrix cases each admitted one and four prefix controls admitted zero. Six sources with three home transports, namespace/junction pi reader boundaries, history/pi policy changes, HTTP lifecycle and installed-package reading passed. WSL independently verified all 51 delivered file hashes and recomputed the matrix; these are reviewed Windows executions, not WSL-native Windows reruns. / Windows 于所列日期交付精确提交的原生结果：F01 126 次构建、313 次精确 Raw、34 份主源不变；40 项正例各 1、4 项前缀负例各 0。六来源三种 home 访问形式、namespace／junction 的 pi reader 边界、history／pi 策略变化、HTTP 生命周期及安装包阅读通过。WSL 独立核验交付的 51 文件 hash 并重算矩阵；这些是审阅 Windows 执行证据，不是 WSL 重跑 Windows。

The first candidate was rejected: six uppercase source-home edits discarded omitted rules and retired the current index, and one running pi job was cancelled (19 HTTP cases: 12 controls passed, seven targets failed). WSL reproduced two lexical regression assertions before repair. The repair separates native scope identity from physical I/O, preserves equivalent-home configuration/rules and canonicalizes captured/history/pi scope without relaxing actual rule-change invalidation. Eight Windows test-only portability corrections were reviewed and adopted; Return and scheduled-origin rejection assertions remain. Fresh exact-diff review and subsequent same-candidate revalidation closed this regression as recorded below. / 首个候选未通过：六来源改为大写 home 会丢掉省略的规则并退役当前索引，另有一项在途 pi 作业被取消（19 项 HTTP 中 12 对照通过、7 目标失败）。WSL 修复前复现了两项词法失败断言；修复区分本机范围身份与物理 I/O，保留等价 home 配置／规则，统一捕获／history／pi scope，不放宽实际规则变化的失效机制。已审查并接纳八文件 Windows 平台测试修正，保留 Return 和定时来源拒绝断言。fresh 精确 diff 审查及后续同候选复验已关闭此回归，见下文。

## Final same-candidate acceptance / 最终同候选验收

Production commit: `e09575700cf5191fbdc4fc613173650a9a54e2f7`; tree: `491cf5303718fedf77452fba0f7c1cf99cc868b4`; repair parent: `f4494a4762cba1853f5bc5f1662527a665a4d809`; independently reviewed repair binary diff SHA256: `d2f143ad0b9ec704ae9d2495ed5de076eab90dd9eb42e325923ae6d6c0a0d810`. Both native executors verified the complete 780-file non-generated candidate. WSL used Node 24.22.2, Windows used Node 24.18.1 on NT 10.0.22631; both used npm 12.0.2, strict installation with no pending scripts, actual dependency resolution and rebuilt assets. / 生产提交、tree、修复父提交与独立审查的修复 diff 摘要如上。双方原生执行者均核验完整 780 份非生成候选文件；Node 版本及 Windows 系统版本如上，双方使用 npm 12.0.2、严格安装且无待处理脚本、实际依赖解析与重建资产。

| Gate / 门槛 | WSL/Linux execution / 执行 | Windows execution / 执行 |
| --- | --- | --- |
| Full Node / 完整 Node | 2,385 tests: 2,384 pass, 1 Windows-only skip / 2,384 通过、1 项仅 Windows 场景跳过 | 2,385 tests: 2,362 pass, 23 platform/capability skips / 2,362 通过、23 项平台／能力跳过 |
| Full browser / 完整浏览器 | 442 pass / 全部通过 | 440 pass, 2 native POSIX skips / 440 通过、2 项原生 POSIX 跳过 |
| Build/check and fresh-package smoke / 构建与全新安装包 | Passed; six-source UI/history / 通过，六来源 UI／history | Passed; six-source UI/history / 通过，六来源 UI／history |
| Native filesystem / 原生文件系统 | Case-distinct inodes, literal backslashes, symlink/.. and distinct configured aliases / 不同大小写 inode、字面反斜杠、symlink／.. 及独立配置别名 | F01: 126 builds, 313 exact Raw reads, 34 unchanged main sources; F03: four junction forms with native bytes/file identity and pi root rejection / 126 次构建、313 次精确 Raw、34 份主源不变；四种 junction 路径形式的原生字节／文件身份与 pi 根边界拒绝 |
| Home lifecycle / 来源根生命周期 | HTTP current/running job, history, Codex SourceRef and pi positive/negative regressions / HTTP 当前／在途作业、history、Codex SourceRef 与 pi 正负回归 | Original 19 cases all pass; minimum regression and real Chrome Return/refresh pass / 原 19 项、最小回归及真实 Chrome 返回／刷新全部通过 |
| Independent reference scope / 独立引用范围 | Reviewed final production diff; 184 focused passes and 1 Windows-only skip / 独立审查最终生产 diff，聚焦 184 通过、1 项 Windows 专属跳过 | 56 native cases, including 8 own-context controls, exact Raw and 5 unchanged sources / 56 项原生检查，含 8 项自身上下文正对照、精确 Raw 与 5 份源不变 |

All complete suites reported zero failures/cancellations. Skips remain skips, not passes; Linux physical behavior is supported by WSL execution, not Windows string simulation. Six-source admission, Claude inferred provenance, OpenCode OR, pi branch counts and WorkBuddy scheduled-origin boundaries remain intact. The 40 explicit UNC positives each admit one; the four adjacent-prefix controls remain zero. / 完整套件均无失败／取消；跳过不算通过，Linux 物理行为来自 WSL 实测而非 Windows 字符串模拟。六来源准入、Claude 推断身份、OpenCode OR、pi 分支计数与 WorkBuddy 定时来源边界保持；40 项明确 UNC 正例各接纳 1，4 项相邻前缀对照仍为 0。

Evidence is retained under `E:\tasks\tmp\codex_exchange\wsl-commit-e09575700cf5` and `windows-acceptance-e09575700cf5`. The Windows handoff manifest SHA256 is `59dda6b528dcb38eeb42c682a992dbeb810364f9c2a9f7fda2fad03eee0b1314`. WSL independently verified its 69 file hashes, all 42 archived source hashes and six harness hashes, and recomputed F01/F03, the 19 predicates, all 56 expected/actual pairs and manual browser before/after state. This was an audit of Windows executor artifacts, not a WSL rerun of Windows. The invalid manual draft attempt and historical patch/type constants were excluded from pass/identity conclusions. / 证据保存在上述交换目录，Windows 交接清单摘要如上。WSL 独立核验 69 文件 hash、全部 42 份归档源 hash 及 6 个 harness hash，重算 F01／F03、19 项 predicate、56 项 expected／actual 及手工浏览器前后状态。这是审计 Windows 执行产物，不是 WSL 重跑 Windows；无效手工草稿及旧 patch／type 常量未用于通过／身份结论。

The results above describe local execution on the identified candidate. Remote SMB/DFS/NAS, Windows file symlinks, case-sensitive Windows directories and device I/O are not newly promised. F03 root rejection is evidence for the pi snapshot reader, not a proof for every reader; SQLite SHM remains coordination state. The separately tracked deleted-cwd Codex Raw-owner debt remains open. / 上述结果描述所列候选的本地执行。不新增远端 SMB／DFS／NAS、Windows file symlink、大小写敏感目录或设备 I/O 支持承诺。F03 根边界拒绝针对 pi snapshot reader，不作为所有 reader 的证明；SQLite SHM 仍为协调状态。单独跟踪的 cwd 删除后 Codex Raw 归属技术债仍保持开放。

## Acceptance mapping / 验收映射

| Matrix / 矩阵 | Evidence / 依据 | Final local acceptance / 最终本地验收 |
| --- | --- | --- |
| P01–P08 | Pure interpretation/context/namespace tests, cross-source target suites, native Linux case tests / 纯解释、范围及 namespace 测试，跨来源目标及 Linux 原生大小写测试 | Passed with Windows native and WSL evidence above / 已由上述 Windows 原生及 WSL 依据通过 |
| S01–S05 | Five-source target tests, Codex config/cwd entrances and CLI/history subprocesses, Claude inferred provenance, pi branches, DeepSeek finalize, WorkBuddy origin / 五来源目标、Codex 配置与 cwd 入口及 CLI／history 子进程、Claude 推断依据、pi 分支、DeepSeek finalize、WorkBuddy 来源 | Passed on the same candidate / 同候选通过 |
| S06 | Existing OpenCode SQLite tests preserve Linux foreign-path refusal and worktree/directory OR / OpenCode SQLite 检查保留 Linux 外来路径拒绝及 OR | Windows native host-path/UNC/OR passed / Windows 原生宿主路径／UNC／OR 通过 |
| L01–L04 | HTTP job/context/reuse and strict ownership tests; history/pi references; browser rule/restore/race tests / HTTP 作业、上下文、复用及严格归属；history／pi 引用；浏览器规则、恢复和竞态 | Passed, including repaired 19-case and independent 56-case Windows runs / 通过，包含修复后的 Windows 19 项及独立 56 项 |
| F01, F03 | Exact same-candidate native localhost UNC and junction evidence / 精确同候选的原生 localhost UNC 及 junction 证据 | Passed within stated reader/filesystem limits / 在所声明 reader／文件系统边界内通过 |
| F02 | Native Linux filesystem and source reader regressions / Linux 实际文件系统与来源读取回归 | Passed locally; no broader filesystem claim / 本机已通过，不扩大文件系统承诺 |
| Q01 | Target tests assert accepted sets and expected zero/rejection controls separately / 目标分别断言接纳集合及预期零／拒绝 | Passed; skips separately reported / 通过，跳过单独记录 |
| Q02 | Pinned install provenance, complete Node/browser and installed-package smoke / 固定依赖依据、完整 Node／浏览器及安装包 smoke | Both local platforms passed on `e095757` / 双平台在所列历史候选上本地通过 |

## PR scope follow-up / PR 范围调整

On 2026-11-13, at the user’s request, the unrelated search-scroll animation-takeover repair and its performance-design paragraph were backed up outside the repository and removed from the UNC PR. The original pagination test and timeout remain unchanged. The complete-suite counts above belong to `e095757`, which included that separate repair; they do not establish a full-suite pass for later revisions after extraction. Per-commit automated results belong in [PR checks](https://github.com/Yijia-Zhou/session-analyzer/pull/107/checks). / 2026-11-13 按用户要求，将无关的搜索滚动动画接管修复及性能设计段落备份到仓库外，并从 UNC PR 中移除；原分页测试和超时保持不变。上文完整套件计数属于含该独立修复的 e095757，不作为拆出后其他修订的全套通过证明。逐提交自动检查结果由 [PR checks](https://github.com/Yijia-Zhou/session-analyzer/pull/107/checks)记录。
