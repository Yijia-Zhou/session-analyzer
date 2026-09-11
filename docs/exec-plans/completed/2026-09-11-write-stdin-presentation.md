# write_stdin request presentation / write_stdin 请求呈现

Scope: Phase A only; [design](../../design-docs/background-terminal-presentation.md). / 范围：仅 A 阶段，见设计文档。

- [x] Strict request classification and minimal materialized presentation facts. / 严格请求分类及最小 materialized presentation facts。
- [x] Timeline/Trajectory labels and hydrated terminal Detail, without origin. / Timeline／Trajectory label 与 hydrated terminal Detail，不关联 origin。
- [x] Synthetic fixture and targeted contract/hydration/search tests. / 合成 fixture 及定向 contract／hydration／search 测试。
- [x] Complete full tests, browser verification, package/build checks and local-server acceptance. / 完成全量测试、浏览器验证、package／build 检查及本地服务验收。

## Acceptance / 验收

- `npm test`: 1,108 passed. Additional terminal contract rejection, folding invariance and stale-source hydration assertions passed in the focused test. / 全量 1,108 项通过；新增 terminal contract 拒绝、folding 不变与 stale-source hydration 断言通过定向测试。
- Focused Chromium test `background terminal requests render`: passed for Timeline, expanded Detail, Inspector response and Trajectory. Chinese labels and escaped input are also covered by the integration test. / 定向 Chromium 测试通过 Timeline、展开 Detail、Inspector response 与 Trajectory；集成测试同时覆盖中文 label 与转义输入。
- `npm run build:check`, `npm run test:package`, `git diff --check`: passed. Package smoke installed the tarball and verified Codex, Claude Code and DeepSeek Harness Timeline → Detail → Raw. / 上述检查通过；package smoke 安装 tarball 并验证三个来源的 Timeline → Detail → Raw。
- Local acceptance: `http://127.0.0.1:17890/`, Node v24.18.1, checkout base `9c3ad1e` plus this change; Codex root `C:\Users\Yijia\.codex`, target `G:\vibe\session-analyzer`. Pinned job 1 eventually succeeded after exceeding the initial 60-second observation window: 722 sessions, 0 diagnostics, no indexing error/code. / 本地验收：上述 URL、Node 与 checkout；固定 job 1 超过最初 60 秒观察窗口后最终成功，722 个会话、0 diagnostics，无 indexing error/code。
- Actual browser reading: Session `01a09030-1cd5-7533-ac74-28e90be1a4f2`; read the initial user/assistant messages, expanded script operation `call_fpwqxSZ5M8rjWouMn6h6kqiA:13`, inspected request source and final output, and collapsed back to surrounding messages. Dedicated write_stdin behavior was verified with the synthetic fixture, not inferred from this Code Mode operation. / 实际浏览器阅读：上述会话中读取开头 user／assistant 消息，展开指定脚本化操作，检查请求源码与最终输出，再折叠返回周围消息。write_stdin 专用行为通过合成 fixture 核验，不从此 Code Mode 操作推断。
- Initial system Chrome CLI launch closed immediately; bundled Chromium completed browser acceptance. The sandboxed package install stalled; the existing smoke passed with network-enabled execution. / 系统 Chrome CLI 初次启动立即关闭，随后 bundled Chromium 完成浏览器验收；sandbox 中 package install 停滞，允许联网后现有 smoke 通过。

Review: no blocking findings remain; canonical construction and search/folding/status logic are unchanged. No commit was created. / Review：无剩余阻塞项；canonical 构造与 search／folding／status 逻辑未变，未创建 commit。

Non-goals: process reconstruction, command suffix, canonical exec classification, new status or search/folding/count semantics. Phase B is a separate planned investigation and Phase C is tracked as debt #25. / 非目标：process 重建、command 后缀、canonical exec 分类、新 status 或 search／folding／count 语义。B 阶段另列待调查计划，C 阶段记录为债务 #25。
