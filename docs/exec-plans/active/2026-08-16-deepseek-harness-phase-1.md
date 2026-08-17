# DeepSeek Harness Phase 1 — third-adapter source-backed transcript support / DeepSeek Harness 第一阶段——第三 adapter 来源回读转录支持

## Objective / 目标

Implement DeepSeek Harness as a real third transcript source in Session Analyzer, using the existing source-neutral Indexed/Materialized lifecycle and the two-axis Detail purpose × responsibility contract as the specification under test. Deliver a deliberately narrow vertical slice: discovery → IndexedSession → ProjectQueryStore → on-demand MaterializedSession → Main / Protocol / Raw → structured Detail → exact lazy Raw readback, while recording architectural pressure instead of widening shared contracts for adapter convenience. / 将 DeepSeek Harness 实现为 Session Analyzer 的第三个真实转录来源，以现有来源中立 Indexed／Materialized 生命周期和 Detail purpose × responsibility 二维契约为受测规范。交付刻意收窄的垂直切片：发现 → IndexedSession → ProjectQueryStore → 按需 MaterializedSession → Main／Protocol／Raw → 结构化 Detail → 精确惰性 Raw 回读；同时记录架构压力，而不是为了 adapter 便利扩展共享契约。

## Baseline and worktree provenance / 基线与工作树来源

- Repository root / 仓库根目录: `/home/joejack/session-analyzer`
- Branch / 分支: `support-dsh`
- Baseline SHA / 基线 SHA: `3e3d4dbc4a76b52fbe149aaa7f7a37e7e1c1e054`
- Baseline relationship / 基线关系: `HEAD`, `origin/support-dsh`, and `origin/towards-0.2.0` all point to the same merge commit; it is PR #14 (`indexed-materialized-session-lifecycle`) integrated onto the prepared branch. / `HEAD`、`origin/support-dsh` 与 `origin/towards-0.2.0` 均指向同一合并提交；它是已合并到准备分支上的 PR #14（`indexed-materialized-session-lifecycle`）。
- Worktree / 工作树: clean before implementation (`git status --porcelain` empty; `tmp/` is Git-ignored). / 实施前工作树干净（`git status --porcelain` 为空；`tmp/` 已被 Git 忽略）。
- Phase 1 implementation commit / 第一阶段实现提交: `8febb626c74c45fa30627e5609584f2b4958d5ae` (`support-dsh`) / 分支 `support-dsh` 上的 `8febb626c74c45fa30627e5609584f2b4958d5ae`
- Acceptance-hardening implementation head / 验收加固实现 head: `b73b2377a4a719523a3edaa37b09024aeef1d99f` (the closeout documentation commit follows separately) / 验收加固实现 head 为 `b73b2377a4a719523a3edaa37b09024aeef1d99f`（文档收尾提交随后单独提交）
- Architecture verified present / 已确认架构存在: `src/source-adapter-contract.js`, `src/source-adapters.js`, `src/canonical-contract.js`, `src/project-query-store.js`, `src/materialized-session-owner.js`, `src/session-query.js`, `src/shared/logical-detail-contract.js`, `src/shared/detail-purpose.js`, `src/browser/detail-presentation.js`, plus strict `indexed-materialized-v1` Codex and Claude adapters. No blocking contract contradiction found at Checkpoint A. / 上述模块均已存在，Codex 与 Claude 已采用严格 `indexed-materialized-v1`；检查点 A 未发现阻断性契约矛盾。

## Local DeepSeek Harness reference / 本地 DeepSeek Harness 参考

- Path / 路径: `./tmp/deepseek-harness` (Git-ignored, READ-ONLY) / （Git 忽略，只读）
- Git HEAD / Git HEAD: `47f943859bef60e4160492346772ded9b24f765a`
- Branch / 分支: `master`, matches `origin/master` and `origin/HEAD`; worktree clean. / 与 `origin/master`、`origin/HEAD` 一致；工作树干净。
- Source anchor for npm `0.1.0-rc.6`: selected shipped files are byte-identical to this commit, but this plan does **not** claim the npm artifact is byte-for-byte equal to the Git commit. / npm `0.1.0-rc.6` 的源码锚点：若干已发布文件与该提交逐字节一致，但本计划**不**声称 npm 产物与 Git 提交逐字节等同。

## Current-writer fixture evidence / 当前 writer fixture 依据

- Spike root / spike 根目录: `/home/joejack/dsh_playground/spike`
- Writer / writer: `@deepseek-ai/dsh` npm **0.1.0-rc.6**, Node v25.6.1 (spike runtime only; product Node floor is unchanged). / npm **0.1.0-rc.6**，Node v25.6.1（仅为 spike 运行环境；产品 Node 下限不变）。
- Physical current-writer artifacts used as primary evidence / 作为主要证据的当前 writer 物理产物:
  - `spike/fx-home/sessions/--home-joejack-dsh_playground-spike-ws-normal--/session-695bc3a2…/session.jsonl.zstd` (normal tool round)
  - `spike/fx-home/sessions/--home-joejack-dsh_playground-spike-ws-interrupt--/session-d4976b66…/session.jsonl.zstd` (user-aborted partial turn)
  - `spike/artifacts/crash-state.raw.zstd` (SIGKILL interrupted/open-turn artifact; the committed copy ends on a complete-frame boundary, so torn-frame behavior is covered by a synthetic truncated-frame test)
- Decoded inspection artifacts under `spike/artifacts/*` are secondary evidence; physical bytes remain authoritative. / `spike/artifacts/*` 下的解码检查产物是次级证据；物理字节仍是权威。

## Phase 1 support boundary / 第一阶段支持边界

Supported / 支持:

- JSONL backend `session.jsonl` and `session.jsonl.zstd`; committed-prefix reads; no artifact repair. / 支持 `session.jsonl` 与 `session.jsonl.zstd`；committed-prefix 读取；绝不修复工件。
- Header-only discovery without whole-session decompression. / 仅读取 header 的发现，不解压整个会话。
- One physical writer storage record = one Raw Record; packed `text-chunks` / `reasoning-chunks` / `tool-call-chunks` rows remain compact and are never eagerly expanded into retained per-delta Raw/Event objects. / 一个物理 writer 存储记录 = 一条 Raw Record；打包分片行保持紧凑，绝不急切展开为常驻逐 delta Raw／Event object。
- Main: human `user/message` (`source.kind === "user"`), append-origin finalized `assistant/message` (visible text and/or embedded reasoning), exact-`callId` tool operations with preserved incomplete/failed status, and lazy reconstructed partial assistant output when no finalized `assistant/message` exists. / Main：人类 `user/message`（`source.kind === "user"`）、append-origin 最终 `assistant/message`（可见文本和／或内嵌 reasoning）、按精确 `callId` 配对的 tool operation（保留 incomplete／failed 状态），以及在不存在最终 `assistant/message` 时惰性重建的 partial assistant 输出。
- Protocol: lifecycle/request/context records and known-but-unmodeled event families. / Protocol：生命周期、request/context 记录，以及已知但未建模的事件族。
- Raw: exact lazy physical-record readback through typed `dsh-storage-record` locators. / Raw：通过带类型的 `dsh-storage-record` locator 进行精确惰性物理记录回读。
- Structured Detail: adapter-assigned purpose and Primary/Supplemental responsibility, shared fixed Raw References action. / 结构化 Detail：由 adapter 分配 purpose 与主体／补充职责，使用共享固定 Raw References 操作。

Deliberately not modeled in Phase 1: compaction, goal/todo, hooks, approvals/permissions/sandbox changes, retries, subagent descriptors/lineage, Code Mode dispatch, tool workflows, slash-command lifecycle, schedule/feedback/agent-preset/tool-workflow/web-search-llm-request and other plugin-owned durable families. They remain Protocol and/or Raw and are inventoried below. / 第一阶段刻意不建模：compaction、goal/todo、hooks、approvals/permissions/sandbox changes、retries、subagent descriptor/lineage、Code Mode dispatch、tool workflow、slash-command lifecycle、schedule/feedback/agent-preset/tool-workflow/web-search-llm-request 以及其他 plugin 自有持久事件族。它们继续保留在 Protocol 和／或 Raw，并在下方清点。

## Checkpoints / 检查点

- [x] Checkpoint A — baseline, evidence, and executable plan / 基线、证据与可执行计划
- [x] Checkpoint B — storage and discovery / 存储与发现
- [x] Checkpoint C — Indexed projection and normal materialization / Indexed 投影与正常物化
- [x] Checkpoint D — partial streaming and Detail / 部分流式与详情
- [x] Checkpoint E — architecture review and hardening (within the testable local environment) / 架构审查与加固（在可测试的本地环境内）

## Architecture pressure log / 架构压力记录

Findings are recorded here before being hidden behind a workaround. Each finding has affected boundary, DeepSeek evidence, abstraction expectation, actual friction, adapter-local feasibility, whether shared source branching would be needed, classification, severity/blocking status, and disposition. / 发现会先记录于此，再考虑 workaround。每条记录包含受影响边界、DeepSeek 证据、抽象预期、实际摩擦、adapter 本地可行性、是否需要共享代码按来源分支、分类、严重性／是否阻断以及处置。

1. **Generic `home` abstraction vs sessions persistence root** / **通用 `home` 抽象 vs 会话持久化根**
   - Boundary / 边界: source-adapter contract / source switching / CLI
   - Evidence / 证据: DeepSeek's configured root is `~/.dsh/sessions`, not an application home like `~/.codex` or `~/.claude`. The existing contract calls every configured directory `sourceHome` and the browser labels it "home"; deriving `<home>/sessions` would make the editable path the app home while the semantic root is a child. / DeepSeek 的配置根是 `~/.dsh/sessions`，而不是像 `~/.codex`、`~/.claude` 那样的应用 home。既有契约把每个配置目录都叫 `sourceHome`，浏览器还标成 “home”；若采用 `<home>/sessions` 派生，可编辑路径就会变成应用 home，而语义根是子目录。
   - Expectation / 预期: one home directory per source, adapter derives its storage layout beneath it. / 每个来源一个 home 目录，adapter 在其下派生存储布局。
   - Friction / 摩擦: DeepSeek's natural root IS the storage layout; deriving it adds a non-evidenced hierarchy assumption. / DeepSeek 的自然根就是存储布局；派生它反而增加了一个无证据的层级假设。
   - Adapter-local clean? / adapter 本地可解决: yes by setting `defaultHome`/`homeLabel` to `~/.dsh/sessions` and documenting the label as the persistence root. The shared API does not need a branch. / 可以：把 `defaultHome`／`homeLabel` 设为 `~/.dsh/sessions`，并把标签解释为持久化根；共享 API 不需要分支。
   - Classification / 分类: naming/API mismatch / 命名/API 不匹配
   - Severity / 严重性: non-blocking / 不阻断 Phase 1
   - Disposition / 处置: implement adapter-locally; revisit shared terminology before a second persistence-root-shaped source appears. / 在 adapter 本地解决；在出现第二个 persistence-root 形态来源前重新审视共享术语。

2. **Packed storage rows are neither JSONL lines nor logical events** / **打包存储行既不是普通 JSONL 行，也不是逻辑事件**
   - Boundary / 边界: Raw layer / locator contract
   - Evidence / 证据: `text-chunks`/`reasoning-chunks`/`tool-call-chunks` rows expand to ranges of `assistant/chunk` seq values (normal fixture: 39 physical records → 120 logical events; abort fixture: 35 physical records → 285 logical events). / 打包行展开为一段 `assistant/chunk` seq 范围（normal：39 条物理记录 → 120 个逻辑事件；abort：35 条物理记录 → 285 个逻辑事件）。
   - Expectation / 预期: Codex/Claude raw locators were file+line and one line often maps to one logical event. / Codex/Claude 的 raw locator 是 file+line，一行通常对应一个逻辑事件。
   - Friction / 摩擦: Raw identity, rawRefs provenance, and exact readback must refer to physical records, while logical provenance refers to seq values; file+line alone is not the semantic identity. / Raw identity、rawRefs provenance 和精确回读必须指向物理记录，而逻辑 provenance 指向 seq；仅靠 file+line 不是语义 identity。
   - Adapter-local clean? / adapter 本地可解决: yes with `dsh-storage-record` locator carrying session id, artifact path, record ordinal, and optional seq range. No canonical field addition needed. / 可以：使用携带 session id、artifact path、record ordinal 与可选 seq range 的 `dsh-storage-record` locator；无需新增 canonical 字段。
   - Classification / 分类: validates current abstraction / 验证当前抽象
   - Severity / 严重性: non-blocking / 不阻断
   - Disposition / 处置: adopted as the Phase 1 Raw identity; packed rows remain one retained Raw object per physical record. / 已采用为 Phase 1 Raw identity；打包行每个物理记录只保留一个 Raw object。

3. **Node zstd API exists only on newer Node 22/24 releases** / **Node zstd API 只存在于较新的 Node 22/24 版本**
   - Boundary / 边界: storage / toolchain
   - Evidence / 证据: default DSH JSONL artifacts are Zstandard framed; `node:zlib` `zstdDecompressSync` is available on the local Node v25.6.1 and on the documented stricter development matrix (`^22.22.2 || ^24.15.0`), but the package `engines.node` says only `>=22`. / 默认 DSH JSONL 产物为 Zstandard 分帧；`node:zlib` 的 `zstdDecompressSync` 在当前 Node v25.6.1 和严格开发矩阵（`^22.22.2 || ^24.15.0`）上可用，但包的 `engines.node` 只写 `>=22`。
   - Expectation / 预期: a dependency-free decoder works across the entire advertised Node range. / 无依赖解码器应在全部宣传的 Node 范围内可用。
   - Friction / 摩擦: a Node 22.0–22.14 runtime could pass the package engine gate but have no built-in zstd. / Node 22.0–22.14 运行时可能通过 engine gate 却没有内置 zstd。
   - Adapter-local clean? / adapter 本地可解决: yes by capability detection and a clear `DEEPSEEK_ZSTD_UNAVAILABLE` error for compressed artifacts; uncompressed JSONL still works. / 可以：做能力检测，压缩工件缺失时给出清晰的 `DEEPSEEK_ZSTD_UNAVAILABLE`；未压缩 JSONL 仍可用。
   - Classification / 分类: shared abstraction gap / toolchain over-constraint / 共享抽象缺口／工具链过度约束
   - Severity / 严重性: non-blocking for the supported development/runtime matrix; documented as deferred / 对受支持的开发／运行矩阵不阻断；记录为推迟
   - Disposition / 处置: do not raise the engine floor or add a large dependency; keep one-shot built-in zstd and explicit capability error. Revisit the `>=22` runtime wording with a future release. / 不提高 engine floor，也不增加大型依赖；使用一次性内置 zstd 与显式能力错误。未来发布时重新审视 `>=22` 运行环境措辞。

4. **Torn Zstd tail has no committed turn/end, and Harness cold repair is a writer action** / **撕裂 Zstd 尾部没有已提交的 turn/end，Harness 冷加载修复是 writer 动作**
   - Boundary / 边界: Indexed/Materialized lifecycle / logical mapping
   - Evidence / 证据: `crash-state.raw.zstd` has 783 complete committed stored events, an open turn, and no final `turn/end`; the Harness runtime would append synthetic `step/end`+`turn/end{interrupted}` during `prepare()`. / 崩溃态有 783 个完整已提交 stored event、打开状态的 turn，但没有最终 `turn/end`；Harness 运行时会在 `prepare()` 期间追加合成 closers。
   - Expectation / 预期: adapters normally map completed lifecycle brackets. / adapter 通常映射完整生命周期括号。
   - Friction / 摩擦: a read-only analyzer must not synthesize source records or repair the artifact; an open turn must still produce usable Main/Raw evidence. / 只读分析器不能合成来源记录或修复工件；开放 turn 仍必须产出可用的 Main/Raw 证据。
   - Adapter-local clean? / adapter 本地可解决: yes by committed-prefix parsing and an `incomplete` partial-assistant event; no synthetic `turn/end`. / 可以：采用 committed-prefix 解析和 `incomplete` partial-assistant event；不合成 `turn/end`。
   - Classification / 分类: validates current abstraction / 验证当前抽象
   - Severity / 严重性: non-blocking / 不阻断
   - Disposition / 处置: implemented; keep the distinction between analyzer committed-prefix reads and Harness cold repair explicit in docs/tests. / 已实现；在文档与测试中显式区分 analyzer committed-prefix 读取和 Harness 冷修复。

5. **ProjectQueryStore projection parity forces exact duplicate interpretation** / **ProjectQueryStore 投影一致性强制精确的重复解释**
   - Boundary / 边界: Indexed/Materialized lifecycle / query store
   - Evidence / 证据: DeepSeek finalization depends on title events, request/header summaries, packed-row preview joins, and open-turn partial reconstruction; all must be deterministic because Indexed and Materialized query projections are compared by digest. / DeepSeek finalization 依赖 title event、request/header 摘要、打包行 preview 拼接和开放 turn partial 重建；因为 Indexed 与 Materialized 的 query projection 要通过 digest 比较，这些都必须确定。
   - Expectation / 预期: one source parser builds transient complete Sessions for the Index, then request-time materialization re-parses selected artifacts. / 一个来源 parser 为 Index 构建瞬态完整 Session，请求时物化重新解析所选工件。
   - Friction / 摩擦: the parity gate makes every source interpretation an exact digest contract; it is strict but did not require duplicated adapter-local storage—the same parser/projector can be used. / parity gate 让所有来源解释成为精确 digest 契约；虽然严格，但不需要重复的 adapter 本地存储——可复用同一个 parser／projector。
   - Adapter-local clean? / adapter 本地可解决: yes, one deterministic parser + one shared `projectQueryProjectionDigestAsync` path. / 可以：一个确定性 parser + 一条共享 `projectQueryProjectionDigestAsync` 路径。
   - Classification / 分类: validates current abstraction / 验证当前抽象
   - Severity / 严重性: non-blocking / 不阻断
   - Disposition / 处置: implement with a single parser path and add parity tests for normal, abort, and open-turn fixtures plus a synthetic torn-frame storage test. / 用单一 parser 路径实现，并为 normal、abort 与 torn-tail fixture 增加 parity 测试。

6. **Future/unknown event vocabulary must not make the transcript disappear** / **未来/未知事件词汇不得让转录消失**
   - Boundary / 边界: logical mapping / Protocol fallback
   - Evidence / 证据: upstream read path refuses unknown non-`ignorable` types because it cannot safely reconstruct a resumable session. Session Analyzer is read-only and must still show what it can prove. / 上游读取路径会拒绝未知且非 `ignorable` 的类型，因为它不能安全重建可恢复会话；Session Analyzer 是只读的，仍须展示可证明的内容。
   - Expectation / 预期: previous adapters had large recognized protocol vocabularies; unknown material went to Protocol/Raw. / 先前 adapter 有大量已识别 protocol 词汇；未知材料进入 Protocol/Raw。
   - Friction / 摩擦: a strict future version can change the header/envelope, so unknown header versions cannot safely be interpreted through the same parser. / 未来版本可能改变 header/envelope，因此未知 header 版本不能安全地用同一 parser 解释。
   - Adapter-local clean? / adapter 本地可解决: partially. Unknown event types with a known v0 envelope become Protocol+Raw. A future header version is rejected explicitly (`DEEPSEEK_FORMAT_VERSION_UNSUPPORTED`) rather than guessed; raw-preserving vN inspection is deferred. / 部分可解决：v0 envelope 下的未知事件类型进入 Protocol+Raw；未来 header 版本显式拒绝（`DEEPSEEK_FORMAT_VERSION_UNSUPPORTED`）而不是猜测；保留原始字节的 vN 检查推迟。
   - Classification / 分类: shared abstraction over-constraint? No shared branch required; deferred/uncertain / 无需共享分支；推迟／待定
   - Severity / 严重性: non-blocking / 不阻断 Phase 1
   - Disposition / 处置: unknown v0 events use bounded Protocol fallback + Raw; no broad `adapterWarnings` field is added. Future-version raw inspection is a Phase 2 candidate. / 未知 v0 事件使用有界 Protocol fallback + Raw；不增加宽泛 `adapterWarnings` 字段。未来版本 raw 检查列入 Phase 2 候选。

7. **Strict lifecycle requires a legacy Raw owner envelope even for typed-locator sources** / **严格生命周期要求所有来源都有 legacy Raw owner envelope，即使该来源使用 typed locator**
   - Boundary / 边界: Indexed/Materialized lifecycle / canonical contract
   - Evidence / 证据: DeepSeek Raw identity is a physical `dsh-storage-record` ordinal and Raw references route through `/api/sessions/:id/raw/:rawId`; the source never uses the file+line `/api/raw` compatibility route. Strict Index validation still requires `legacyRawOwners` plus `validateLegacyRawOwnerIndex`. / DeepSeek Raw identity 是物理 `dsh-storage-record` ordinal，Raw reference 走 `/api/sessions/:id/raw/:rawId`；来源从不使用 file+line `/api/raw` 兼容路由。但严格 Index 验证仍要求 `legacyRawOwners` 和 `validateLegacyRawOwnerIndex`。
   - Expectation / 预期: every strict adapter carries a legacy Raw owner index. / 每个严格 adapter 都携带 legacy Raw owner index。
   - Friction / 摩擦: DeepSeek must carry a semantically empty but byte-accounted envelope solely to satisfy the shared shape. / DeepSeek 必须携带一个语义为空但字节计数的 envelope，仅为满足共享形状。
   - Adapter-local clean? / adapter 本地可解决: yes; an empty `{}` payload plus exact `accountedBytes` is honest and bounded. / 可以；空 `{}` payload 加精确 `accountedBytes` 是诚实且有界的。
   - Classification / 分类: shared abstraction over-constraint / 共享抽象过度约束
   - Severity / 严重性: non-blocking / 不阻断 Phase 1
   - Disposition / 处置: accepted locally; a future typed-locator-only source should decide whether the legacy envelope becomes optional or remains an explicit no-op. / 本地接受；未来只使用 typed locator 的来源应决定该 legacy envelope 是否可改为可选，或继续作为显式 no-op。

8. **Conformance test swaps IndexedSession objects for MaterializedSession objects** / **Conformance 测试用 MaterializedSession 替换 IndexedSession**
   - Boundary / 边界: Indexed/Materialized lifecycle / source-adapter conformance
   - Evidence / 证据: the source-neutral conformance runner materializes every session and then replaces `index.sessions`/`sessionsById` with complete Sessions. DeepSeek's detail/Raw readers first looked for `materializationDescriptor` on the selected `sessionsById` entry; after that swap the descriptor is absent. / 来源中立 conformance runner 物化每个 session 后，用完整 Session 替换 `index.sessions`/`sessionsById`。DeepSeek 的 detail/Raw reader 原先从所选 `sessionsById` entry 找 `materializationDescriptor`；替换后该 descriptor 不存在。
   - Expectation / 预期: an adapter detail/readback implementation can use the registered Index shape. / adapter 的 detail/readback 实现可以使用注册的 Index 形状。
   - Friction / 摩擦: the shared test boundary blurs Indexed and Materialized identities, so an adapter must infer the artifact from `session.sourceFile` when the descriptor is absent. Production routes are unaffected. / 共享测试边界模糊了 Indexed 与 Materialized identity，adapter 必须在 descriptor 缺失时从 `session.sourceFile` 推断工件；生产路由不受影响。
   - Adapter-local clean? / adapter 本地可解决: yes, with a small fallback; no shared code change. / 可以，用一个小 fallback；无需修改共享代码。
   - Classification / 分类: naming/API mismatch / shared abstraction over-constraint? / 命名/API 不匹配／共享抽象过度约束？
   - Severity / 严重性: non-blocking / 不阻断
   - Disposition / 处置: recorded here; future conformance fixtures could pass an explicit hydrated-context adapter hook instead of replacing the Index. / 记录于此；未来 conformance fixture 可以传入显式 hydration-context adapter hook，而不是替换 Index。

9. **Detail/Raw readback did not enforce the committed Indexed source snapshot** / **Detail／Raw 回读未强制执行已提交 Indexed 来源 snapshot**
   - Boundary / 边界: adapter Detail and Raw readback / source freshness / adapter Detail／Raw 回读与来源新鲜度
   - Evidence / 证据: independent review confirmed that `parsedRecordsForSession()` and `readPhysicalRecordText()` reread the current artifact without the accepted snapshot, while `materializeSession()` already verified file identity, accepted byte length, and accepted-prefix digest. A source mutation after materialization could therefore pair old Indexed/Materialized canonical state with newer Detail/Raw bytes. / 独立评审确认 `parsedRecordsForSession()` 与 `readPhysicalRecordText()` 在不使用 accepted snapshot 的情况下直接重读当前工件，而 `materializeSession()` 已校验 file identity、accepted byte length 与 accepted-prefix digest。因此物化后的来源变更可能把旧的 Indexed／Materialized canonical state 与较新的 Detail／Raw bytes 混在一起。
   - Expectation / 预期: every request-time read for an already Indexed/Materialized Session uses the same committed dependency evidence as materialization; stale changes fail with `INDEXED_SOURCE_STALE`. / 对已 Indexed／Materialized Session 的每次请求期读取都必须使用与物化相同的已提交 dependency evidence；来源不兼容变更必须以 `INDEXED_SOURCE_STALE` 失败。
   - Adapter-local clean? / adapter 本地可解决: yes. One DeepSeek-owned accepted-snapshot read boundary plus dependency-set resolution is sufficient; no shared runtime branch is needed. / 可以。一个 DeepSeek 自有的 accepted-snapshot 读取边界加上 dependency set 解析即可；不需要共享运行时分支。
   - Classification / 分类: lifecycle correctness / source freshness / 生命周期正确性／来源新鲜度
   - Severity / 严重性: blocking for Phase 1 acceptance before fix / 修复前阻断 Phase 1 验收
   - Disposition / 处置: fixed in the acceptance-hardening follow-up. `readCommittedArtifactPrefix()` is now the single snapshot boundary; Detail and Raw resolve the committed dependency entry through `materializationEvidenceForSession()`. Exact file identity + accepted byte length + accepted-prefix digest semantics are preserved, so append, same-length replacement, and missing artifacts fail closed. Deterministic append and same-length-replacement regressions cover logical Detail hydration and Raw readback. / 已在验收加固后续中修复。`readCommittedArtifactPrefix()` 现为唯一 snapshot 读取边界；Detail 与 Raw 通过 `materializationEvidenceForSession()` 解析已提交 dependency entry。保留精确 file identity＋accepted byte length＋accepted-prefix digest 语义，因此 append、等长替换与工件缺失都会 fail closed。确定性 append 与等长替换回归覆盖 logical Detail hydration 与 Raw 回读。

10. **Indexing transiently expanded packed rows through the per-member decoder** / **Indexing 曾通过逐成员 decoder 瞬时展开打包行**
   - Boundary / 边界: DeepSeek indexing and materialization / packed-row representation / DeepSeek indexing／物化与打包行表示
   - Evidence / 证据: independent review confirmed that `parseSessionArtifact()` called `decodeStorageRecord()` for every physical row. For `text-chunks`/`reasoning-chunks`/`tool-call-chunks` that function allocates one synthetic `assistant/chunk` SessionEvent per member, so indexing eagerly expanded the packed representation transiently even though the committed Index did not retain those objects. / 独立评审确认 `parseSessionArtifact()` 对每个物理行调用 `decodeStorageRecord()`。对于三类 chunk 打包行，该函数会为每个成员分配一个合成 `assistant/chunk` SessionEvent，因此 indexing 会瞬时期望展开打包表示，尽管已提交 Index 并未常驻这些对象。
   - Expectation / 预期: during ordinary indexing/materialization packed rows stay packed and are processed structurally; the lossless per-member decoder is reserved for targeted inspection paths. / 普通 indexing／物化期间打包行保持打包并结构化处理；无损逐成员 decoder 只用于定向 inspection 路径。
   - Adapter-local clean? / adapter 本地可解决: yes. `decodePackedStorageRecordFacts()` reads seq0/seqEnd/member count/final time/turn/step/chunk family directly from the physical row. / 可以。`decodePackedStorageRecordFacts()` 直接从物理行读取 seq0／seqEnd／member count／final time／turn／step／chunk family。
   - Classification / 分类: indexing representation contract / packed-row memory discipline / indexing 表示契约／打包行内存纪律
   - Severity / 严重性: blocking for Phase 1 acceptance before fix / 修复前阻断 Phase 1 验收
   - Disposition / 处置: fixed in the acceptance-hardening follow-up. Ordinary indexing/materialization now validates sequence continuity, advances expected seq, updates timestamps, preserves Raw provenance, and builds bounded partial text without calling `decodeStorageRecord()`. A deterministic 4,096-member regression monkeypatches the decoder and proves it is not invoked during index build or materialization; the previous retained-Raw-count test alone was insufficient. / 已在验收加固后续中修复。普通 indexing／物化现在无需调用 `decodeStorageRecord()` 即可校验序列连续性、推进 expected seq、更新时间戳、保留 Raw provenance 并构建有界 partial text。确定性 4,096 成员回归通过 monkeypatch decoder 证明其在 index build 与物化期间从未被调用；仅靠此前的保留 Raw 计数测试是不够的。

11. **Whole-file Detail/Raw readback cost** / **全文件 Detail／Raw 回读成本**
   - Boundary / 边界: Detail hydration and Raw readback / large-session request latency / Detail hydration 与 Raw 回读／大 Session 请求延迟
   - Evidence / 证据: confirmed in the acceptance-hardening follow-up: opening one Detail or Raw record still reads the entire stable artifact, decompresses every committed Zstd frame, and (for Detail) parses every committed physical record before selecting the requested record(s). / 验收加固后续确认：打开一条 Detail 或 Raw 记录仍会读取整个稳定工件、解压所有已提交 Zstd frame，并且 Detail 在选取所需记录前会解析所有已提交物理记录。
   - Expectation / 预期: future large DSH Sessions should have bounded/sequential frame scanning that stops after the required physical record(s); the current one-click cost is performance debt rather than a Phase 1 correctness issue. / 未来大型 DSH Session 应采用有界／顺序 frame 扫描并在读取到所需物理记录后停止；当前单击成本属于性能债务，不是 Phase 1 正确性问题。
   - Adapter-local clean? / adapter 本地可解决: yes in a future DeepSeek storage follow-up; no shared runtime change is expected. / 可以，留给未来 DeepSeek storage follow-up；预计无需修改共享运行时。
   - Classification / 分类: storage read performance / 存储读取性能
   - Severity / 严重性: non-blocking for Phase 1; deferred / 不阻断 Phase 1；推迟
   - Disposition / 处置: recorded here and in the tech-debt tracker. Keep the whole-file behavior for this follow-up; future direction is bounded sequential frame/record scanning that stops once the requested ordinal(s) have been recovered. / 已记录于此及 tech-debt tracker。本次后续保持全文件行为；未来方向是有界顺序 frame／record 扫描，并在取得请求的 ordinal 后停止。

## Known but unmodeled DeepSeek events / 已知但未建模的 DeepSeek 事件

Evidence vocabulary is the generated catalog at upstream `packages/core/session/src/known-event-types.ts` (44 entries at HEAD `47f9438…`), the generated `docs/persistence-catalog.md`, and the current-writer fixtures. Treatment key: **modeled** (dedicated Main/Protocol semantics), **generic Protocol** (recognized, bounded Protocol fallback), **Raw-only** (storage rows with no logical event), **recognized but deferred**, **unsupported due to missing evidence**. / 词汇依据为上游生成目录 `packages/core/session/src/known-event-types.ts`（HEAD `47f9438…` 共 44 项）、生成的 `docs/persistence-catalog.md` 与当前 writer fixtures。处理标记：**modeled**（专属 Main/Protocol 语义）、**generic Protocol**（已识别、有界 Protocol fallback）、**Raw-only**（仅存储行、无逻辑事件）、**recognized but deferred**、**unsupported due to missing evidence**。

| Event type / family | Evidence source / 证据 | In curated fixtures / 精选 fixture 中 | Phase 1 treatment / 第一阶段处理 | Semantic significance / 语义意义 | Phase 2? / 是否 Phase 2 | Expected pressure / 预期压力 |
| --- | --- | --- | --- | --- | --- | --- |
| `session` header | catalog + fixtures | yes | modeled as discovery/materialization header; Raw-only physical record | identity, cwd, createdAt, delegation, seed lineage | no | seed/lineage would need relationship UI if modeled |
| `user/message` (`source.kind:"user"`) | catalog + normal/abort | yes | modeled Main `user_message` | human prompt | no | none |
| `user/message` (`source.kind:"plugin"` and other non-user) | catalog + normal/abort | yes | generic Protocol | injected runtime context | no | none |
| `assistant/chunk` | catalog + fixtures | yes | Raw-only individual record; transient stream state only | token-level replay fidelity | no | none |
| `text-chunks` / `reasoning-chunks` / `tool-call-chunks` | chunk-rows + fixtures | yes | Raw-only compact physical record; lazy partial reconstruction | lossless packed stream rows | no | validates Raw unit ≠ logical event |
| `assistant/message` | catalog + normal | yes | modeled Main `assistant_message`; embedded reasoning may produce Main `reasoning`; embedded tool-call blocks are not duplicated as tool lifecycle | finalized assembled assistant evidence | no | none |
| `tool/call` + `tool/result` | catalog + normal | yes | modeled Main tool operation, exact `callId` pairing | tool execution request/result | no | result metadata / rewrite semantics later |
| `turn/start`, `turn/end`, `step/start`, `step/end` | catalog + normal/abort/crash | yes | generic Protocol; `turn/end` reason preserved in protocol and partial status | lifecycle brackets | no | none |
| `request/header`, `request/context` | catalog + fixtures | yes | generic Protocol with bounded provider/model/capacity summary | request configuration and route context | no | none |
| `session/title`, `session/title-llm-request` | catalog + normal/abort | yes | generic Protocol; last title contributes list title | human/LLM title lifecycle | no | none |
| `permission/preset`, `sandbox/mode`, `approval/policy`, `approval/asked`, `approval/decided` | catalog | first three in fixtures | generic Protocol (policy snapshot facts only) | permission/sandbox/approval audit | yes | approvals/policy presentation |
| `agent/inbox/spliced` | catalog + fixtures | yes | generic Protocol | queued-input inbox mutation | no | none |
| `agent-preset/selected` | catalog | no | recognized but deferred, generic Protocol | durable agent preset selection | yes | preset resolution UI |
| `command/run`, `command/done` | catalog | no | recognized but deferred, generic Protocol | slash-command lifecycle | yes | command lifecycle correlation |
| `compaction/start`, `compaction/summary`, `compaction/end`, `compaction/prune` | catalog + spike compaction artifacts | no curated fixture | recognized but deferred, generic Protocol; append-origin rule prevents replacement surface from becoming human transcript | priced surface compaction | yes | replacement surface projection |
| `feedback/record` | catalog | no | recognized but deferred, generic Protocol | message feedback | yes | none |
| `goal/change` | catalog | no | recognized but deferred, generic Protocol | goal lifecycle | yes | plan/goal facets |
| `hook/invoked`, `hook/result` | catalog + upstream snapshots | no | recognized but deferred, generic Protocol | hook lifecycle | yes | hook correlation |
| `llm/retry`, `llm/retry-started` | catalog + upstream snapshots | no | recognized but deferred, generic Protocol | retry lifecycle | yes | retry grouping |
| `plan/mode` | catalog | no | recognized but deferred, generic Protocol | plan mode lifecycle | yes | plan mode UI |
| `schedule/change` | catalog | no | recognized but deferred, generic Protocol | schedule changes | yes | schedule UI |
| `session/end-seed` | catalog + fork-seed spike | no curated fixture | recognized but deferred, generic Protocol | seed boundary | yes | fork/seed ownership |
| `subagent/descriptor` | catalog + subagent spike | no curated fixture | recognized but deferred, generic Protocol | subagent descriptor | yes | derived session lineage |
| `todo/write` | catalog + upstream snapshots | no | recognized but deferred, generic Protocol | todo snapshot | yes | goal/todo rich mapping |
| `tool-workflow/*` | catalog | no | recognized but deferred, generic Protocol | workflow run lifecycle | yes | workflow UI |
| `tool/code-dispatch`, `tool/code-dispatch-start` | catalog + PTC spike | no curated fixture | recognized but deferred, generic Protocol | Code Mode nested dispatch | yes | nested Code Mode operation |
| `web/deepseek-search-llm-request` | catalog + upstream snapshots | no | recognized but deferred, generic Protocol | auxiliary search LLM request | yes | request provenance |
| Unknown/plugin-owned event types | envelope contract | none | bounded Protocol fallback + Raw; never silently dropped | unknown durable evidence | yes | degradation/versioning UI |
| Future `SESSION_FORMAT_VERSION > 0` | upstream types | none | explicit `DEEPSEEK_FORMAT_VERSION_UNSUPPORTED`; rich interpretation fails closed | future format | yes | raw-preserving vN inspection |

## Test and fixture plan / 测试与 fixture 计划

- Curate minimal synthetic current-writer fixtures under `test/fixtures/deepseek-harness/`: normal `.jsonl.zstd`, user-abort `.jsonl.zstd`, SIGKILL open-turn crash `.jsonl.zstd`, and exactly one small `session.jsonl` generated through the `@deepseek-ai/dsh` 0.1.0-rc.6 persistence writer serialization path (compression `none`). No real user DSH transcript is committed. / 在 `test/fixtures/deepseek-harness/` 下精选最小合成 current-writer fixture：normal `.jsonl.zstd`、user-abort `.jsonl.zstd`、SIGKILL open-turn crash `.jsonl.zstd`，以及恰好一个通过 `@deepseek-ai/dsh` 0.1.0-rc.6 persistence writer 序列化路径生成的压缩 `none` `session.jsonl`。不提交任何真实用户 DSH 转录。
- Deterministic tests: discovery, strict Index shape, query-store parity, materialization, Main/Protocol/Raw, exact lazy raw readback, packed-row retention counts, partial reconstruction, future-version rejection, Detail purpose/responsibility, source switching without DeepSeek branches in browser code. / 确定性测试：发现、严格 Index 形状、query-store parity、物化、Main/Protocol/Raw、精确惰性 raw 回读、打包行保留计数、partial 重建、未来版本拒绝、Detail purpose/responsibility、以及浏览器代码中无 DeepSeek 分支的 source switching。

## Progress log / 进展记录

- 2026-08-17 (Required-environment validation): installed project-local Node `v24.18.1`/npm `12.0.2` under ignored `tmp/`, ran `npm ci` to replace the environment's incorrectly symlinked `esbuild` with the locked `0.28.1`, and ran `npm run release:check` → PASS (build check, 626/626 Node tests, package smoke). Browser suite attempted after installing Playwright Chromium under `tmp/ms-playwright`; see Validation results for the 113/117 environment-limited result. / 安装项目本地 Node `v24.18.1`／npm `12.0.2` 到忽略的 `tmp/`，执行 `npm ci` 将环境中错误 symlink 的 `esbuild` 替换为锁定版本 `0.28.1`，并运行 `npm run release:check` → 通过（build check、626/626 Node 测试、package smoke）。随后在 `tmp/ms-playwright` 安装 Playwright Chromium 并尝试浏览器套件；113/117 的受限结果见验证结果。

- 2026-08-16 (Acceptance-hardening follow-up): started from the committed Phase 1 head `8febb626c74c45fa30627e5609584f2b4958d5ae` with a clean `support-dsh` worktree. Independent-review finding 1 (Detail/Raw source freshness) was **confirmed**: `parsedRecordsForSession()` and `readPhysicalRecordText()` reread the current artifact without the committed accepted snapshot. Independent-review finding 2 (transient packed-row expansion) was **confirmed**: `parseSessionArtifact()` called `decodeStorageRecord()` for every physical row and allocated one synthetic `assistant/chunk` SessionEvent per packed member. Fixed both with one DeepSeek-owned `readCommittedArtifactPrefix()` snapshot boundary and structural `decodePackedStorageRecordFacts()` indexing; the lossless decoder now remains only on targeted Detail paths. Finding 3 (whole-file Detail/Raw cost) was confirmed and deferred as recorded in pressure finding 11 and tech-debt item 20. Added deterministic append and same-length-replacement Detail/Raw regressions and a 4,096-member packed-row no-decoder regression. Implementation head: `b73b2377a4a719523a3edaa37b09024aeef1d99f`. / 从已提交的 Phase 1 head `8febb626c74c45fa30627e5609584f2b4958d5ae` 开始，`support-dsh` 工作树干净。独立评审发现 1（Detail/Raw 来源新鲜度）**确认属实**：`parsedRecordsForSession()` 与 `readPhysicalRecordText()` 未使用已提交 accepted snapshot 直接重读当前工件。独立评审发现 2（打包行瞬时展开）**确认属实**：`parseSessionArtifact()` 对每个物理行调用 `decodeStorageRecord()`，为每个打包成员分配一个合成 `assistant/chunk` SessionEvent。已通过唯一 DeepSeek 自有 `readCommittedArtifactPrefix()` snapshot 边界与结构化 `decodePackedStorageRecordFacts()` indexing 修复两者；无损 decoder 现仅保留在定向 Detail 路径。发现 3（全文件 Detail/Raw 成本）确认属实并推迟，记录于压力发现 11 与 tech-debt 条目 20。新增确定性 append 与等长替换 Detail/Raw 回归，以及 4,096 成员打包行无 decoder 回归。实现 head：`b73b2377a4a719523a3edaa37b09024aeef1d99f`。

- 2026-08-16 (Checkpoint E): implemented `src/deepseek-harness-storage.js`, `src/deepseek-harness.js`, and `src/deepseek-harness-detail.js`; registered `deepseek-harness` in `src/source-adapters.js`; added `--dsh-home`/aliases and help; curated four current-writer fixtures with provenance; added `test/deepseek-harness.test.js` and extended shared adapter conformance with a real DeepSeek fixture. Full Node suite is 621/622 in this local environment, with the sole failure being the pre-existing `npm pack` manifest assertion under the environment's npm 11.17.0 (the repository requires npm 12.0.2 and that npm version auto-includes `docs/README.md` in the pack list). Focused DeepSeek tests are 11/11; source-adapter conformance is 13/13; source-switch tests are 15/15. / 实现三个 DeepSeek 模块；注册 `deepseek-harness`；新增 `--dsh-home` 及别名与帮助；精选四个 current-writer fixture 并记录来源；新增 `test/deepseek-harness.test.js`，并把真实 DeepSeek fixture 纳入共享 adapter conformance。本环境完整 Node 测试为 621/622，唯一失败是既有 `npm pack` manifest 断言在 npm 11.17.0 下的环境差异（仓库要求 npm 12.0.2；当前 npm 会把 `docs/README.md` 自动纳入包清单）。DeepSeek 聚焦测试 11/11、source-adapter conformance 13/13、source-switch 15/15。
- 2026-08-16 (Checkpoint A): recorded branch/SHA, verified clean worktree and present architecture, inspected `tmp/deepseek-harness` HEAD `47f9438…`, inspected current-writer spike fixtures and decoded inventories, created this plan with initial pressure log and unmodeled-event inventory. No production code changed yet. / 记录 branch/SHA，确认工作树干净且架构存在，检查 `tmp/deepseek-harness` HEAD `47f9438…`，检查 current-writer spike fixtures 与解码 inventory，创建本计划、初始压力记录与未建模事件清单。尚未修改生产代码。

## Final Phase 1 verdict / 第一阶段最终结论

### Indexed/Materialized lifecycle / Indexed/Materialized 生命周期

Validated / 已验证:

- The strict lifecycle did not require a resident-complete compatibility shortcut. DeepSeek discovery → strict `IndexedSession` → shared `ProjectQueryStore` → on-demand `MaterializedSession` works as one parser path. / 严格生命周期不需要 resident-complete 兼容捷径；DeepSeek 的发现 → 严格 `IndexedSession` → 共享 `ProjectQueryStore` → 按需 `MaterializedSession` 可用单一 parser 路径完成。
- Packed physical rows remain compact: abort fixture 285 logical stored events become 35 Raw Records; no expanded per-delta objects are retained and `IndexedSession` exposes no `rawEvents`/`logicalEvents`. / 打包物理行保持紧凑：abort fixture 285 个 logical stored event 变成 35 条 Raw Record；不保留逐 delta 展开对象，`IndexedSession` 也不暴露 `rawEvents`/`logicalEvents`。
- Request-time dependency closure is exactly the selected artifact plus its committed-prefix digest/identity, not the whole DSH home or sibling sessions. / 请求时依赖闭包恰为所选工件及其 committed-prefix digest/identity，而不是整个 DSH home 或兄弟会话。
- The materialized projection digest parity gate passed on normal, abort, crash/open-turn, uncompressed, and unknown-event fixtures; the shared boundary rejected no adapter interpretation drift. / normal、abort、crash/open-turn、未压缩与未知事件 fixture 均通过物化投影 digest parity gate；共享边界未发现 adapter 解释漂移。
- Torn/open-turn reads can follow committed-prefix semantics without synthesizing source closers. / 撕裂／开放 turn 读取可以遵循 committed-prefix 语义，无需合成来源 closers。

Awkward / 尴尬之处:

- `legacyRawOwners` is a required strict-Index envelope even for a typed-locator-only source; DeepSeek carries an honest empty envelope (pressure finding 7). / `legacyRawOwners` 是严格 Index 的必填 envelope，即使来源只使用 typed locator；DeepSeek 只能携带一个诚实的空 envelope（压力记录 7）。
- Shared conformance swaps Indexed for Materialized identities, which forced a small adapter-local descriptor fallback (pressure finding 8). / 共享 conformance 会把 Indexed identity 换成 Materialized identity，这迫使 adapter 本地增加一个小 descriptor fallback（压力记录 8）。
- The generic “home” terminology is semantically wrong for `~/.dsh/sessions` (pressure finding 1); no shared API change was needed. / 通用 “home” 术语对 `~/.dsh/sessions` 语义不准确（压力记录 1）；无需修改共享 API。

Shared changes DeepSeek genuinely forced / DeepSeek 真正迫使的共享修改:

- None in `src/canonical-contract.js`, `src/session-query.js`, `src/project-query-store.js`, `src/shared/logical-detail-contract.js`, or browser detail/timeline code. The only shared-surface edits are the registry entry itself, CLI `--dsh-home`/aliases/help, packaging, docs, and tests. / 在 canonical contract、session-query、project-query-store、logical-detail contract 或浏览器 detail/timeline 代码中没有共享修改。唯一共享 surface 修改是 registry entry、CLI `--dsh-home`／别名／帮助、打包、文档与测试。

### Acceptance-hardening follow-up / 验收加固后续

- Finding 1 was **confirmed**: Detail and Raw readback could reread a changed current artifact and mix it with old Indexed/Materialized canonical state. Fixed by making `readCommittedArtifactPrefix()` the single DeepSeek-owned accepted-snapshot read boundary; Detail and Raw now resolve the committed dependency entry and reject append/replacement/missing artifacts with `INDEXED_SOURCE_STALE`. / 发现 1 **确认属实**：Detail 与 Raw 回读可能重读已变更的当前工件，并将其与旧的 Indexed／Materialized canonical state 混合。已将 `readCommittedArtifactPrefix()` 设为唯一 DeepSeek 自有 accepted-snapshot 读取边界；Detail 与 Raw 现在解析已提交 dependency entry，并以 `INDEXED_SOURCE_STALE` 拒绝 append／replacement／工件缺失。
- Finding 2 was **confirmed**: ordinary indexing transiently allocated one synthetic `assistant/chunk` SessionEvent per packed member. Fixed with structural `decodePackedStorageRecordFacts()`; indexing validates sequence/times/partial text directly from the packed row and the per-member decoder is now only a targeted Detail/test utility. / 发现 2 **确认属实**：普通 indexing 会为每个打包成员瞬态分配一个合成 `assistant/chunk` SessionEvent。已用结构化 `decodePackedStorageRecordFacts()` 修复；indexing 直接从打包行校验 sequence／time／partial text，逐成员 decoder 现仅作为定向 Detail／测试工具。
- Finding 3 was **confirmed and deferred**: one Detail/Raw open still reads the whole artifact and decodes/parses all committed physical records. Recorded as pressure finding 11 and tech-debt item 20; future direction is bounded sequential frame/record scanning that stops after the requested ordinal(s). / 发现 3 **确认并推迟**：打开一条 Detail/Raw 仍会读取整个工件并解码／解析全部已提交物理记录。已记录为压力发现 11 与 tech-debt 条目 20；未来方向是有界顺序 frame／record 扫描并在取得请求 ordinal 后停止。
- Shared changes in this follow-up: none. / 本次后续的共享修改：无。

### Detail purpose × responsibility / Detail purpose × 责任

Validated / 已验证:

- DeepSeek assigned `content`/`request`/`result`/`context`/`traceability`/`fallback` directly from source semantics; the shared contract accepted them without title, renderer, source-kind, or producer-order inference. / DeepSeek 直接根据来源语义分配六种 purpose；共享契约接受它们，无需 title、renderer、source kind 或 producer 顺序推断。
- `timelineSections[]`=Primary and `inspectorSections[]`=Supplemental held for user messages, assistant/reasoning content, command request/result, protocol request context, and reconstructed partial evidence. / 用户消息、助手／推理内容、命令请求／结果、protocol request context 与重建 partial evidence 均遵循 `timelineSections[]`=主体、`inspectorSections[]`=补充。
- Raw References remained the exact evidence authority; Main/Protocol `raw_json` appears only for an unknown event as bounded Supplemental `fallback`, and Raw readback returns the physical record text. / Raw References 仍是精确证据权威；Main/Protocol `raw_json` 仅对未知事件作为有界补充 `fallback` 出现，Raw 回读返回物理记录文本。
- The existing shared conformance suite accepted a real DeepSeek fixture alongside Codex and Claude without weakening scenario rules. / 既有共享 conformance suite 在不弱化场景规则的情况下，接受真实 DeepSeek fixture 与 Codex、Claude 并列。

Awkward / 尴尬之处:

- No renderer extension was needed. The main adaptation work was deciding primary versus supplemental request evidence for DeepSeek's single `tool/call` + `tool/result` pair; the shared completed-command scenario correctly required full request evidence to be Supplemental. / 无需扩展 renderer。主要适配工作是决定 DeepSeek 单一 `tool/call` + `tool/result` pair 的主体与补充 request evidence；共享 completed-command 场景正确要求完整 request evidence 属于补充。

Shared changes DeepSeek genuinely forced / DeepSeek 真正迫使的共享修改:

- None. The new adapter uses existing renderer types (`markdown`, `code`, `terminal`, `kv`, `notice`, `token_usage`, `raw_json`) and existing Raw action. / 无。新 adapter 使用既有 renderer type 与既有 Raw 操作。

### Before Phase 2 / Phase 2 之前

- Revisit optionality of the legacy Raw owner envelope for typed-locator-only adapters. / 重新审视 typed-locator-only adapter 的 legacy Raw owner envelope 是否应可选。
- Decide whether the conformance runner should keep Indexed identities and pass an explicit hydration context instead of replacing `sessionsById` with Materialized Sessions. / 决定 conformance runner 是否应保留 Indexed identity，并传入显式 hydration context，而不是用 Materialized Session 替换 `sessionsById`。
- Decide future-version raw-preserving inspection and explicit degradation UI before modeling compaction, goals, hooks, approvals, retries, subagents, workflows, or Code Mode dispatch. / 在建模 compaction、goal、hook、approval、retry、subagent、workflow 或 Code Mode dispatch 之前，先决定未来版本 raw-preserving 检查与显式降级 UI。
- Keep upstream source and current-writer artifacts as separate evidence classes; do not silently reconcile any future disagreement. / 继续把上游源码与 current-writer 工件作为不同证据类别；未来出现分歧时不得静默调和。
- Address the deferred whole-file Detail/Raw readback cost with bounded sequential frame/record scanning before relying on very large DSH Sessions in production workflows. / 在生产工作流依赖超大型 DSH Session 前，以有界顺序 frame／record 扫描解决推迟的全文件 Detail/Raw 回读成本。

## Validation results / 验证结果

Required-environment validation was completed after installing a project-local Node `v24.18.1` + npm `12.0.2` toolchain under `tmp/node-v24.18.1-linux-x64` and restoring exact locked dependencies with `npm ci`. / 在 `tmp/node-v24.18.1-linux-x64` 下安装项目本地 Node `v24.18.1`＋npm `12.0.2`，并通过 `npm ci` 恢复精确锁定依赖后，完成了要求环境验证。

- PASS — `npm run release:check` under Node `v24.18.1` / npm `12.0.2`: generated-asset `build:check` passed, full Node suite passed **626/626**, and package smoke passed for Codex, Claude Code, and DeepSeek Harness. / PASS — Node `v24.18.1`／npm `12.0.2` 下 `npm run release:check`：生成资产 `build:check` 通过，完整 Node 套件 **626/626** 通过，package smoke 对 Codex、Claude Code、DeepSeek Harness 三轮通过。
- PASS — Focused DeepSeek Harness Node tests remain 15/15, including the append/replacement source-freshness regressions and the 4,096-member packed-row no-expansion regression. / PASS — DeepSeek Harness 聚焦 Node 测试保持 15/15，包含 append／replacement 来源新鲜度回归与 4,096 成员打包行不展开回归。
- PASS — Source-adapter conformance 13/13; source-switch plus build-boundary focus 28/28. / PASS — source-adapter conformance 13/13；source-switch 与 build-boundary 聚焦 28/28。
- FAIL (browser test drift + local WSL rendering limit, non-application) — Playwright Chromium was installed under `tmp/ms-playwright`. With a local ignored WSL launch-args shim (`--disable-gpu --disable-software-rasterizer`; required because unmodified headless Chromium does not produce `requestAnimationFrame` frames in this sandbox), the browser suite is **113/117**. Three failures are stale two-source chooser expectations now that DeepSeek Harness is the third registered source; one search-scroll test still times out on WSL wheel/rendering behavior. No product code was changed for these browser results. / FAIL（浏览器测试期望漂移＋本地 WSL 渲染限制，非应用）——Playwright Chromium 已安装到 `tmp/ms-playwright`。使用本地忽略的 WSL 启动参数 shim（`--disable-gpu --disable-software-rasterizer`；必需，因为该 sandbox 中未修改的 headless Chromium 不产生 `requestAnimationFrame` frame）后，浏览器套件为 **113/117**。其中 3 个失败是 DeepSeek Harness 成为第三个已注册来源后，测试仍按旧的两个来源 chooser 顺序断言；1 个 search-scroll 测试在 WSL wheel／rendering 行为下超时。这些浏览器结果没有修改任何产品代码。
