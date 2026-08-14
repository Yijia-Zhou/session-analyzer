# Source-neutral runtime cleanup / 来源中立运行时清理

## Objective / 目标

Complete the focused source-neutral cleanup described in the session goal: move shared query ownership out of Codex, make source configuration registry-driven, and preserve the existing Codex and Claude Code contracts. The mandatory review checkpoint was after Milestone 2; Sol's revised architecture re-review approved the M1/M2 boundary, M3 and M4 implementation are complete, and this active plan now records final external-review closure evidence. / 完成当前任务目标中的来源中立清理：把共享查询 ownership 移出 Codex，使来源配置由 registry 驱动，并保持现有 Codex 与 Claude Code 契约。强制评审检查点位于 Milestone 2 之后；Sol 修订后的架构复审已批准 M1/M2 边界，M3 与 M4 implementation 已完成，当前 active plan 只记录最终 external-review closure 证据。

## Baseline / 基线

- Branch / 分支: `v0.1.4-development`
- Baseline planning SHA / 规划基线 SHA: `c731eada6e84175b68a9d47a327b923f79d6364e`
- Actual starting HEAD / 实际起始 HEAD: `30ec088e931aa35e3a08cdb2a10a16e8ba8962d3`
- Worktree was clean before implementation / 实现前工作树干净
- The delta from the planning SHA is commit `30ec088` and only removes source/protocol chips from the session list. / 规划 SHA 之后只有 `30ec088` 一个提交，内容仅为移除 session list 的 source/protocol chips。

## Milestone record / 里程碑记录

### M0 — Freeze current contracts / 冻结当前契约

Baseline commands actually run / 已实际运行的基线命令:

- `npm test` — 466/466 passed.
- `npm run test:browser` — 108/108 passed.
- Runtime: Node `v24.18.1`, npm `12.0.2`.

Existing Codex search tests, Claude shared-timeline tests, source-switch tests, and build-boundary tests provide the initial characterization. New boundary tests will be added before ownership migration is considered complete. / 现有 Codex 搜索测试、Claude 共享时间线测试、来源切换测试和构建边界测试构成初始 characterization；在 ownership 迁移完成前会补充新的边界测试。

### M1 — Neutral query ownership / 来源中立查询 ownership

Implemented ownership / 已实现 ownership:

- `src/session-query.js` owns canonical session filtering, file suggestions, timeline projection, event lookup, and neutral DTO construction.
- Codex Code Mode context/facet behavior remains an explicit Codex query presentation hook.
- `src/codex.js` keeps only compatibility exports for existing internal callers while the server uses the neutral query boundary.
- `src/codex-search.js` is now a thin compatibility factory over `src/session-query.js`.
- `src/source-adapters.js` exposes one query implementation per registered source; the server routes shared query endpoints through `queryForIndex(index)`.
- Claude source-switch coverage now exercises sessions, timeline, and event lookup through the neutral query path. / `src/codex-search.js` 现在只是 `src/session-query.js` 之上的兼容 factory；`src/source-adapters.js` 为每个 registry 来源暴露 query 实现；服务器通过 `queryForIndex(index)` 处理共享查询 route；来源切换测试已覆盖 Claude 的 sessions、timeline 与 event lookup 中性路径。

### M2 — Registry-driven source configuration / registry 驱动来源配置

Implemented state / 已实现 state:

- The server stores `sourceConfigs` keyed by registered source kind and derives the active home from `sourceKind`.
- Legacy CLI and `/api/source` `codexHome`/`claudeHome` inputs are normalized only at the input/compatibility boundary.
- Browser state stores generic source configurations and renders supported source homes from server metadata.
- The registry now supplies source labels, legacy option names, and default homes through `supportedSourceOptions()`; API payloads add canonical `sourceConfigs` and `sourceOptions` while retaining legacy response fields.
- Canonical `/api/source` accepts `{ source, sourceConfigs: { [kind]: { home } } }`; legacy home fields remain accepted for compatibility, and malformed canonical entries fail closed.
- The project chooser now renders one home input per registry source using `data-source-home`; existing Codex/Claude test selectors remain stable through generated IDs. / registry 现在通过 `supportedSourceOptions()` 提供来源标签、旧 option 名称与默认 home；API payload 新增规范 `sourceConfigs` 与 `sourceOptions`，同时保留旧响应字段。规范 `/api/source` 接受 `{ source, sourceConfigs: { [kind]: { home } } }`；旧 home 字段继续兼容，规范 entry malformed 时 fail closed。项目 chooser 按 registry 来源使用 `data-source-home` 动态渲染 home input，并通过生成 ID 保持现有 Codex/Claude 测试 selector 稳定。

Changed implementation files / 已变更实现文件:

- `src/session-query.js`, `src/codex-search.js`, `src/codex-code-mode-presentation.js`, `src/codex.js`
- `src/source-adapters.js`, `server.js`
- `src/browser/app.js`, `public/index.html`, `public/assets/app.js`, `src/shared/i18n.js`
- `scripts/package-smoke.js`, `e2e/browser.test.js`
- `package.json`
- `test/build-boundary.test.js`, `test/codex-search.test.js`, `test/codex.test.js`, `test/runtime-diagnostics.test.js`, `test/source-switch.test.js`, `test/package.test.js`
- `docs/design-docs/transcript-source-adapters.md`

No third transcript source, real user transcript, or fixture was added. / 未添加第三种 transcript source，也未添加真实用户 transcript 或 fixture。

### Mandatory checkpoint / 强制检查点

After M2, prepare a review packet with exact base/head SHAs, M0–M2 summary, changed files, ownership/dependency changes, exact tests/results, deviations, unresolved questions, and the smallest useful diff range. Do not begin M3 without Terra/Sol findings. / M2 之后准备包含精确 base/head SHA、M0–M2 摘要、变更文件、ownership/dependency 变化、实际测试结果、偏差、未决问题及最小 review diff 范围的评审包。在 Terra/Sol 意见返回前不得开始 M3。

### Sol checkpoint review-fix pass / Sol 检查点 review-fix 轮次

Historical checkpoint record, superseded by the M3 completion section below: Sol xhigh returned a failed architecture checkpoint: the M1/M2 implementation was not approved to proceed to M3. This pass addressed the three findings below; M3 was paused at that point. / 历史检查点记录，已被下方 M3 completion section 取代：Sol xhigh 返回了未通过的架构检查点：M1/M2 实现当时未获准进入 M3。本轮处理了以下三个 finding；M3 仅在该历史时点保持暂停。

#### Finding 1 — Code Mode ownership boundary / Finding 1 — Code Mode ownership 边界

- Root cause / 根因: the canonical query and shared server route still interpreted the Codex-only facet, request normalization, event identity, and presentation-index fields directly. / canonical query 与 shared server route 仍直接解释 Codex-only facet、request normalization、event identity 及 presentation-index 字段。
- Code change / 代码变更: `src/session-query.js` now exposes only a small opaque presentation/query hook seam; it has no Code Mode identifiers, normalizer, or Codex index knowledge. Codex normalization, matching, facets, catalog projection, and index access live in `src/codex-search.js` and `src/codex-code-mode-presentation.js`; `server.js` only parses neutral filters and asks the active query for generic presentation data. / `src/session-query.js` 现在只暴露小型 opaque presentation/query hook seam，不包含 Code Mode 标识、normalizer 或 Codex index 知识。Codex normalization、matching、facet、catalog projection 与 index access 位于 `src/codex-search.js` 和 `src/codex-code-mode-presentation.js`；`server.js` 只解析中性 filters，并向 active query 请求通用 presentation data。
- Regression coverage / 回归覆盖: `test/build-boundary.test.js` rejects semantic leakage tokens (`code_mode_operation`, `codeModeRequest`, `codeModeDeclaredRequests`, `normalizeCodeModeRequest`, and `presentationIndexes`) in the canonical query and shared server; Codex query tests preserve existing behavior; `test/source-switch.test.js` proves a Claude session remains queryable when given the Codex-only facet. / `test/build-boundary.test.js` 禁止 canonical query 与 shared server 出现 semantic leakage token；Codex query tests 保留原行为；`test/source-switch.test.js` 证明 Claude session 带 Codex-only facet 时仍可查询。

#### Finding 2 — canonical source configuration precedence / Finding 2 — canonical sourceConfigs 优先级

- Root cause / 根因: server mutation handling and browser hydration applied legacy `codexHome`/`claudeHome` after or ahead of canonical `sourceConfigs`, allowing compatibility fields to overwrite explicit canonical values. / server mutation handling 与 browser hydration 在 canonical `sourceConfigs` 之后或之前应用 legacy `codexHome`/`claudeHome`，使兼容字段可以覆盖显式 canonical 值。
- Code change / 代码变更: canonical `sourceConfigs[kind].home` is authoritative whenever the entry is present; legacy source-home fields are fallback only when that canonical entry is absent. The same rule is implemented in `server.js` and `src/browser/app.js`, and documented in `docs/design-docs/transcript-source-adapters.md`. / 当 `sourceConfigs[kind].home` entry 存在时 canonical 值权威；legacy source-home 字段只有在对应 canonical entry 缺失时才作为 fallback。该规则已在 `server.js` 与 `src/browser/app.js` 一致实现，并记录在 `docs/design-docs/transcript-source-adapters.md`。
- Regression coverage / 回归覆盖: `test/source-switch.test.js` covers canonical-only, legacy-only, equal, and conflicting inputs; `e2e/browser.test.js` covers conflicting browser hydration and preserves literal backslashes in POSIX paths. / `test/source-switch.test.js` 覆盖 canonical-only、legacy-only、equal 与 conflicting 输入；`e2e/browser.test.js` 覆盖 conflicting browser hydration，并保留 POSIX 路径中反斜杠的字面语义。

#### Finding 3 — explicit canonical source ownership / Finding 3 — canonical source ownership 必须显式

- Root cause / 根因: canonical `queryForIndex` and `adapterForSession` silently defaulted to Codex, and an adapter-built index could enter runtime state without ownership. / canonical `queryForIndex` 与 `adapterForSession` 静默 fallback 到 Codex，adapter-built index 也可能在没有 ownership 的情况下进入 runtime state。
- Code change / 代码变更: `src/source-adapters.js` now requires a supported explicit `sourceKind` for canonical index/session dispatch and validates index/session ownership before commit. `server.js` rejects an unowned or mismatched adapter index before assigning it to runtime state; Codex remains a default only at CLI/startup source selection. Broader canonical field/locator cleanup remains deferred to M3. / `src/source-adapters.js` 现在要求 canonical index/session dispatch 具有显式且受支持的 `sourceKind`，并在 commit 前校验 index/session ownership。`server.js` 在 runtime state assignment 前拒绝无 ownership 或不匹配的 adapter index；Codex 仅在 CLI/startup source selection 边界保留 default。更广泛的 canonical field/locator 清理留给 M3。
- Regression coverage / 回归覆盖: `test/source-switch.test.js` covers missing, unsupported, mismatched, and valid ownership plus rejection before runtime commit; affected Codex, diagnostics, and browser fixtures now declare their explicit ownership. / `test/source-switch.test.js` 覆盖 missing、unsupported、mismatched 与 valid ownership，以及 runtime commit 前拒绝；受影响的 Codex、diagnostics 与 browser fixtures 现在显式声明 ownership。

The revised implementation was returned to architecture review here. The historical “do not begin M3” gate was superseded when Sol's re-review approved the M1/M2 boundary. / 修订后的实现已在此返回架构评审。Sol 复审批准 M1/M2 边界后，历史性的“不得开始 M3” gate 已被 supersede。

### Remaining-gap review fix / 剩余边界 gap review-fix

#### Gap 1 — malformed canonical `sourceConfigs` / Gap 1 — malformed canonical `sourceConfigs`

- Root cause / 根因: server canonical entries used the generic optional-home resolver, so `{ codex: {} }` inherited the current home; browser hydration also retained an existing home when a malformed canonical entry produced no value. / server canonical entry 使用了允许 optional home 的通用 resolver，因此 `{ codex: {} }` 会继承当前 home；browser hydration 在 malformed canonical entry 没有产生值时也会保留既有 home。
- Code change / 代码变更: server canonical entries now require an own `home` property whose value is a non-empty string and reject missing, empty, or non-string values before mutation. Browser hydration treats an explicitly malformed canonical map/entry as authoritative-but-invalid, clears that source's existing home, and never falls back to legacy; a canonical entry that is absent still permits legacy fallback. / server canonical entry 现在要求自有的 `home` 属性且必须是非空字符串，在 mutation 前拒绝 missing、empty 或 non-string 值。Browser hydration 将显式 malformed canonical map/entry 视为 authoritative-but-invalid，清除该来源既有 home 且不 fallback 到 legacy；canonical entry 缺失时仍允许 legacy fallback。
- Regression test / 回归测试: `test/source-switch.test.js` covers missing, empty, invalid, valid, legacy-only, equal, and conflicting inputs; `e2e/browser.test.js` covers valid canonical precedence and malformed canonical hydration without legacy fallback. / `test/source-switch.test.js` 覆盖 missing、empty、invalid、valid、legacy-only、equal 与 conflicting 输入；`e2e/browser.test.js` 覆盖 valid canonical precedence 及 malformed canonical hydration 不 fallback legacy。

#### Gap 2 — `sessionsById` ownership bypass / Gap 2 — `sessionsById` ownership bypass

- Status / 状态: Superseded by the final Finding-3 ownership closure below; the code change described in this historical section is the intermediate fix, not the final union validation. / 已被下方的 Finding-3 最终 ownership closure 取代；本历史段落描述的是中间修复，不是最终的 union validation。
- Root cause / 根因: `validateIndexOwnership()` skipped an accessor-backed `sessions` collection to preserve server error-path tests, but did not inspect the `sessionsById` map used by canonical query lookup. / `validateIndexOwnership()` 为保留 server error-path tests 而跳过 accessor-backed `sessions` collection，但没有检查 canonical query lookup 实际使用的 `sessionsById` map。
- Code change / 代码变更: ownership validation now validates `sessionsById` map values first; only when that canonical map is unavailable does it inspect a plain `sessions` array. Throwing/accessor-backed `sessions` getters are never invoked merely for validation. / ownership validation 现在优先校验 `sessionsById` map values；只有 canonical map 不存在时才检查 plain `sessions` array。不会仅为 validation 调用 throwing/accessor-backed `sessions` getter。
- Regression test / 回归测试: `test/source-switch.test.js` now rejects an index with valid index ownership but an unowned session reachable through `sessionsById`, while asserting the throwing `sessions` getter is not invoked. / `test/source-switch.test.js` 现在拒绝 index ownership 有效但 `sessionsById` 可达 session 未声明 ownership 的 index，并同时保证不会调用 throwing `sessions` getter。

#### Intentional compatibility deviation — Code Mode response shape / 有意的兼容性偏差 — Code Mode response shape

- Exact behavior / 具体行为: Code Mode presentation fields are source-specific after cleanup. Codex continues to expose its Code Mode fields through its query/presentation hook; Claude/shared canonical query responses no longer expose an empty `codeModeRequests` property. / cleanup 后 Code Mode presentation fields 按来源区分。Codex 继续通过 query/presentation hook 暴露 Code Mode 字段；Claude/shared canonical query response 不再暴露空的 `codeModeRequests` 属性。
- Why retained / 保留原因: restoring an empty Codex-specific field to Claude/shared responses would reintroduce the semantic coupling rejected by Finding 1. / 将空的 Codex-specific 字段恢复到 Claude/shared response 会重新引入 Finding 1 所拒绝的语义耦合。
- Compatibility impact / 兼容性影响: this is a deliberate response-shape change for consumers that assumed the old field was always present. Repository documentation contains no public/stable API guarantee requiring an empty `codeModeRequests` field for Claude or source-neutral responses; Codex Code Mode behavior remains preserved. / 对假设旧字段始终存在的 consumer，这是有意的 response-shape 变化。仓库文档没有要求 Claude 或来源中立 response 必须带空 `codeModeRequests` 字段的 public/stable API guarantee；Codex Code Mode 行为保持不变。

### Final Finding-3 ownership closure / Finding-3 最终 ownership closure

#### Closure 1 — validate both canonical session collections / Closure 1 — 校验两个 canonical session collection

- Root cause / 根因: validation previously selected either `sessionsById` or `index.sessions`, while canonical filtering can consume the latter and timeline/detail lookup consumes the former. / 之前的 validation 只选择 `sessionsById` 或 `index.sessions` 其中之一，但 canonical filtering 会消费后者，timeline/detail lookup 会消费前者。
- Code change / 代码变更: `validateIndexOwnership()` now validates the union of all `sessionsById` Map values and the plain data-property `index.sessions` Array, deduplicated by object identity; accessor-backed getters remain uninvoked. / `validateIndexOwnership()` 现在校验全部 `sessionsById` Map values 与 plain data-property `index.sessions` Array 的 union，并按 object identity 去重；accessor-backed getter 仍不会被调用。
- Regression test / 回归测试: `test/source-switch.test.js` combines valid `sessionsById` sessions with an additionally mismatched plain-array session and requires fail-closed validation; the throwing-getter case remains covered. / `test/source-switch.test.js` 将 valid `sessionsById` session 与额外 mismatched plain-array session 组合并要求 fail-closed；throwing-getter case 继续覆盖。

#### Closure 2 — bind returned index ownership to initiating job source / Closure 2 — 将返回 index ownership 绑定到 job source

- Root cause / 根因: `startProjectJob()` validated only the returned index's internal consistency, not whether it matched the `jobSourceKind` used to invoke the adapter build. / `startProjectJob()` 只校验返回 index 的内部一致性，没有校验它是否匹配调用 adapter build 时使用的 `jobSourceKind`。
- Code change / 代码变更: after stale-job cancellation handling and before runtime commit, the server compares the validated returned `index.sourceKind` with the immutable job snapshot and raises `SOURCE_OWNERSHIP_MISMATCH` on divergence. / 在 stale-job cancellation handling 之后、runtime commit 之前，server 将 validated returned `index.sourceKind` 与 immutable job snapshot 比较，发生偏差时抛出 `SOURCE_OWNERSHIP_MISMATCH`。
- Regression test / 回归测试: `test/source-switch.test.js` starts a Claude-owned job whose adapter returns a self-consistent Codex index and verifies job failure plus no committed runtime state. / `test/source-switch.test.js` 启动 Claude-owned job，但 adapter 返回 self-consistent Codex index，并验证 job failure 及 runtime state 未 commit。

### Sol xhigh re-review follow-up / Sol xhigh re-review follow-up

Historical review record, superseded by the M3 completion section below: Sol's re-review resolved Findings 1 and 3 and accepted the Code Mode response-shape deviation. It identified one remaining M2 Finding 2 gap, which was subsequently closed before M3 completion. / 历史复审记录，已被下方 M3 completion section 取代：Sol 的 re-review 已确认 Finding 1 与 Finding 3 resolved，并接受 Code Mode response-shape 偏差；当时发现的 M2 Finding 2 gap 已在 M3 completion 之前关闭。

#### Finding 2 closure — runtime-wide canonical source configuration authority / Finding 2 closure — runtime-wide canonical sourceConfigs authority

- Root cause / 根因: `sourceConfigHome()` accepted legacy-shaped strings, `cloneSourceConfigs()` recovered malformed explicit entries through adapter defaults, `createInitialSourceConfigs()` allowed legacy and active `sourceHome` values to override or recover canonical entries, and browser hydration retained prior state when all explicit entries were cleared. / `sourceConfigHome()` 接受了 legacy-shaped string；`cloneSourceConfigs()` 会用 adapter default 恢复显式 malformed entry；`createInitialSourceConfigs()` 允许 legacy 与 active `sourceHome` 覆盖或恢复 canonical entry；browser hydration 在所有显式 entry 被清除时保留旧 state。
- Code change / 代码变更: server canonical entries now require an object with an own non-empty string `home`; explicit malformed entries throw `INVALID_SOURCE_CONFIG` at initialization and no longer fall back to legacy/default. Valid canonical entries win over both legacy homes and active `sourceHome`, for options and initial-index initialization. Browser state commits an empty canonical map when explicit entries are malformed and derives active `sourceHome` from the resulting canonical state whenever a canonical payload is present; legacy `sourceHome` remains a fallback only when canonical configuration is absent. / server canonical entry 现在必须是带自有非空 string `home` 的 object；初始化时显式 malformed entry 以 `INVALID_SOURCE_CONFIG` fail closed，不再 fallback 到 legacy/default。无论 options 还是 initial-index initialization，valid canonical entry 都优先于 legacy home 与 active `sourceHome`。Browser state 在显式 entry malformed 时会提交空 canonical map，并且只要 payload 带 canonical configuration 就从最终 canonical state 推导 active `sourceHome`；只有 canonical configuration 缺失时 legacy `sourceHome` 才继续作为 fallback。
- Regression coverage / 回归覆盖: `test/source-switch.test.js` covers valid canonical options, valid canonical initial-index configuration, conflicting legacy/active homes, and malformed missing/empty/string entries; `e2e/browser.test.js` covers fresh malformed hydration and a later malformed payload clearing previously hydrated canonical state and active home. / `test/source-switch.test.js` 覆盖 valid canonical options、valid canonical initial-index configuration、conflicting legacy/active home 及 missing/empty/string malformed entry；`e2e/browser.test.js` 覆盖 fresh malformed hydration，以及后续 malformed payload 清除此前 hydrated canonical state 与 active home。

#### Follow-up — reject unsupported canonical source keys / Follow-up — 拒绝 unsupported canonical source key

- Root cause / 根因: the initializer validated only supported values while iterating `supportedSourceKinds()`, so an own key such as `mystery` was silently ignored even though `/api/source` rejected it. / initializer 只在遍历 `supportedSourceKinds()` 时校验受支持的 value，因此 `mystery` 这样的 own key 会被静默忽略，尽管 `/api/source` 已拒绝该 key。
- Code change / 代码变更: `requireSourceConfigMap()` now rejects every unsupported own key with `UNSUPPORTED_SOURCE_CONFIG`, keeping initialization and mutation boundaries aligned. / `requireSourceConfigMap()` 现在拒绝所有 unsupported own key，并以 `UNSUPPORTED_SOURCE_CONFIG` fail closed，使 initialization 与 mutation boundary 保持一致。
- Regression test / 回归测试: `test/source-switch.test.js` verifies `createServer()` rejects a canonical map containing valid `codex` plus unsupported `mystery` instead of silently falling back. / `test/source-switch.test.js` 验证 `createServer()` 拒绝同时包含 valid `codex` 与 unsupported `mystery` 的 canonical map，而不是静默 fallback。

### M3 — Tighten the canonical adapter contract / 收紧 canonical adapter contract

M3 status: implementation complete; M4 is the active closeout scope. / M3 状态：实现完成；M4 是当前收尾范围。

#### Contract before / 之前的 contract

The adapter boundary required explicit Index/Session `sourceKind` ownership, but the remaining canonical shape was implicit. Shared query DTOs could fall back from a missing Raw/Event `sourceKind`, and the neutral query could synthesize a generic `jsonl_line` locator from `raw.source.file` and `raw.source.line`. Index/session collection shape, event identity, and common Raw Reference identity were not documented as one small adapter contract. / adapter boundary 要求 Index／Session 具有显式 `sourceKind` ownership，但其余 canonical shape 仍是隐式的。shared query DTO 在 Raw／Event 缺少 `sourceKind` 时仍可 fallback；neutral query 也会根据 `raw.source.file` 与 `raw.source.line` 合成通用 `jsonl_line` locator。Index／Session collection shape、event identity 与 common Raw Reference identity 没有被记录为一个小型 adapter contract。

#### Contract after / 之后的 contract

`src/canonical-contract.js` now defines the minimal structural contract used by both adapters: / `src/canonical-contract.js` 现在定义两个 adapter 共用的最小结构契约：

- Index: an exact supported canonical `sourceKind`, non-empty `repoRoot`, `sessions` Array, and `sessionsById` Map keyed by the same Session IDs/objects. / Index：精确且受支持的 canonical `sourceKind`、非空 `repoRoot`、`sessions` Array，以及按相同 Session ID／object 建立的 `sessionsById` Map。
- Session: non-empty `id`, matching explicit `sourceKind`, `rawEvents`, `logicalEvents`, and the numeric `counts.messages`, `counts.toolCalls`, and `counts.failedCommands` fields consumed by shared summary/sort/browser behavior. / Session：非空 `id`、匹配的显式 `sourceKind`、`rawEvents`、`logicalEvents`，以及 shared summary／sort／browser 使用的数值型 `counts.messages`、`counts.toolCalls`、`counts.failedCommands`。
- Logical Event: non-empty `id`, matching explicit `sourceKind`, non-empty `kind`, `main`/`protocol` `layer`, string `timestamp`, and a `rawRefs` Array whose entries have `rawId`. / Logical Event：非空 `id`、匹配的显式 `sourceKind`、非空 `kind`、`main`／`protocol` `layer`、字符串 `timestamp`，以及每项带 `rawId` 的 `rawRefs` Array。
- Raw Event: non-empty `rawId` and explicit matching `sourceKind`. / Raw Event：非空 `rawId` 与显式且匹配的 `sourceKind`。

Source-specific payload, detail facts, presentation indexes, `source`, and `sourceLocator` remain optional/opaque. Codex and Claude keep their existing locator/readback construction; no generic locator shape is imposed by the shared layer. / 来源专属 payload、detail facts、presentation indexes、`source` 与 `sourceLocator` 仍为 optional／opaque。Codex 与 Claude 继续保持各自既有 locator／readback 构造；shared layer 不强制统一 generic locator shape。

#### Fallbacks removed / 已移除的 fallback

- The neutral `session-query.js` no longer has `defaultSourceKind` or missing Event/Raw `sourceKind` fallback; consumed canonical events must carry their own explicit ownership. / neutral `session-query.js` 不再有 `defaultSourceKind`，Event／Raw 缺少 `sourceKind` 时也不再 fallback；被消费的 canonical event 必须自带显式 ownership。
- The neutral query no longer infers a typed locator from generic `raw.source` fields; it only projects an adapter-supplied locator. / neutral query 不再从 generic `raw.source` 字段推断 typed locator，只投影 adapter 提供的 locator。
- `normalizeSourceKind()` and the CLI/startup Codex default remain only at source selection/adapter lookup boundaries. They are not used for canonical query or adapter ownership dispatch. / `normalizeSourceKind()` 与 CLI／startup 的 Codex default 只保留在 source selection／adapter lookup 边界，不参与 canonical query 或 adapter ownership dispatch。

#### Validation and regression coverage / Validation 与回归覆盖

`validateIndexOwnership()` performs the Index/Session structural and ownership checks in the existing pre-commit pass, including the union of `sessionsById` and the data-property `sessions` Array. The canonical path is strict: accessor-backed getters are never accepted as adapter-built indexes. The server's explicit `allowUninspectableSessions` option is reserved for legacy/synthetic error-path fixtures, and adapter build commits never pass it. Logical/Raw Event shape checks run at query/detail consumption, where consumers enforce the complete Index → Session → Event/Raw ownership chain without a second full-index event traversal. Synthetic contract tests cover valid Codex/Claude output, missing fields, each ownership mismatch edge, optional locators, and accessor strictness. / `validateIndexOwnership()` 在既有 pre-commit pass 中完成 Index／Session 的结构与 ownership 校验，包括 `sessionsById` 与 data-property `sessions` Array 的 union。canonical path 严格要求 accessor-backed getter 不能作为 adapter-built index 被接受。server 的显式 `allowUninspectableSessions` option 仅保留给 legacy／synthetic error-path fixture；adapter build commit 永远不传入该 option。Logical／Raw Event 在 query/detail 消费时校验，consumer 会锁住完整的 Index → Session → Event/Raw ownership chain，且不额外进行一次完整 index event traversal。synthetic contract test 覆盖 valid Codex／Claude output、missing field、每层 ownership mismatch、optional locator 与 accessor strictness。

M3 intentionally does not validate every Raw payload, locator internals, source-native event facts, or full-index event contents at build time. Those remain source-owned and outside the M4 closeout scope; M4 does not broaden the canonical contract or add another full-index traversal. / M3 有意不在 build time 校验每个 Raw payload、locator 内部、来源原生 event facts 或完整 index event contents。这些继续由来源拥有，也不属于 M4 收尾范围；M4 不会扩展 canonical contract，也不会增加另一次 full-index traversal。

### M4 — Cleanup, documentation, verification, and review preparation / 清理、文档、验证与评审准备

M4 is a closeout milestone, not a new architecture pass. The residue audit found no safely removable intermediate production path. The Codex query compatibility factory and legacy query exports remain reachable compatibility boundaries, and legacy codexHome/claudeHome names remain confined to CLI/compatibility inputs and response payloads; canonical runtime state remains sourceConfigs. / M4 是收尾里程碑，不是新的架构阶段。残留审计没有发现可以安全删除的中间态生产路径。Codex query compatibility factory 与 legacy query export 仍是可达的兼容边界，legacy codexHome/claudeHome 名称仍限制在 CLI／兼容输入与 response payload；canonical runtime state 仍是 sourceConfigs。

Boundary protection was strengthened in test/build-boundary.test.js. It now covers both directions of source-specific builder isolation, rejects fixed source-home fields in server/browser runtime state including bracket access, rejects direct server imports of Codex modules, keeps Code Mode identifiers out of session-query.js, and asserts that canonical query/session dispatch uses explicit ownership rather than source normalization. Existing canonical-contract and source-switch tests continue to cover the behavioral fail-closed paths. / test/build-boundary.test.js 已加强边界保护：覆盖来源专属 builder 的双向隔离，拒绝 server/browser runtime state 中包括 bracket access 在内的固定 source-home 字段，拒绝 server 直接 import Codex module，继续禁止 session-query.js 出现 Code Mode identifier，并断言 canonical query/session dispatch 使用显式 ownership 而不是 source normalization。既有 canonical-contract 与 source-switch test 继续覆盖行为层 fail-closed path。

Third-source pressure test result: a third source would need source-owned interpreter/builder files, one registry adapter descriptor, optional labels/i18n and CLI aliases, plus tests, packaging, and documentation. It would not require source-specific branches in shared query logic, fixed source-home fields in core server/browser state, changes to existing Codex/Claude builders, or Codex-default canonical fallbacks. No plugin SDK, capability framework, mixed-source index, or new transcript source was introduced. / 第三来源压力测试结果：第三来源只需要来源专属 interpreter／builder 文件、一个 registry adapter descriptor、可选的 label／i18n 与 CLI alias，以及测试、打包和文档；不需要在 shared query logic 增加来源分支、不需要在 core server/browser state 增加固定 source-home 字段、不需要修改现有 Codex／Claude builder，也不需要 Codex-default canonical fallback。没有引入 plugin SDK、capability framework、mixed-source index 或新的 transcript source。

### Terra focused implementation review and accepted fixes / Terra focused implementation review 与已接受修复

Terra max reviewed the complete staged M0–M4 artifact against base SHA `30ec088e931aa35e3a08cdb2a10a16e8ba8962d3` and returned **Block** with three findings. The review found that image-preview dispatch bypassed the M3 logical/raw ownership boundary, mixed-case index `sourceKind` values could be accepted and then fail during query ownership comparison, and the browser source switch still selected only the first alternative source. / Terra max 基于 base SHA `30ec088e931aa35e3a08cdb2a10a16e8ba8962d3` 检查了完整 staged M0–M4 artifact，结论为 **Block**，共提出三项 finding：image-preview dispatch 绕过了 M3 logical/raw ownership boundary；mixed-case index `sourceKind` 可能被接受但在 query ownership comparison 时失败；browser source switch 仍只选择第一个 alternative source。

The follow-up keeps the approved architecture and makes the smallest boundary fixes: `server.js` now dispatches image previews through `readImagePreviewForSession()`, which validates Index → Session → Logical Event and referenced Raw ownership before adapter access; the Codex preview reader validates the selected source-specific Raw with the same expected owner; canonical dispatch rejects non-canonical casing instead of accepting an index the query cannot consume; and the browser advances through all supported registry source kinds in order with wraparound. / 本轮 follow-up 保持已批准的架构，只做最小 boundary 修复：`server.js` 通过 `readImagePreviewForSession()` dispatch image preview，在进入 adapter 前校验 Index → Session → Logical Event 及其引用的 Raw ownership；Codex preview reader 使用同一 expected owner 校验实际选中的 source-specific Raw；canonical dispatch 拒绝非 canonical casing，不再接受 query 无法消费的 index；browser 按 supported registry source kind 顺序前进并循环。

Regression coverage includes synthetic logical/raw image-preview ownership failures, non-canonical index source ownership rejection, the existing Codex image-preview HTTP path, and a three-source browser registry-cycle test. Terra/Heisenberg targeted re-review subsequently passed; the remaining closure was identified by the fresh Luna review recorded below. / 回归覆盖包括 synthetic logical/raw image-preview ownership failure、non-canonical index source ownership rejection、既有 Codex image-preview HTTP path，以及 three-source browser registry-cycle test。Terra/Heisenberg targeted re-review 随后已通过；剩余 closure 由下方记录的 fresh Luna review 发现。

Post-Terra follow-up verification / Terra 后 follow-up 验证:

- Targeted canonical/source/boundary/Codex tests: `node.exe --test 'test/build-boundary.test.js' 'test/canonical-contract.test.js' 'test/source-switch.test.js' 'test/codex.test.js'` — 116/116 passed.
- Targeted three-source browser test: `node.exe --test --test-name-pattern='browser source switch cycles through every supported registry source' 'e2e/browser.test.js'` — 1/1 passed.
- Targeted image-preview endpoint: `node.exe --test --test-name-pattern='image preview endpoint rehydrates only indexed server-owned image locators' 'test/codex.test.js'` — 1/1 passed.
- Full Node suite: `npm.cmd test` — 490/490 passed.
- Full browser suite: the first rerun had 111/112 passed because one existing home-directory timing test timed out; that test passed alone 1/1, and the complete rerun finished 112/112 passed.
- Build/package/release gates: `npm.cmd run build:check`, `npm.cmd run test:package`, and `npm.cmd run release:check` — all passed; release check included build check, Node 490/490, and Codex/Claude package smoke.
- Syntax and diff checks: changed JavaScript `node.exe --check` loop and `git diff --check` — passed. CI was not run or observed.

Historical M4 verification before the final Luna closure / 最终 Luna closure 之前的历史 M4 验证:

- Targeted boundary/source/contract tests: node.exe --test 'test/build-boundary.test.js' 'test/canonical-contract.test.js' 'test/source-switch.test.js' — 38/38 passed.
- Full Node suite: npm.cmd test — 488/488 passed.
- Full browser suite: npm.cmd run test:browser — first 120-second attempt ended with execution timeout exit 124 and no test failure output; the required rerun with a 300-second limit completed 111/111 passed.
- Build gate: npm.cmd run build:check — generated assets are current.
- Package smoke: npm.cmd run test:package — Codex and Claude Code package smoke passed.
- Release gate: npm.cmd run release:check — build:check, full Node 488/488, and package smoke all passed.
- Syntax gate: a PowerShell loop ran node.exe --check over server.js, all changed src JavaScript, changed Node tests, e2e/browser.test.js, and scripts/package-smoke.js — all passed.
- Diff gate: git diff --cached --check — passed.

The executed tests were the targeted boundary/contract/source-switch tests, the full Node suite, the full browser suite, package smoke, build check, and release check. The package scripts, boundary tests, canonical contract, source-switch tests, design doc, and active plan were inspected before execution. No CI run was started or observed. / 实际执行的测试包括 targeted boundary／contract／source-switch test、全量 Node、全量 browser、package smoke、build check 与 release check。执行前检查了 package scripts、boundary test、canonical contract、source-switch test、design doc 与 active plan。本次没有启动或观察到 CI。

### Luna independent final-review closure / Luna 独立最终评审 closure

The fresh independent Luna review identified two Medium and three Low findings; two Low findings required code closure, while the CLI integration finding was resolved as an explicit documented integration boundary. This pass keeps the approved M0–M4 architecture and addresses only those boundaries: logical detail now resolves and validates every Raw Event referenced by the selected Logical Event, including fail-closed missing references; the legacy `/api/raw` route now uses source-specific lookup followed by shared Index → Session → Raw ownership validation; canonical dispatcher and strict registry lookup require exact explicit source ownership without a Codex default; and the third-source pressure-test wording now records CLI home-option/help integration as a legitimate source-specific surface when needed. / fresh independent Luna review 发现两个 Medium 与三个 Low finding；其中两个 Low 需要代码 closure，CLI integration finding 则通过明确记录的 integration boundary 文档决策解决。本轮保持已批准的 M0–M4 architecture，只处理这些边界：logical detail 现在会解析并校验所选 Logical Event 引用的每条 Raw Event，缺失引用也会 fail closed；legacy `/api/raw` route 现在先执行来源专属 lookup，再进行共享的 Index → Session → Raw ownership 校验；canonical dispatcher 与 strict registry lookup 要求精确且显式的 source ownership，不再有 Codex default；第三来源压力测试文案也明确记录：当新来源需要 CLI 可配置 home 时，CLI home option／help integration 可以是合法的来源专属扩展面。

Regression coverage added in this closure pass includes cross-owned and dangling Raw References plus valid multi-Raw logical detail, equivalent image-preview dangling-reference rejection, synthetic HTTP rejection of malformed legacy Raw ownership, whitespace-padded canonical dispatcher rejection, and strict absent-source registry lookup. The next step is the same fresh Luna reviewer's targeted follow-up; no M4 redesign or self-approval is recorded here. / 本轮新增回归覆盖包括跨来源与 dangling Raw Reference、valid multi-Raw logical detail、image-preview 对 dangling reference 的一致拒绝、synthetic HTTP malformed legacy Raw ownership rejection、canonical dispatcher 对 whitespace-padded sourceKind 的拒绝，以及 strict registry lookup 对缺失 source 的拒绝。下一步是同一 fresh Luna reviewer 的 targeted follow-up；这里不记录 M4 redesign 或自我批准。

Final Luna-closure verification / 最终 Luna closure 验证:

- Narrow regressions: `node.exe --test 'test/canonical-contract.test.js' 'test/build-boundary.test.js'` — 30/30 passed; `node.exe --test --test-name-pattern='image preview endpoint rehydrates only indexed server-owned image locators|legacy raw endpoint rejects malformed canonical Raw Event ownership' 'test/codex.test.js'` — 2/2 passed.
- Existing targeted source/query/boundary set: `node.exe --test 'test/build-boundary.test.js' 'test/canonical-contract.test.js' 'test/source-switch.test.js' 'test/codex-search.test.js' 'test/codex-presentation-context.test.js' 'test/codex.test.js'` — 132/132 passed.
- Full Node: `npm.cmd test` — 497/497 passed.
- Full browser: `npm.cmd run test:browser` — first 304-second attempt timed out with no failure output; the 600-second rerun completed 112/112 passed.
- Build/package/release: `npm.cmd run build:check`, `npm.cmd run test:package`, and `npm.cmd run release:check` — all passed; release check also completed Node 497/497 and Codex/Claude package smoke.
- Syntax/diff: `node.exe --check` over 20 changed JavaScript files and `git diff --check` — passed. CI was not run or observed.

The review packet remains relative to actual base SHA 30ec088e931aa35e3a08cdb2a10a16e8ba8962d3. The current HEAD is unchanged because no review-fix commit was created; the staged diff is the complete M0–M4 implementation plus the accepted Terra follow-up fixes and the final Luna closure pass below. Terra/Heisenberg targeted re-review passed; the next step is targeted follow-up by the same fresh Luna reviewer, and this implementation session does not self-approve the cleanup. / 评审包仍以实际 base SHA 30ec088e931aa35e3a08cdb2a10a16e8ba8962d3 为基准。由于没有创建 review-fix commit，当前 HEAD 未改变，staged diff 是完整的 M0–M4 implementation、已接受的 Terra follow-up 修复以及下方最终 Luna closure pass。Terra/Heisenberg targeted re-review 已通过；下一步是由同一个 fresh Luna reviewer 进行 targeted follow-up，本 implementation session 不自我批准 cleanup。

Current worktree state: HEAD 30ec088e931aa35e3a08cdb2a10a16e8ba8962d3; all 24 changed files are staged; no unstaged changes; staged diff check passes. / 当前工作树状态：HEAD 为 30ec088e931aa35e3a08cdb2a10a16e8ba8962d3；24 个 changed file 全部已 staged；没有 unstaged change；staged diff check 通过。

Complete staged changed-file list / 完整 staged changed-file 列表:

- docs/design-docs/transcript-source-adapters.md
- docs/exec-plans/active/2026-08-14-source-neutral-runtime-cleanup.md
- e2e/browser.test.js
- package.json
- public/assets/app.js
- public/index.html
- scripts/package-smoke.js
- server.js
- src/browser/app.js
- src/canonical-contract.js
- src/codex-code-mode-presentation.js
- src/codex-search.js
- src/codex.js
- src/session-query.js
- src/shared/i18n.js
- src/source-adapters.js
- test/build-boundary.test.js
- test/canonical-contract.test.js
- test/codex-presentation-context.test.js
- test/codex-search.test.js
- test/codex.test.js
- test/package.test.js
- test/runtime-diagnostics.test.js
- test/source-switch.test.js

## Verification log / 验证日志

Post-M2 verification / M2 后验证:

- `npm test` — 469/469 passed.
- `npm run test:browser` — 108/108 passed on the final full run.
- `npm run build:check` — generated assets are current.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- `node --test 'test/build-boundary.test.js'` — 10/10 passed.
- `node --test 'test/source-switch.test.js'` — 9/9 passed.
- `node --test --test-name-pattern='browser treats backslashes as literal characters in POSIX home paths' e2e/browser.test.js` — passed during targeted diagnosis.
- `git diff --check` and syntax checks for `server.js`, `src/source-adapters.js`, `src/session-query.js`, and `src/browser/app.js` — passed.

Sol review-fix verification / Sol review-fix 验证:

- `node --test 'test/codex-search.test.js' 'test/codex-presentation-context.test.js'` — 9/9 passed.
- `node --test 'test/build-boundary.test.js'` — 10/10 passed.
- `node --test 'test/source-switch.test.js'` — 12/12 passed.
- `node --test 'test/runtime-diagnostics.test.js'` — 9/9 passed.
- `node --test 'test/codex.test.js'` — 76/76 passed.
- `node --test --test-name-pattern='browser hydration prefers canonical source configs' e2e/browser.test.js` — 1/1 passed.
- `node --test --test-name-pattern='browser treats backslashes as literal characters in POSIX home paths|browser search registry follows folding profile rule revisions' e2e/browser.test.js` — 2/2 passed.
- `node --test 'test/package.test.js'` — 14/14 passed.
- `npm test` — 472/472 passed.
- `npm run test:browser` — 109/109 passed.
- `npm run build:check` — generated assets are current.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- `node --check server.js; node --check src/session-query.js; node --check src/codex-search.js; node --check src/codex-code-mode-presentation.js; node --check src/codex.js; node --check src/source-adapters.js; node --check src/browser/app.js; node --check scripts/package-smoke.js; node --check test/build-boundary.test.js; node --check test/source-switch.test.js; node --check test/package.test.js; node --check e2e/browser.test.js` — passed.
- `git diff --check` — passed; only expected LF/CRLF normalization warnings were emitted.

Remaining-gap follow-up verification / 剩余 gap follow-up 验证:

- `node --test 'test/source-switch.test.js'` — 12/12 passed.
- `node --test --test-name-pattern='browser hydration prefers canonical source configs over conflicting legacy home fields|browser does not fall back to a legacy home when a canonical source config is malformed' e2e/browser.test.js` — 2/2 passed.
- `node --test 'test/build-boundary.test.js'` — 10/10 passed.
- `npm run build:client` — generated client bundle rebuilt successfully.
- `npm test` — 472/472 passed.
- `npm run test:browser` — 110/110 passed.
- `npm run build:check` — generated assets are current.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- `node --check server.js; node --check src/session-query.js; node --check src/codex-search.js; node --check src/codex-code-mode-presentation.js; node --check src/codex.js; node --check src/source-adapters.js; node --check src/browser/app.js; node --check scripts/package-smoke.js; node --check test/build-boundary.test.js; node --check test/source-switch.test.js; node --check test/package.test.js; node --check e2e/browser.test.js` — passed.
- `git diff --check` — passed; only expected LF/CRLF normalization warnings were emitted.

Final Finding-3 closure verification / Finding-3 最终 closure 验证:

- `node --test 'test/source-switch.test.js'` — 13/13 passed, including the union-of-session-collections and initiating-job-source ownership regressions.
- `npm test` — 473/473 passed.
- `npm run test:browser` — 110/110 passed.
- `npm run build:check` — generated assets are current.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- `node --check server.js; node --check src/session-query.js; node --check src/codex-search.js; node --check src/codex-code-mode-presentation.js; node --check src/codex.js; node --check src/source-adapters.js; node --check src/browser/app.js; node --check scripts/package-smoke.js; node --check test/build-boundary.test.js; node --check test/source-switch.test.js; node --check test/package.test.js; node --check e2e/browser.test.js` — passed.
- `git diff --check` — passed; only expected LF/CRLF normalization warnings were emitted.

Sol re-review follow-up verification / Sol re-review follow-up 验证:

- `node --test 'test/source-switch.test.js'` — 14/14 passed, including canonical options/initial-index initialization, malformed-entry rejection, union ownership, and initiating-job-source ownership regressions.
- `node --test --test-name-pattern='browser hydration prefers canonical source configs|browser does not fall back to a legacy home when a canonical source config is malformed|browser clears stale source config and active home after a later malformed canonical hydration' e2e/browser.test.js` — 3/3 passed.
- `npm run build:client` — generated client bundle rebuilt successfully.
- `npm test` — 474/474 passed.
- `npm run build:check` — generated assets are current.
- `npm run test:browser` — 111/111 passed.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- `node --check server.js; node --check src/session-query.js; node --check src/codex-search.js; node --check src/codex-code-mode-presentation.js; node --check src/codex.js; node --check src/source-adapters.js; node --check src/browser/app.js; node --check scripts/package-smoke.js; node --check test/build-boundary.test.js; node --check test/source-switch.test.js; node --check test/package.test.js; node --check e2e/browser.test.js` — passed.
- `git diff --check` — passed; only expected LF/CRLF normalization warnings were emitted.

Unsupported canonical-key closure verification / Unsupported canonical-key closure 验证:

- `node --test 'test/source-switch.test.js'` — 14/14 passed, including rejection of an initializer map containing unsupported `mystery` alongside valid `codex`.
- `node --test 'test/build-boundary.test.js'` — 10/10 passed.
- `npm test` — 474/474 passed.
- `npm run build:check` — generated assets are current.
- `npm run test:browser` — 111/111 passed.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- `node --check server.js; node --check test/source-switch.test.js` — passed.
- `git diff --check` — passed; only expected LF/CRLF normalization warnings were emitted.

M3 completion verification / M3 完成验证:

- `node --test 'test/canonical-contract.test.js' 'test/source-switch.test.js'` — 19/19 passed, covering synthetic Codex/Claude output, missing fields, ownership mismatch, optional locators, and source-switch ownership regressions.
- `node --test 'test/codex-search.test.js' 'test/codex-presentation-context.test.js' 'test/runtime-diagnostics.test.js' 'test/build-boundary.test.js'` — 28/28 passed.
- `node --test --test-name-pattern='browser applies source config from a 202 indexing-job state|browser search registry follows folding profile rule revisions' e2e/browser.test.js` — 2/2 passed after canonical fixture corrections.
- `npm test` — 479/479 passed.
- `npm run test:browser` — 111/111 passed.
- `npm run build:check` — generated assets are current.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- `node --check src/canonical-contract.js; node --check test/canonical-contract.test.js; node --check src/codex.js; node --check src/codex-search.js; node --check src/session-query.js; node --check src/source-adapters.js; node --check e2e/browser.test.js` — passed.
- `git diff --check` — passed; only expected LF/CRLF normalization warnings were emitted.

M3 ownership-boundary closure follow-up / M3 ownership boundary closure follow-up:

- Root cause / 根因: `validateCanonicalSessionShape()` returns the source-kind string directly, but two shared query consumers attempted to read `.sourceKind`, disabling Session → Event/Raw ownership matching. Accessor-backed `sessions` were also treated as acceptable by the canonical validator to preserve synthetic error-path fixtures, despite the documented adapter contract requiring a data-property Array. / `validateCanonicalSessionShape()` 直接返回 source-kind 字符串，但两个 shared query consumer 错误读取 `.sourceKind`，导致 Session → Event/Raw ownership matching 被关闭。为了保留 synthetic error-path fixture，accessor-backed `sessions` 也曾被 canonical validator 当作可接受，但这与文档规定的 data-property Array 不一致。
- Code change / 代码变更: query consumers now pass `index.sourceKind` into Session validation and pass the resulting kind into Event/Raw validation, closing Index → Session → Event/Raw. `validateIndexOwnership()` is strict by default: accessor-backed `sessions` fail with `CANONICAL_CONTRACT_VIOLATION`; only explicit `allowUninspectableSessions: true` on legacy/synthetic server error fixtures preserves the throwing getter, and adapter build commits never opt in. / query consumer 现在把 `index.sourceKind` 传入 Session validation，再把得到的 kind 传入 Event/Raw validation，锁住 Index → Session → Event/Raw。`validateIndexOwnership()` 默认严格：accessor-backed `sessions` 以 `CANONICAL_CONTRACT_VIOLATION` 失败；只有 legacy／synthetic server error fixture 显式传入 `allowUninspectableSessions: true` 才保留 throwing getter，adapter build commit 永远不 opt in。
- Regression coverage / 回归覆盖: synthetic tests cover Codex raw under Claude, Codex logical Event under Claude, Codex Session under Claude file suggestions, strict accessor rejection/explicit fixture opt-in, and adapter-build rejection before runtime commit. / synthetic test 覆盖 Claude 下的 Codex raw、Claude 下的 Codex logical Event、Claude index 下的 Codex Session file suggestions、strict accessor rejection／显式 fixture opt-in，以及 runtime commit 前拒绝 accessor-backed adapter index。
- `node --test 'test/canonical-contract.test.js' 'test/source-switch.test.js' 'test/codex.test.js'` — 102/102 passed.
- `node --test --test-name-pattern='browser (presents Claude pointer fork context|Raw refs preserve malformed Claude source text|project query transitions|applies source config from a 202 indexing-job state|search registry follows folding profile rule revisions)' e2e/browser.test.js` — 5/5 passed.
- `npm test` — 486/486 passed.
- `npm run test:browser` — 111/111 passed.
- `npm run build:check` — generated assets are current.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- syntax checks for the changed server, contract, query, adapter, builder, and regression-test files — passed.
- `git diff --check` — passed.

Final M3 closure follow-up / M3 最终 closure follow-up:

- Issue 1 / 问题 1: shared detail dispatch validated Index/Session ownership but invoked source-specific detail builders without validating the requested Logical/Raw Event. / shared detail dispatch 已校验 Index／Session ownership，但调用来源专属 detail builder 前没有校验请求的 Logical／Raw Event。
- Root cause → code change / 根因 → 代码变更: `buildEventDetailForSession()` now locates the requested raw record or layer-matching logical event, validates it with the already validated session source kind, and only then dispatches to Codex/Claude detail rendering. Unknown records still return `null`; source-specific builders remain unchanged. / `buildEventDetailForSession()` 现在先定位 requested raw record 或匹配 layer 的 logical event，用已验证的 session source kind 校验，再 dispatch 到 Codex／Claude detail rendering。未知 record 仍返回 `null`；来源专属 builder 未改变。
- Regression test / 回归测试: synthetic Claude index/session with a Codex logical event and with a Codex raw event both fail with `SOURCE_OWNERSHIP_MISMATCH` before adapter dispatch; existing Codex/Claude detail and full browser tests remain green. / synthetic Claude index／session 分别包含 Codex logical event 与 Codex raw event 时，均在 adapter dispatch 前以 `SOURCE_OWNERSHIP_MISMATCH` 失败；既有 Codex／Claude detail 与全量 browser test 继续通过。
- Issue 2 / 问题 2: validation checked Array → Map membership but allowed extra Map sessions. / validation 检查了 Array → Map membership，却允许 Map 中存在 Array 没有的额外 session。
- Root cause → code change / 根因 → 代码变更: `validateIndexOwnership()` now rejects duplicate Array IDs and requires the data-property `sessions` ID set size to equal `sessionsById.size`; existing identity/key checks prove the exact same object set without a second event traversal. Accessor opt-in remains isolated to explicit synthetic server error fixtures. / `validateIndexOwnership()` 现在拒绝 Array 中重复 ID，并要求 data-property `sessions` ID set size 等于 `sessionsById.size`；既有 identity/key check 共同证明完全相同的 object set，且不进行第二次 event traversal。accessor opt-in 仍只保留给显式 synthetic server error fixture。
- Regression test / 回归测试: extra valid Map session and Array session absent from the Map both fail with `CANONICAL_CONTRACT_VIOLATION`; browser synthetic fixtures were synchronized to the same canonical set. / Map 中额外的 valid session，以及 Array 中不存在于 Map 的 session，均以 `CANONICAL_CONTRACT_VIOLATION` 失败；browser synthetic fixture 已同步为相同 canonical set。
- `node --test 'test/canonical-contract.test.js' 'test/source-switch.test.js' 'test/codex.test.js'` — 102/102 passed.
- `node --test 'test/codex-search.test.js' 'test/codex-presentation-context.test.js' 'test/runtime-diagnostics.test.js' 'test/build-boundary.test.js'` — 28/28 passed.
- `npm test` — 486/486 passed.
- `npm run test:browser` — 111/111 passed.
- `npm run build:check` — generated assets are current.
- `npm run test:package` — Codex and Claude Code package smoke passed.
- syntax checks for changed server/contract/query/adapter/builder/test files — passed.
- `git diff --check` — passed.

M3 final invariant confirmation / M3 最终 invariant 确认:

- Query and detail consumption both enforce Index → Session → Event/Raw ownership. / query 与 detail consumption 均强制 Index → Session → Event/Raw ownership。
- `sessions` and `sessionsById` contain the same canonical Session set. / `sessions` 与 `sessionsById` 包含相同的 canonical Session set。
- Accessor-backed synthetic fixtures are explicit exceptions, not accepted production adapter indexes. / accessor-backed synthetic fixture 是显式例外，不是可接受的 production adapter index。
- No second full-index event-validation pass was introduced. / 没有引入第二次 full-index event-validation pass。
- Codex and Claude source-native detail semantics remain source-specific and unchanged. / Codex 与 Claude 的 source-native detail semantics 仍由各自拥有且未改变。

Review packet / 评审包:

- Planning SHA / 规划 SHA: `c731eada6e84175b68a9d47a327b923f79d6364e`.
- Actual implementation base / 实际实现 base: `30ec088e931aa35e3a08cdb2a10a16e8ba8962d3`.
- Current HEAD / 当前 HEAD: `30ec088e931aa35e3a08cdb2a10a16e8ba8962d3`; no review-fix commit was created, so the revised review artifact is the complete staged diff against that HEAD, including this remaining-gap follow-up. / 当前 HEAD 仍为该 SHA；没有创建 review-fix commit，因此修订评审材料是相对该 HEAD 的完整 staged diff，并包含本轮剩余 gap follow-up。
- M0 froze the 466/466 Node and 108/108 browser baseline; M1 moved shared query ownership to `src/session-query.js`; M2 moved runtime/browser source configuration to registry-backed `sourceConfigs` while preserving legacy boundaries.
- Review-fix dependency change: the canonical query now depends only on an explicit generic presentation hook; Codex semantics and presentation-index access enter through the Codex-owned adapter/presentation layer. Canonical source configuration precedence is consistent across server and browser, and source ownership is validated before dispatch/commit. / Review-fix dependency 变化：canonical query 现在只依赖显式的通用 presentation hook；Codex 语义与 presentation-index access 通过 Codex-owned adapter/presentation layer 进入。server 与 browser 的 canonical source configuration precedence 已一致，source ownership 也在 dispatch/commit 前校验。
- Revised review status / 修订评审状态: Sol's architecture re-review approved M1/M2, M3 is complete, and the M4 closeout gates are recorded below. Terra's focused implementation review historically returned Block; its accepted follow-up fixes are recorded above, and Terra/Heisenberg's targeted re-review subsequently passed. / 修订评审状态：Sol 架构复审已批准 M1/M2，M3 已完成，M4 收尾 gate 已在下方记录。Terra focused implementation review 的历史结论为 Block；已接受的 follow-up 修复已记录在上方，Terra/Heisenberg targeted re-review 随后已通过。
- Remaining-gap status / 剩余 gap 状态: canonical source configuration authority now holds across mutation, server initialization, initial-index hydration, and browser stale-state hydration; malformed explicit entries fail closed, sessions reachable through `sessionsById` cannot bypass ownership validation, and the intentional Code Mode response-shape deviation is recorded above. / canonical source configuration authority 现在贯穿 mutation、server initialization、initial-index hydration 与 browser stale-state hydration；显式 malformed entry 会 fail closed；`sessionsById` 可达 session 不能绕过 ownership validation；有意的 Code Mode response-shape 偏差已在上文记录。

## Final review closure / 最终评审收口

The external review sequence is complete: Sol's architecture checkpoint passed; Terra/Heisenberg's focused implementation review initially blocked, then passed targeted follow-up after all findings were fixed; and the fresh Luna/Locke independent final review initially blocked, then passed targeted follow-up with no remaining High, Medium, or Low findings. / external review sequence 已完成：Sol architecture checkpoint 通过；Terra/Heisenberg focused implementation review 初始为 Block，所有 finding 修复后 targeted follow-up 通过；fresh Luna/Locke independent final review 初始为 Block，所有 accepted finding 修复后 targeted follow-up 通过，且不再有 High、Medium 或 Low finding。

The final Luna/Locke follow-up was documentation-only. It confirmed that Terra/Heisenberg's pass history is recorded accurately, stale awaiting-review wording is gone, no additional production-code changes were introduced, and `git diff --cached --check` passes. The previously recorded runtime, browser, build, package, release, and syntax gates remain the final implementation evidence; no CI run was observed. / 最终 Luna/Locke follow-up 只涉及文档。它确认 Terra/Heisenberg 的通过历史记录准确、过时的 awaiting-review 文案已移除、没有新增 production-code change，且 `git diff --cached --check` 通过。此前记录的 runtime、browser、build、package、release 与 syntax gate 仍是最终 implementation 证据；没有观察到 CI 运行。

Status: completed / 状态：已完成
Completed: 2026-08-15 / 完成日期：2026-08-15
Real user transcripts remain outside the repository. / 真实用户 transcript 始终留在仓库之外。
