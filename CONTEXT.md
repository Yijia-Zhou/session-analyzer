# Session Analysis Context / 会话分析上下文

This context describes the shared language for turning session transcripts into readable, traceable work history. / 本上下文定义将会话转录转化为可读、可追溯工作历史时使用的共同语言。

## Language / 领域语言

### Source history / 来源历史

**Transcript Source / 转录来源**:
The source system whose storage layout and runtime semantics produced a Session Transcript, such as Codex or Claude Code. / 生成会话转录、并决定其存储布局和运行时语义的来源系统，例如 Codex 或 Claude Code。
_Avoid_: Provider, importer / 提供方、导入器

**Source Session Identity / 来源会话标识**:
The identity assigned to a Session by its Transcript Source; it is only assumed to be unique within that source's own identity boundary. / 转录来源为会话分配的标识；只假定它在该来源自身的标识边界内唯一。
_Avoid_: Analyzer ID, global session ID / 分析器 ID、全局会话 ID

**Analyzer Session Identity / 分析器会话标识**:
The opaque identity used by Session Analyzer to distinguish primary and Derived Sessions across Transcript Sources without treating a source-provided ID as globally unique. / Session Analyzer 用于跨转录来源区分主要会话和派生会话的不透明标识，不把来源分配的 ID 当作全局唯一标识。
_Avoid_: Source session ID, file name / 来源会话 ID、文件名

**Session / 会话**:
A bounded work history produced through one continuous interaction with an agent. / 通过与 agent 的一次连续交互形成的、有明确边界的工作历史。
_Avoid_: Thread, conversation / 线程、对话

**Session Transcript / 会话转录**:
The source-produced chronological record of the interactions and runtime activity that belong to a Session. / 由来源系统产生、按时间记录一个会话内交互与运行活动的记录。
_Avoid_: Log, chat history / 日志、聊天记录

**Raw Record / 原始记录**:
The smallest source-preserved entry in a Session Transcript, before entries are combined or interpreted as user-meaningful work. / 会话转录中由来源保留的最小条目，尚未被组合或解释为对用户有意义的工作。
_Avoid_: Raw Event, Raw Row, source row / 原始事件、原始行、来源行

**Raw Reference / 原始引用**:
A traceability link from a Logical Event to one of the Raw Records that supports it. / 从逻辑事件指向其依据之一——某条原始记录——的可追溯关联。
_Avoid_: Source link, raw link / 来源链接、原始链接

### Interpreted history / 解释后历史

**Logical Event / 逻辑事件**:
A user-meaningful unit of work interpreted from one or more Raw Records while preserving traceability to them. / 从一条或多条原始记录解释得到、对用户有意义且保留原始可追溯性的工作单元。
_Avoid_: Normalized record, timeline item / 归一化记录、时间线条目

**Structured Detail / 结构化详情**:
A bounded, source-interpreted presentation of one Logical Event that keeps its supporting Raw References available without becoming canonical history or a lossless payload store; Raw Record detail is a separate source-evidence surface. / 对一个逻辑事件进行的有界、由来源解释的呈现；它保留可用的支撑原始引用，但不会成为规范历史或无损 payload 存储；原始记录详情是独立的来源证据界面。
_Avoid_: Canonical detail, normalized payload / 规范详情、归一化 payload

**Detail Purpose / 详情用途**:
The source-neutral meaning of one Structured Detail section, independent of its renderer type, localized title, and producer order. / 一个结构化详情区段的来源中立含义，独立于其 renderer type、本地化标题与 producer 顺序。
_Avoid_: Section type, title category, display order / 区段类型、标题类别、显示顺序

**Detail Responsibility / 详情职责**:
The source-neutral reading responsibility of one Structured Detail section: either Primary Detail or Supplemental Detail, independently of its Detail Purpose and renderer. / 一个结构化详情区段承担的来源中立阅读职责：主体详情或补充详情；该职责独立于详情用途和 renderer。
_Avoid_: Renderer placement, section location, UI bucket / Renderer 位置、区段位置、UI 分桶

**Primary Detail / 主体详情**:
The event-specific readable representation needed to understand what happened while following chronological work history. / 沿时间顺序阅读工作历史时，为理解发生了什么所必需的事件专属可读表示。
_Avoid_: Timeline section, summary, preview / Timeline 区段、摘要、预览

**Supplemental Detail / 补充详情**:
Additional structured information useful for inspection, verification, provenance, debugging, or deeper understanding, but not required to follow chronological work history. / 对检查、核验、来源追溯、调试或深入理解有用，但并非沿时间顺序理解工作历史所必需的附加结构化信息。
_Avoid_: Inspector section, metadata, secondary content / Inspector 区段、元数据、次要内容

**Event Layer / 事件层**:
One of the product's distinct views of session history, defined by how much source activity is interpreted or exposed. / 产品查看会话历史的不同视图之一，以来源活动被解释或暴露的程度来区分。
_Avoid_: View mode, timeline mode / 视图模式、时间线模式

**Main Timeline / 主时间线**:
The default Event Layer containing the Logical Events that best represent the flow of user-relevant work. / 默认事件层，包含最能代表用户相关工作流程的逻辑事件。
_Avoid_: Main layer, logical layer / 主层、逻辑层

**Protocol Layer / 协议层**:
The Event Layer containing agent runtime and coordination activity that remains useful for inspection but does not belong in the Main Timeline. / 包含 agent 运行时及协调活动的事件层；这些活动仍有检查价值，但不属于主时间线。
_Avoid_: Debug layer, system layer / 调试层、系统层

**Raw Layer / 原始层**:
The Event Layer exposing Raw Records as source history rather than as interpreted work. / 将原始记录作为来源历史而非解释后工作加以呈现的事件层。
_Avoid_: JSON layer, source layer / JSON 层、来源层

**Folding Strategy / 折叠策略**:
A named reading policy that controls how prominently different Logical Events appear in the Main Timeline. / 一种具名的阅读策略，用于控制不同逻辑事件在主时间线中的显著程度。
_Avoid_: Profile, preset, filter / 配置、预设、筛选器

**Plan Event / 计划事件**:
A Logical Event whose user meaning is either a Plan Artifact or a Plan Update. An Observed Nested Activity can qualify under its own identity, while a Declared Nested Call or Nested Tool Projection cannot. / 用户语义属于计划产物或计划更新的逻辑事件。已观测嵌套活动可以凭自身 identity 成为计划事件，而声明的嵌套调用或嵌套工具投影不能。
_Avoid_: Planning anchor, plan-shaped display / 规划锚点、计划形态展示

**Plan Artifact / 计划产物**:
A Plan Event representing a complete proposed plan intended to be read as one coherent work artifact. / 表示一份完整 proposed plan、应作为一个连贯工作产物阅读的计划事件。
_Avoid_: Plan update, plan snapshot / 计划更新、计划快照

**Plan Update / 计划更新**:
A Plan Event representing an observed establishment or change of the execution plan, whether reported as a full update or an incremental delta. / 表示已观测到执行计划被建立或发生变化的计划事件，无论来源将其报告为完整更新还是增量变更。
_Avoid_: Plan artifact, declared plan intent / 计划产物、声明的计划意图

### Tool execution topology / 工具执行拓扑

**Tool Lifecycle Family / 工具生命周期族**:
A source-aware classification that relates the exact Raw Record types describing stages of the same category of tool execution while preserving current and historical wire identities. It does not by itself decide Main Timeline admission. / 一种面向来源的分类，用于关联描述同一类工具执行各阶段的精确原始记录类型，同时保留现行与历史 wire identity。它本身不决定是否进入主时间线。
_Avoid_: Tool kind, prefix family / 工具 kind、前缀族

**Lifecycle Phase / 生命周期阶段**:
A source-neutral position of a Raw Record within a Tool Lifecycle Family, such as start, progress, interaction, terminal, or single. It is independent of the wire suffix, outcome status, and representative-selection priority. / 原始记录在工具生命周期族中的来源中立位置，例如开始、进展、交互、终态或单条；它独立于 wire 后缀、结果状态和代表记录选择优先级。
_Avoid_: Wire suffix, status, terminal rank / Wire 后缀、状态、终态排名

**Lifecycle Correlation Identity / 生命周期关联标识**:
A typed source identity, such as a call ID, hook run ID, or event ID, that can support relating lifecycle Raw Records to the same execution. It does not by itself authorize grouping across turn or Session boundaries or choose Logical Event ownership. / 一种带类型的来源 identity，例如调用 ID、hook run ID 或事件 ID；它可以支持把生命周期原始记录关联到同一次执行，但本身不授权跨 turn 或会话分组，也不决定逻辑事件 ownership。
_Avoid_: Generic call ID, untyped ID / 泛化调用 ID、无类型 ID

**Lifecycle Outcome Status / 生命周期结果状态**:
A source-supported completion, failure, decline, or other outcome of a tool lifecycle, independent of its Lifecycle Phase and representative-selection priority. / 由来源证据支持的工具生命周期完成、失败、拒绝或其他结果；它独立于生命周期阶段和代表记录选择优先级。
_Avoid_: Phase, representative rank / 阶段、代表记录排名

**Direct Tool Call / 直接工具调用**:
A tool invocation emitted directly as a source-level call, rather than invoked inside a Code Mode Operation. / 作为来源层调用直接发出的工具调用，而不是在 Code Mode 操作内部发起的调用。
_Avoid_: Legacy tool call / 旧式工具调用

**Read Tool Call / 文件读取工具调用**:
A Direct Tool Call that asks the source runtime to return file contents without changing the file. / 一种要求来源运行时返回文件内容、但不修改该文件的直接工具调用。
_Avoid_: Other Tool Call, Patch, resource read / 其他工具调用、文件补丁、资源读取

**Code Mode Operation / Code Mode 操作**:
A tool-execution unit initiated by an outer `exec` call whose JavaScript may invoke nested tools and may continue through one or more Poll Phases. Its user-facing display name is `Code Mode tool call`; the canonical concept and stable `code_mode_operation` subtype remain unchanged. / 由外层 `exec` 调用发起的工具执行单元；其中的 JavaScript 可以调用嵌套工具，也可以通过一个或多个轮询阶段继续运行。其用户界面显示名为 `Code Mode 工具调用`；规范概念和稳定的 `code_mode_operation` subtype 保持不变。
_Avoid_: Exec event, JavaScript command / Exec 事件、JavaScript 命令

**Observed Nested Activity / 已观测嵌套活动**:
Nested tool activity whose execution is evidenced by its own source lifecycle records within a Code Mode Operation. / 在 Code Mode 操作内，由自身来源生命周期记录证明已经执行的嵌套工具活动。
_Avoid_: Declared nested call, parsed nested call / 声明的嵌套调用、解析出的嵌套调用

**Declared Nested Call / 声明的嵌套调用**:
A nested `tools.*` call site visible in Code Mode JavaScript; it records declared intent but does not prove how many times, or whether, the call executed. / Code Mode JavaScript 中可见的嵌套 `tools.*` 调用位置；它记录声明意图，但不能证明该调用是否执行或执行了多少次。
_Avoid_: Executed nested tool, observed activity / 已执行嵌套工具、已观测活动

**Nested Tool Projection / 嵌套工具投影**:
A display-only representation of a nested tool request within a Code Mode Operation. It may originate from a Declared Nested Call and may carry a result association classified as `exact`, `bounded`, or `none`. It is not a Logical Event and does not own metrics, search identity, Raw References, or an outcome. / Code Mode 操作内嵌套工具请求的仅展示表示。它可以来自声明的嵌套调用，并可带有分类为 `exact`、`bounded` 或 `none` 的结果关联。它不是逻辑事件，也不拥有指标、搜索 identity、原始引用或结果。
_Avoid_: Nested Logical Event, Observed Nested Activity / 嵌套逻辑事件、已观测嵌套活动

**Poll Phase / 轮询阶段**:
One `wait` call/output exchange that observes or advances a pending Code Mode cell as part of its owning Code Mode Operation. / 一次用于观察或推进 pending Code Mode cell 的 `wait` 调用/输出交换；它是所属 Code Mode 操作的一部分。
_Avoid_: Wait operation, wait event / Wait 操作、Wait 事件

**Operation Observation State / 操作观测状态**:
What the Session Transcript proves about whether a Code Mode Operation reached an observed terminal result, independently of whether that result succeeded or failed. / 会话转录能够证明 Code Mode 操作是否到达已观测终态；该状态独立于结果成功或失败。
_Avoid_: Success status, outcome / 成功状态、结果

**Operation Outcome Status / 操作结果状态**:
A success, failure, or decline conclusion supported by outcome-specific evidence, or neutral when no such conclusion is supported; it is independent of observation completeness. / 由结果专属证据支持的成功、失败或拒绝结论；当没有此类受支持的结论时为中性。该状态独立于观测完整性。
_Avoid_: Completion state, observed state / 完成状态、观测状态

**Escalation Evidence / 提权证据**:
Structured request evidence owned by an Observed Nested Activity that asks for execution outside the normal sandbox; it does not by itself prove that approval was granted or declined. / 由已观测嵌套活动拥有、表明其请求在普通 sandbox 之外执行的结构化请求证据；它本身不能证明审批已获准或被拒绝。
_Avoid_: Approval result, permission event / 审批结果、权限事件

### Session relationships / 会话关系

**Agent Coordination / Agent 协调**:
A Direct Tool Call that creates, observes, waits for, communicates with, delegates to, interrupts, or closes a subagent on behalf of the source Session. / 来源会话为了创建、观察、等待、通信、委派、中断或关闭 subagent 而发出的直接工具调用。
_Avoid_: Subagent activity, Subagent lifecycle / Subagent 活动、Subagent 生命周期

**Subagent Lifecycle Event / Subagent 生命周期事件**:
A source-reported fact that a subagent lifecycle transition or interaction completed; it is distinct from the Agent Coordination operation that may have requested that transition. / 来源系统报告的 subagent 生命周期转换或交互已完成这一事实；它不同于可能请求该转换的 Agent 协调操作。
_Avoid_: Agent Coordination, coordination command / Agent 协调、协调命令

**Subagent Activity Observation / Subagent 活动观察**:
A source-reported observation that an Agent Coordination action affected a subagent identified through typed event, thread, and path identities. It may be replicated across related Session Transcripts and is not a second coordination operation or a generic call-ID record. / 来源系统报告的一项观察，表示某次 Agent 协调操作影响了由带类型的 event、thread 与 path identity 标识的 subagent。它可以复制到相关会话转录中，但不是第二次协调操作，也不是泛化的调用 ID 记录。
_Avoid_: Duplicate coordination call, generic call-ID event / 重复协调调用、泛化调用 ID 事件

**Derived Session / 派生会话**:
A child Session created for delegated subagent work or review work on behalf of a source Session. / 为来源会话执行委派的 subagent 工作或审查工作而创建的子会话。
_Avoid_: Fork Session, child transcript / 分叉会话、子转录

**Fork Session / 分叉会话**:
A user-created Session that branches from an earlier Session and continues as primary work in its own right. / 用户从较早会话分支创建、并作为独立主要工作继续进行的会话。
_Avoid_: Derived Session, subagent session / 派生会话、subagent 会话

**Pointer Fork Session / 指针式分叉会话**:
A Fork Session whose source history refers to inherited parent history instead of storing that history again as child-owned Raw Records. / 来源历史通过引用继承的父会话历史、而不是把该历史再次存为 child 所有原始记录的分叉会话。
_Avoid_: Empty fork, metadata-only session / 空分叉、仅 metadata 会话

**Materialized Fork Session / 物化式分叉会话**:
A Fork Session whose physical transcript repeats the Raw Records visible from its immediate source Session at the fork point before storing its own continuation. The repeated prefix remains Raw evidence but is not current-session activity. / 物理转录先重复分叉点处从直接来源会话可见的原始记录、再保存自身续写的分叉会话。重复前缀继续作为 Raw 证据保留，但不属于当前会话活动。
_Avoid_: Duplicated child activity, merged session / 重复的 child 活动、合并会话

**Inherited Session Context / 继承会话上下文**:
History inherited through a source Session at the fork point but not owned by the current continuation, presented with explicit source traceability. A fork chain may contain activity from more than one earlier Session. / 在分叉点通过来源会话继承、但不属于当前续写的历史；展示时带有明确的来源可追溯性。分叉链可能包含来自多个较早会话的活动。
_Avoid_: Copied child history, child Raw Records / 复制的 child 历史、child 原始记录

**Earlier Branch / 较早分支**:
An inactive source Session shown beneath its sole continuing Fork Session when reliable timestamps prove that it did not continue after that fork was created. It remains independently selectable and keeps its own identity and Raw evidence. / 当可靠时间戳证明来源会话在唯一续写分叉创建后没有继续活动时，将该来源会话显示在续写会话下方。它仍可独立选择，并保留自身标识与 Raw 证据。
_Avoid_: Prompt edit, deleted branch, merged history / 提示编辑、已删除分支、合并历史

### Search boundaries / 搜索边界

**Current Session Scope / 当前会话范围**:
The search boundary containing only the selected Session's history. / 只包含所选会话历史的搜索边界。
_Avoid_: Local scope, session search / 本地范围、会话搜索

**Project Scope / 项目范围**:
The search boundary containing indexed Sessions associated with the selected repository. / 包含与所选仓库关联的已索引会话的搜索边界。
_Avoid_: Global scope, repository scope / 全局范围、仓库范围
