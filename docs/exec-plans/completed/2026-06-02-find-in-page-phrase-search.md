# Find-in-page phrase search / 类浏览器页内短语查找

## Goal / 目标

Align every free-text `q` consumer with browser-like contiguous phrase matching while preserving structured operators, continuous timeline display, bounded preload, and search-hit navigation. / 让所有自由文本 `q` 消费者统一采用类似浏览器页内查找的连续短语匹配，同时保留结构化操作符、连续时间线展示、有限预加载和命中导航。

## Completed work / 已完成工作

- [x] Added a reusable backend phrase regex builder with case-insensitive literal matching and `\s+` whitespace runs. / 增加可复用的后端短语正则构建器，支持忽略大小写的字面量匹配和 `\s+` 空白段。
- [x] Applied the shared backend semantics to event hits, counts, snippets, and direct session filtering. / 将统一后端语义应用到事件命中、计数、摘要和直接 session 筛选。
- [x] Matched event `preview` and `searchText` independently, preferring preview snippets and using the larger field count to avoid duplicate derived text or cross-field matches. / 独立匹配事件 `preview` 与 `searchText`，优先使用 preview 摘要，并取两个字段中的较大计数，避免派生文本重复或跨字段命中。
- [x] Updated DOM highlighting to mark complete phrases inside individual text nodes without cross-node concatenation. / 更新 DOM 高亮，在单个文本节点内标记完整短语，不跨节点拼接。
- [x] Kept the displayed navigation denominator at least as large as the rendered jump-target count while retaining backend full-text coverage for unloaded content. / 让显示的导航分母至少覆盖已渲染可跳转目标数，同时保留后端全文计数对未加载内容的覆盖。
- [x] Added regression coverage and synchronized bilingual docs. / 增加回归覆盖并同步双语文档。

## Verification / 验证

- `npm test`
- `node --check src/codex.js`
- `node --check public/highlight.js`
- `node --check public/app.js`
