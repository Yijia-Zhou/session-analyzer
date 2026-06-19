# Codex Hooks Guardrails / Codex Hooks 护栏

## Metadata / 元数据
- Owner: repository maintainers / 负责人：仓库维护者
- Status: draft / 状态：草案
- Last updated: 2026-06-20 / 最近更新：2026-06-20
- Related docs: / 相关文档：
  - `docs/product-specs/session-transcript-analyzer.md`
  - `docs/design-docs/logical-event-timeline.md`
  - `docs/design-docs/codex-protocol-event-coverage.md`
  - `docs/exec-plans/tech-debt-tracker.md`

## Context / 背景

Codex hooks can provide lightweight lifecycle reminders for local development, but this repository should not rely on hooks to enforce parser correctness, privacy, release policy, or architectural boundaries. The existing project workflow depends on focused tests, sanitized fixtures, generated-asset checks, and bilingual documentation updates.

Codex hooks 可以为本地开发提供轻量生命周期提醒，但本仓库不应依赖 hooks 来强制保证解析器正确性、隐私、发布策略或架构边界。现有项目流程依赖聚焦测试、脱敏 fixture、生成产物检查和双语文档更新。

The committed hook material is intentionally non-active by default. `.codex/hooks.example.json` is an example file, not a discovered `hooks.json`. Developers who want to try it can copy it to `.codex/hooks.json` in their working tree; that local activation file is ignored by git.

已提交的 hook 材料默认刻意不生效。`.codex/hooks.example.json` 是示例文件，而不是会被发现的 `hooks.json`。想试用的开发者可以在自己的工作区把它复制为 `.codex/hooks.json`；该本地启用文件已被 git 忽略。

## Goals / 目标

- Keep the first hook sample advisory-only and read-only. / 第一批 hook 样例只做建议提示，只读运行。
- Avoid changing Codex behavior for contributors unless they explicitly opt in. / 除非贡献者显式启用，否则不改变 Codex 行为。
- Remind developers about project-specific privacy, generated bundle, localization, and documentation guardrails. / 提醒开发者注意项目特有的隐私、生成 bundle、本地化和文档护栏。
- Keep hook scripts outside the npm package surface and outside CI gates. / hook 脚本不进入 npm package 表面，也不作为 CI gate。

## Non-goals / 非目标

- No automatic code edits, documentation edits, bundle rebuilds, or fixture generation from hooks. / hooks 不自动编辑代码、文档、重建 bundle 或生成 fixture。
- No hook should read, copy, upload, archive, or summarize real transcript content. / hook 不应读取、复制、上传、归档或总结真实 transcript 内容。
- No parser behavior should be added only because Codex has hook lifecycle events. / 不应仅因为 Codex 存在 hook 生命周期事件就新增 parser 行为。
- No broad hard-block policy until real hook inputs and false-positive rates are understood. / 在理解真实 hook 输入和误报率前，不引入宽泛 hard-block 策略。

## Current Sample / 当前样例

The current example contains one `SessionStart` command hook:

当前示例只包含一个 `SessionStart` command hook：

- It runs only for `startup|resume` when a developer locally enables `.codex/hooks.json`. / 只有开发者在本地启用 `.codex/hooks.json` 后，才会在 `startup|resume` 时运行。
- It reads git branch and `git status --short`, then prints a short guardrail checklist. / 它只读取 git 分支和 `git status --short`，然后打印简短护栏清单。
- It does not inspect transcript files, write files, start servers, run tests, or block tools. / 它不检查 transcript 文件、不写文件、不启动服务、不运行测试，也不阻断工具。

## Future Candidates / 后续候选

The next low-risk candidate is an advisory `Stop` hook that checks changed file names and reminds the developer about relevant docs and gates. It should stay read-only and should not run full browser or package tests automatically.

下一个低风险候选是 advisory `Stop` hook：检查 changed file names，并提醒开发者相关文档和 gate。它仍应保持只读，不应自动运行完整 browser 或 package 测试。

`PreToolUse` policy hooks should wait until the project has validated real hook input shapes. If added, they should start with narrow warnings for obvious risks such as `npm publish`, deleting docs or fixtures, committing real `.codex/sessions`, or direct edits to generated `public/assets/app.js`.

`PreToolUse` policy hook 应等项目验证真实 hook 输入形态后再添加。若添加，也应先从狭窄 warning 开始，只覆盖明显风险，例如 `npm publish`、删除 docs 或 fixtures、提交真实 `.codex/sessions`，或直接编辑生成的 `public/assets/app.js`。

## Risks / 风险

- Project-local hooks require local trust before they run; changed hook definitions require review again. / project-local hooks 需要本地 trust 后才会运行；hook 定义变更后需要再次 review。
- Advisory output can become noise if it is too long or fires too often. / 如果提示太长或触发太频繁，advisory 输出会变成噪音。
- Hooks are development workflow aids, not a replacement for tests, package smoke checks, schema review, or human review. / hooks 是开发流程辅助，不是测试、package smoke、schema review 或人工审查的替代品。

## Validation / 验证

- `node .codex/hooks/session-start.mjs` should run without writing files. / `node .codex/hooks/session-start.mjs` 应能运行且不写文件。
- `node --check .codex/hooks/session-start.mjs` should pass. / `node --check .codex/hooks/session-start.mjs` 应通过。
- `npm pack --dry-run` should not include `.codex/` because `package.json` uses an explicit `files` allowlist. / 因为 `package.json` 使用显式 `files` allowlist，`npm pack --dry-run` 不应包含 `.codex/`。
