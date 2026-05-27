# Event Body and Inspector Responsibility Split / 事件正文与 Inspector 职责重切

## Objective / 目标

Make timeline expanded bodies show the primary work content only, while the right-side inspector shows metadata, structured payloads, raw refs, and other supplemental material. / 让 timeline 展开正文只展示主要工作内容，同时由右侧 inspector 展示 metadata、结构化 payload、raw refs 和其他补充材料。

## Scope / 范围

- Replace the single event-detail `sections[]` DTO field with `timelineSections[]` and `inspectorSections[]`. / 将事件详情 DTO 的单一 `sections[]` 字段替换为 `timelineSections[]` 和 `inspectorSections[]`。
- Render command timeline bodies as Markdown-style code fences for command, stdout, and stderr, with command shell language inference. / 将 command timeline 正文渲染为 Markdown 风格代码围栏，包含命令、stdout 和 stderr，并推断命令 shell 语言。
- Render patch timeline bodies with file summaries, line-number gutters, and added/removed line styling. / 用文件摘要、行号 gutter 和加减行样式渲染 patch timeline 正文。
- Keep inspector sections focused on metadata, structured outputs, raw JSON, and supplemental status. / 让 inspector sections 聚焦 metadata、结构化输出、原始 JSON 和补充状态。

## Status / 状态

- 2026-05-27: Completed. Backend DTO split, command/patch timeline sections, inspector information hierarchy, frontend renderers, docs, and regression tests were updated together. / 2026-05-27：已完成。后端 DTO 拆分、command/patch timeline section、inspector 信息层级、前端渲染器、文档和回归测试已同步更新。

## Validation / 验证

- `node --test`
- `node --check public/app.js`
- `node --check public/renderers.js`
- `node --check src/codex.js`
- `node --check server.js`
