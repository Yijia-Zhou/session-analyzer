# Inspector search target reveal / Inspector 搜索目标展开定位

## Goal / 目标

Make previous/next free-text search navigation reveal inspector matches inside closed nested `<details>` sections and scroll the concrete live mark into view after inspector redraws. / 让自由文本搜索的上一个/下一个导航能够展开 Inspector 中关闭的嵌套 `<details>` 区段，并在 Inspector 重绘后将实际存在的 mark 滚动到视口内。

## Completed work / 已完成工作

- [x] Added a reusable `reveal()` helper that opens every `<details>` ancestor before scrolling a mark into view. / 增加可复用的 `reveal()` helper，在滚动 mark 前展开其所有 `<details>` 祖先。
- [x] Updated search navigation to reacquire the live active mark after synchronous inspector redraws and scroll that concrete target instead of its timeline event card. / 更新搜索导航：在 Inspector 同步重绘后重新获取仍在 DOM 中的 active mark，并滚动该具体目标而不是所属时间线事件卡片。
- [x] Kept ordinary highlight refresh passive so closed supplemental sections open only when the user navigates to one of their matches. / 保持普通高亮刷新不主动展开折叠区，只有用户导航到其中的命中时才展开。
- [x] Added regression coverage and synchronized bilingual docs. / 增加回归覆盖并同步双语文档。

## Verification / 验证

- `npm test`
- `node --check public/highlight.js`
- `node --check public/app.js`
- `git diff --check`
