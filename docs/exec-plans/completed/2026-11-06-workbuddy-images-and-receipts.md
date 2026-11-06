# WorkBuddy image messages and tool receipts / WorkBuddy 图片消息与工具回执

Base: `3e053d7`. Preserve the existing uncommitted integration changes. / 基线如上，保留既有未提交整合改动。

## Scope / 范围

- Honor native `toolResult.rawResponse.is_error: true`, including deferred tools; retain transport status and exact Raw. / 识别原生嵌套错误标记，含延迟工具；保留传输状态和精确 Raw。
- Present validated native `image_blob_ref` messages as one user event with attachment metadata. Admit reference-only input without loading external payloads. Move corroborated native image wrappers to inspection while retaining all searchable source text. / 将有效原生图片引用消息展示为单个用户事件与附件 metadata；接纳仅引用的输入，不加载外置 payload；经图片引用佐证的原生包装移入检查，保留全部可搜索来源文字。
- Identify subagent user-role inputs as subagent inputs, without claiming manual authorship or inferring individual parent calls. / 将子代理中的用户角色输入标为子代理输入，不推断人工作者或具体父调用。
- Update stale real-corpus evidence and keep successful teammate delivery unverified. / 更新过时真实语料依据，成功队友投递继续保持未验证。

## Validation / 验证

Use minimized synthetic tests for errors, mixed/reference-only images, malformed references, literal markup, search ownership, bounded Detail and exact Raw. Exercise desktop/mobile browser reading and current real cases read-only. Before any commit, obtain independent fresh-context review and record exact base/diff plus executed checks. / 使用最小合成测试覆盖错误、混合／仅引用图片、异常引用、字面标签、搜索归属、有界详情与精确 Raw；执行桌面／移动浏览器阅读和只读真实回归。提交前独立审查并记录精确基线／差异和实际检查。

## Executed evidence / 已执行依据

- Node 24.22.2: 132 tests passed across WorkBuddy, i18n, source-adapter conformance, logical-detail contracts/sanitizer and history service. After the review correction, all 45 WorkBuddy tests passed again. / 所列 Node 回归 132 项通过；审查修正后再次通过全部 45 项 WorkBuddy 测试。
- Browser build and freshness check passed; all three WorkBuddy Playwright cases passed after the correction, covering desktop/mobile search, image metadata and Raw, deferred failures and internal compaction. / 浏览器构建与一致性检查通过；修正后三项 WorkBuddy Playwright 测试通过，覆盖桌面／移动搜索、图片 metadata 与 Raw、延迟工具失败和内部压缩。
- Read-only real acceptance: 7 physical sessions, 1,674 Raw records, zero diagnostics; 26 selected Detail events plus exact Raw verified. One image event, eight child inputs, 15 failed deferred calls (four corrected nested errors), and two internal compaction continuations were checked. Source bytes remained unchanged; scripts/reports stay under `/tmp`, outside repository history. / 真实只读验收：七个物理会话、1,674 条 Raw、零诊断；核验 26 个选定详情事件与精确 Raw，含一个图片事件、八条子代理输入、15 次失败延迟调用（四次修正嵌套错误）和两条内部压缩续接。源字节未变，脚本／报告仅保留在仓库历史之外的 /tmp。
- Local preview restarted at `http://127.0.0.1:17892`; HTTP state confirmed the requested WorkBuddy root/project, successful indexing and seven sessions without diagnostics. A real browser searched the image filename, read attachment metadata and opened exact Raw with no page errors. / 本地预览已在所列地址重启；HTTP 状态确认预期 WorkBuddy 根／项目、索引成功、七个会话且无诊断。真实浏览器完成图片文件名搜索、附件 metadata 阅读及精确 Raw 打开，没有页面错误。
- Fresh independent static review identified mixed-image wrapper overmatching. The correction requires the complete observed three-block form and a string filename; added prose, unknown blocks, missing/non-string names and non-path literal tags retain Main text. Reviewer sandbox HTTP/browser checks encountered `listen EPERM`; the main agent executed those checks successfully with local-port permissions. CI and the full repository suite were not run for this focused change. / 独立静态审查发现混合图片包装过度匹配；修正为要求完整观测三块形态与字符串文件名，额外文字、未知块、缺失／非字符串名称及非路径字面标签保留主层文字。审查者的 HTTP／浏览器检查遇到 listen EPERM；主 agent 已取得本地端口权限并成功执行。此次聚焦改动未运行 CI 或全仓库测试套件。

## Completion review / 完成审查

Fresh-context reviewer `/root/review_workbuddy` reviewed the eight tracked changed files and this plan against base `3e053d7a0cd958a8ac1ef1ffd4c0c9859687c23d`, excluding generated assets. After the substantive correction, re-review found no further actionable issues and independently passed all 15 Detail tests plus `git diff --check`. The reviewed tracked diff SHA-256 was `787ce85be5dfe1862c0401aa3e7ca124827ca9bb616451cd7425d351515428fd`; the then-active plan SHA-256 was `8ec2701dec5a477de604ade164a31cb67e22d4829ac9fcaf3d337e5feea27de9`. Subsequent plan-only edits record review/completion and archive the runbook; they do not change the reviewed implementation. / fresh-context 审查者按所列基线审查八个已跟踪改动文件及本计划，排除生成资产。实质修正后的复审未发现其他可操作问题，独立通过全部 15 项 Detail 测试与差异格式检查。已审查 tracked diff 及当时 active 计划的 SHA-256 如上；后续仅补记审查／完成结果并归档，不改变已审查实现。

All evidence-supported changes in this scope are implemented. Successful native teammate delivery and external image payload preview remain outside verified coverage; neither requires further user work for these fixes to function. / 本范围内已有依据的修改均已实现。成功原生队友投递与外置图片 payload 预览仍在已验证覆盖之外；本次修复生效不需要用户再做额外操作。
