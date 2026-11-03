# WorkBuddy message identity correction / WorkBuddy 消息身份修正

## Scope and baseline / 范围与基线

Branch `fix/workbuddy-message-identity` starts at development commit `703b6676db4fd79a8c9cda10bbf8bc8f111706a6`. Correct the native CodeBuddy 2.179.0 adapter's message identity, turn boundaries and fallback titles together. Preserve all physical records and exact Raw references. / 修复分支从所列开发提交开始，统一修正固定原生 profile 的消息身份、回合边界及默认标题；保留全部物理记录与精确 Raw 引用。

## Evidence and acceptance / 依据与验收

- Read the pinned producer's `InputItemUtils.isLiveStreamUserMessageItem`, `isExternalUserPromptItem`, `classifyUserMessageMarkers`, `startsNewTurnTimer`, queue/steer writer, recovery writer and command/goal output writer. External-request eligibility does not prove manual human input. / 阅读固定 producer 的所列判定与 writer；外部请求资格不证明由人手动输入。
- Introduce one classification result consumed by logical mapping, turn assignment and title selection. Keep internal recovery, teammate, local output, attached context and ambiguous internal markers in Protocol/Raw; never infer identity merely from prose tags. / 引入统一判定供逻辑映射、回合归属与标题选择使用；内部恢复、队友消息、本地输出、附加上下文和含糊内部标记保留在协议／原始层，不仅凭正文标签推断身份。
- Preserve genuine steer as user input without a new turn. Count a multi-text-block user record once while keeping its readable blocks and Raw identity. / 保留真实追加指令的用户输入身份，但不新增回合；多文本块用户记录只计一次，并保留可读块与 Raw 身份。
- Run focused native-reader/detail and browser checks; have a fresh independent subagent review the final proposed diff before committing. / 执行聚焦原生 reader／详情及浏览器检查；提交前由无实现上下文的子代理独立审查最终差异。
- Attempt three separate actual producer sessions for steer, two subagents and local commands. Keep version, operation order, paths and explicit unavailable/unobserved outcomes outside repository history. Do not deliberately trigger recovery errors. / 尝试三个独立真实 producer 会话，分别覆盖追加指令、双子代理及本地命令；版本、操作顺序、路径和不可用／未观测结果保存在仓库历史之外，不刻意触发恢复错误。

## Implementation and executed checks / 实现与已执行检查

The classifier now drives mapping, Raw turn assignment and fallback title selection. Runtime markers cannot be promoted by a contradictory new-request flag; full summaries remain compactions without supplying titles. User and assistant counts use physical records while text blocks keep independent read/search references. Unsupported content remains Protocol without inventing turns. / 分类器现统一驱动映射、Raw 回合归属与默认标题；矛盾的新请求标记不能提升运行时消息身份，完整摘要仍作为压缩且不供给标题。用户与助手计数按物理记录，文本块保留独立阅读／搜索引用。未支持内容保留协议层，不虚构回合。

Executed on Node 24.19.0: 38 WorkBuddy cases (identity 8, reader/integration 22, Detail 8), 20 source-adapter conformance cases, 38 history-service and 10 logical-detail contract tests. All three WorkBuddy browser cases passed using system Chromium, including desktop/mobile and new identity → Protocol → Detail → exact Raw assertions. Pinned npm 12.0.2 build and build:check passed; no browser assets changed. Full cross-platform CI was not run for this corrective branch. / 在所列 Node 版本执行 38 项 WorkBuddy、20 项适配契约以及 38 项 history-service／10 项逻辑详情契约检查，均通过。系统 Chromium 下三项浏览器测试通过，包括桌面／移动及新增身份→协议→详情→精确 Raw；固定 npm 的构建与构建检查通过，浏览器生成资产无差异。本修正分支尚未执行完整跨平台 CI。

## Actual producer observations / 真实 producer 观察

Official CodeBuddy CLI 2.179.0 used the configured OpenRouter free model through the existing wrapper. Three independent TUI cases and their operation recordings remain under `/workspace/work/buddy/audit-20261103`; native transcripts remain under `/workspace/work/buddy/config/projects/`. No real transcript, terminal recording or credential is committed. / 官方 CLI 2.179.0 通过既有 wrapper 使用已配置的 OpenRouter 免费模型。三个独立 TUI case 及操作记录位于所列外部目录，原生转录位于既有配置根；不提交真实转录、终端录制或凭据。

1. `wb-audit-20261103-steer`: send WB-AUDIT-01, then WB-AUDIT-02 during execution. The UI queued the second input until the next tool call; no Esc interruption was used to send it. The addition preceded the eventual successful sleep. An initial tool-mode mismatch was retained; the eventual REPL sleep completed and the final reply acknowledged the supplement. Reader result: two user records, one turn. / 先发送第一条，再在运行中发送第二条；界面排队至下一工具调用，未用 Esc 中断发送；追加发生在活动回合内、最终成功等待之前。保留最初工具模式不匹配；最终 REPL 等待成功并在回复确认补充。回读两条用户记录、一个回合。
2. `wb-audit-20261103-subagents-cli`: two actual Agent tool calls returned WB-CHILD-A and WB-CHILD-B, then the parent summarized. Parent plus two native subagent files were retained. An earlier startup-only `wb-audit-20261103-subagents` attempt is separately retained, with zero messages/turns after finalization. / 两次真实 Agent 调用各自返回标记，由主代理汇总；保留主文件及两个子文件。较早仅启动的尝试单独保留，结束后为零消息／回合。
3. `wb-audit-20261103-commands`: use actual `/help`, `/status` UI, then send WB-AUDIT-03. Six local-command records have `skipRun: true`; command wrappers are persisted but the visible panel bodies are not nonempty stdout. The later prompt is the only counted user message/turn. / 实际使用帮助、状态界面后发送第三条标记；六条本地命令记录带 skipRun，命令包装已保存，但可见面板正文未作为非空 stdout 保存；后续提示为唯一计入的用户消息／回合。

Final native readback: six sessions, 70 Raw records and 80 Detail events, every Raw string matched its physical line and source bytes were unchanged. Final diagnostics: zero. During the still-open startup-only attempt an interim `WORKBUDDY_CWD_INVALID` diagnostic was observed; its finalized three-row artifact contains cwd and indexes successfully. Local preview on port 17890 selects source `workbuddy`, the audit project root and the existing config root; HTTP state confirms six indexed files and zero diagnostics. / 最终原生回读六会话、70 条 Raw、80 条详情，每条原文与物理行匹配且源字节未变；最终诊断为零。仅启动尝试仍打开时曾出现工作目录无效诊断，结束后的三行工件含 cwd 并成功索引。17890 端口预览选择正确来源、审计项目及既有根，HTTP 状态确认六个已索引文件、零诊断。

## Remaining evidence boundaries / 剩余依据边界

These captures establish CLI queued delivery and Agent child persistence, not immediate ACP steer, teammate-mail delivery, or a WorkBuddy desktop version. Recovery semantics are backed by pinned source and synthetic tests; no errors were deliberately forced. The real line 701 remains unavailable, and no exact manual-human-input count is asserted. / 采集证明 CLI 排队投递与 Agent 子文件持久化，不证明即时 ACP steer、队友邮件投递或特定 WorkBuddy 桌面版本。恢复语义由固定源码与合成测试支撑，未刻意制造错误。真实第 701 行仍不可用，不声明精确人工输入数量。

## Independent review / 独立审查

A fresh-context sol reviewer found no actionable implementation issue and independently executed the focused, downstream, browser and asset checks listed above. The final documentation receives a follow-up review; the commit records the exact reviewed base/diff. / 无实现上下文的 sol 审查未发现有效实现问题，并独立执行上述聚焦、下游、浏览器及资产检查；最终文档另作跟进审查，提交记录所审查的精确基线／差异。
