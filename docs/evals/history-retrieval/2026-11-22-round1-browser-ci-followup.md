# Round 1 browser CI follow-up / 第一轮浏览器 CI 跟进

This record covers synthetic browser regression work after the formal comparison. The original result remains 57/70 (`fail`). Ordinary reads keep `content`, `auto` remains opt-in, and `compact` retains its separate default. D07-current-B remains an accepted recorded limitation. / 本记录覆盖正式对照之后的合成浏览器回归工作。原结论仍为 57/70（`fail`）。普通读取保持 `content`，`auto` 保持显式可选，`compact` 按独立验收保持默认。D07-current-B 仍为已接受的记录局限。[Formal comparison / 正式对照](2026-11-15-round1-comparison.md) · [Closeout supplement / 收尾补充](2026-11-18-round1-closeout-supplement.md)

## Failed CI and reference preparation / CI 失败与引用准备

The original `reading-presentation` job passed 155 of 171 tests. Fifteen failures used a compact search handle as a durable reference for a read or Viewer entry. The remaining failure was the narrow pi recorded-evidence case. The original `navigation-evidence` job was cancelled. Inspection of that group's tests found the same short-handle assumption in three more files. / 原 `reading-presentation` 作业的 171 项中通过 155 项。15 项失败将 compact 搜索的短句柄用作读取或 Viewer 入口的持久引用。剩下一项是 pi 记录证据读取的窄屏用例。原 `navigation-evidence` 作业被取消，检查该组源码时在另外三份文件中发现了同类短句柄假设。[Original CI / 原 CI](https://github.com/Yijia-Zhou/session-analyzer/actions/runs/45013218035)

The cases that require durable bookmarks, cross-layer context, or snapshot checks now request `full` for those references. OpenCode keeps the previous content and `STALE_REFERENCE` assertions across service revisions. Its Raw-link read uses durable references from a `full` response. The pi branch cases cover the default over HTTP on desktop and narrow screens. They search with the compact default, read the handle with its `contextRef`, pass the returned durable `evidenceRef` to `open`, and verify the exact session, selected card, and expected text in that card. Viewer validation and product defaults are unchanged. / 需要持久书签、跨层上下文或快照核验的用例现为这些引用显式请求 `full`。OpenCode 保留跨服务版本的旧内容及 `STALE_REFERENCE` 断言，Raw 续读使用 `full` 响应中返回的持久引用。pi 分支用例在桌面和窄屏经 HTTP 覆盖默认路径，按 compact 默认搜索，携带 `contextRef` 读取短句柄，将返回的持久 `evidenceRef` 交给 `open`，并核对 Viewer 中准确的会话、选中卡片及卡片内的预期文本。Viewer 核验与产品默认值保持原样。

## Narrow pi layer change / pi 窄屏切层

The unmodified 390-pixel case passed one local run. A controlled delay of the Main navigation response reproduced the CI symptom. After switching from Protocol, the target header was attached and had a visible rectangle in Events. Releasing the response restored the prior selection in the Inspector, changed the mobile surface to Detail, and left the header attached with no visible rectangle. The click timed out. The revised test waits for the restored selection when a layer change starts with a selected card, then opens Events and clicks the requested card. The same controlled delay passed after the change. / 未修改的 390 像素用例本地运行一次通过。受控延迟 Main 导航响应复现了 CI 的症状。从 Protocol 切层后，目标标题已挂载，在 Events 中有可见矩形。放行响应后，Inspector 恢复原选中位置，移动界面切到 Detail，目标标题仍挂载但没有可见矩形，点击超时。修订后的测试在切层前已有选中卡片时等待选中恢复，再打开 Events 并点击目标卡片。修订后同一受控延迟复测通过。

## Local validation / 本地验证

Windows, Node.js 24.18.1 and Playwright 1.60.0. The isolated test tree is identified by base `ae5342176f8376795ce98a4dc903fe6de52a6ae8` and input manifest SHA-256 `5e7b3222823972c1e7af0d5dc6d8fa0cb4781502ee3c4458648a64f07c773f44`. The digest covers the base, file hashes and the rebuilt asset hashes. `node scripts/build-client.js` and `node scripts/build-client.js --check` passed in the copy. The affected browser run passed **97/97** with synthetic fixtures. / Windows、Node.js 24.18.1 与 Playwright 1.60.0。隔离测试树以基点 `ae5342176f8376795ce98a4dc903fe6de52a6ae8` 和输入清单 SHA-256 `5e7b3222823972c1e7af0d5dc6d8fa0cb4781502ee3c4458648a64f07c773f44` 标识。摘要覆盖基点、文件哈希及重建的资产哈希。在副本中执行 `node scripts/build-client.js` 和 `node scripts/build-client.js --check`，均通过。受影响浏览器用例使用合成 fixture，**97/97** 通过。

```sh
node --test --test-concurrency=2 e2e/opencode.test.js e2e/pi-navigation.test.js e2e/pi-reading-evidence.test.js e2e/pi.test.js e2e/qoder.test.js e2e/workbuddy.test.js e2e/history-evidence.test.js e2e/recorded-configuration.test.js e2e/turn-lineage.test.js
```

The earlier product and evaluator tests retain their own source identity. The updated PR records its own CI run. / 此前的产品和评估门禁验证保留各自的源码身份。更新后的 PR 单独记录其 CI 运行。[Repair validation / 修复验证](2026-11-18-round1-repair-validation.md) · [PR #110 checks / PR #110 检查](https://github.com/Yijia-Zhou/session-analyzer/pull/110/checks)
