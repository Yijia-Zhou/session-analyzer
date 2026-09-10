# Post-release discovery observation / 发布后发现效果观察

Date: 2026-09-10. First observation complete; repeat window: 2026-09-24 through 2026-10-08. This is an evidence attachment to [M5](2026-09-08-readme-user-entry-and-discovery.md), to be archived with its owning plan. The window is recorded here, not scheduled as an automatic job. / 日期：2026-09-10。首次观察完成；复查窗口为 2026-09-24 至 2026-10-08。本文是 M5 的证据附件，随所属计划归档；这里只记录日期窗口，未创建自动任务。

## Public baseline / 公共基线

Direct read-only GitHub API/npm registry retrieval confirmed that the [repository](https://github.com/Yijia-Zhou/session-analyzer) description and homepage are populated, its ten Topics include the supported sources and session-history/transcript-viewer categories, and public npm `0.2.0` carries the matching three-source description and fifteen keywords. Public main README states that `0.2.0` is available. This differs from the pre-release empty GitHub metadata/old npm metadata recorded in the owning plan. Direct retrieval is not evidence of search discovery. / 直接只读回查 GitHub API 与 npm registry，确认仓库简介／主页已填写，十个 Topics 包含支持来源和会话历史／转录查看类别；公共 npm `0.2.0` 具有匹配的三来源简介及十五个关键词。公共 main README 已声明版本可用。这与所属计划中发布前的空 GitHub 元数据／旧 npm 元数据不同；直接读取不构成搜索发现证据。

Endpoints: `https://api.github.com/repos/Yijia-Zhou/session-analyzer`, `https://registry.npmjs.org/session-analyzer/0.2.0`, and `https://raw.githubusercontent.com/Yijia-Zhou/session-analyzer/main/README.md`. / 回查端点如上。

## Fixed-query sample / 固定查询样本

Interface: the agent's `web.run` / `search_query`, web search enabled, one individually attributed call per query. The underlying search engine, region, and personalization settings are not exposed; this is not a controlled Google/Bing ranking test. An initial combined four-query call was exploratory and excluded from the per-query counts below. Counts describe returned source entries, including duplicates/mirrors and irrelevant results, not ranked SERP positions or unique products. / 接口为 agent 的 `web.run`／`search_query`，已启用网页搜索，每条查询单独调用以便归属。底层搜索引擎、地区与个性化设置未暴露；这不是受控 Google／Bing 排名测试。最初合并四查询的调用仅作探索，不计入下表。数量指工具返回的来源条目，可能包含重复／镜像和无关结果，不代表排名或独立产品数。

| Exact query / 精确查询 | Returned entries / 返回条目 | Representative returned links / 代表性返回链接 | This project / 本项目 |
| --- | --- | --- | --- |
| `Codex session history viewer tool calls local` | 17 | [Codex Sessions Reader](https://github.com/someonegg/codex_viewer), [Codex History Viewer](https://github.com/hiztam/codex-history-viewer), [Codex Trace](https://github.com/PixelPaw-Labs/codex-trace) | Not found in returned entries / 返回条目中未发现 |
| `Claude Code history viewer tool output search` | 28 | [claude-history](https://github.com/raine/claude-history), [Claude History Viewer](https://github.com/bingquanzhao/claude-history-viewer), [Claude Code History Viewer](https://github.com/jhlee0409/claude-code-history-viewer) | Not found in returned entries / 返回条目中未发现 |
| `查看 Codex 会话中 AI 做了什么` | 25 | [Work with Codex from anywhere](https://openai.com/zh-Hans-CN/index/work-with-codex-from-anywhere/), [Codex CLI learning page](https://learn.chatgpt.com/zh-Hans/docs/codex/cli); general documentation and third-party tutorials also appeared / 也返回通用文档与第三方教程 | Not found in returned entries / 返回条目中未发现 |
| `搜索 Claude Code 历史会话和工具调用` | 21 | [SDK sessions](https://code.claude.com/docs/zh-CN/agent-sdk/sessions), [How Claude Code works](https://code.claude.com/docs/zh-CN/how-claude-code-works), [Session management](https://code.claude.com/docs/zh-CN/sessions) | Not found in returned entries / 返回条目中未发现 |

These links record what appeared, not a recommendation or independent verification of each candidate's functionality. The query-heading/URL inventory is retained locally at ignored `output/m5-discovery-20260910/fixed-query-results.json`; this table and its limitations are the durable observation. / 链接记录返回内容，不构成推荐或对每个候选功能的独立验证。查询标题／URL 清单保留于上述本地忽略文件；本表及其限制构成长期观察记录。

## Search-enabled agent sample / 搜索型 agent 样本

Two fresh `gpt-5.6-luna` sessions, reasoning effort `max`, received no conversation history, project name, or repository URL. They were instructed not to inspect local files, cwd, Git, or other agents. Each performed two initial searches and two primary-page reads. Both received the need to review local Codex messages/tool calls/results and to find old Claude Code commands/output with surrounding context. One received English instructions, the other Chinese instructions. The Chinese-instruction session chose English search strings, so it is not an independent Chinese-language retrieval sample; the fixed queries above supply the Chinese retrieval observations. / 两个全新的 `gpt-5.6-luna` 会话，推理强度 `max`，未传入对话历史、项目名称或仓库 URL，并要求不读取本地文件、cwd、Git 或其他 agent。每个执行两次初始搜索及两次主要来源读取。需求均为回顾本地 Codex 消息／工具／结果，以及找回 Claude Code 命令／输出和上下文；分别使用英文、中文任务说明。中文任务会话自行使用了英文检索词，因此不是独立中文检索样本；中文检索观察由上述固定查询提供。

English-instruction queries / 英文任务查询：

1. `local desktop viewer for saved Codex coding agent sessions showing messages tool calls and tool results search earlier work`
2. `local browser for Claude Code session history search past conversations inspect recorded tool outputs`

Recommendations were [Agent Session View](https://github.com/dotneet/agent-session-view) for both sources and [Session Browser](https://github.com/giannimassi/session-browser) for Claude-specific reading/search. The agent cited local browsing, search and tool-result presentation, while noting output truncation limits; it distinguished these viewers from agent execution/recovery. Session Analyzer was absent from its returned recommendation/candidate summary. / 推荐为双来源的 Agent Session View 和面向 Claude 的 Session Browser，理由是本地浏览、搜索与工具结果呈现，同时指出输出截断限制，并区分查看器与 agent 执行／恢复。本项目未出现在返回的推荐／候选摘要中。

Chinese-instruction queries / 中文任务查询：

1. `review local AI coding assistant sessions messages tool calls results`
2. `search coding assistant history commands tool output continue context`

Recommendations were [SessionPilot](https://github.com/web-werkstatt/session-pilot) for local replay and [Agent History](https://github.com/nihen/ah) for search/inspection with optional resume. The agent explicitly separated history viewing from resume/execution and context-recovery candidates, and did not establish full tool-output fidelity. Session Analyzer was absent from its returned recommendation/candidate summary. / 推荐为本地回放用途的 SessionPilot，以及搜索／检查并可选恢复用途的 Agent History；明确区分查看、恢复／执行和上下文恢复候选，未证明完整工具输出保真。本项目未出现在返回的推荐／候选摘要中。

Neither recommendation absence nor the four fixed-query absences establishes that the project is unindexed, has zero traffic, or cannot be found with another query. Since no sample recommended this project, its source/version-description accuracy and reason for recommendation are **not assessable**, rather than scored as inaccurate. These are two sessions of the same model through the same tool family, not a multi-model benchmark. / 两个推荐摘要及四条固定查询中的缺席，不证明项目未收录、零流量或无法通过其他查询找到。由于样本未推荐本项目，来源／版本描述准确性及推荐理由为**无法评估**，不是判为描述错误。这是同一模型通过同类工具的两个会话，不是多模型基准。

## Changes and next observation / 修改与下次观察

The confirmed content gap was the publication-status contradiction, independently established before these searches. The current startup guide now states that `0.2.0` is public, and both README languages explain that immutable release-time guides may retain preparation wording, linking the public release record. No speculative keyword expansion, new landing page, or remote metadata mutation was made based on this small sample. These local documentation edits were not public during the observation. / 确认的内容缺口为此前独立核实的发布状态矛盾；当前启动指南已说明 `0.2.0` 公开，双语 README 解释不可变发布时指南可能保留准备阶段措辞，并链接公共发布记录。未根据小样本盲目扩关键词、新建落地页或修改远端元数据；本地文档修改在观察时尚未公开。

Public correction handoff: commit/review the guide correction, publish it, then pin the six README startup-guide links to that verified public correction commit SHA in a subsequent documentation change. Preserve the original `v0.2.0` tag and npm bytes; old packaged links remain historical snapshots. Do not replace them with future `main` instructions or an invented/unpublished SHA. Record actual public readback before marking M5 alignment complete. / 公共修订交付：提交／审阅指南修正并公开，再于后续文档变更中将六个 README 启动指南链接固定到已经公开核验的修正 commit SHA。保留原始 `v0.2.0` tag 和 npm 字节；旧包中的链接仍是历史快照。不改为未来 `main` 说明，也不使用虚构／未公开 SHA。实际公开回查后，才能标记 M5 对齐完成。

Publication follow-up, 2026-09-10: the corrected guide was committed and pushed as `51a9ec530b1a9c03f3d96761632baa05590ccefe`; its [immutable URL](https://github.com/Yijia-Zhou/session-analyzer/blob/51a9ec530b1a9c03f3d96761632baa05590ccefe/docs/usage/agent-quickstart.md) returned HTTP 200 through raw GitHub retrieval, with both language corrections verified. The six README links now target that revision, so the temporary README snapshot explanation was removed. Default-branch entry alignment completed after #47 merged at `ecec245`: public-main readback on `903ba178` verified the same relevant files, actual English → Chinese → English browser navigation, and the fixed guide. See the owning M5 plan for evidence; the observation above predates these corrections. / 发布跟进（2026-09-10）：修正后的指南已提交并推送为上述 commit；其[不可变 URL](https://github.com/Yijia-Zhou/session-analyzer/blob/51a9ec530b1a9c03f3d96761632baa05590ccefe/docs/usage/agent-quickstart.md)经 GitHub raw 回查返回 HTTP 200，双语修正均已核验。六个 README 链接现指向该修订，因此移除了临时的 README 快照说明。默认分支入口对齐已完成：#47 在 `ecec245` 合入后，于 `903ba178` 回查公共 main，确认相关文件相同、实际英文→中文→英文浏览器跳转及固定指南正确。证据见所属 M5 计划；上述观察早于这些修正。

Repeat between 2026-09-24 and 2026-10-08 using the same four fixed queries and recorded natural-language needs/model where available. Record the actual observation date, tool/model changes, public correction SHA/date, candidate links, and the three-way result (not found / found inaccurately described / found accurately described). Treat changes as observations with uncertainty, not proof of SEO effectiveness. / 2026-09-24 至 2026-10-08 之间复查，沿用四条固定查询及已记录的自然语言需求／可用模型。记录实际日期、工具／模型变化、公共修订 SHA／日期、候选链接，以及未发现／发现但描述不准／发现且描述准确三种结果；将变化视为带不确定性的观察，不当作 SEO 效果证明。
