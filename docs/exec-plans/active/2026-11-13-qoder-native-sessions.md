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

## Current progress / 当前进度

- Baseline fetched and isolated branch created. / 已拉取基线并创建独立分支。
- Corpus inventory: 110 JSONL files, 50 main and 60 child transcripts; 86,543 records at the initial inspection. / 初始盘点含 110 份 JSONL、50 份主会话、60 份子会话，共 86,543 条记录。
- Implementation and evidence review in progress. / 正在实现与审查依据。
- Executed validation and fresh-review evidence: pending. CI: not yet run. / 实际验证与 fresh review 依据待完成；尚未运行 CI。
