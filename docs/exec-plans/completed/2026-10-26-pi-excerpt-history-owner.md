# pi excerpt history ownership / pi 节选历史归属

Base: `af27edc52802e5b9136970268429ff5443f755d2` (tree equals PR #98 head `9c3c07a6132da339e94c36dd79402271b389a1c3`); branch `fix/pi-excerpt-browser-return`. Status: implementation and local acceptance complete; exact independent review and hosted checks are recorded with the commit/PR. / 基线树与 #98 所列 head 相同；当前分支如上，状态：实现与本地验收完成，精确独立审查及 hosted 检查记录于提交／PR。

## Scope and evidence / 范围与依据

The follow-up review identifies a double-owner path if an owned `popstate` restoring `#ref` is followed by `hashchange`: the old handler clears `history.state` and starts another resolver. Its external probe used extracted handlers and UI/I/O substitutes; this task verifies the supplied scenario against the complete application. / 后续审查指出：恢复 `#ref` 的已归属 `popstate` 若随后收到 `hashchange`，旧处理器会清空 `history.state` 并发起另一解析，形成双重接管。外部探针使用提取处理器及 UI／I/O 替身；本轮依据给定场景核验完整应用。

Stronger native Chromium 154 E2E passes on the base: **22/22** pi navigation tests, including nonanchor selection, manual folds/disclosures, Inspector and Raw-reference views, nonzero Timeline/Detail scroll, an independent in-app return consumed after repeated Back/Forward, real gated late responses, and intentional hash changes. Each excerpt Back emits only trusted `popstate`, preserving its owner with one resolve and one read per context event. A separate platform check observes both events for fragment-only traversal, but only `popstate` when query and fragment change together. This does not reproduce the reported full-app failure on this browser. / 加强后的原生 Chromium 154 E2E 在基线上 **22/22** 通过，覆盖非锚点选择、手动折叠／展开、Inspector 与 Raw 引用界面、非零 Timeline／Detail 滚动、重复前后退后实际消费独立应用内返回、真实响应门控及主动 hash 切换。每次节选后退仅收到可信 `popstate`，归属保留，一次 resolve 且每个上下文事件读取一次。独立平台检查在仅 fragment 变化时观察到双事件，而 query 与 fragment 同时变化时仅收到 `popstate`；因此此浏览器未复现所述整应用失败。

The explicitly named simulated-companion E2E uses the actual application and real gated HTTP, delivering one untrusted `HashChangeEvent` after native Back. It fails on the base: owner becomes null and resolve requests double. Keep this event-delivery simulation distinct from native-browser reproduction. Managed Chromium 148 download is blocked by proxy HTTP 403; its hosted CI is separate evidence. / 明确命名的模拟伴随事件 E2E 使用真实应用与真实门控 HTTP，在原生后退后主动送达一个非可信 `HashChangeEvent`；它在基线上因 owner 变为 null、resolve 请求翻倍而失败。该事件送达模拟与原生浏览器复现分别记录。托管 Chromium 148 下载被代理以 HTTP 403 阻止，其 hosted CI 为独立依据。

## Change / 修改

Use a one-shot destination/owner/position guard to coordinate the two browser event channels. Ignore obsolete queued hash notifications; preserve normal new/cleared hashes, snapshot scope checks, cancellation, history length and the independent reading-return stack. No parser, statistics, media or path changes. The local Detail-view subhistory arrow is outside the saved reading-position contract and is excluded explicitly from payload comparisons; the real reading-return stack is asserted and consumed. / 使用一次性目标／归属／位置保护协调两个浏览器事件通道。忽略过时排队 hash 通知，保持主动新建／清空 hash、快照范围检查、取消、历史长度及独立阅读返回栈。无解析器、统计、媒体或路径修改。局部 Detail 子历史箭头不属于保存阅读位置契约，正文比较明确排除它；真实阅读返回栈另有断言并实际消费。

## Validation / 验证

Run guard unit checks, generated-asset checks, complete pi navigation/history-evidence/turn-lineage browser regressions and fresh independent exact-diff review. Record final results and hosted CI/Codex separately before merge. / 运行保护单元检查、生成资产检查、完整 pi 导航／历史依据／turn lineage 浏览器回归及 fresh 独立精确 diff 审查；合并前分别记录最终结果与 hosted CI／Codex。

- Simulated companion case changes from RED (owner cleared/two resolves) to GREEN (owner retained/one resolve); the later real Forward and released old response preserve the newer state. Native and simulated event diagnostics explicitly distinguish `isTrusted`. / 模拟伴随事件用例从 RED（归属清空／两次解析）变为 GREEN（归属保留／一次解析）；之后真实前进及旧响应释放保持较新的状态。原生与模拟事件诊断明确区分 `isTrusted`。
- **75/75** pi navigation/history-evidence/turn-lineage browser tests pass. Unit checks include one-time matching, cancellation, different URL/owner/position, and replacement by an unowned/newer traversal. / **75/75** pi 导航／历史依据／turn lineage 浏览器测试通过；单元检查覆盖单次匹配、取消、不同 URL／归属／位置及被无归属／较新遍历替代。
- `npm run release:check` passes: generated assets current, **1,993/1,993** Node tests without skips, and installed-package UI/history reading for all four sources. The existing acceptance server serves the exact new bundle hash; server code and source transcripts are unchanged. / 所列检查通过：生成资产一致、无跳过的 **1,993/1,993** Node 测试及四来源安装包 UI／历史读取。现有验收服务提供与新 bundle 完全相同的哈希，服务端代码及来源转录保持原状。
