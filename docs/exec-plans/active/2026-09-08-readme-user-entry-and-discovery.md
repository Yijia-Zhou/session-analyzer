# README user entry and discovery / README 用户入口与可发现性

Status: local README work reviewed and accepted on 2026-09-09; release-dependent follow-ups recorded below. / 状态：本地 README 工作已于 2026-09-09 审阅认可；依赖发布的后续事项见下文。

Baseline: checkout `cc09021`, reviewed on 2026-09-08. / 基线：2026-09-08 审阅的 checkout `cc09021`。

## Objective / 目标

Help a reader review what an AI did and how it did it within a current or historical session: follow readable messages and tool activity, then inspect the commands, changes, and results recorded in the transcript. Project history and search help locate an older session before the same reading task. Start the correct version and separately report indexing outcome, session count, and source diagnostics. / 帮助读者回顾当前或历史会话中 AI 做了什么、具体怎么做的：连贯阅读消息与工具活动，再查看转录中记录的命令、修改与结果。项目历史与搜索帮助先找到旧会话，再完成同样的阅读任务。启动正确版本，并分别报告索引结果、会话数和来源诊断。

Editorial principles: value first; qualifications next to the relevant claim; media must demonstrate its stated scenario; choose the smallest sufficient delivery format. / 编辑原则：价值先行、限定就近、素材必须证明场景、交付形式保持精简。

Confirmed story priority from maintainer experience: review session work first, inspect a concrete operation second, find an older session and resume reading third. Related-session provenance remains a supporting capability. Maintainer experience selects the story; unfamiliar-reader acceptance separately verifies whether the explanation communicates it. / 根据维护者经验确定故事优先级：首先回顾会话工作，其次查看具体操作，再找回旧会话继续阅读；关联会话来源追溯保留为辅助能力。维护者经验帮助选择故事，陌生读者验收另行核验表达是否传达到位。

The maintainer describes messages buried among tool-call records, substantial detail hidden behind transcript mode or repeated expansion, and long outputs or cramped unhighlighted detail making review difficult. Locating a historical session adds an earlier obstacle before the same reading difficulty. These are reported user experiences, not a verified comparison of every current Codex client/version; public copy should demonstrate the Analyzer reading experience rather than assert a universal competitor limitation. / 维护者描述的体验是：消息被工具调用记录淹没，大量细节需要进入 transcript 模式或层层展开，冗长输出或狭小且缺少高亮的详情让回顾困难；历史会话还多一道先找到它的障碍。这是用户报告的经历，不是对所有当前 Codex 客户端／版本的核验比较；公开文案应展示 Analyzer 的阅读体验，避免宣称竞品普遍存在某项限制。

The reading promise has two inseparable parts: retain the work narrative while reducing repetitive output, and make the needed tool details accessible and readable. “How” means recorded operations and results, not inferred hidden reasoning or reconstructed causality. “Current session” refers to available persisted transcript history; this plan adds no live-monitoring or automatic-refresh promise. / 阅读承诺包含两个不可分割的部分：减少重复输出干扰的同时保留工作叙述，并让需要的工具细节易于访问与阅读。“怎么做”指记录中的操作与结果，不是推断隐藏思维或重建因果；“当前会话”指可用的已持久化转录历史，本计划不新增实时监控或自动刷新承诺。

This plan delivers documentation, synthetic demonstration media, and discoverability metadata. It does not authorize publishing an npm version or changing remote repository settings. Prepare reviewable changes and exact metadata before the applicable publication step. / 本计划交付文档、合成演示素材与可发现性元数据；不构成发布 npm 版本或修改远端仓库设置的授权。先准备可审阅的变更与精确元数据，再进入相应发布步骤。

## References and baseline facts / 依据与基线事实

- [Domain vocabulary](../../../CONTEXT.md), [product spec](../../product-specs/session-transcript-analyzer.md), and [trajectory design](../../design-docs/trajectory-presentation.md). / 领域术语、产品规格与轨迹设计。
- [Documentation system](../../design-docs/documentation-system.md), [visual capture runbook](../../design-docs/readme-visual-capture-runbook.md), and [showcase source](../../../showcase/README.md). / 文档体系、视觉捕获运行手册与演示数据来源。
- [Source onboarding result](../completed/2026-09-08-source-onboarding-reliability.md), [source adapters](../../design-docs/transcript-source-adapters.md), and [release runbook](../../design-docs/npm-release-runbook.md). / 来源上手结果、来源适配器与发布运行手册。
- The existing search storyboard searches within the selected session. It does not demonstrate finding an unknown session through project search. The existing branching demonstration uses a synthetic Codex review-derived session. No Trajectory comparison storyboard exists at the baseline. / 既有搜索分镜只搜索所选会话，不能证明通过项目搜索找回未知会话；既有关联演示使用合成 Codex review 派生会话；基线没有 Trajectory 对比分镜。
- During the preceding review, direct GitHub API readback returned empty description/homepage/topics; npm registry `latest` returned `0.1.4` with Codex and Claude Code in description/keywords. Checkout package metadata also says `0.1.4`, but already names DeepSeek Harness and has an npm homepage. These are dated observations; re-read remote state before delivery. / 前一轮评估直接查询 GitHub API，简介、主页与 Topics 为空；npm registry 的 `latest` 为 `0.1.4`，简介／关键词包含 Codex 与 Claude Code。Checkout 包版本同为 `0.1.4`，但元数据已包含 DeepSeek Harness，且已有 npm homepage。这些是有日期的观察，交付前须重新查询远端状态。

## Scope and decisions / 范围与决定

- In scope: bilingual README, a short online consumer agent guide, online troubleshooting and source-development instructions, necessary navigation updates, three task demonstrations, GitHub/npm metadata, and publication/link verification. / 范围内：双语 README、简短在线消费端 agent 指南、在线故障排查与源码开发说明、必要导航更新、三个任务演示、GitHub／npm 元数据，以及发布／链接核验。
- Default to online guides. Do not add usage guides to the npm package or promise offline availability. Published-package links must point to the matching release tag or another immutable matching revision, never silently to future `main` instructions. / 默认提供在线指南，不将使用指南加入 npm 包，也不承诺离线可用。发布包链接必须指向对应 release tag 或其他匹配的不可变 revision，不得静默指向未来 `main` 指南。
- No product runtime, search defaults, adapter semantics, or domain terminology changes are required. If documentation verification exposes a product defect, record it separately; a defect that prevents a demonstrated promise remains a blocker for that promise. / 本轮不要求修改产品运行时、搜索默认值、adapter 语义或领域术语。文档验收发现产品缺陷时另行登记；妨碍演示承诺的缺陷仍会阻塞该承诺的交付。
- Defer a public landing page, source-specific tutorials, and repeated non-brand discovery observations. Do not introduce a documentation framework, MCP server, SDK, `llms.txt`, or special AI schema in this work. / 公开落地页、来源专用教程与持续非品牌发现观察留待后续；本轮不引入文档框架、MCP server、SDK、`llms.txt` 或特殊 AI schema。

## README reading path / README 阅读路径

1. Product name, explicit category, supported sources, concrete value, and local transcript handling. / 项目名、明确类别、支持来源、具体价值与本地转录处理说明。
2. Existing overview image with a short text explanation; Quick Start immediately follows. / 既有总览图及简短文字，随后立即进入 Quick Start。
3. Three task stories, each with a problem sentence, action/result explanation, and sufficient media evidence. / 三个任务故事，每个包含问题句、操作／结果说明与充分的素材证据。
4. A small set of supporting capabilities, including related-session provenance with the reusable branching demonstration, structured Code Mode display, and Codex token/cache observations with source limits. / 少量辅助特色能力，包括配可复用关联演示的会话来源追溯、Code Mode 结构化展示与带来源限定的 Codex token／缓存观测。
5. Compact source support table, data locations, and decision-relevant limits. / 紧凑来源支持表、数据位置与影响用户决定的限制。
6. Short FAQ/troubleshooting with actionable links. / 简短且带操作入口的 FAQ／故障排查。
7. Consumer agent guide entry; also expose a short link next to Quick Start. / 消费端 agent 指南入口，并在 Quick Start 旁提前提供短链接。
8. Development, architecture, performance, contribution, and license links. / 开发、架构、性能、贡献与许可链接。

Use approximately 800–1,200 English words as an initial editing budget, not a release gate. Chinese must preserve the same claims, limitations, and reading hierarchy without mirroring English sentence length. / 英文初稿以约 800–1,200 词作为编辑预算，不作为发布门槛；中文保持相同承诺、限制与阅读层级，无需跟随英文句长。

Suggested category: “Local session history viewer for Codex, Claude Code, and DeepSeek Harness.” Retain the product name. Lead with reviewing what happened within a session, then inspecting recorded operations/results, then finding older sessions by project. / 建议类别：“Codex、Claude Code 与 DeepSeek Harness 的本地会话历史查看器。”保留项目名称；先写回顾会话内发生的工作，再写查看记录中的操作／结果，最后写按项目找回旧会话。

Opening-copy direction: “See what your AI did and how it did it. Read the conversation alongside tool activity, inspect recorded commands, file changes, and results, and find earlier sessions by project when you need to revisit them.” / 开头文案方向：“回看 AI 做了什么、具体怎么做的。连贯阅读对话与工具活动，查看记录中的命令、文件修改和执行结果；需要回顾更早的工作时，按项目浏览和搜索历史会话。”

State that the app reads existing transcripts locally without modifying or uploading their contents. Do not promise zero network requests, automatic causal explanations, agent execution, code restoration, or a complete Git audit. Bound the product naturally through its positive positioning; do not turn the opening into a warning list. / 说明应用在本地读取已有转录，不修改或上传其内容；不承诺零网络请求、自动因果解释、执行 agent、恢复代码或完整 Git 审计。通过正面定位自然界定产品，避免把开头写成警告清单。

## Quick Start and support / 快速开始与支持说明

- Put recommended Node.js 24 before commands; retain the complete installed-runtime range in support information. Keep the exact source-development Node/npm policy in the development guide, unchanged. / 将推荐 Node.js 24 放在命令之前，在支持说明保留完整安装后运行时范围；精确源码开发 Node／npm 策略原样保留在开发指南。
- After the target version is publicly verified, present three alternative startup commands: `npx session-analyzer`, `npx session-analyzer --source claude-code`, and `npx session-analyzer --source deepseek-harness`. State that the reader chooses one. Follow with `http://127.0.0.1:17890/`, project selection, session opening, and switching Search options from current session to entire project. / 目标版本公开核验后，展示三个可选启动命令并明确只需选择一个；随后说明本地地址、选择项目、打开会话，以及在 Search options 中将当前会话范围切换为整个项目。
- Keep explicit `--repo` configuration and a Windows path example one level below the default path. `--repo` names the user's target project; the Analyzer checkout/install directory and transcript root are distinct. / 将显式 `--repo` 配置与 Windows 路径示例放在默认路径的下一层；`--repo` 指用户目标项目，Analyzer checkout／安装目录与转录根是不同路径。
- The source table contains Codex `~/.codex` / `--codex-home`, Claude Code `~/.claude` / `--claude-home`, and DeepSeek Harness `~/.dsh/sessions` / `--dsh-home`. Limit rows/columns to initial-use decisions. / 来源表包含三个来源的默认目录与对应自定义参数，行列仅覆盖首次使用决定。
- Retain one-active-source/no-mixed-index behavior, runtime source switching, Codex-specific metrics, unread external Claude payloads, DeepSeek Zstd capability requirements, and long-session loading/memory guidance. Leave event-family inventories and Phase 2A–2D details in existing technical documents. / 保留单一活动来源／不混合索引、运行时来源切换、Codex 专属指标、Claude 外置载荷不读取、DeepSeek Zstd 能力要求及长会话加载／内存指引；事件族清单与 Phase 2A–2D 细节留在既有技术文档。
- Keep localhost binding and the consequence of overriding it near advanced host configuration. / 在高级 host 配置旁保留 localhost 默认绑定及修改绑定的影响。

## Demonstration contracts / 演示契约

| Task / 任务 | Required evidence / 必需证据 | Media decision / 素材决定 |
| --- | --- | --- |
| Review what happened in this session / 回顾这次会话做了什么 | Show a tool-heavy synthetic segment with readable messages and tool activity in folded Timeline and Trajectory, using comparable loaded coverage. The reader can follow recorded work in order despite long output. / 展示工具密集合成片段，在折叠 Timeline 与 Trajectory 中均可阅读消息及工具活动，加载覆盖可比较；即使存在长输出，读者仍能按顺序回顾记录中的工作。 | Prefer two comparison screenshots plus text; Timeline is the default reading path and Trajectory the optional compact presentation. No new GIF required. / 优先两张对比截图配文字；Timeline 是默认阅读路径，Trajectory 是可选紧凑呈现，不要求新 GIF。 |
| Inspect how a concrete operation was performed / 查看一次具体操作怎么做的 | From that segment, select a command or patch and show its recorded request/change and result in readable structured detail while retaining session context. Verify highlights, text space, and navigation at actual README scale. / 从同一片段选择命令或补丁，在保留会话上下文时展示记录中的请求／修改与结果；在真实 README 尺度检查高亮、文字空间与导航。 | Reuse a suitable detail frame from the overview or first task; add one detail screenshot only if needed. A collapsed view alone does not prove this task. / 复用总览或第一个任务中合适的详情画面，仅必要时补一张详情图；只有折叠画面不能证明此任务。 |
| Find an older session and continue reviewing / 找回旧会话继续回顾 | Start in A; switch to entire-project search; find a query occurring only in B; open B and its matching event/detail, then show surrounding session context. A and B are distinct sessions in the same project. / 从 A 开始，切换整个项目搜索，找到只出现在 B 的查询内容，打开 B 及对应事件／详情，再呈现周围会话上下文；A、B 属于同一项目的不同会话。 | New short capture using synthetic showcase data; a GIF or ordered image sequence must show both retrieval and resumed reading. / 使用合成 showcase 数据补充短演示，用 GIF 或有序截图同时展示找回与继续阅读。 |

Supporting provenance demonstration: inspect inherited context in the existing Codex review-derived example, return to its source session, and verify a Raw Reference entry. Reuse the branching capture with an accurate source-specific caption; add a small supplementary image only if a newly claimed navigation step needs evidence. It is not one of the three lead task stories. / 辅助来源追溯演示：在既有 Codex review 派生示例查看继承上下文、返回来源会话并核验原始引用入口。复用关联素材并准确标注来源；仅当新增承诺的导航步骤缺少证据时补小图。它不再属于三个首要任务故事。

Use the existing synthetic `acme/task-board` showcase and normal adapter/UI flow. Keep scenarios and storyboards tracked, generated materialization/candidate captures under ignored `output/`, and private transcripts out of assets. Add a uniquely identifiable B-only target that does not leak into A through copied context. / 使用既有合成 `acme/task-board` showcase 与正常 adapter／UI 路径；跟踪场景与分镜，将生成数据／候选素材保存在忽略的 `output/`，不使用私人转录。新增只属于 B 的唯一目标，避免通过复制上下文泄漏到 A。

Trajectory copy leads with value: “When tool calls get noisy, switch to Trajectory to review conversation and tool activity in a compact view.” Then qualify: “The view shows currently loaded events; load more to continue through a long session.” / Trajectory 文案先写价值：“工具调用太多时，切换到 Trajectory，用紧凑视图回看对话与工具活动。”再限定：“视图显示当前已加载的事件；长会话可继续加载更多。”

Every asset needs nearby explanatory text, meaningful alt text, readable README-scale framing, and a source label where capability might otherwise be generalized. Preserve the existing overview unless inspection identifies an inaccurate or unreadable element. / 每份素材都需要相邻说明、有效替代文本及 README 尺度可读性；可能被推广到全部来源的能力就地标注来源。既有总览图无不准确或不可读问题时保留。

Follow the existing capture runbook's human review boundary before promoting candidates into final public media. Prepare the full candidate comparison and captions before that review. / 将候选素材晋升为最终公开素材前，遵循既有捕获运行手册的人工审阅边界；审阅前准备完整候选对比与图注。

## Document ownership / 文档归属

- `README.md` and `README.zh-CN.md`: product entry, first run, concise limitations, and navigation. / 产品入口、首次运行、简短限制与导航。
- New `docs/usage/agent-quickstart.md`: one bilingual, version-aware task for starting and verifying the user's selected source/project; canonical owner of detailed consumer-agent startup/acceptance instructions. / 新增双语且注明版本的完整任务指南，负责替用户启动所选来源／项目及验收的详细规则。
- New `docs/usage/troubleshooting.md`: bilingual actions for missing/zero history, source roots, diagnostics, missing Zstd, indexing failures, long sessions, and aggregate logging/OOM recovery. Preserve the existing advice to attempt normal indexing before changing heap settings. / 新增双语故障操作指南，涵盖无／零历史、来源根、诊断、缺失 Zstd、索引失败、长会话、聚合日志与 OOM 恢复；保留先正常索引、仅出现相应失败再调整 heap 的建议。
- New `docs/development.md`: move the existing exact Node/npm bootstrap and install-script policy, build/test/package commands, and repository layout here; link to the release runbook. / 新增开发说明，迁入既有精确 Node／npm bootstrap、安装脚本策略、构建／测试／打包命令及仓库布局，链接发布运行手册。
- Existing lifecycle/performance design documents remain owners of measurement samples, environments, numbers, cache weights, and inference boundaries. Reuse existing evidence instead of copying another measurement catalog. / 既有生命周期／性能设计文档继续负责量测样本、环境、数字、缓存权重与推断边界，复用已有证据，不新增重复量测目录。
- Update `docs/README.md`, documentation-system design, and AGENTS navigation to explain usage/development document roles. Replace detailed consumer-agent duplication in AGENTS with the canonical guide link while retaining concise repository-development startup guidance. / 更新文档导航、文档体系设计及 AGENTS 导航，说明使用／开发文档职责；AGENTS 中重复的消费端 agent 细节改为规范指南链接，保留简短仓库开发启动说明。
- Update product specifications only if their user-visible contract needs correction; the README rewrite itself does not create new runtime behavior. Keep all edited bilingual facts synchronized. / 仅当用户可见契约需要修正时更新产品规格；README 重写本身不创建新运行时行为；同次更新所有修改涉及的双语事实。

## Consumer agent result contract / 消费端 agent 结果契约

Record the actual installed version or checkout commit, Node version, selected source, intended repository, source root, and local URL. Verify the process actually uses those values; registry `latest` alone is not installed-version evidence. / 记录实际安装版本或 checkout commit、Node 版本、来源、目标项目、来源根及本地 URL；核验进程实际使用这些值，registry `latest` 不能单独证明已安装版本。

Poll current internal `/api/project/status` with a bounded deadline. Treat `queued`/`running`, `cancelled`, `failed`, and `succeeded` distinctly. Report `job.error` and `job.errorCode` on failure. On success inspect `/api/state`: `projectSelected`, intended `repoRoot`, `totals.sessionCount`, and `sourceDiagnostics`. HTTP readiness alone is insufficient; unselected `/api/state` HTTP 409 means project selection is required. These endpoints are version-specific internal checks, not a stable public API. / 对当前内部状态接口进行有界轮询，区分排队／运行、取消、失败与成功；失败报告错误及错误码，成功核验项目选择、目标路径、会话数及诊断。HTTP 就绪不充分；未选项目的 state 409 表示需要选择项目；接口是版本相关内部检查，不是稳定公共 API。

Report task outcome, count, diagnostics, and actual reading verification separately. Never equate diagnostic count with skipped-artifact count unless the data supports that mapping. / 分别报告任务结果、数量、诊断与实际阅读核验；除非数据证明对应关系，不得把诊断条数等同于跳过工件数。

| Outcome / 结果 | Required report / 必需报告 |
| --- | --- |
| Completed, readable history, no diagnostics / 完成、有可读历史、无诊断 | Count plus an actually opened session and search hit; no diagnostics observed within the implemented coverage. / 数量、实际打开的会话及搜索命中，并说明在实现覆盖内未观察到诊断。 |
| Completed, readable history and diagnostics / 完成、有可读历史且有诊断 | Preserve partial-success meaning: readable count, diagnostic codes/summary, verified skipped artifacts if available, and working reading path. / 保留部分成功语义，报告可读数量、诊断码／摘要、可核实的跳过工件情况与有效阅读路径。 |
| Completed with zero sessions / 完成但零会话 | State zero explicitly, include diagnostics if present, and check source/root/project matching. Do not conclude that the user has no history. / 明确零会话，附带已有诊断并核对来源／根／项目匹配；不推断用户没有历史。 |
| Failed / 失败 | Error/code and appropriate retry or configuration action; a retained old index does not mean the attempted refresh succeeded. / 错误／错误码与相应重试或配置操作；保留旧索引不代表本次刷新成功。 |
| Pending, cancelled, or selection required / 等待、取消或待选项目 | State the actual condition and next action without claiming completion. / 报告实际状态及下一步，不声称完成。 |

Place the empty-result advice in troubleshooting and the agent guide: absence of diagnostics alone does not prove correct configuration or complete reading coverage. DeepSeek-owned root/artifact diagnostics must not be described as equally covering every Codex/Claude failure path. / 将零结果指引放在故障排查与 agent 指南：没有诊断不能单独证明配置正确或读取覆盖完整；DeepSeek 所有的根／工件诊断不能描述为同等覆盖所有 Codex／Claude 失败路径。

## Metadata and release lifecycle / 元数据与发布生命周期

Prepare GitHub description: “Local session history viewer for Codex, Claude Code, and DeepSeek Harness. Review what your AI did, inspect tool calls and results, and find past sessions by project.” Set GitHub homepage to the repository README while no public product page exists. Keep the existing npm homepage. / 准备上述 GitHub 简介，按回顾工作、查看工具调用及结果、找回旧会话的顺序表达；没有公开产品页时，将 GitHub homepage 指向仓库 README，保留既有 npm homepage。

Prepare relevant GitHub topics: `codex`, `claude-code`, `deepseek-harness`, `ai-agents`, `coding-agents`, `session-history`, `transcript-viewer`, `local-first`, `jsonl`. Preserve useful npm keywords and add purpose terms such as `history`, `search`, and `coding-agent`; rewrite npm description around readable session work, tool inspection, and project history. Record the final exact payload during implementation. These are relevance choices, not measured search-volume claims. / 准备上述真实相关 Topics；保留有效 npm 关键词，补充用途词并围绕可读会话工作、工具检查与项目历史改写简介；实施时记录最终精确载荷。这些是相关性选择，不是搜索量研究结论。

1. Before release: re-check the actual public package; put a temporary branch-capability note beside affected commands and link the exact source-development path. Do not bump versions just to make documentation appear consistent. / 发布前：重查公开包，在受影响命令旁保留临时分支能力提示，并链接准确源码运行路径；不为文档表面一致而提前改版本。
2. Release preparation: coordinate with the existing release runbook. Prepare the final release README and guides in the candidate; pin online guide links to the intended matching release tag or an existing immutable revision. Check intended-tag targets against the release source locally; mark public resolution pending until the tag exists. A staged artifact is not a public release. / 发布准备：与既有发布运行手册协调，在候选制品准备最终 README／指南，并固定在线链接版本；预期 tag 的目标先对发布来源作本地检查，tag 存在前公开解析仍记为待核验；staged 制品不算公开发布。
3. After authorized publication and public verification: the default README leads with the published success path and removes the temporary branch warning. Verify npm README/metadata and exact-version installation, plus public guide/media links. GitHub README changes alone do not update npm README. / 授权发布并公开核验后：默认 README 以已发布成功路径为主，移除临时分支提示；检查 npm README／元数据、精确版本安装与公开指南／素材链接；仅修改 GitHub README 不会更新 npm README。
4. Track repository content, approved media, remote metadata, and public package verification separately. Do not report external delivery complete based on local edits or merge alone. / 分别跟踪仓库内容、获批素材、远端元数据及公开包核验；不能仅因本地修改或合并就报告外部交付完成。

## Milestones / 里程碑

- [x] M1 — Inventory final claims against actual version/source behavior; draft bilingual opening and reading path; specify A/B target and media storyboards. / 对照实际版本／来源盘点承诺，起草双语开头与阅读路径，指定 A／B 目标与素材分镜。
- [x] M2 — Rewrite both READMEs; create usage/development guides; relocate existing technical content and update navigation; prepare exact metadata and version-aware links. / 重写双语 README，创建使用／开发指南，迁移技术内容与更新导航，准备精确元数据及版本链接。
- [x] M3 — Capture Timeline/Trajectory reading and concrete operation detail, then cross-session search that returns to reading; audit/reuse branching and overview assets; assemble complete candidate previews and captions for the existing media review boundary. / 捕获 Timeline／Trajectory 阅读及具体操作详情，再捕获回到阅读的跨会话搜索；审阅复用关联／总览素材，准备完整候选预览与图注供既有素材边界审阅。
- [x] M4 — Complete functional reading, outcome reporting, bilingual consistency, and local/rendered link checks; record fresh-context agent feedback and the maintainer's acceptance of the final preview. / 完成实际阅读、结果报告、双语一致性与本地／渲染链接检查，记录无历史上下文 agent 反馈及维护者对最终预览的认可。
- [ ] M5 — Complete the two release-dependent follow-ups below: installation/demo alignment and post-release discovery observations. / 完成下文两项依赖发布的后续工作：安装／演示对齐与发布后发现效果观察。

M1 precedes prose/media implementation; M2 and M3 may proceed independently once their claims agree. M4 uses the assembled result. M5 aligns the release candidate first and observes the public result after actual publication. / M1 先于文案／素材实施；承诺一致后 M2 与 M3 可独立推进；M4 验收组装结果；M5 先对齐发布候选，再在实际发布后观察公开结果。

## Acceptance / 验收

### Value recognition / 价值识别

Give a reader familiar with coding agents but unfamiliar with this project only the opening and three task sections. Without coaching, ask them to explain what it does, a situation in which they would open it, and its boundaries. Record their answers and which text or image informed them. / 只给熟悉 coding agent、不了解本项目的读者看开头与三个任务段；不提示答案，请其解释用途、会在何时打开及能力边界，记录回答及其依据的文字／图片。

Pass when the reader identifies reviewing what an AI did within a current or historical session as the main value, understands that both readable work context and inspectable tool details are available, and recognizes project search as a way to return to old work. They name at least one concrete personal use case without inferring agent execution, automatic causal explanation, code recovery, or complete Git auditing. A response describing only a search/archive tool or only output hiding signals an editorial failure. If only a fresh-context agent proxy is available, label that evidence as a proxy and leave human value recognition unverified; do not claim a conversion uplift from this test. / 通过条件：识别回顾当前或历史会话中 AI 做过的工作是主要价值，理解既能连贯阅读工作上下文也能查看工具细节，并认识到项目搜索帮助返回旧工作；能提出至少一个具体使用场景，未误解为执行 agent、自动因果解释、恢复代码或完整 Git 审计。若只理解成搜索／归档工具或只会隐藏输出，说明表达未通过。若只有无历史上下文 agent 代理，须标明代理证据，人工价值识别仍为未验证；不得据此宣称转化率提升。

### First successful use and recovery / 首次成功使用与恢复

- Follow public entry instructions in a clean consumer environment using the correct version. Verify each advertised source startup with source-appropriate synthetic history and correct default/custom root examples. / 在干净消费环境按公开入口运行正确版本，使用对应来源合成历史核验所宣称来源启动及默认／自定义根示例。
- Actually read a known synthetic session segment and identify the recorded work from its messages/tool activity; inspect one operation and explain its recorded command/change and result, returning to the surrounding work. Then perform the A-to-B entire-project search and resume reading at the matching event/detail. Merely opening a pane, counting sessions, or checking root HTTP readiness does not pass. / 实际阅读已知合成会话片段，从消息／工具活动辨认记录中的工作；查看一次操作，说明其记录中的命令／修改及结果，并返回周围工作。随后完成 A 到 B 的整个项目搜索，从命中事件／详情继续阅读。仅打开面板、计数会话或检查根 HTTP 就绪不能通过。
- Exercise readable success, readable success with diagnostics, zero sessions with and without diagnostics, and failure using existing suitable fixtures; verify bounded pending/cancellation reporting as applicable. Use DeepSeek fixtures for its diagnostic coverage, not a fabricated all-adapter promise. / 使用适合的既有 fixture 覆盖可读成功、带诊断可读成功、带／不带诊断的零会话及失败；适用时核验有界等待／取消报告；用 DeepSeek fixture 验证其诊断覆盖，不制造全 adapter 承诺。
- Review English and Chinese commands, feature qualifications, source labels, FAQ actions, and version statements together. / 同时审查中英文命令、能力限定、来源标签、FAQ 操作及版本表述。

### Publication integrity and discovery / 发布完整性与发现

- Check local Markdown targets/anchors, GitHub and npm rendered links/images, and guide links at the intended immutable version. Explicitly confirm guides are online-only and are not promised in the tarball. / 检查本地 Markdown 目标／锚点、GitHub 与 npm 渲染链接／图片，以及对应不可变版本的指南链接；明确指南仅在线，不承诺位于 tarball。
- Read back GitHub description/homepage/topics and public npm version/description/keywords/README after delivery. Keep publication-dependent checks pending until externally observable. / 交付后回读 GitHub 简介／主页／Topics 与公开 npm 版本／简介／关键词／README；发布依赖项在外部可观察前保持待验证。
- Record a small set of non-brand query hypotheses for later observation; visibility/ranking is not a release gate or a promised outcome. / 记录一组非品牌需求查询假设供后续观察；可见性／排名不作为发布门槛或承诺结果。
- Documentation-only edits require content/link/media/consumer-path checks, not new tests mirroring prose. If packaging changes become necessary, run the applicable package smoke; the normal release gates remain governed by the release runbook. / 纯文档修改执行内容／链接／素材／消费路径检查，不新增照抄文案的测试；若确需修改打包，执行相应 package smoke；正常发布门槛仍由发布运行手册规定。

## Risks and completion record / 风险与完成记录

Primary risks are attractive copy unsupported by media, qualifications dominating the opening, guide/version drift, duplicated instructions, and counting partial or zero results as unrestricted success. Resolve each against its acceptance evidence rather than adding more README sections. / 主要风险是素材无法证明吸引人的文案、限定压过开头价值、指南／版本漂移、重复说明，以及将部分或零结果当成无条件成功；按对应验收证据解决，不以不断增加 README 章节替代。

### Implementation evidence, 2026-09-08 / 实施证据，2026-09-08

- Both READMEs and three online guides are written; document navigation and release/capture runbooks are updated. The temporary public-package examples now pin `0.1.4`, and the source guide includes the verified public `towards-0.2.0` clone path. Final release link pinning remains a release gate. / 已完成双语 README、三份在线指南，以及导航与发布／捕获运行手册；临时公开包示例固定 `0.1.4`，源码指南补充已核验公开分支克隆路径；最终发布链接固定仍属于发布门槛。
- Node `v24.18.1`, npm `12.0.2`; generated browser assets are current. Existing showcase tests: 3 passed. Source onboarding and adapter conformance: 27 passed. Focused browser onboarding: 4 passed, covering readable diagnostics, failed startup/retry, zero-result distinctions, and recovery after discovery errors. / 已核验工具链及生成资源；既有 showcase 测试 3 项、来源上手与 adapter 一致性 27 项、定向浏览器上手 4 项通过，覆盖可读诊断、失败／重试、零结果区分及发现错误后恢复。
- Installed-package smoke passed for all three sources. Codex intentionally indexed zero sessions without diagnostics; Claude Code and DeepSeek each indexed one synthetic session without diagnostics. This verifies the current branch tarball, not publication or the public npm `0.1.4` artifact. / 三来源安装包 smoke 通过；Codex 场景有意返回零会话且无诊断，Claude Code 与 DeepSeek 各返回一个合成会话且无诊断。此证据对应当前分支 tarball，不证明已发布或公开 npm `0.1.4` 的行为。
- The isolated Codex showcase indexed the intended `acme/task-board` project: 6 sessions, zero diagnostics. Real browser actions read the parent Timeline/Trajectory and selected patch, then searched `npm test -- project-switch` in A (no matches), switched to project scope (one session/one event), opened B, expanded its command and read `8 tests passed` plus surrounding messages. / 独立 Codex showcase 对预期项目索引得到 6 个会话、零诊断；真实浏览器阅读父会话及补丁，随后完成 A 内零命中、项目范围单会话／单事件命中、打开 B、展开命令并读到结果与前后消息。
- Candidate media: three 1080×910 PNGs and one 1240×900, approximately 11-second GIF under ignored `output/readme-capture/entry/`. Both full README previews load all six referenced images through the candidate mapping; the 1050px browser/960px text-column preview has no horizontal document overflow. Candidates are not yet promoted to `docs/assets/readme/`. / 候选素材为三张 PNG 与一份约 11 秒 GIF，位于忽略的候选目录。完整 README 预览经候选映射加载全部六份引用素材；1050px 浏览器／960px 正文预览无文档横向溢出。候选尚未晋升正式素材目录。
- A fresh-context reader agent identified session-work reading and operation inspection, with accurate boundaries. It flagged an OOM retry example that could switch program/source, a version ambiguity, and missing final media. The command/source example and pinned-version guidance were corrected; media awaits human review. This is proxy evidence; unfamiliar-human value recognition remains unverified. / 无历史上下文的读者代理识别到会话工作阅读及操作检查，能力边界理解准确；指出 OOM 重试可能切换程序／来源、版本歧义与正式素材缺失。前两项已修正，素材待人工审阅。此为代理证据，陌生人价值识别仍未核验。
- Final local checks: 11 edited entry/guide documents, 73 relative targets checked, no unexpected missing targets; four intentional final-media references await promotion from verified candidates. English README is approximately 1,190 whitespace-delimited words; bilingual command blocks agree; all documented PowerShell blocks parse; diff whitespace check passes. Both language previews load six images and show no horizontal document overflow. / 最终本地检查：11 份入口／指南文档、73 个相对目标无意外缺失，四个正式素材引用待从已核验候选晋升；英文约 1,190 词，双语命令一致，全部 PowerShell 示例可解析，diff 空白检查通过；双语预览均加载六份素材且无文档横向溢出。

### Exact remote metadata payload / 精确远端元数据载荷

Prepared for GitHub About, not applied. The current connector exposes no repository-settings write operation; no GitHub CLI/token or authenticated browser session was available. Do not infer write capability from file/PR tools or change connection permissions. / 已准备 GitHub About 内容，尚未应用。当前连接未暴露仓库设置写操作，环境也没有可用 GitHub CLI／token 或已登录浏览器；不得从文件／PR 工具推断设置写入能力，也不调整连接权限。

```json
{
  "description": "Local session history viewer for Codex, Claude Code, and DeepSeek Harness. Review what your AI did, inspect tool calls and results, and find past sessions by project.",
  "homepage": "https://github.com/Yijia-Zhou/session-analyzer#readme",
  "topics": ["codex", "claude-code", "deepseek-harness", "ai-agents", "coding-agents", "session-history", "transcript-viewer", "local-first", "jsonl"]
}
```

The corresponding npm description/keywords are updated locally in `package.json`; version and homepage are unchanged. Public GitHub metadata and npm README/metadata publication remain pending, with baseline readback reconfirming npm `0.1.4` and empty GitHub About fields. / 对应 npm 简介／关键词已在本地更新，版本及 homepage 不变；公开 GitHub 元数据及 npm README／元数据发布待完成，最新基线回读再次确认 npm `0.1.4` 与空 GitHub About 字段。

### Approved media delivery, 2026-09-09 / 获认可素材交付，2026-09-09

- The maintainer explicitly reviewed and approved the four new assets. Copied all four from `output/readme-capture/entry/` into `docs/assets/readme/` without alteration; SHA-256 matches the approved candidates for every file. / 维护者明确审阅并认可四份新素材；全部原样复制至正式素材目录，每份 SHA-256 均与获认可候选一致。
- Rechecked both READMEs and the related guides: 73 relative targets, no missing targets or pending media references, and matching bilingual command blocks. `npm pack --dry-run --json --ignore-scripts` includes all four new assets while leaving online usage guides outside the package. / 重新核验双语 README 及相关指南：73 个相对目标无缺失、无待补素材引用，双语命令一致；npm 打包预演包含四份新素材，在线使用指南仍不入包。
- The P2 review finding about absent demonstration assets is resolved in the working tree. This approval covers media selection; it does not establish an unfamiliar-reader test or authorize a git commit/npm publication. / 素材缺失的 P2 review finding 已在工作树中解决；本次认可覆盖素材选择，不等同于陌生读者测试，也不构成 git 提交或 npm 发布授权。

The maintainer reviewed the updated preview on 2026-09-09 and reported no issues. Local content and media acceptance is complete, supported by the recorded functional checks and fresh-context agent review. This is maintainer acceptance, not a claimed blinded unfamiliar-human study. The two release-dependent follow-ups below remain open. / 维护者于 2026-09-09 审阅更新后的预览并确认没有问题；结合已记录的功能核验与无历史上下文 agent 审查，本地内容与素材验收完成。这是维护者认可，不声称完成了陌生人盲测。下文两项依赖发布的后续事项保持未完成。

### Entry clarity follow-up, 2026-09-09 / 入口清晰度跟进，2026-09-09

- Moved the concrete pain of messages buried by tool calls and long outputs into the first paragraph, alongside the reading/inspection benefit. Added short first-screen links to startup and the three tasks; replaced repeated pain text in the first demonstration with the actual failed-test/follow-up-patch story. / 将消息被工具调用及长输出淹没的具体痛点前置到首段，与阅读／检查收益一起呈现；首屏加入启动及三个任务的短导航；第一个演示用实际失败测试／补丁修复故事替换重复痛点描述。
- Added a copyable consumer-agent request using the public repository URL and requiring version/source-aware startup and reading verification. Explicitly tell readers to use remembered content from their own history instead of the synthetic demonstration query. Approved media is unchanged. / 新增可复制的消费端 agent 请求，使用公开仓库 URL，要求匹配版本／来源启动并实际核验阅读；明确提示搜索自己历史中的内容，而非照抄合成演示查询。获认可素材未修改。
- Public entry readback still shows empty GitHub description/homepage/topics, npm `latest` at `0.1.4` with the old Codex/Claude metadata, and the default-branch README instead of this working-tree revision. Publishing the reviewed entry and matching metadata is the next distribution priority; further keyword repetition cannot substitute for delivery. / 公开入口回读仍显示 GitHub 简介／主页／Topics 为空，npm `latest` 为使用旧 Codex／Claude 元数据的 `0.1.4`，默认分支 README 尚非本工作树修订。下一项传播优先工作是交付审阅后的入口及匹配元数据；继续重复关键词无法替代交付。
- Recorded non-brand query hypotheses: `Codex session history viewer tool calls local` and `Claude Code history viewer tool output search`. A small search sample is wording/discovery exploration, not evidence of indexing status, ranking, or increased traffic. Revisit after the public entry changes are observable. / 记录上述两条非品牌需求查询假设；小样本搜索只用于措辞／发现探索，不证明收录状态、排名或流量增长。公开入口变更可见后再复查。
- Validation: all 73 local link targets resolve, eight first-screen anchors match their headings, bilingual shell commands agree, and diff whitespace checks pass. No runtime behavior or package file boundary changed. / 验证：73 个本地链接目标有效、八个首屏锚点与标题匹配、双语 shell 命令一致、diff 空白检查通过；未改变运行行为或包文件边界。

### PR integration test migration, 2026-09-09 / PR 集成测试迁移，2026-09-09

- Confirmed four stale assertion groups after the README migration: promotional metadata, source setup instructions, the exact tarball manifest, and README memory measurements. Moved the checks to their owning guides/designs, retained strict toolchain order and OOM recovery safeguards, and added the four approved assets to the exact manifest. Metadata checks now validate a nonempty description, unique formatted keywords, and required source names instead of freezing promotional wording. / 确认 README 迁移后四组断言过时：宣传元数据、源码安装说明、精确 tarball 清单及 README 内存量测。将检查迁至所属指南／设计，保留严格工具链顺序与 OOM 恢复边界，将四份已批准素材加入精确清单。元数据检查改为验证描述非空、关键词格式及唯一性、必要来源名称，不再锁死宣传措辞。
- Added the relevant npm keywords `ai-agents`, `session-history`, `transcript-viewer`, and `local-first`; the approved README narrative and package version remain unchanged. / 补充上述四个相关 npm 关键词；已认可的 README 叙事与包版本保持不变。
- Validation on Windows, Node 24.18.1 / npm 12.0.2: focused tests 25/25, full Node suite 1046/1046, generated build check passed. The combined `release:check` reached package smoke but npm registry access returned sandbox `EACCES`; stopped that attempt and reran `test:package` with network access, passing all three sources. Thus all constituent non-browser release checks passed, without claiming a new remote CI matrix result. / Windows、Node 24.18.1／npm 12.0.2 验证：聚焦测试 25/25、全部 Node 测试 1046/1046、生成资源检查通过。组合 `release:check` 到安装包冒烟时因沙箱访问 npm registry 返回 `EACCES`，停止该次运行并在允许联网的环境重跑 `test:package`，三个来源全部通过。因此非浏览器发布检查的各组成项均通过，不声称远端 CI 矩阵已重新通过。

## Deferred follow-ups / 后续事项

### 1. Align installation with the demonstrated experience / 对齐安装与演示体验

- [ ] During the release that includes the demonstrated capabilities, follow the [release runbook](../../design-docs/npm-release-runbook.md) to replace the temporary `0.1.4`/source-checkout split with a clear published-package Quick Start for all supported sources. Remove branch-preview labels only when the corresponding release is publicly available. / 发布包含演示能力的版本时，按发布运行手册将临时 `0.1.4`／源码分流改为清楚的发布包 Quick Start，覆盖全部受支持来源；对应版本公开可用后才移除分支预览标识。
- [ ] In a clean consumer environment, use the documented command and exact release artifact to open a session, read Timeline/Trajectory, inspect an operation, and complete an A-to-B project search. Verify that the demonstrated controls and supported source choices are actually present. / 在干净消费环境中，按文档命令运行精确发布制品，打开会话、阅读 Timeline／Trajectory、查看操作并完成 A 到 B 的项目搜索；核验演示控件与支持来源选项实际存在。
- [ ] Check both languages and matching-version guide/media links. Record the tested version and observed result; close this item only after the shortest public startup path delivers the advertised reading experience. / 核验双语说明及匹配版本的指南／素材链接，记录测试版本与实际结果；最短公开启动路径能获得所宣称阅读体验后才关闭本项。

### 2. Observe discovery after release / 发布后观察发现效果

- [ ] Begin once the reviewed public entry and matching release are available. Take an initial observation, then repeat approximately two to four weeks later; do not treat a single search as an effectiveness verdict. / 审阅后的公开入口与匹配发布版本可用后开始，记录首次观察，并在约两至四周后复查；不以单次搜索判定优化效果。
- [ ] Use a small, stable set of non-brand needs in both languages: `Codex session history viewer tool calls local`, `Claude Code history viewer tool output search`, `查看 Codex 会话中 AI 做了什么`, and `搜索 Claude Code 历史会话和工具调用`. Use equivalent natural-language requests with a search-capable AI agent, without supplying the product name or repository URL. / 使用上述少量固定中英文非品牌需求查询；向具备搜索能力的 AI agent 提出等价自然语言请求，不提供项目名称或仓库 URL。
- [ ] Record date, query, search engine or agent/model and whether web search was enabled, relevant returned links, whether the project was found, and the stated recommendation reason. Check source/version accuracy and whether it is understood as a readable work-history viewer rather than an agent runner, code-recovery tool, or automatic explanation service. / 记录日期、查询、搜索引擎或 agent／模型及是否启用网络搜索、相关返回链接、是否发现项目与推荐理由；核验来源／版本准确性，以及是否理解为可读工作历史查看器，避免误解为 agent 执行器、代码恢复工具或自动解释服务。
- [ ] Distinguish not found, found but inaccurately described, and found with an accurate use case. Fix reproducible content/entry gaps and record the change for the next observation. Report samples and uncertainty; do not infer indexing status, ranking improvement, or traffic growth from isolated appearances or absences. / 区分未发现、发现但描述不准确、发现且使用场景准确；修正可复现的内容／入口缺口，记录变更供下次观察对照。报告样本与不确定性，不从偶发出现或缺席推断收录状态、排名提升或流量增长。
