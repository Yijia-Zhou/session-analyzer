# Qoder native sessions / Qoder 原生会话

## Objective and baseline / 目标与基线

Adapt the user-selected Windows `.qoder-cn/projects` corpus as an independent `qoder` source, then push a reviewed branch and open a draft PR with reproducible missing-case instructions. Baseline: fetched `origin/v0.3.0-development` at `5db31ba`; implementation branch: `feat/qoder-native-sessions`. The original checkout is preserved; implementation uses a separate worktree. / 将用户指定的 Windows `.qoder-cn/projects` 语料适配为独立 qoder 来源，经审查后推送分支并创建 draft PR，列出缺失真实 case 的制造步骤。基线为已拉取的所列提交，实现位于独立 worktree，保留原 checkout。

## Evidence and boundaries / 依据与边界

Read real records only in place. Commit synthetic minimal fixtures and aggregate structural findings, never private transcripts or copied sidecar payloads. Validate source-specific shapes independently of Claude Code. Unknown content remains Protocol/Raw; native recorded paths remain evidence, not permission to read arbitrary files. / 真实记录只就地只读检查；仅提交最小合成 fixture 与结构汇总，不提交私人转录或复制的 sidecar 正文。独立验证来源形态；未知内容保留 Protocol/Raw，记录路径本身不授权任意文件读取。

## Work and commit strategy / 工作与提交策略

1. Inventory all JSONL and relevant sidecars, identify producer versions, map observations and gaps. / 盘点全部 JSONL 及相关 sidecar，识别 producer 版本、已观察行为和缺口。
2. Implement native storage, Indexed/Materialized lifecycle, mapping and structured Detail/Raw; integrate CLI, source chooser, history CLI and package allowlist. / 实现原生存储、索引／物化生命周期、映射及结构化详情／Raw，接入 CLI、来源选择器、history CLI 与打包清单。
3. Validate synthetic regressions, actual-corpus read-only replay, affected browser flows and package smoke. / 验证合成回归、真实语料只读回放、受影响浏览器流程及安装包 smoke。
4. Use two cohesive commits: adapter + source integration + focused/package tests/spec/design, then browser acceptance + coverage/gap documentation. No intermediate fixup commits. Before each commit, a fresh non-inheriting reviewer reviews the exact proposed staged tree; substantive corrections receive another review. Record base and diff identity separately from executed tests and CI. / 使用两份连贯提交：adapter／来源接入／聚焦与安装包测试／规格设计，然后浏览器验收及覆盖缺口文档。不留下中间 fixup 提交。每次提交前由不继承上下文的 fresh reviewer 审查精确暂存树；实质性修订须复审。分别记录基线、diff identity、实际测试与 CI。
5. Restore only generated browser assets before commits; push and open a draft PR against `v0.3.0-development`. Archive this plan when implementation and acceptance are complete. / 提交前仅恢复生成的浏览器资产；推送并向目标开发分支创建 draft PR，实现及验收完成后归档计划。

## Completion and validation / 完成与验证

Implementation and local acceptance are complete. Delivery is a draft PR against `v0.3.0-development`, not a release or merge; its current URL/CI status are external evidence reported in the PR and task result. / 实现与本地验收已完成；交付形式为面向开发分支的 draft PR，不是发布或合并。当前 URL／CI 状态作为外部依据在 PR 和任务结果中报告。

- Implementation commit: `4c354ca` (27 files). Browser acceptance and this completion record form the second commit. / 实现提交如上（27 个文件），浏览器验收与完成记录构成第二份提交。
- Native implementation covers 24 focused synthetic regressions. Final full Node suite: 2,413 tests, 2,412 passed, one Windows path/working-drive case skipped on Linux; zero failures. Node `v24.22.2`, npm `12.0.2`. / 原生实现有 24 项聚焦合成回归；最终完整 Node suite 共 2,413 项，2,412 通过，Linux 跳过一项 Windows 路径／工作盘案例，零失败，工具链版本如上。
- Source chooser browser suite: 49/49. Qoder desktop/mobile acceptance: 2/2, including command request/result/Raw, rendered Edit diff, decoded inline PNG, exact child navigation/return and unchanged synthetic source files. Browser grouping checks: 10/10. / 来源选择器浏览器套件 49 项通过；Qoder 桌面／移动验收 2 项通过，含命令请求／结果／Raw、Edit diff、已解码内嵌 PNG、精确子代理跳转／返回及源 fixture 未变；分组检查 10 项通过。
- Build/build:check passed with generated assets excluded from commits. Installed-package smoke passed for all seven sources' Web and history status/search/context/read/raw/open; this preceded only the narrow final malformed-input/ambiguity guard corrections, which received affected Node/browser reruns. / 构建及资产检查通过，生成资产不提交。七种来源的 Web 及 history 各项安装包 smoke 通过；其后只有最后的异常输入／歧义防护修正，并已复跑受影响 Node／浏览器验证。
- Read-only mapping of all 110 physical transcripts: 86,543 Raw records, 87,627 Logical Events, 20,984 calls, 20,975 exact pairs, 61 compactions. Five calls have no result; four results lack sufficient ancestry evidence and stay Protocol. / 全部 110 份物理转录的只读映射得到所列数量；五个调用没有结果，四个结果缺少充分祖先依据并保留 Protocol。
- Lifecycle replay completed all 34 discovered project selections: index ownership, materialization/query digest parity, 1,642 sampled Detail reads and 114 exact Raw reads, with zero diagnostics. Project containment causes four repeated session reads; these are not extra physical files. Separately read three real inline images from both user and tool-result records (1,022,581 decoded bytes). This replay preceded only synthetic edge-case review corrections; it is source-corpus evidence, not a universal capacity benchmark. / 生命周期回放完成全部 34 个发现项目的索引归属、物化／查询摘要一致性、1,642 次分类抽样详情和 114 次精确 Raw，零诊断；项目包含关系造成四次重复会话读取，并非新增物理文件。另读取用户与工具结果两类记录内的三幅真实图片，解码总量如上。回放先于仅针对合成边界的审查修正，不作为普遍容量基准。
- Local HTTP acceptance: a dedicated Qoder server indexed the selected Windows project successfully (43 Sessions, zero diagnostics); actual tool search, Detail and Raw reads passed. Server preview is rebuilt/restarted from the final branch for user acceptance. / 独立 Qoder 本地 HTTP 服务成功索引所选 Windows 项目（43 会话、零诊断），工具搜索、详情与 Raw 实读通过；最终分支重新构建并启动预览供验收。
- Sandbox-restricted full-suite/HTTP attempts could not exercise local server binding reliably; the recorded full-suite and browser results above are executed outside that restriction. / 沙箱内完整套件／HTTP 尝试不能可靠执行本地端口绑定；上列完整套件及浏览器结果是在该限制外实际执行所得。

## Independent review evidence / 独立审查依据

Implementation base: `5db31ba05d10b39a8b4c4ef8982776d82bb893a5`. Review hashes below are SHA-256 of `git diff --cached --binary`, excluding generated assets and the later browser acceptance files. / 实现基线如上；以下为暂存 binary diff 的 SHA-256，不含生成资产及后续浏览器验收文件。

1. Fresh reviewer, no inherited conversation: `6f91afd8ecbf9fe3aa474c7c2f7fa08afe04abf91741ee3166b6f1f547a2ffbe`. Reproduced null-content Detail failure, explicit cross-agent result pairing, duplicate cross-tool child navigation and a staged package-test dependency omission. All were fixed with regressions or coherent staging. / 第一位无继承上下文 reviewer 复现四项问题，均以回归修复或一致暂存处理。
2. Another fresh reviewer: initial corrected diff `85950c42ba16a69747fbbc642d0ec04169be6d9a75cf67309b0a18d317499ca3`. Found malformed MIME type handling and Protocol-only duplicate call competitors; both fixed with end-to-end regressions. Re-review approved exact final diff `0b99a7601bb9b3201446ad320974719f1bb1017da12e2d43d5733298fd15d404`, with no remaining actionable findings. / 第二位 fresh reviewer 发现异常 MIME 类型及只在 Protocol 可见的重复调用竞争，均修复并添加端到端回归；复审批准所列最终精确 diff，无剩余有效问题。
3. Independent execution after correction: 24 native and 22 conformance cases passed; earlier independent package/source-switch 33 cases, CLI, project-context and build-boundary checks passed. Those reviewers did not execute browser acceptance, real-corpus replay, installed-package smoke or CI; author-executed results are separately listed above. / 修正后独立执行 24 项原生及 22 项 conformance 测试；此前独立 package／source-switch 共 33 项及其他所列检查通过。reviewer 未执行浏览器、真实语料、安装包 smoke 或 CI；作者执行结果已单独列出。
4. The second commit's fresh review records its exact base/diff in that commit message; no test or CI success is inferred from static review. CI had not run at local completion. / 第二份提交的 fresh review 在该提交信息记录精确 base／diff；不从静态审查推断测试或 CI 成功。本地完成时尚未运行 CI。

## Remaining evidence / 剩余依据

The [Qoder design](../../design-docs/qoder-native-sessions.md#validation-and-remaining-cases--验证与剩余案例) and draft PR contain manual capture recipes for branch/fork replay, background completion, approval/question/plan causality, hook/queued/remote/scheduled origin, nonzero usage, external payload persistence, manual compaction, workspace/worktree changes and other producers/platforms. Existing supported observations are implemented; stronger unproven semantics remain explicit follow-ups. / 所链设计及 draft PR 包含分支／fork 回放、后台完成、审批／问答／计划因果、hook／排队／远程／定时来源、非零用量、外部正文持久化、手动压缩、workspace／worktree 变化及其他 producer／平台的人工采集步骤。已有支持范围内的观测均已实现，更强但未证明的语义明确列为后续事项。
