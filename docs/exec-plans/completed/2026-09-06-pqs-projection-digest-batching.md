# PQS Projection Digest Batching — Production Contract

## Status and baseline

PQS_DIGEST_BATCHING: CLOSED_POSITIVE_SIGNAL_NOT_ACCEPTED

PQS_BENCHMARK_RECOVERY: STOP_ENGINEERING_COST_BOUND

PRODUCTION_ACCEPTANCE: NO
NO_BENEFIT: FALSE
PR/MERGE: NO

Closeout only. This document records the frozen candidate, diagnostic evidence, and final cost-stop; it does not accept the candidate into production. The historical valid primary signal remains preserved as OLD_SAME_PROCESS_HARNESS and must never be converted into production acceptance. No production source, tracked test, candidate worktree, corpus, gate, or performance artifact was changed by this closeout. This document is an English-only execution record, not a change to bilingual product specifications.

- Frozen measurement ref: origin/towards-0.2.0 as fetched and verified on 2026-09-06; the measured BASE is the exact commit below.
- BASE_SHA: d8bde19400f634493f9612350b446b650fa0f10e.
- BASE_TREE: d5db345b037d7b52693ed739a1b31dee3f0f79ee.
- Frozen CANDIDATE_SHA: 3da08ca7f077076cea403dc7d59f2090000dd01d.
- Frozen CANDIDATE_TREE: 06ed62bfe460483e8cea020358f5241e7f03b6da.
- Candidate is the direct child of BASE_SHA; both frozen measurement worktrees were clean.
- Post-freeze repository audit on 2026-09-08 fetched origin/towards-0.2.0 and verified root HEAD and the remote ref at ec8694b5c323659cd7a9560de3afa693590d235e, a direct child of the frozen BASE. That later UI commit is outside the candidate evidence and is not a rebind of the measured target.
- Observed local toolchain: Node v24.18.1, npm 12.0.2; Windows, Asia/Shanghai.
- The candidate is preserved without merge or PR. A durable local ref is recorded at refs/heads/archive/pqs-digest-batching-candidate and was created only after confirming that ref name was absent.

Related context: `CONTEXT.md`, `docs/design-docs/indexed-materialized-session-lifecycle.md`, and `docs/design-docs/transcript-source-adapters.md`. No user contract, ownership model, or architecture change is proposed.

## Evidence and decision boundaries

Completed local investigation: `tmp/hash-writer-investigation/RESIDUAL-ASSESSMENT.md`; independent PASS: `tmp/hash-writer-investigation/INDEPENDENT-REVIEW.md`. Mechanism reference: `tmp/hash-writer-investigation/investigation/v2-supplement/candidate-B.diff`; archived raw B phases: `investigation/v2-pre-supplement/` beneath that investigation root. These are local evidence, not tracked dependencies; preserve their hashes and availability in the implementation evidence manifest before relying on them.

B is promoted to planning: stress crypto calls 296,272 → 55 (99.9814% reduction); large/stress clean writer gains 30.83%/32.50%, digest phase 32.58%/32.14%, addSession 24.72%/22.92%, commit 25.14%/24.04%, PQS build+finish+validation 23.06%/22.73%. Digest/cadence parity passed. Whole-project startup was NOT measured. Tiny writer early-call instability remains disclosed. Investigation evidence selects the mechanism, not production acceptance, CI, memory acceptance, or the new candidate's performance.

A_GRAPH_FINGERPRINT: CLOSED_NO_GO_UNCHANGED. Its frozen >=30% fingerprint-phase gate was not met; this is not NO_BENEFIT. Do not reopen, implement, benchmark, or abstract A in this wave.

## Historical contract boundary

The following sections, from tracked scope through candidate handoff, preserve the original execution contract for provenance. Their implementation instructions and gates are historical requirements, not authorization to resume work. The final closeout declaration supersedes their pending-work language.

## Tracked scope ceiling

Allowed production file: `src/project-query-store.js`, confined to the local internal `createProjectionDigestWriter` delivery logic and an adjacent private capacity constant if useful. Keep its interface and exports unchanged.

Allowed focused tests: existing `test/project-query-store*.test.js` files as needed, preferably one new `test/project-query-store-digest-batching.test.js`. This active plan is the only expected documentation change. No new public test exports. Access private functions only through test-local loading/instrumentation, or exercise them through existing public entry points.

Benchmark harness, sealed corpus, manifests, and raw results belong under a new ignored `tmp/pqs-digest-batching-production/` evidence directory. Hash and preserve the harness as a standalone reproducibility artifact; do not transplant the investigation's generic writer, raw-write method, instrumentation, or `__investigation` export into production. A tracked benchmark utility would be a scope expansion requiring prior report/approval.

Forbidden: source-adapters/adapter-contract/Codex/Claude/DeepSeek production edits; canonical or Materialized Session schema changes; browser/query API changes; PQS ownership redesign; immutable proofs; skipping or narrowing validation; derived indexes; caches/interners; generic shared writer; dependency changes; capacity sweep or adaptive sizing. Report a hard requirement to exceed this ceiling and STOP before implementing it.

## Mechanical implementation contract

MECHANISM: 64_KIB_BOUNDED_DIRECT_STAGING.

One writer owns one fixed 65,536-byte Buffer, its occupied byte count, and its SHA-256 hash. No global pool, cross-writer state, retained cache, or additional whole-value Buffer. Only initialized occupied bytes may be passed to crypto; never hash unused allocation contents. Native hash.update consumes each flushed subarray synchronously before reuse.

For each `write(value)`, retain CURRENT conversion: use strings as-is, otherwise `String(value)`. Calculate UTF-8 byte length, form decimal ASCII digits followed by `:`, then deliver prefix and value in that order. Direct Buffer.write encodes small text into staging. Flush occupied bytes when remaining capacity is insufficient. Never slice a UTF-16 string into fragments to fit the buffer. A value <=65,536 bytes whose prefix plus value does not fit may require flushing the prefix separately before writing the complete value. Exact-capacity values must work. For a value >65,536 bytes, flush preceding staged bytes, deliver its prefix, then call native `hash.update(text, 'utf8')` without a temporary whole-value Buffer. Empty values still deliver `0:`. Flush before final `hash.digest('base64url')`. Preserve V2's complete-write checks or prove equivalent bounds in focused tests.

Do NOT use V1's per-segment Buffer.from followed by staging copy. Do not change writeList, writeRow, writeLayer, traversal, or callers. Do not introduce a new raw-byte interface.

Exact stream: UTF8(decimal(Buffer.byteLength(text, 'utf8')) + ':') followed by UTF8(text), for every logical write. Freeze `project-query-projection-v1`, SHA-256/base64url, main/protocol/raw ordering as CURRENT, layer counts, row order, field/list order, boolean encoding and existing lone-surrogate replacement behavior. Batch boundaries have no meaning. Keep schema version 2, store/shard/chunk shapes, dictionaries, gzip policy, projectionDigest format, and all public/serialized boundaries unchanged; no migration or new retained store state.

## Async and validation invariants

Keep `PROJECT_QUERY_VERIFICATION_ROWS_PER_YIELD = 512`, existing row traversal, throwIfAborted checkpoints, onChunk payload/order, setImmediate yield count/order, error ownership and final checks. `validateProjectQueryStoreForCommit` must still perform its structural checks, initial yield, every stored-shard digest reconstruction/comparison, final abort check and validation-state update. Existing `structurallyValidated` behavior is not an optimization opportunity.

Cancellation may discard pending staging in an unfinished hash. Compare observable error, callback and yield traces, and absence of a finalized digest—not partial bytes already delivered to crypto. Never add checkpoint flushes or buffer-full yields. Strict cold materialization uses this writer via materialized_projection; its path is only a secondary control, not an invitation to change adapters.

## Correctness matrix (fresh candidate evidence)

Use an independently preserved CURRENT implementation at BASE_SHA as oracle, not another copy of the candidate algorithm. Compare complete delivered byte streams in separate instrumentation runs as well as final digests. No per-write instrumentation in acceptance timing.

Fixtures: empty Session/empty layers; single and ordinary rows; multiple layers; large Unicode and isolated surrogates; large preview/searchText; long filter/suggestion/declared-request lists; identity and gzip-1 chunks; multiple stored chunks; 65,535/65,536/65,537-byte values and combined-prefix boundaries; partly occupied staging; consecutive oversized values; empty values after oversized values. Include multi-byte characters at fit boundaries and real accepted Sessions.

Exercise every applicable fixture through sync and async projectQueryProjectionDigest, builder-produced digests, stored-shard sync and async verification, and full validateProjectQueryStoreForCommit. Assert exact schema/object/chunk representation parity in addition to digest parity. Record which paths each fixture covers; do not silently skip a path because a helper is private.

Retain existing mutation/corruption failures: changed row metadata/text, list/dictionary contents, row counts/order, digest mismatch, malformed chunks and missing/unexpected Session IDs. Exercise existing structural-validation cache paths without weakening verification. Compare CURRENT/CANDIDATE failure outcomes. Test cancellation initially, at row checkpoints, during stored verification, and final callbacks; use >512 rows and multiple layers/chunks. Capture callback/yield traces and reject digest finalization after abort. Any successful-call stream/digest mismatch: STOP and return to Astra; no iterative patch-until-green without boundary diagnosis.

## Sealed real corpus plan

Planning inventory only found `D:/Users/Yijia/.codex/sessions` present, with 896 JSONL files totaling 3,545,433,755 bytes at observation. This is a live cross-project directory, NOT a frozen corpus, not accepted volume, and not permission to benchmark it in place. No transcript payload was needed for this planning inventory. The deleted 1.922 GB S5 corpus will not be recreated.

During implementation preparation, inventory current Codex project metadata and prefer repoRoot `G:/vibe/session-analyzer`. Select genuine completed transcript files for that project, with required real relationship dependencies. Exclude the active implementation/review Session and files changing across the stability check. Never alter transcript content, duplicate/expand rows, use OCR, or invent a real corpus. If this project cannot qualify, report the insufficiency and obtain a new project choice; do not silently substitute synthetic or cross-project content.

Copy selected files, preserving source-relative layout, into `tmp/pqs-digest-batching-production/corpus/codex-home/`. Hash source before and after copying, verify destination content hashes, reject changing files; freeze destination metadata/source snapshot identities after copy. Both worktrees must read the SAME absolute sealed source root and SAME actual repoRoot, not worktree-specific repo roots. Keep full-content identities separate from source stat identities (exact bigint values as strings where applicable). Do not point production source settings at the copy. Never benchmark the live source root.

Using CURRENT only, qualify and freeze the workload before observing candidate timings: record selected/accepted/rejected file counts and bytes, accepted Session counts, PQS rows per layer and chunk codecs. Require both PQS construction and full commit to exceed 100 ms median over three diagnostic fresh processes. This is a measurement floor, not a performance gate. If insufficient, add genuine completed same-project transcripts and reseal before candidate comparison. If unavailable, formal acceptance is blocked pending a suitable real workload; no gate relaxation. Select a disjoint small real subset for tiny control and a moderate subset for ordinary control before candidate timing.

Manifest: original source root, sealed root, actual repo root, source kind, stable relative paths, selected and accepted file counts/bytes, per-file SHA-256, deterministic aggregate manifest hash (UTF-8 ordinal path order and explicit encoding), source snapshot identities, rejection reasons, timezone/OS/build/architecture, Node/npm/executable versions, target SHA/tree. Hash verification runs outside timed intervals and before/after each block. Keep private payloads local, not in PR artifacts; publish only appropriate non-content evidence.

## KPI boundaries and measurement harness

The production server route is POST `/api/project` → startProjectJob → adapter.buildIndex → validateIndexOwnershipForCommit → installIndexRevision → succeeded status with state. `job.buildMs` ends before revision installation and is not the primary project-ready metric.

Primary clean harness: use the unchanged createServer and real adapter, empty initial index/cache, fresh process and ephemeral local port. Start the monotonic timer immediately before POST `/api/project`; stop after the first GET `/api/project/status?jobId=...` response showing succeeded plus installed project state. Poll sequentially every 5 ms (no overlapping requests); include request/response/poll overhead consistently. Validate repoRoot, Session count and revision presence. Report this as production-equivalent backend project readiness, not browser paint or process-launch latency. Preserve default prewarm/diagnostics configuration identically and freeze log destination/options; do not disable ownership checks or use buildIndexOverride. Do not stop at build completion. Use the same harness bytes for both worktrees.

Phase measurement is a SEPARATE paired cohort with coarse boundary timers, not per-write probes. Test-local module wrapping may time exported boundaries before dependent modules load; preserve receiver, arguments, errors and returned values/promises. It must leave production files unchanged and establish trace/result parity against the clean harness. If wrappers cannot faithfully measure a boundary, stop for harness review, not production hooks.

| Metric | Frozen boundary |
| --- | --- |
| T0 | Entire real adapter.buildIndex call; includes nested PQS construction, not additive to it |
| T_PQS_BUILD | Sum of createProjectQueryStoreBuilder construction, full addSession calls and finish; includes row work/compression in those calls |
| T_COMMIT | Entire validateIndexOwnershipForCommit call including full PQS validation; record nested full validateProjectQueryStoreForCommit separately |
| T_BUILD_VALIDATION | T0 + T_COMMIT for that process; no double-counting nested PQS times |
| T_PQS_BUILD_VALIDATION | T_PQS_BUILD + nested full PQS commit validation; supporting gate, distinct from T_BUILD_VALIDATION |
| T_PROJECT_READY | Clean HTTP start-to-installed-success-state completion above; primary user-facing KPI |

Do not infer T_PROJECT_READY from any sum or the old 23% result. Record all phase intervals/raw outputs. Extra clean writer diagnostics and call-size characterization are separate, non-acceptance cohorts. Do not use the legacy profile script's private-proof experiments or old baselines as the formal harness.

## Balanced formal design and gates

For EACH clean large project-ready cohort and separate large phase cohort: 16 fresh processes, four chronological blocks: CURRENT/CANDIDATE/CANDIDATE/CURRENT; CANDIDATE/CURRENT/CURRENT/CANDIDATE; repeat those two blocks. Here A/B order notation means CURRENT/CANDIDATE, never graph Candidate A. Eight samples per arm; one first project build per process; no in-process warmup. Never run arms concurrently. Freeze options, source/repo paths, environment, background-service policy, power settings and harness hashes first. OS filesystem cache is uncontrolled/warm-normalized: run one untimed read-only corpus pass before each block; claim process/application-cold, not disk-cold.

Gain = 100 × (1 - candidate median/current median). Overall median uses all eight raw values per arm. Each block compares its two candidate values' median with its two current values' median; positive means strictly >0. Do not average percentage improvements or claim statistical significance. No post-hoc sample removal. Record failed jobs/environment disturbances; invalidate the affected cohort, preserve all raw evidence and rerun the full cohort only after a documented cause is addressed.

Required gates:

- Clean T_PROJECT_READY overall improvement >=2.0%, with >=3/4 positive blocks.
- Formal T_PQS_BUILD_VALIDATION improvement >=15%. Full PQS commit improvement >=15% is a preferred supporting target; falling below it requires explicit Astra explanation/decision, not concealment. Failing the required supporting or primary gate means no production acceptance even if writer-only improves.
- Ordinary/tiny/control: block on a repeatable end-to-end regression BOTH >2% AND >5 ms. If first cohort breaches both, run one independently scheduled identical 16-process confirmatory cohort; require the breach overall and >=3/4 regressing blocks in both to classify repeatable. Otherwise disclose uncertainty, without claiming universal neutrality. Do not pool confirmation and initial samples.
- Correctness, async, unchanged schema/validation, scope and no unbounded retained state are mandatory regardless of speed.

Tiny control: its own 16-process balanced clean cohort, no digest/build prewarming; record first PQS build, first commit in a separate first-call phase cohort, and full tiny project ready in clean cohort. Never combine these with warmed results. Optional warmed writer diagnostic stays separately labeled; 30× warmup cannot substitute for tiny project acceptance.

Ordinary project-ready and controls use the same balanced process design. After required setup outside each control interval, measure one cold materialization with an empty Materialized Session cache, then exact warm hit, and ordinary timeline/query against fixed IDs/options; freeze Session/query selections on CURRENT first. Keep control results separate from initial project-ready samples. Materialization gains are SECONDARY_SHARED_WRITER_EFFECT only; material regressions follow the regression gate. No A writer changes or performance attribution.

## Memory and concurrent lifetime

Separate fresh-process memory cohort on the formal large workload uses the same 16-process balanced order. Record RSS, heapUsed, external, arrayBuffers, process.resourceUsage().maxRSS with units, at startup/build/commit/ready and after settled work; record sampling interval and GC policy. If explicit-GC diagnostics are added, put them in a separate identically configured cohort, never timed acceptance. Report observations descriptively; do not claim memory improvement or equate staging size with process peak.

Invariant: one 65,536-byte allocation per active writer, no cross-Session/global retained state. Async writers can overlap while yielded, including strict cold materialization; synchronous writers cannot yield but can be nested through callbacks. Additional staging bound is 65,536 × simultaneously reachable writer instances, not 65,536 for the whole process. Audit actual scheduler/prewarm limits and builder lifetime, and run separate supported concurrent-materialization diagnostics using those limits. Report completed-writer release/GC observations and count assumptions. A repeatable material process-memory increase requires diagnosis before acceptance; NO_UNBOUNDED_RETAINED_STATE is mandatory, no arbitrary RSS-improvement claim.

## Candidate freeze, validation and handoff

1. Luna Max starts a fresh implementation context from this contract after authorization. Reverify baseline; establish isolated CURRENT and CANDIDATE worktrees from this exact base. Implement local V2 mechanically; consult the investigation diff only as reference. Never copy its exports/generic helper. Complete focused parity first.
2. Prepare/seal/qualify real corpus, tiny/ordinary selections, and validate clean/phase harnesses. Freeze sample design before candidate timing. Implementation readiness does not mean the corpus or harness already exists.
3. Run focused PQS tests, affected source-adapter lifecycle tests, package tests, full npm test, build check and diff check. Suggested exact commands: `node --test test/project-query-store*.test.js`; `node --test test/source-adapter-contract.test.js test/source-adapter-conformance.test.js test/codex-indexed-materialization.test.js test/materialized-session-owner.test.js test/index-revision-server.test.js`; `node --test test/package.test.js`; `npm test`; `npm run build:check`; `npm run test:package`; `git diff --check`. Record commands, versions, exit codes and raw output; do not claim CI from local tests.
4. With normal git authorization, freeze BASE_SHA/BASE_TREE and CANDIDATE_SHA/CANDIDATE_TREE, changed paths, per-file SHA-256, canonical binary diff SHA-256 (raw bytes, not PowerShell re-encoding), clean status, corpus/environment/harness manifests. Use one exact parent, not unrelated worktree HEADs. No formal timing until freeze is complete.
5. Run fresh correctness and formal timing/memory evidence against the frozen candidate. Any code change creates a new candidate and invalidates formal timings; no amendment to a timed candidate. Freeze result artifacts separately so evidence logging does not alter source identity. Later documentation-only commits must be separately identified and must not be misrepresented as the measured SHA.
6. Fresh Luna Max reviewer receives only frozen contract, base/candidate SHA/tree, final diff, raw correctness and benchmark output, corpus/environment/harness manifests; no implementer reasoning as evidence. Review exact stream, capacity/oversized behavior, async, schema/validation, fairness, first-call behavior, memory, scope and claim limits. Astra independently arbitrates every gate. Investigation PASS is not acceptance.
7. Before merge, require GitHub Node 22 Ubuntu, Node 24 Ubuntu, Node 24 Windows, Browser Ubuntu, Package smoke Ubuntu/Windows and aggregate ci, all for the proposed revision. Windows is ordinary required coverage, not a reopened BigInt incident. One focused PR only after acceptance; proposed commit/title: `perf(pqs): batch projection digest writes`. No PR or commit was performed; the final closeout below records the stop. This plan is archived under completed as a non-acceptance closeout even though production work did not conclude; no shipping decision follows.

STOP on parity failure, altered async/error behavior, ownership/proof/schema proposals, missing real-workload qualification, unfrozen/changed candidate, invalid benchmark, failed required gate, or scope expansion. Return the specific blocker to Astra; do not lower thresholds, broaden architecture, or productionize on microbenchmark benefit.

## Progress log and final closeout declaration

2026-09-06: historical planning record — fetched explicit target, verified SHA/tree, read independent investigation closure and V2 B diff, audited writer/async/full commit/server-ready boundaries, checked package/CI commands and metadata-only source availability. At that time, corpus seal, implementation, candidate freeze, fresh tests, performance/memory acceptance and CI were pending; the subsequent candidate and bounded-stop records are captured below.

## Final closeout — 2026-09-08

### Authority and outcome

The final decision is frozen as follows:

- PQS_BENCHMARK_RECOVERY: STOP_ENGINEERING_COST_BOUND.
- PQS_DIGEST_BATCHING: CLOSED_POSITIVE_SIGNAL_NOT_ACCEPTED.
- PRODUCTION_ACCEPTANCE: NO.
- NO_BENEFIT: FALSE. Positive writer/correctness/diagnostic signals remain provenance only; they do not become a product-acceptance claim.
- PR/MERGE: NO. No closeout commit, PR, merge, CI claim, or production rollout occurred. The existing frozen candidate commit remains unmerged.

The engineering-cost stop is a bounded stop on evidence infrastructure, not a claim that the mechanism is impossible and not a product-failure finding. The unmerged candidate remains an implementation artifact only.

### Archive provenance and resolved root-plan discrepancy

At the initial closeout audit, the root worktree was clean and `docs/exec-plans/active/2026-09-06-pqs-projection-digest-batching.md` was absent, although FINAL-COST-STOP.md described an earlier untracked copy there. Closeout review paused on that discrepancy. On 2026-09-08 the user confirmed that the root copy had leaked from the independent worktree and had already been cleaned up, and accepted its absence. This explanation resolves the root-plan discrepancy; it does not change any frozen measurement identity or evidence.

This completed record archives the contract preserved at `docs/exec-plans/active/2026-09-06-pqs-projection-digest-batching.md` in candidate commit `3da08ca7f077076cea403dc7d59f2090000dd01d`: Git blob `1ad5ac9a096c981ce2afa6628b5429cc14e0f7e9`, file SHA-256 `d5c74c7e83af7131050a1987ba8eff383648737acce97c17d8e9cfda910ff5a0`. Because the root copy was already absent, the proposed root diff adds a completed record rather than renaming an active file. The frozen candidate's original active-path copy remains unchanged for provenance. No plan or evidence was deleted in this closeout.

### Frozen identities and evidence

| Item | Identity |
| --- | --- |
| CURRENT measurement commit/tree | d8bde19400f634493f9612350b446b650fa0f10e / d5db345b037d7b52693ed739a1b31dee3f0f79ee |
| CANDIDATE measurement commit/tree | 3da08ca7f077076cea403dc7d59f2090000dd01d / 06ed62bfe460483e8cea020358f5241e7f03b6da |
| Durable local candidate ref | refs/heads/archive/pqs-digest-batching-candidate -> 3da08ca7f077076cea403dc7d59f2090000dd01d |
| CURRENT source identity | c321dc1b8e18eb590950a653a11b3f33423a3a104c32c38a1563aa19b5619eb5 |
| CANDIDATE source identity | 770a8bc3883667edfac7a1743f7f2f3e1d1b3605789d76044f981e97bde8e7c1 |
| Frozen manifest | tmp/pqs-digest-batching-production/manifests/freeze.json, SHA-256 1685c781b576c1060173c23fc1c7565c3d82e27961170e9c984bb29280055128 |
| Canonical candidate/base diff | tmp/pqs-digest-batching-production/raw/candidate-base.diff, SHA-256 f4b48f0351269f5959e7717873d528328d4f629f52c7d0412d09d07d86cb7fdd, 37085 bytes |
| Stream CURRENT / CANDIDATE | raw/stream-current.json SHA-256 ae2c94d9d32e3da9320ed805e73292a54fa81b62e472afc5c66398dfff8c190c / raw/stream-candidate.json SHA-256 c5a0d12a0e824ad0c154d9bc588bde2243dfcba061f20de419723bc6e688c51 |
| Focused validation record | raw/validation-summary.md, SHA-256 0f0649a12c87f1eafd448d6a75474040e78e9a08914903a15028065839a3ef97 |

The candidate's delivered stream and digest parity was recorded for the frozen fixtures and sealed workload. This is correctness/provenance evidence only; it does not waive the required performance, memory, CI, or review gates.

### Historical primary signal — preserved, not accepted

The only valid primary project-ready signal remains the old same-process clean cohort:

- HISTORICAL_VALID_PRIMARY: OLD_SAME_PROCESS_HARNESS.
- T_PROJECT_READY: 20696.07 -> 19886.52 ms.
- GAIN: 3.91% (raw calculation 3.9116292158983823%).
- POSITIVE_BLOCKS: 4/4.
- Raw artifact: tmp/pqs-digest-batching-production/evidence-repair/raw/formal-large-clean-v1.json.
- Raw artifact SHA-256: b7080303e6b758965554912a17bc4c1d87b55e46d0a19e6e1cfbf39137b8e64c.

Do not recalculate, pool, or causally decompose this result with the later split-process transport/phase work. It is not candidate production acceptance, and it does not change PRODUCTION_ACCEPTANCE: NO.

### Final stop evidence and unresolved gates

The final bounded stop is recorded in tmp/pqs-digest-batching-production/autonomous-recovery/FINAL-COST-STOP.md (SHA-256 5bdb543dd94e651657c67e0f43e85c9784d32f459247ef05669049abe1c9f479). It records no formal remeasurement after the cost stop, no formal phase or memory cohort, and no production acceptance.

The v5 independent stop review is tmp/pqs-digest-batching-production/phase-completion-repair-v5/FRESH-STOP-REVIEW.md (SHA-256 65b54d3cd76c6d12d61ca9b77dd34c2ebee8439232dcc3e8f63a429fe4a68562); its qualification summary SHA-256 is 2e9fb567e565103d613a444bfbfc54b9b547c5bbf40cf7eb2109c26850d056d8 and its mode summary SHA-256 is fcc7150259132042c8e8350bf77430147b687aca8d909cac44c165e493c811dc. The v5 stop is attributed to the evidence-harness output-directory ownership collision (REFUSING_OVERWRITE), with no retry or sixth generation.

Gate disposition:

- Frozen correctness/stream parity and focused candidate validation passed as recorded; no closeout rerun was needed.
- The earlier pre-freeze cohort (`raw/large-ready.json`) was invalid due to a transport/cleanup failure. Its corrected diagnostic rerun (`raw/large-ready-rerun.json`) reported 0.9177488691213931% overall gain and 2/4 positive blocks, below the frozen primary gate, and is not formal frozen-candidate acceptance evidence. These records are distinct from, and do not invalidate or supersede, the preserved historical valid primary cohort (`evidence-repair/raw/formal-large-clean-v1.json`: 3.91%, 4/4).
- The required >=15% T_PQS_BUILD_VALIDATION supporting gate remains unresolved; the preferred >=15% full PQS commit target remains unresolved.
- Formal phase, memory, tiny, ordinary, and secondary cohorts were not completed after the primary stop; NO_UNBOUNDED_RETAINED_STATE therefore remains an outstanding acceptance gate, not a pass claim.
- Required CI matrix, fresh independent acceptance review, PR, merge, and production rollout were not performed.

### Transport-harness provenance

Only the provenance needed to explain the stop is retained here. new-split-reset-bridge/FRESH-REVIEW.md and autonomous-recovery/BRIDGE-ARBITRATION.md classify the fixed synthetic server-timeout/reset bridge as CONFIRMED_WITH_LIMITS: process separation alone was insufficient for that fixed synthetic case, but the evidence does not prove every historical chronology or universal product failure. The subsequent split completion-control work remained benchmark infrastructure, not a production HTTP fix. FINAL-COST-STOP.md records the bounded v5 stop after successive independent harness defects. No server timeout, keep-alive, retry, polling, source, schema, validation, corpus, gate, or numerical evidence was changed for this closeout.

### Revisit condition and local retention

Revisit only with explicit renewed authorization and a new engineering-cost budget. First stabilize and independently review the supervisor/child output-directory and lifecycle contracts; then establish a new frozen base/candidate pair, rerun qualification, and rerun every required formal gate from scratch. No historical primary sample, diagnostic sample, transport repair sample, or failed cohort may be reused as acceptance evidence. This condition does not authorize a production timeout or keep-alive workaround.

Preserve-required local records are the CURRENT and CANDIDATE worktrees, the durable candidate ref, the sealed corpus and its manifests, raw stream/validation/benchmark artifacts, the autonomous-recovery final decision, the v5 stop review/summary, and the transport bridge records named above. Cleanup-safe candidates, not deleted here, are reproducible dependency installs under isolated worktrees and superseded harness working copies/logs after a separate retention decision; raw results, summaries, manifests, and failure records are not cleanup-safe until independently archived. No file, worktree, corpus, evidence artifact, or ref was deleted.

### Closeout validation record

Read-only closeout checks included:

- git fetch --no-prune origin towards-0.2.0 — succeeded; remote and root HEAD both remained ec8694b5c323659cd7a9560de3afa693590d235e.
- git worktree list --porcelain — confirmed the root, CURRENT, CANDIDATE, and related worktrees; CURRENT/CANDIDATE statuses were empty.
- git rev-parse and git cat-file checks — confirmed the frozen commits/trees and the candidate parent/base relationship.
- Existing validation record: candidate focused digest-batching test 3/3 passed; node check and diff check passed; direct project-query-store suites 51/51 for each arm, source-adapter focused suites 83/83, build check, and package smoke passed. Full npm test recorded 1020/1021 with the existing missing candidate/node_modules/highlight.js/LICENSE environment dependency; no dependency or package file was changed to mask it.
- No benchmark, test, source, candidate, corpus, gate, or performance evidence was rerun or edited during this closeout.
```text
PQS_DIGEST_BATCHING: CLOSED_POSITIVE_SIGNAL_NOT_ACCEPTED
PQS_BENCHMARK_RECOVERY: STOP_ENGINEERING_COST_BOUND
PRODUCTION_ACCEPTANCE: NO
NO_BENEFIT: FALSE
PR/MERGE: NO
HISTORICAL_PRIMARY: OLD_SAME_PROCESS_HARNESS
HISTORICAL_T_PROJECT_READY: 20696.07 -> 19886.52 ms
HISTORICAL_GAIN: 3.91%
HISTORICAL_POSITIVE_BLOCKS: 4/4
BASE_SHA: d8bde19400f634493f9612350b446b650fa0f10e
BASE_TREE: d5db345b037d7b52693ed739a1b31dee3f0f79ee
CANDIDATE_SHA: 3da08ca7f077076cea403dc7d59f2090000dd01d
CANDIDATE_TREE: 06ed62bfe460483e8cea020358f5241e7f03b6da
CANDIDATE_REF: refs/heads/archive/pqs-digest-batching-candidate
PQS_SCHEMA: UNCHANGED
DIGEST_PROTOCOL: UNCHANGED
COMMIT_VALIDATION: UNCHANGED
ASYNC_CADENCE: UNCHANGED
SUPPORTING_PQS_GATE: UNRESOLVED
MEMORY_GATE: UNRESOLVED
CI_AND_REVIEW: NOT_COMPLETED
DELETE: NONE
REVISIT: NEW_AUTHORIZATION_AND_RENEWED_COST_BOUND_REQUIRED
```
