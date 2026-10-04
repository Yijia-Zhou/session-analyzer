# Shell result semantics / Shell 结果语义

Status: implementation and local acceptance completed on 2026-10-04. PR delivery and required CI are tracked in [PR #76](https://github.com/Yijia-Zhou/session-analyzer/pull/76). / 状态：实现与本地验收于 2026-10-04 完成；PR 交付与必要 CI 在 PR #76 中跟踪。

Repair debts #29 and #25 on `fix/post-020-review`, continuing PR #76. Interpret only source-specific, uniquely owned shell results; preserve exact Raw and existing Code Mode/terminal relationship ownership. / 在当前分支与 PR #76 修复债务 #29、#25。仅解释来源专属、归属唯一的 shell 结果；保留精确 Raw 及既有 Code Mode／终端关联归属。

- DeepSeek authority: pinned `639ed015397290b3745d163aafe02ffee4aa3f84` bash/pwsh renderers and shared `parseExitStatus`, plus the already documented rc.2 exit-7 observation. Native foreground nonzero exits use a final newline-prefixed marker while `isError` describes tool infrastructure. Background promotion, timeout and signal are separate outcomes. / DeepSeek 依据为上述固定源码及已有 rc.2 退出 7 观察。原生前台非零退出使用末尾带换行标记，`isError` 描述工具基础设施；后台转交、超时及信号属于独立结果。
- Codex authority: the existing pinned direct formatter grammar and native terminal fixtures; only exact exec_command requests and unambiguous function-call/output ownership are admitted. Missing exits stay unknown, running receipts stay incomplete, and typed/lifecycle evidence retains precedence. / Codex 依据为已有固定 direct formatter grammar 与原生终端 fixture；只接纳精确 exec_command 请求及无歧义调用／输出归属。缺失退出码保持未知，运行中回执保持未完成，typed／lifecycle 依据优先。

Completed execution / 已完成执行：

1. Added failing synthetic regressions and implemented source-owned interpretation for plain/Zstd, direct/PTC, malformed/lookalike results, background/timeout/signal/stop and command classification. Added duplicate, mixed function/custom, cross-turn, namespace and argument negatives and lifecycle precedence for Codex. / 已添加失败合成回归并实现来源自有解释，覆盖普通／Zstd、direct／PTC、畸形／伪似结果、后台／超时／信号／停止及命令分类；Codex 补充重复／function 与 custom 混合／跨回合／namespace／参数反例及 lifecycle 优先级。
2. Synchronized bilingual spec/design/debt/changelog; closed debts #25 and #29. Corrected an existing capacity-evidence link after its plan had been archived. / 已同步双语规格、设计、债务与 changelog，关闭债务 25、29，并修正证据计划归档后遗留的容量文档链接。
3. Reviewed the final code and completed local acceptance below. Restarted the selected DeepSeek development service while preserving its project/source/root. / 已审查最终代码并完成下述本地验收；重启当前 DeepSeek 开发服务，保留项目／来源／根配置。

Acceptance: exit-7 commands are failed and counted without modifying Raw; valid Codex durable exec_command requests have readable command/output sections; unknown and running results never become successful exits. / 验收：退出 7 命令被标为失败并计数，不修改 Raw；合法 Codex durable exec_command 请求具备可读命令／输出；未知及运行中结果不会成为成功退出。

Validation / 验证：

- Focused Node suite: 46 passed; full `npm test`: 1,570 passed. The four new plain/Zstd integration tests were rerun after adding project-search and timeline-hit parity assertions and all passed. / 聚焦 Node 套件 46 项通过，完整 npm test 1,570 项通过；扩展项目搜索与时间线命中一致性断言后，四项新增普通／Zstd 集成测试再次全部通过。
- Browser: all four new exit-7 Main/Detail/Raw cases passed for Codex and DeepSeek in English/Chinese. Full cross-platform and browser CI is a separate PR merge gate; its head-specific outcome is recorded on PR #76. / 浏览器：Codex 与 DeepSeek 的中英文退出 7 Main／Detail／Raw 四项新增场景全部通过；完整跨平台及浏览器 CI 是独立 PR 合并门槛，PR #76 记录对应 head 结果。
- `node scripts/build-client.js --check`: generated assets current. Installed `node scripts/package-smoke.js`: Codex, Claude Code and DeepSeek Timeline/Detail/Raw all passed, including compressed artifacts. / 生成资产检查通过；安装包 smoke 的三种来源时间线／详情／Raw 全部通过，包含压缩工件。
- Development URL `http://127.0.0.1:17890/`: DeepSeek target `tmp/dsh-lab-workspace`, source root `tmp/dsh-lab-home/sessions`, indexing succeeded, 23 Sessions, zero source diagnostics. Actual Main message and command Detail/Raw reads passed through the internal HTTP API; browser evidence uses synthetic fixtures. / 本地 URL 对应所列 DeepSeek 项目与来源根，索引成功、23 个会话、零来源诊断；通过内部 HTTP API 实际读取主时间线消息及命令详情／Raw，浏览器证据使用合成 fixture。
- Toolchain: Node 24.18.1 / npm 12.0.2. Final diff and local Markdown references checked; no source transcript is added to the commit. / 工具链为 Node 24.18.1／npm 12.0.2；已检查最终 diff 与本地 Markdown 引用，提交不包含来源转录数据。

Source limits / 来源限制：

The DeepSeek renderer's exact final status marker cannot be distinguished from identical command output; this matches the pinned upstream text contract. Persistent PowerShell completion-padding handling is source-inspected only. Codex terminal relations keep their narrower native-local-direct gate independently of command classification; unknown envelopes retain output and Raw without an inferred exit. / DeepSeek renderer 的末尾精确状态标记无法与完全相同的命令输出区分，符合固定上游文本契约；持久 PowerShell 完成行空格处理仅做源码检查。Codex 终端关系继续独立使用更窄的 native-local-direct 准入；未知封装保留输出及 Raw，不推断退出码。
