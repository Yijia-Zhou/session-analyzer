# README showcase refresh / README 展示场景更新

Status: completed locally after maintainer approval, 2026-09-19. / 状态：维护者批准后本地完成，2026-09-19。

Latest revision: the provenance example is an ordinary `subagent` named `Docs`,
delegated to write search navigation usage examples using inherited implementation
context. It is no longer a review story. The scenario key and manifest now use
`subagent-child`; the existing synthetic session ID remains unchanged. Nineteen
materializer/story/fork tests passed, and the browser displays `Subagent Docs`
with ten inherited Main events and a working Open parent action. The final
provenance GIF remains 1440×900 / 90 frames / 9s; its source keyframes/concat are
`branching-subagent/` and `branching-subagent.txt`. Other candidates are unchanged.
The tracked bilingual READMEs now use the subagent alt text/caption and relative
media links to the approved files in the current checkout.

最新修订：来源示例改为名为 `Docs` 的普通 `subagent`，利用继承的实现上下文撰写
搜索导航使用示例，不再使用 review 故事。场景 key 与 manifest 改用 `subagent-child`，
原合成会话 ID 保持不变。十九项物化／故事／fork 测试通过，浏览器显示 `Subagent Docs`、
十个继承 Main 事件，返回父会话操作有效。最终来源动图仍为 1440×900／90 帧／9 秒，
关键帧和拼接输入改用 `branching-subagent/` 与 `branching-subagent.txt`。其他候选不变。
受版本管理的双语 README 已同步采用 subagent 替代文本／图注，并使用相对媒体
链接引用当前 checkout 中获批的文件。

## Scope and decisions / 范围与决定

- Selectively incorporate reads before the first patch and between test failure
  and repair; keep the shared README scenario in English. / 选择性吸收首次补丁前及
  测试失败与修复之间的读取，共用 README 场景保留英文。
- Baseline: `c5bc304898ddccdf2cb4700a2e571e5079d342bb`; the original checkout's
  scenario matched it before this change. Video source:
  `G:/vibe/session-analyzer-studio/runtime/analyzer/showcase/scenarios/readme/scenario.js`.
  The failure-realism `scenario-before.cjs` was not treated as the original baseline.
  / 基线为上述 commit，原仓库修改前的场景与其一致；视频来源如上，未把报错改进
  前的备份误当成全部修改前的基线。
- Keep helper-based authoring; align source, patch hunks, assertion and read line
  numbers, plan status, and both spec-reporter outputs. / 保留辅助函数写法，对齐
  源码、补丁、断言与读取行号、计划状态及前后 spec reporter 输出。
- Preserve the original presentation roles after user review: Timeline hero with
  the successful command expanded, Timeline/Trajectory reading comparison, and
  expanded patch inspection. Only the dedicated Trajectory image uses that view.
  GIFs retain concrete operations and use short real scrolls when needed.
  / 根据用户审阅，保留原呈现分工：Timeline 主图展开成功命令、Timeline／Trajectory
  阅读对照、展开补丁检查。仅专门的 Trajectory 图片使用该视图；动图保留具体操作，
  空间不足时使用短暂的真实滚动。
- The new regression test validates only the isolated synthetic search module
  (11 pass / 1 fail, then 12 pass). Timings/stack excerpts and neighboring stories
  remain authored. No claim of a real complete agent/task-board run. / 新校验只
  验证隔离合成搜索模块；时长、堆栈节选及相邻故事仍为编写内容，不声称完整真实执行。

## Implementation and acceptance / 实现与验收

- [x] Update scenario, focused validation, showcase guide, capture runbook and four
  storyboards. / 更新场景、聚焦校验、showcase 指南、取景手册及四份分镜。
- [x] Re-materialize through the normal Codex JSONL path; do not edit DTOs or UI.
  / 通过正常 Codex JSONL 流程重新物化，不修改 DTO 或界面。
- [x] Capture four PNG candidates and the referenced project-search and provenance
  GIFs. Keep the unused legacy search GIF unchanged. / 生成四张 PNG 和项目搜索、
  派生来源两份 GIF 候选；未使用的历史搜索 GIF 保持原状。
- [x] Verify reading, Raw call/result association, unique A-to-B search and parent
  navigation. / 核验阅读、Raw 调用结果关联、唯一 A→B 搜索及父会话导航。
- [x] Inspect candidates at 960px README width in both languages; all six images
  load with no page overflow. Validate GIF signatures, dimensions and durations:
  project search 1240×900 / 134 frames / 13.4s, provenance 1440×900 / 90 frames / 9s.
  Check source privacy, storyboard dimensions, local documentation links and
  `git diff --check`. / 在双语 README 的 960px 宽度下检查候选，六份素材均加载且
  页面无横向溢出；核验 GIF 格式、尺寸、帧数与时长如上，检查源码隐私、分镜
  尺寸、本地文档引用及 diff 空白规则。
- [x] Human review at README scale; promote only the accepted candidates.
  / 在 README 尺寸下人工审阅，只将获批候选放入正式素材目录。
- [x] Align both development READMEs with the six approved local assets using
  relative media links, and synchronize the subagent captions. / 双语开发 README
  使用相对媒体链接引用六份获批本地素材，同步 subagent 图注。
- [x] Archive this plan after local promotion and reference alignment. / 本地采用
  素材并对齐引用后归档本计划。

Approval: the maintainer explicitly approved the current six assets. SHA-256
checks confirmed that every promoted file matches the reviewed candidate.
After promotion, all 16 `test/package.test.js` checks passed. Both actual local
READMEs loaded all six approved files through their relative links, with matching
subagent captions and no horizontal overflow; no preview media/caption replacement
was used. Documentation links and `git diff --check` passed.
The local promotion step did not publish, commit, push, or move tags. The maintainer
subsequently authorized a separate branch push: `codex/readme-showcase-refresh`,
based on `origin/main` at `52581d8`. At the next authorized
release, convert development-relative media links to matching immutable URLs as
required by the existing release runbook; public rendering is not claimed here.

批准记录：维护者明确批准当前六份素材；SHA-256 检查确认正式目录中的每份文件均
与审阅候选一致。采用素材后，`test/package.test.js` 的十六项检查通过；两份实际
本地 README 均经相对链接加载六份正式素材，subagent 图注一致、无横向溢出，
未使用预览媒体／图注替换；文档引用及 `git diff --check` 通过。
本地替换步骤未发布、提交、推送或移动 tag。随后维护者授权推送独立分支
`codex/readme-showcase-refresh`，基于 `origin/main` 的 `52581d8`。下一次获授权发布时，按既有
发布手册将开发相对媒体链接转换为匹配的不可变 URL；本记录不声称完成公开渲染。

## Evidence and reproduction / 证据与复现

- Application checkout: `3fb38b402d35470581c137712ad61da3abd491ab` plus this
  showcase-only work; Node `v24.18.1`, npm `12.0.2`. The pre-existing staged product
  changes were committed separately while this task was running. / 应用代码为上述
  commit 加本次 showcase 改动；先前已暂存的产品改动在本任务期间由其他工作提交。
- Normal source: `output/showcase/codex-home`; target:
  `output/showcase/workspace/acme/task-board`; local capture server:
  `http://127.0.0.1:17912/`. / 正常来源、目标项目及本地取景服务如上。
- Indexing succeeded: six sessions, 30 logical events, 89 raw records, zero
  diagnostics. Parent: ten loaded events, seven calls. Child: 26 inherited raw,
  ten Main, one Protocol; two owned Main events. / 索引成功：六会话、30 逻辑事件、
  89 原始记录、零诊断；父会话十事件／七调用；子会话继承 26 原始记录、十 Main、
  一 Protocol，自有两个 Main 事件。
- Project query `npm test -- project-switch`: zero in A, one matching session /
  one event project-wide, B output `Project switch suite` / `8 tests passed`.
  Filename query `search-navigation.test.js`: four targets / five occurrences;
  Next selects the first patch (2 / 4). / 上述项目查询在 A 中零命中，整个项目一会话／
  一事件，B 输出如上；文件名查询四目标／五次出现，下一跳为首个补丁（2 / 4）。
- `node --test test/materialize-showcase.test.js test/codex-search.test.js
  test/codex-forks.test.js test/codex-fork-review-markers.test.js test/codex-detail.test.js`:
  75 passed. After shortening patch lines, the four materializer/story tests passed
  again. `npm run build:check` passed. / 相关 75 项测试通过；缩短补丁行后再次通过
  四项物化／故事测试，生成资产检查通过。
- Candidates, keyframes, snapshots, GIF concat manifests and validation evidence:
  `output/readme-capture/refresh-2026-09-19/` (ignored). Candidate review server:
  `http://127.0.0.1:17913/`. / 候选、关键帧、快照、GIF 拼接清单与校验证据位于
  上述忽略目录；候选审阅服务如上。
- Revised GIF keyframes and concat inputs are `project-search-v2/`,
  `branching-v2/`, `project-search-v2.txt` and `branching-v2.txt` in that directory.
  Both contain ten scroll frames (one second at 10 fps) captured from real pane
  scrolling; no content/CSS changes. The hero is a 1600×1000 Timeline screenshot
  scrolled to the failed-command → read → repair → successful output and summary
  segment. The other three PNGs keep their prior roles and candidates.
  / 修订后的关键帧及拼接输入为上述目录中的这些 v2 路径；两份动图各含十个真实
  滚动帧（10 fps 下为一秒），未修改内容或 CSS。主图为 1600×1000 的 Timeline
  截图，滚动到失败命令→读取→修复→成功输出与总结片段。另三张 PNG 保持此前的
  呈现分工及候选。
- Reproduce with the materializer and normal server commands in the capture
  runbook, then follow the tracked storyboards in English. Use the new source
  counts, not historical approved-media counts. / 按取景手册的物化与正常服务命令
  启动，再遵循英文分镜；使用新版场景计数，不沿用历史获批素材的计数。

The local preview now serves approved files from `docs/assets/readme/` through
the actual relative links in both READMEs. The previous approved files remain in
ignored `previous-approved/` for comparison. Public GitHub/npm state is unchanged.

本地预览现通过双语 README 中的实际相对链接读取 `docs/assets/readme/` 正式素材；
此前正式素材保留在忽略目录 `previous-approved/` 供对照。公开 GitHub／npm 状态未变。
