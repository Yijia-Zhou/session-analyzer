# Post-release discovery observation / 发布后发现效果观察

Status: complete. Initial observation: 2026-09-10; repeat completed on 2026-10-15, after the planned 2026-09-24 through 2026-10-08 window. This evidence attachment is archived with its owning [M5 plan](2026-09-08-readme-user-entry-and-discovery.md). No automatic observation job was scheduled. / 状态：已完成。首次观察为 2026-09-10；复查于 2026-10-15 补做，晚于原定 2026-09-24 至 2026-10-08 窗口。本文作为证据附件随所属 M5 计划归档；未创建自动观察任务。

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

## Repeat observation, 2026-10-15 / 复查，2026-10-15

Completed at the maintainer's request, seven days after the planned window ended. The earlier sections preserve the initial observation and its then-pending actions; this section records the repeat and closes the observation milestone. / 按维护者要求补做，晚于计划窗口结束日七天。前文保留首次观察及当时的待办，本节记录复查并关闭观察里程碑。

### Public baseline and method changes / 公共基线与方法变化

- Direct GitHub API readback at `2026-10-15T13:50:30+08:00` identified public main as `a9b7f672e76e83da8ce09deb7de7a91ea58f45f5`, committed on `2026-10-05T03:40:26Z`. The description, README homepage and ten Topics remain populated with the three supported sources and history-viewer positioning. The npm registry's `latest` is now `0.2.1`, with the matching description and fifteen keywords, compared with `0.2.0` initially. / 所列时间直接回查 GitHub API，确认公共 main 为上述 SHA，提交时间如上。简介、README 主页与十个 Topics 继续包含三个支持来源及历史查看器定位；npm registry 的 latest 已从首次的 0.2.0 更新为 0.2.1，简介匹配且包含十五个关键词。
- Public README search content and direct page reading both identify `0.2.1`. The original publication correction remains the dated `2026-09-10` record at `51a9ec530b1a9c03f3d96761632baa05590ccefe`; this repeat observes a later public release/documentation state, not an unchanged `0.2.0` baseline. Public sources: [repository](https://github.com/Yijia-Zhou/session-analyzer), [pinned README](https://github.com/Yijia-Zhou/session-analyzer/blob/a9b7f672e76e83da8ce09deb7de7a91ea58f45f5/README.md), [npm metadata](https://registry.npmjs.org/session-analyzer/latest). / 搜索返回的 README 内容与直接页面读取均标识 0.2.1；原发布修正仍以 2026-09-10、上述 51a9ec SHA 的记录为准。本次观察的是之后的公共版本／文档状态，基线已不再固定为 0.2.0；公共来源见链接。
- Fixed queries used `web.run` / `search_query`, one query per call with `response_length=long`; the four independent calls ran concurrently. No domain filters, product-name additions or retries were used. Engine, region and personalization remain undisclosed. / 固定查询继续使用所列工具，每次调用一条查询并设 long 返回长度，四次独立调用并发执行；未加域名过滤、产品名或重试。底层引擎、地区与个性化仍未暴露。
- Retrieval limits: web-tool opens of the GitHub API/npm endpoints returned internal errors, and the initial shell request was sandbox-blocked; the authorized direct HTTP readback then succeeded for repository metadata, main SHA and npm latest. An additional shell read of immutable raw documentation failed with a transport connection reset, so a fresh complete bilingual-guide/link acceptance is not claimed. The readable public GitHub page and web-tool raw-main README supplied current entry content; prior installation/browser acceptance remains unchanged. / 回查限制：web 工具打开 GitHub API／npm 端点返回内部错误，首次 shell 请求受沙箱阻止；获授权的直接 HTTP 回查随后成功取得仓库元数据、main SHA 及 npm latest。额外尝试读取不可变 raw 文档时连接被重置，因此不声称重新完成整套双语指南／链接验收。当前入口内容来自可读的 GitHub 公共页及 web 工具取得的 raw-main README；既有安装／浏览器验收记录不变。
- Two fresh agents received equivalent English/Chinese needs without conversation history, the product name or its URL. They were forbidden from inspecting local files, cwd, Git or other agents and reported complying. The former `gpt-5.6-luna` model was unavailable; these sessions inherited the current default model/settings, whose exact model identifier and effort were not returned by the spawn tool. This model change prevents a controlled same-model comparison. / 两个全新 agent 接收等价中英文需求，未传入会话历史、产品名或 URL；禁止读取本地文件、cwd、Git 或其他 agent，二者均报告遵守。原 gpt-5.6-luna 不可用，本次继承当前默认模型／设置，启动工具未返回精确型号与 effort；模型变化使本次不能作为受控的同模型比较。

### Fixed-query results / 固定查询结果

Counts are returned source entries, including irrelevant entries and mirrors, not unique products or search-engine ranking positions. / 数量为工具返回的来源条目，含无关项及镜像，不代表独立产品数或搜索引擎排名。

| Exact query / 精确查询 | Entries / 条目数 | Representative returned links / 代表性返回链接 | This project / 本项目 |
| --- | --- | --- | --- |
| `Codex session history viewer tool calls local` | 18 | [Codex History Viewer](https://github.com/thisjojo/codex-history-viewer), [Codex Session Viewer](https://github.com/skyerhxx/codex-session-viewer), [Session Analyzer](https://github.com/Yijia-Zhou/session-analyzer) | Found, accurately described / 已发现，描述准确 |
| `Claude Code history viewer tool output search` | 36 | [Claude History Viewer](https://github.com/bingquanzhao/claude-history-viewer), [claude-history](https://github.com/raine/claude-history), [Claude Code History Viewer](https://github.com/jhlee0409/claude-code-history-viewer) | Not found / 未发现 |
| `查看 Codex 会话中 AI 做了什么` | 28 | [OpenAI announcement](https://openai.com/zh-Hans-CN/index/work-with-codex-from-anywhere/), [Codex session guide](https://daiw.org/manual/codex/sessions) | Not found / 未发现 |
| `搜索 Claude Code 历史会话和工具调用` | 30 | [Claude Code commands](https://code.claude.com/docs/zh-CN/commands), [Coding Agent History Viewer](https://github.com/XZL-CODE/cc-codex-history-viewer), [Chinese viewer README](https://github.com/jhlee0409/claude-code-history-viewer/blob/main/README.zh-CN.md) | Not found / 未发现 |

The matching result describes a local viewer for all three sources, reading messages and recorded operations/results, and searching sessions by project; its startup example names `0.2.1`, consistent with registry readback. It does not describe an agent runner or code-recovery service. This is search-result description accuracy; a raw search result has no agent recommendation rationale. Other candidate links above record appearances only and were not functionality-tested. / 命中结果准确描述三来源本地查看器、消息与记录的操作／结果阅读及按项目搜索；启动示例为 0.2.1，与 registry 回查一致，未描述为 agent 执行器或代码恢复服务。此处评估搜索结果描述准确性，原始搜索结果没有 agent 推荐理由；表中其他候选仅记录出现情况，未实测功能。

### Fresh-context agent results and isolation limits / 无对话历史 agent 结果与隔离限制

Method correction after maintainer review: `fork_turns: none` and instructions not to inspect the workspace do not prove that initial environment context excluded the working-directory path or repository instructions. These agents shared the project workspace, whose name itself can disclose product identity. Their 2/2 recommendations are exploratory samples with possible environment leakage, not a verified blind discovery result. The fixed-query return inventories remain observed tool outputs. / 维护者审查后的方法修正：fork_turns: none 及禁止查看工作区的指令，不能证明初始环境上下文排除了工作目录路径或仓库说明。这些 agent 共用项目工作区，目录名本身就可能泄漏产品身份；2/2 推荐应视为存在潜在环境干扰的探索样本，不能视为已验证的盲测发现结果。固定查询返回清单仍为实际工具输出。

Each agent formulated two non-brand queries, submitted them together in one search call, and read two distinct primary candidate pages. Returned inventories are combined per agent and cannot be attributed to one query or language. The Chinese session additionally read another line range of one of its two pages. / 每个 agent 自拟两条非品牌查询，在一次搜索调用中一起提交，并读取两个不同候选的主要来源页面。结果清单按 agent 合并，不能归属至单条查询或某一种语言；中文样本还继续读取了其两个页面之一的另一段行号。

English-instruction queries / 英文任务查询：

1. `local coding agent session history viewer messages tool calls results transcript`
2. `coding assistant conversation log viewer search previous commands output context local`

The English agent's 26-entry inventory included this project. It read [Session Analyzer](https://github.com/Yijia-Zhou/session-analyzer) and [Agent Session View](https://github.com/dotneet/agent-session-view), recommending Session Analyzer first for reading operations in context and navigating project-search matches to the relevant event. Agent Session View was an alternative for terminal browsing/export. / 英文 agent 的 26 条结果包含本项目；实际读取上述两个页面，优先推荐 Session Analyzer，理由是上下文中的操作阅读以及项目搜索命中后定位相关事件；Agent Session View 为终端浏览／导出的备选。

Chinese-instruction queries / 中文任务查询：

1. `本地 AI 编程 会话 历史 查看器 工具调用 结果 搜索 上下文 多来源`
2. `local coding agent session history viewer search commands outputs conversation context transcript tool calls`

The Chinese agent's 28-entry combined inventory included this project. It read [Session Analyzer](https://github.com/Yijia-Zhou/session-analyzer) and [Agent History](https://github.com/nihen/ah), recommending the former for continuous reading and the latter for CLI search with surrounding context. Because this sample mixed Chinese and English queries, it does not establish discovery through the Chinese query alone. / 中文 agent 的 28 条合并结果包含本项目；实际读取上述两个页面，推荐前者用于连贯阅读、后者用于命令行搜索并查看周围上下文。该样本混用中英文查询，不能证明仅通过中文查询发现本项目。

Both recommendations correctly identified Session Analyzer `0.2.1`, the three supported sources, one active source at a time, and the limitation that Claude Code external `tool-results/*` contents are neither loaded nor searched. Both treated it as saved-history reading, without promising execution, code restoration or automatic refresh. Each is classified **found with an accurate use case**, based on documentation; neither installed or tested candidates. / 两个推荐均准确标识 Session Analyzer 0.2.1、三个支持来源、一次一个活动来源，以及 Claude Code 外部 tool-results/* 内容不读取也不搜索的限制；均理解为已保存历史阅读，未承诺执行、代码还原或自动刷新。按文档依据，两者均归类为**发现且使用场景准确**，均未安装或实测候选。

### Interpretation and completion / 解释与完成

Compared with the initial sample, fixed-query appearances changed from 0/4 to 1/4 and agent recommendation appearances from 0/2 to 2/2. These are observed sample counts, not conversion rates, ranking changes, traffic growth or causal evidence of SEO effectiveness. Date, public release/docs, model, agent query wording and returned result sets all changed; the three absent fixed-query results do not establish that the project is unindexed. / 相对首次样本，固定查询出现数从 0/4 变为 1/4，agent 推荐出现数从 0/2 变为 2/2。这是观察样本计数，不是转化率、排名变化、流量增长或 SEO 效果的因果证据；日期、公共版本／文档、模型、agent 查询措辞及返回结果均有变化，三条固定查询未命中不证明项目未收录。

The repeat found no reproducible content/entry contradiction requiring correction. The observation milestone is complete regardless of discovery success; M5 and its owner can now be archived with the acceptance attachment. No recurring observation, publication or metadata change was performed. The fixed-query title/URL inventory is retained under ignored `output/m5-discovery-20261015/fixed-query-results.json`; this section is the durable result. / 本次未发现需要修正的可复现内容／入口矛盾。观察里程碑已完成，不以搜索命中作为完成条件；M5 及主计划可与验收附件一同归档。未创建定期观察、发布内容或修改元数据。固定查询标题／URL 清单保留于上述忽略文件，本节为长期结果记录。

## Anonymous AI website supplement, 2026-10-15 / 匿名 AI 网页补充观察，2026-10-15

At the maintainer's request, operated real Chrome pages through the local Playwright CLI, using a newly opened isolated browser session without importing a signed-in profile. The maintainer explicitly limited further attempts to sites usable without login. Each successful website received one identical Chinese prompt through its ordinary chat UI; no files, repository path, project name, URL, earlier results or conversation history were supplied. This removes the local-agent workspace-context channel from the submitted prompt; it does not establish the absence of provider-side personalization or a controlled benchmark. / 按维护者要求，通过本地 Playwright CLI 操作真实 Chrome 网页，使用新开的隔离浏览器会话，未导入已登录 profile；维护者明确要求后续仅尝试无需登录的网站。两个成功网站各通过普通聊天界面接收一次相同中文问题，未提供文件、仓库路径、项目名、URL、此前结果或对话历史。这排除了提交内容中的本地 agent 工作区上下文渠道，但不证明服务端不存在个性化，也不构成受控基准。

Exact submitted prompt / 实际提交的精确提示词：

> 我想回顾本地保存的 Codex 编程会话，连贯阅读消息、工具调用及执行结果，也想搜索以前 Claude Code 会话里的命令或输出，找到后阅读周围上下文。请联网查找并推荐最多三个现有工具，提供项目链接、推荐理由和已知限制。请区分历史查看、继续执行会话和恢复代码；若不能联网，请明确说明。

English explanation (not submitted): request up to three existing tools for reading saved local Codex messages/tool activity/results and searching old Claude Code commands/output with surrounding context; ask for web research, project links, reasons, limitations, and a distinction between reading history, resuming execution and restoring code. / 英文说明未提交，仅解释上述中文需求，供双语读者理解。

### Access outcomes / 访问结果

| Website / 网站 | Observed outcome / 实际结果 |
| --- | --- |
| [Doubao](https://www.doubao.com/chat/) / 豆包 | Anonymous answer completed; UI mode `豆包 快速`; exact backend model/version not disclosed. / 匿名回答完成，界面模式为“豆包 快速”，后端精确模型／版本未披露。 |
| [Qianwen](https://www.qianwen.com/) / 千问 | Anonymous answer completed; UI labels `Qwen3.7-千问` and `快速`. These are visible product labels, not independently verified backend identities. / 匿名回答完成，界面标识为“Qwen3.7-千问”和“快速”；这是可见产品标识，不等于独立核验后端身份。 |
| [DeepSeek](https://chat.deepseek.com/) | Redirected to sign-in; no prompt submitted. / 跳转登录页，未提交问题。 |
| [Kimi](https://www.kimi.com/) | Typing and submitting triggered a login dialog; no answer received and no login attempted. / 输入并提交触发登录框，未得到回答，也未登录。 |
| [ChatGPT](https://chatgpt.com/), [Perplexity](https://www.perplexity.ai/), [Gemini](https://gemini.google.com/) | Browser navigation returned `net::ERR_CONNECTION_TIMED_OUT`; no prompts submitted. These are access failures, not negative discovery results. / 浏览器导航均连接超时，未提交问题；这是访问失败，不能计为未发现本项目。 |

### Completed responses / 已完成回答

| Sample / 样本 | Visible search evidence / 可见搜索依据 | Main recommendations / 主要推荐 | This project / 本项目 |
| --- | --- | --- | --- |
| Doubao / 豆包 | 4 query strings and 18 source links, expanded and captured. / 展开并保存 4 条查询及 18 个来源链接。 | [Codex History Viewer](https://open-vsx.org/extension/HizTam/codex-history-viewer), [agentfdr](https://www.npmjs.com/package/agentfdr), [sessionwiki](https://crates.io/crates/sessionwiki) | **Retrieved but not recommended:** source item 15 links to [session-analyzer on npm](https://www.npmjs.com/package/session-analyzer); the final recommendation text does not mention it. / **检索到但未推荐**：来源第 15 项为本项目 npm 页，最终推荐正文未提及。 |
| Qianwen / 千问 | 3 query strings and 20 source links, expanded and captured. / 展开并保存 3 条查询及 20 个来源链接。 | cass, yolog Desktop, Codex History Manager; source links include [cass listing](https://lobehub.com/ar/skills/mrc220-agent_flywheel_clawdbot_skills_and_integrations-cass), [yolog listing](https://www.aitoolnet.com/zh/yolog), [Codex History Manager](https://marketplace.visualstudio.com/items?itemName=llsenyue.codex-history-vscode). / 推荐名称及对应来源如左。 | **Absent from the captured sources and recommendation text.** / **捕获的来源和推荐正文均未出现**。 |

Doubao emphasized editor-based browsing/resume, CLI timeline inspection, and indexing/search respectively. Qianwen emphasized cross-agent search, Claude replay, and Codex browsing/resume. These are summaries of the services' recommendations, not independently verified feature comparisons. Qianwen also blurred code recovery with manually extracting snippets or resuming a conversation, and its answer relied partly on directory/marketplace entries rather than direct project URLs. Neither response described this project's capabilities, so accuracy of a website recommendation for this project is not assessable. / 豆包分别强调编辑器浏览／继续会话、CLI 时间线检查和索引搜索；千问分别强调跨 agent 搜索、Claude 回放和 Codex 浏览／继续会话。此处总结服务的推荐，不作为独立核验的功能比较。千问还将代码恢复与手工提取片段或继续对话混用，回答部分依赖目录／市场条目而非直接项目链接。两个回答均未描述本项目能力，因此无法评估网页推荐对本项目的描述准确性。

Displayed Doubao queries / 豆包显示的查询：

1. `review local saved Codex Claude Code programming session history tool search messages tool calls context`
2. `tools to view local saved Claude Code session history project links limitations`
3. `local Codex chat session archive viewer tool github`
4. `Claude Code local session log viewer open source`

Displayed Qianwen queries / 千问显示的查询（界面同时显示外围双引号）：

1. `"Codex CLI session history viewer tool"`
2. `"Claude Code session history search tool"`
3. `"review CLI coding assistant session logs messages tool calls"`

### Evidence and interpretation / 证据与解释

The supplement produced two completed anonymous website responses: 0/2 recommended this project, while 1/2 exposed it in the visible source list. Source-list position is not a search-engine ranking. Login barriers and timeouts are excluded from those denominators. This provides a separate website perspective and does not validate or refute the potentially contaminated local-agent 2/2 sample; prompts, providers and search systems differ. Retrieval and final recommendation are distinct outcomes. / 本次补充获得两个完整匿名网页回答：0/2 推荐本项目，1/2 在可见来源中包含本项目。来源列表序号不等于搜索引擎排名；登录阻挡和超时不计入分母。这提供了单独的网页视角，但不能验证或推翻存在潜在干扰的本地 agent 2/2 样本，因为提示词、服务商和搜索系统不同。检索到与最终推荐是两个不同结果。

Ignored local evidence: `output/playwright/discovery-web-20261015/` contains `doubao-result.yml`, `doubao-sources.yml`, `doubao-sources.png`, `qianwen-result.yml`, `qianwen-all-sources.yml`, `qianwen.png` and `source-inventories.json` (18 and 20 links). Captures cover the synthetic public-tool query only; no sign-in credentials or real transcripts were submitted. The durable result is this section; anonymous conversation URLs are not assumed publicly shareable. No additional generation was requested to seek a preferred result. / 本地忽略证据目录包含上述回答／来源快照、截图及链接清单（分别 18、20 条）。采集仅涉及合成的公共工具查询，未提交登录凭据或真实转录；本节为长期结果，不假设匿名会话 URL 可公开分享。未为取得偏好结果要求额外生成。
