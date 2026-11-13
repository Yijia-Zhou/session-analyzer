# UNC project interpretation implementation / UNC 项目解释实施

Base: `v0.3.0-development@64f5b3ab351c3be6840396ddb1e8194ab102b4dc`, fetched again 2026-11-12. Branch: `fix/unc-project-path-context`. Independent worktree: `/tmp/session-analyzer-unc-implementation`. / 基线于所列日期重新 fetch；在独立 worktree 实施。

## Scope and accepted decisions / 范围与决策

Implement D1–D5 and the P/S/L/F/Q matrix in the user-provided decision, represented by the [versioned design](../../design-docs/project-path-interpretation.md). WSL is the production implementation owner; Windows performs independent native acceptance of the same candidate content. Communication is in `E:\tasks\tmp\codex_exchange`. No real transcripts; no publication, push or merge. On 2026-11-13 the user authorized a local candidate commit on the isolated branch, superseding the earlier no-commit restriction for that action. Windows native acceptance remains pending. / 实施用户决策 D1 至 D5 与验收矩阵，设计见链接。WSL 为主实施者，Windows 独立验收同一候选内容，在指定目录交接。不用真实转录，不发布／推送／合并。用户于 2026-11-13 授权在隔离分支创建本地候选提交，就此动作解除此前不提交限制；Windows 原生验收仍待进行。

## Milestones / 里程碑

- [x] Record decisions and establish failing target assertions. Eight actual cross-source failures were observed before migration: UNC split, absent compatibility evidence, Claude 1-vs-3 and false inference after dropping invalid cwd. / 已记录决策并实际观察迁移前八项目标失败。
- [x] Complete the scoped-interpretation vertical product flow through HTTP selection, reading and restoration. / 已完成有范围解释的 HTTP 选择、阅读及恢复闭环。
- [x] Migrate all six applicable source consumers, preserving their admission and physical reader boundaries. / 已迁移六来源适用消费者，保留准入及读取边界。
- [x] Run Linux native and complete Node/browser/package acceptance with pinned toolchain. / 已用固定工具链完成 Linux 原生及 Node／浏览器／安装包验收。
- [x] Obtain fresh independent review of the proposed diff and substantive corrections; verify the final content manifest in the handoff before any commit. / 已完成拟议 diff 及实质修订的 fresh 独立审查；任何提交前在交接中核验最终内容清单。
- [ ] Exchange an identified candidate and collect Windows native results; distinguish expected zero controls from defects. / 交接固定候选并收集 Windows 原生结果，区分预期零会话负例与缺陷。

## Verification record / 验证记录

Toolchain: Node `v24.22.2`, npm `12.0.2` bootstrapped outside checkout under `/tmp/session-analyzer-unc-toolchain`; `npm ci --strict-allow-scripts` installed lockfile dependencies and `npm install-scripts ls --json` reported `allowScripts: []`. / 工具链在 checkout 外 bootstrap，严格安装锁定依赖，安装脚本检查无待处理项。

Complete Node suite after the final context/configuration corrections: 2,375 tests, 2,374 passed, one Windows-only skip, zero failures/cancellations. The pinned command and log are recorded under `output/unc-implementation/evidence/node-full-candidate.log`. The final CLI/lifecycle/context focused run passed 21/21. / 最终上下文／配置修订后完整 Node 共 2,375 项，2,374 通过，1 项仅 Windows 场景跳过，无失败／取消；固定命令与日志保存在所列证据目录。最终 CLI／生命周期／上下文聚焦运行 21 项全部通过。

New target evidence covers the five JSONL sources through discovery, indexing, materialization, Detail and exact Raw, plus OpenCode host admission and OR selection. Native Linux tests create distinct case-sensitive paths, literal-backslash names, configured source-home symlinks and an escaping symlink; lexical tests are not reported as Windows filesystem evidence. / 新目标测试覆盖五 JSONL 来源的发现、索引、物化、Detail 和精确 Raw，并覆盖 OpenCode 宿主准入及 OR 筛选。Linux 原生检查实际创建大小写不同路径、字面反斜杠名称、配置来源根别名及越界 symlink；词法测试不当作 Windows 文件系统依据。

Independent review found and verified corrections for native namespace history compatibility and relative `projectPathScopeRoot` borrowing process cwd. The latter now requires a native canonical absolute locator without replacing configured aliases by realpath. Browser corrections preserve rules across same-process A→B→A, explicit empty rules, physical scope edge spaces and omitted-rule lost responses. Seventeen browser target tests pass, including a second browser that cannot override a first explicit empty rule set, and English/Chinese namespace notices that do not misreport readable history as unreadable. / 独立审查发现并核验修复了原生 namespace 历史兼容及相对 projectPathScopeRoot 借用进程 cwd 的问题；该字段现要求宿主规范绝对 locator，不以 realpath 替换配置别名。浏览器修正保留同进程 A→B→A 的规则、显式空规则、物理范围边缘空格，以及省略规则字段时的丢响应核验。17 项浏览器目标通过，包含第二浏览器不能覆盖首次显式空集，以及英中 namespace 提示不把可读历史误报为不可读。

The first complete browser run passed 440/441. The sole search-scroll/pagination failure was independently reproduced on a fully rebuilt, unmodified base: a trusted wheel reached the bottom but the pending native search animation pulled it back. A six-line handoff correction stops that animation at the current position without changing pagination eligibility/authorization. The original test and timeout remain unchanged; all 28 pagination tests and five independently rerun positive/negative cases pass. The final complete browser suite passes 442/442, with no failures, skips or cancellations. / 首次完整浏览器 440／441 通过；唯一搜索滚动／分页失败在完整重建的未改基线上独立复现：真实 wheel 到底后被尚未结束的原生搜索动画拉回。六行交接修正保持当前位置并停止动画，不改变分页资格／授权；原测试与超时不变，整份 28 项及独立复跑的五项正／负例均通过。最终完整浏览器 442 项全部通过，无失败／跳过／取消。

The final fresh review also closed an eager `process.cwd()` default for already absolute project inputs and a no-op mutation that discarded the first explicit empty rule field. Empty declarations now advance configuration/discovery generation without retiring an unchanged active Index/job. Absolute captured project materialization remains valid after cwd removal; separate Raw checks retain their documented host boundary. / 最终 fresh 审查还关闭了绝对项目输入仍提前读取 process.cwd()，以及语义未变时丢弃首次显式空规则字段的问题。空集声明会推进配置／发现代次，但不退役语义未变的活跃 Index／作业。绝对捕获项目在 cwd 删除后仍可物化；独立 Raw 检查保留已记录的宿主边界。

Synthetic preview HTTP acceptance switches all six sources and verifies 11 Sessions through Detail/Raw, preserving all 13 source/configuration files byte-for-byte. The preview uses only isolated fixtures; recorded UNC strings on Linux are not native UNC filesystem evidence. / 合成预览 HTTP 验收切换六来源，核验 11 条会话的 Detail／Raw，全部 13 份源／配置文件字节不变。预览仅使用隔离 fixture，Linux 上的 UNC 记录字符串不作为原生 UNC 文件系统依据。

Final build/check and installed-package smoke pass. The package is installed into a fresh temporary project; all six source UI and history status/search/context/read/Raw/open chains pass. Browser shared/i18n Node checks also pass 19/19 after the notice correction. / 最终构建／检查及安装包 smoke 通过；包安装到全新临时项目后，六来源 UI 及 history 状态／搜索／上下文／读取／Raw／open 链路均通过。提示文案修正后的浏览器共享／i18n Node 检查另有 19 项全部通过。

Pending: Windows native same-commit acceptance. Local candidate commit authorization was received on 2026-11-13; the handoff records the exact SHA, reviewed diff and content verification. No CI has been run for this local-only candidate. Remote SMB, Windows symlinks and case-sensitive directories remain outside new support claims. / 尚待 Windows 原生同提交验收。本地候选提交授权已于 2026-11-13 收到；交接记录精确 SHA、已审查 diff 及内容核验。此仅本地候选未运行 CI。远端 SMB、Windows symlink 和大小写敏感目录不新增支持承诺。

## Acceptance mapping / 验收映射

| Matrix / 矩阵 | Evidence / 依据 | Remaining gate / 剩余门槛 |
| --- | --- | --- |
| P01–P08 | Pure interpretation/context/namespace tests, cross-source target suites, native Linux case tests / 纯解释、范围及 namespace 测试，跨来源目标及 Linux 原生大小写测试 | Native Windows behavior has separate acceptance / Windows 原生另验 |
| S01–S05 | Five-source target tests, Codex config/cwd entrances and CLI/history subprocesses, Claude inferred provenance, pi branches, DeepSeek finalize, WorkBuddy origin / 五来源目标、Codex 配置与 cwd 入口及 CLI／history 子进程、Claude 推断依据、pi 分支、DeepSeek finalize、WorkBuddy 来源 | Windows candidate reading / Windows 候选阅读 |
| S06 | Existing OpenCode SQLite tests preserve Linux foreign-path refusal and worktree/directory OR / OpenCode SQLite 检查保留 Linux 外来路径拒绝及 OR | Windows host-path and UNC transport / Windows 宿主路径及 UNC 访问 |
| L01–L04 | HTTP job/context/reuse and strict ownership tests; history/pi references; browser rule/restore/race tests; complete browser 442/442 / HTTP 作业、上下文、复用及严格归属；history／pi 引用；浏览器规则、恢复和竞态；完整浏览器 442／442 | Windows native flows / Windows 原生链路 |
| F01, F03 | Windows owner receives exact candidate content / Windows 侧接收精确候选内容 | Native localhost UNC and junction results required / 需要原生 localhost UNC 及 junction 结果 |
| F02 | Native Linux filesystem and source reader regressions / Linux 实际文件系统与来源读取回归 | Passed locally; no broader filesystem claim / 本机已通过，不扩大文件系统承诺 |
| Q01 | Target tests assert accepted sets and expected zero/rejection controls separately / 目标分别断言接纳集合及预期零／拒绝 | Preserve distinctions in Windows report / Windows 报告保留区分 |
| Q02 | Pinned install provenance, complete Node/browser and installed-package smoke / 固定依赖依据、完整 Node／浏览器及安装包 smoke | Same-candidate Windows evidence; no CI yet / 同候选 Windows 依据；尚无 CI |
