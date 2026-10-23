# pi history navigation / pi 历史导航

The pi 1.4.0 reader treats a native session as a tree of saved work. The motivating workflow is a failed approach A, navigation back with a summary, a successful approach B, and later continuation. These additions make that history navigable without changing canonical root-to-leaf ownership. / pi 1.4.0 阅读器将原生会话视为保存工作历史的树。核心场景是方案 A 失败、带摘要切回、方案 B 成功及之后继续开发；本增量让这段历史可导航，不改变 canonical 根到叶归属。

## Current-history entry references / 当前历史 entry 引用

`pi-entry-v1` references contain a scope digest of the admitted source root and project, relative indexed artifact identity, native session ID, entry ID, exact physical-line digest, and optional logical projection discriminator/layer. They contain no message content. They are locators, not authorization tokens. Resolution first matches an indexed artifact; it never opens a path supplied by a reference. / 所列引用包含准入来源根与项目的范围摘要、已索引相对工件标识、原生 session ID、entry ID、物理行精确摘要及可选逻辑投影标识／层，不包含消息内容；它是定位符而非授权令牌。解析先匹配已索引工件，不打开引用直接提供的路径。

Appending and rebuilding may replace a leaf Session ID while preserving the referenced entry. The resolver returns all containing branches, requiring a choice when several are present; an explicit branch must actually contain the entry. A retired logical projection opens its exact physical Raw with a visible explanation. A changed/missing entry, moved artifact, different root/project or ambiguous native identity is unavailable. A stale accepted prefix returns `INDEXED_SOURCE_STALE` until rebuild. Existing snapshot-bound history references retain their exact semantics. / 追加并重建可替换叶 Session ID，同时保留目标 entry。解析器列出所有所属分支，多分支需选择，明确指定的分支也必须包含目标。已消失逻辑投影回退至精确物理 Raw 并提示；记录改变／缺失、工件移动、根／项目改变或原生身份歧义均不可用。已接纳前缀过期时返回所列错误直到重建；原有绑定快照引用保持精确语义。

The read-only `/api/pi/navigation`, `/api/pi/entry-reference` and `/api/pi/entry` routes require the selected source, project and index revision. Reads use an index-revision lease and the normal root/prefix/digest/inode checks. Browser operations are scoped to source/project/index, cancel obsolete requests and refuse a bookmark for another project. URL hydration does not replace the selected source or project silently. / 三个只读接口要求所选来源、项目和索引 revision；读取使用 revision lease 及正常根／前缀／摘要／inode 校验。浏览器操作绑定来源／项目／索引，取消过期请求并拒绝其他项目的书签；URL 恢复不静默切换来源或项目。

## Navigation and accounting / 导航与统计

The sidebar groups branches into collapsible native sessions. The selected-session overview shows the latest whole-artifact name, substantive branch tips, the common ancestor with the selected branch and current label anchors. Latest names and labels are whole-artifact metadata, matching the pinned writer; historical branch titles remain branch-local. Empty and absent label values clear labels; an empty session name clears the current name. The overview shows at most 100 branches and 50 labels, with explicit truncation; it does not claim an active runtime cursor. / 侧栏按原生会话折叠分支；所选会话概览显示工件最新名称、分支最近实质内容、与所选分支的共同祖先及当前标签锚点。最新名称／标签按固定 writer 的整工件语义处理，历史分支标题仍局限于分支。空或缺失标签值清除标签，空名称清除当前名称。概览最多展示 100 个分支及 50 个标签并明确截断，不声称运行期活动游标。

`branch_summary.fromId` can link to the abandoned sibling branch; labels can target other existing branches. Context edits and compaction boundaries retain their earlier-ancestor rules. Navigation establishes an entry relationship, not copied message ownership, child-agent identity or execution. / 分支摘要可链接离开的兄弟分支，标签可指向其他已有分支；context edit 和 compaction 边界仍要求较早祖先。导航仅建立记录关系，不建立复制消息归属、子 agent 身份或执行事实。

Project search groups matching branches and separately labels visible native-session and matching-branch counts. Shared-prefix event hits remain repeated per containing branch. This is presentation grouping, not physical-hit or usage/file-statistics deduplication. A shared call may have different physical results in different descendants; whole-native totals require a separate contributor model. / 项目搜索对匹配分支分组，分别标注当前显示的原生会话数和匹配分支数；共同前缀命中仍在各所属分支重复。这是展示分组，不是物理命中或用量／文件统计去重。共享调用可在不同后代有不同物理结果，完整原生总量需另行设计贡献项模型。

## Reading saved evidence / 阅读保存的依据

Models and usage are accessible from the overview. Readable Detail sections distinguish model selection from actual assistant attribution, explain prompt/tool patches and context transitions, and show category-separated usage partial sums with missing/invalid coverage. Native read ranges, write content and output truncation are visible as recorded evidence. No disk state, billing or final provider request is reconstructed. / 概览可进入模型与用量详情；可读区段区分模型选择与实际助手归属，解释提示／工具 patch 和上下文变化，按类别展示带缺失／无效覆盖的用量部分和。原生读取范围、写入内容和输出截断按记录展示，不重建磁盘状态、账单或最终 provider 请求。

Saved pi image blocks use the shared image-preview presentation, with exact event/block ownership and fresh accepted-snapshot validation on every read. Supported inline PNG/JPEG/GIF/WebP/AVIF payloads are bounded to 16 MiB encoded and 12 MiB decoded per image; at most eight previews are presented per event. URLs, paths and extension renderers are never executed or fetched. Cached parsed companions omit image bytes; physical Raw strings remain exact and search excludes media. / 保存的图片块复用共享预览，严格绑定事件／内容块且每次读取重新验证快照。支持所列内嵌格式，单图编码最多 16 MiB、解码最多 12 MiB，每事件最多呈现八张；不执行或获取 URL、路径及扩展 renderer。缓存解析副本省略图片字节，物理 Raw 原文保持精确且搜索排除媒体。

Explicitly cancelled direct user shell commands show Cancelled and do not contribute to failed-command counts; their command, exit code and excluded-context flag remain inspectable. Other direct shell operations keep recorded exit-code status. / 明确取消的用户直接 shell 命令显示已取消且不计入失败命令；命令、退出码及上下文排除标志仍可检查，其他直接 shell 操作保持记录退出码状态。

## Evidence / 依据

- Native references and ownership: [Node workflows](../../test/pi-navigation.test.js), [browser workflows](../../e2e/pi-navigation.test.js). / 原生引用与归属：所列 Node／浏览器工作流。
- Readable evidence and saved images: [reading tests](../../test/pi-reading-presentation.test.js), [image tests](../../test/pi-images.test.js), [writer-shaped edge cases](../../test/pi-workflow-edges.test.js). / 可读依据及保存图片：所列读取、图片及 writer 形态边界测试。
- Capacity: [profile script](../../scripts/pi-session-profile.js) offers a bounded capacity suite. Measurements are descriptive fresh-process samples, not guarantees. / 容量脚本提供有界量测集；结果是新进程描述性样本，不构成容量保证。

Real provider/SDK workflows and screenshots remain outside the repository. Committed tests use synthetic fixtures; source-version, live versus scripted provenance, validation and actual measurements belong in the [execution plan](../exec-plans/completed/2026-10-23-pi-history-navigation.md). / 真实 provider／SDK 工作流及截图保留在仓库外；提交测试使用合成 fixture。来源版本、实时与脚本化区别、验证及实际量测记录于执行计划。
