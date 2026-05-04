# Long-Horizon Ideas
# 远期想法

This file captures possible future improvements that are not yet accepted
requirements or implementation plans.
本文件记录尚未成为已接受需求或实施计划的潜在未来改进。

## Idea: Distinguish Sub-Agent Sessions After Core UI Freeze
## 想法：核心 UI 冻结后区分显示 Sub-Agent Session

- Captured: 2026-05-04
- 记录日期：2026-05-04
- Status: parking
- 状态：parking
- Source: UX exploration
- 来源：UX 探索
- Theme: session navigation, event hierarchy
- 主题：session 导航、事件层级
- Confidence: low
- 置信度：低

### Notes
### 说明

The current session list presents sessions primarily as flat Codex development
runs. After the core UI design is frozen, consider whether sessions created by
sub-agents should be visually distinguished from primary sessions.
当前 session 列表主要把 session 展示为扁平的 Codex 开发过程。核心 UI 设计冻结后，可以考虑是否需要把 sub-agent 创建的 session 与主 session 做视觉区分。

Possible directions:
可能方向：

- Add a parent/child session marker in the session list.
- 在 session 列表中增加父子 session 标记。
- Show sub-agent sessions with a compact nested treatment under the parent
  session.
- 将 sub-agent session 以紧凑的嵌套形式展示在父 session 下。
- Add filtering for primary sessions, sub-agent sessions, or both.
- 增加筛选项，用于查看主 session、sub-agent session 或两者。
- Use distinct badges for explorer, worker, or default sub-agent roles if that
  information is available in the parsed data.
- 如果解析后的数据中存在相关信息，为 explorer、worker 或 default 等 sub-agent 角色显示不同徽标。

### Promotion Criteria
### 晋升标准

Promote this idea only if the UI routinely displays enough sub-agent sessions
that users struggle to understand which work happened in the main thread versus
delegated threads.
只有当 UI 经常展示足够多的 sub-agent session，导致用户难以判断哪些工作发生在主线程、哪些工作发生在委派线程时，才晋升该想法。

Before promotion, confirm that the underlying session data reliably exposes
parent/child relationships or role metadata.
晋升前，需要确认底层 session 数据能够可靠暴露父子关系或角色元数据。
