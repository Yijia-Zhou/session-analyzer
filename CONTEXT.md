# Session Analysis Context / 会话分析上下文

This context describes the shared language for turning session transcripts into readable, traceable work history. / 本上下文定义将会话转录转化为可读、可追溯工作历史时使用的共同语言。

## Language / 领域语言

### Source history / 来源历史

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

### Tool execution topology / 工具执行拓扑

**Direct Tool Call / 直接工具调用**:
A tool invocation emitted directly as a source-level call, rather than invoked inside a Code Mode Operation. / 作为来源层调用直接发出的工具调用，而不是在 Code Mode 操作内部发起的调用。
_Avoid_: Legacy tool call / 旧式工具调用

**Code Mode Operation / Code Mode 操作**:
A tool-execution unit initiated by an outer `exec` call whose JavaScript may invoke nested tools and may continue through one or more Poll Phases. / 由外层 `exec` 调用发起的工具执行单元；其中的 JavaScript 可以调用嵌套工具，也可以通过一个或多个轮询阶段继续运行。
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

**Derived Session / 派生会话**:
A child Session created for delegated subagent work or review work on behalf of a source Session. / 为来源会话执行委派的 subagent 工作或审查工作而创建的子会话。
_Avoid_: Fork Session, child transcript / 分叉会话、子转录

**Fork Session / 分叉会话**:
A user-created Session that branches from an earlier Session and continues as primary work in its own right. / 用户从较早会话分支创建、并作为独立主要工作继续进行的会话。
_Avoid_: Derived Session, subagent session / 派生会话、subagent 会话

### Search boundaries / 搜索边界

**Current Session Scope / 当前会话范围**:
The search boundary containing only the selected Session's history. / 只包含所选会话历史的搜索边界。
_Avoid_: Local scope, session search / 本地范围、会话搜索

**Project Scope / 项目范围**:
The search boundary containing indexed Sessions associated with the selected repository. / 包含与所选仓库关联的已索引会话的搜索边界。
_Avoid_: Global scope, repository scope / 全局范围、仓库范围
