# Codex 0.155–0.160 compatibility / 兼容性核验

Baseline / 基线: handoff `6e84bb09876561ced0b060e68f3ee5da173614a5`; working HEAD `7a10b61175dce885738ea7ce54eb88faf3c34e52` (storage/search/pagination merge #73). Initial worktree clean. / 初始工作区干净，工作 HEAD 多出存储／搜索／分页合并 #73。

## Scope and sequence / 范围与顺序

1. Verify pinned producer serialization and persistence, then reproduce typed-item semantic gaps with synthetic fixtures. / 核验固定版本生产端序列化与持久化，再以合成 fixture 复现 typed item 语义缺口。
2. Adapt source-specific facts and reuse logical/detail paths, preserving original Raw and conservative identity matching. / 适配来源事实并复用逻辑／详情路径，保留原始 Raw 与保守身份匹配。
3. In parallel, verify compaction/fork/usage and Code Mode interruption boundaries. Merge only demonstrated fixes. / 并行核验压缩／分叉／usage 与 Code Mode 中断边界，仅集成已复现修复。
4. Gate executed-call metadata on durable visibility; classify communication, identity, images/settings and excluded RPC-only changes. / executed-call 元数据先过落盘可见性门槛；分类通信、身份、图片／设置及仅 RPC 的变化。
5. Validate cold/compact/hydrated/cache/append/search/detail/navigation/statistics paths; inspect final diff and restart development server if running. / 验证冷解析／紧凑／水合／缓存／追加／搜索／详情／导航／统计路径，审查最终 diff，若开发服务正在运行则重启。

## Evidence and limits / 依据与限制

- Handoff: `G:\vibe\codex-0155-0160-session-analyzer-handoff.md`. Recommendations are hypotheses until independently checked. / 交接建议在独立核验前保持假设性质。
- Upstream matrix: [evidence review](../../design-docs/codex-0155-0160-evidence.md), including baseline gaps, accepted types, producer links and remaining limits. / 上游矩阵包含基线缺口、已接纳类型、生产端链接与剩余限制。
- Fixtures must be labeled synthetic with pinned source references; no private transcript content is copied. / fixture 标明合成与固定版本依据，不复制私人转录正文。
- No commit, push, release or complete real-writer certification is authorized or implied by local test success. / 不提交、推送或发布；本地测试通过不代表完整真实 writer 兼容认证。

## Progress / 进展

- [x] Read handoff, record HEAD and clean worktree, verify Node 24.18.1 / npm 12.0.2. / 阅读交接、记录 HEAD 与干净工作区、核验工具链。
- [x] Producer evidence and classification matrix. / 生产端依据与分类矩阵。
- [x] Typed-item reproduction, implementation and cross-path regression. / typed item 复现、实现与跨路径回归。
- [x] Compaction/fork and Code Mode boundary verification within the documented evidence boundary. / 在文档所述证据范围内完成压缩／分叉与 Code Mode 边界核验。
- [x] Final validation, docs and remaining-risk report. / 最终验证、文档与剩余风险报告。

## Delivered behavior / 已交付行为

- One source-specific semantic view reuses existing logical/detail construction for typed commands, patches, MCP, dynamic calls, ordinary messages/reasoning/external input, compaction, three Extension variants and five producer-proven collaboration tools. Subagent activities remain non-executing trace evidence. / 单一来源语义视图复用逻辑／详情构建，支持 typed 命令、补丁、MCP、动态调用、普通消息／推理／外部输入、压缩、三类 Extension 及五种有生产端证据的协作工具；子 agent 活动保持非执行的来源证据。
- Identity checks reject duplicate/foreign/conflicting items, wrong tool families and crossed turn boundaries. Proven mirrors retain original Raw refs. Missing/null exits are no longer coerced to zero; partial command output and patch result/diff text remain readable and searchable. / 身份检查拒绝重复／外部／冲突项、错误工具类别及跨轮边界，已证明镜像保留原始 Raw refs；缺失／null 退出码不再转为零，部分命令输出与补丁结果／diff 均可读可搜索。
- Checkpoint history is not replayed. Owned checkpoints and typed compaction markers establish cache-comparison boundaries. Late Code Mode output cannot establish cross-turn physical spans or reopen a prior wait chain, including exec calls without their own turn ID. / 不重放检查点历史；当前 owner 检查点与 typed 压缩标记建立缓存比较边界；Code Mode 迟到输出不得建立跨轮物理范围或重开旧 wait 链，包括 exec 自身无 turn ID 的情况。
- Compact representation advanced to `codex-compact-v2`; canonical/descriptor shapes remain unchanged. No frontend source changed; generated assets were checked. / 紧凑表示升级至 v2；canonical／descriptor 形状不变。无前端源码变更，已检查生成资产。

## Validation / 验证

| Check / 检查 | Result / 结果 |
| --- | --- |
| `node --test 'test/*.test.js'` | 1522 passed, 0 failed / 1522 通过，0 失败 |
| `node --test --test-name-pattern 'Codex external\|persisted realtime\|localized Codex agent\|Code Mode' e2e/browser.test.js` | 21 passed / 21 通过 |
| New `Codex 0.160 Paginated` browser tests / 新增分页浏览器测试 | 2 passed; real Chromium/HTTP, English and Chinese, Main → Raw refs → Raw / 2 通过，真实 Chromium／HTTP，英中双语 |
| `npm run build:check` | Generated assets current / 生成资产一致 |
| `npm run test:package` | Codex, Claude Code, DeepSeek installed-package Timeline/Detail/Raw smoke passed / 三种来源安装包 smoke 通过 |
| `git diff --check` | Passed / 通过 |

The first package smoke hit sandbox network EACCES; an escalated rerun passed. An initial server-restart request was not executed because automatic approval review hit a usage limit; after the user's continuation, the reviewed restart succeeded. The restarted process serves `http://127.0.0.1:17890/` with the original DeepSeek lab repository/root. Startup job succeeded, 23 sessions, no source diagnostics. This restart check is not Codex real-writer acceptance; new Codex reading/navigation acceptance uses the synthetic browser fixtures above. / 首次安装包 smoke 因沙箱联网 EACCES 受阻，提权重跑通过。首次服务重启因自动审批用量限制未执行，用户继续后审批并重启成功。重启进程保持原 DeepSeek 实验仓库与来源根，索引成功、23 会话、无来源诊断。该重启检查不代表真实 Codex writer 验收；新增 Codex 阅读／导航验收使用上述合成浏览器 fixture。

## Remaining evidence / 剩余证据

- No real 0.155–0.160 writer/daemon/TUI/embedded/app-server matrix, instant_interrupt on/off comparison, remote import or projectless live run was performed. All new fixtures are explicitly synthetic. / 未执行真实版本／入口矩阵、即时打断开关对照、远程导入或 projectless 实机运行；新增 fixture 均明确为合成。
- Transformed subagent history with filtered/rewritten checkpoints cannot be proven inherited by the exact-digest matcher; child statistics may include ownership-unproven copies. This requires writer-shaped evidence and a separate mapping design, recorded in [tech debt](../tech-debt-tracker.md#codex-01550160-writer-evidence-and-transformed-forks--writer-依据与变换分叉). / 精确 digest 无法证明过滤／改写检查点后的子 agent 历史归属，子级统计可能包含无法证明归属的复制记录；需要 writer 形态依据及独立映射设计，已记录技术债。
- Pending agent communications retain safe Protocol fallback; metadata inventories remain attempted-call Raw evidence. Unverified collaboration enums and non-adjacent prepared-image message mirrors remain conservative fallbacks. / 待送达通信保留安全 Protocol 兜底，metadata 库存保留为尝试调用 Raw 证据；未核验协作枚举和不相邻图片准备消息镜像保持保守处理。
- No dedicated session export feature exists in this checkout; exact Raw retrieval, serialization/detail and packaged-reader paths were checked, not an invented export flow. Full browser suite and other OS/Node combinations were not run. / 本 checkout 无专门会话导出功能；验证了精确 Raw 读取、序列化／详情与安装包读取路径，不虚构导出流程。未运行完整浏览器套件及其他 OS／Node 组合。
