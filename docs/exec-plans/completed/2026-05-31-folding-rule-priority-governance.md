# Folding Rule Priority Governance / 折叠规则优先级治理

## Metadata / 元数据

- Status / 状态: Completed / 已完成
- Created / 创建时间: 2026-05-31
- Last updated / 最后更新: 2026-05-31
- Related product spec / 相关产品规格: `docs/product-specs/session-transcript-analyzer.md`
- Related design doc / 相关设计文档: `docs/design-docs/logical-event-timeline.md`

## Objective / 目标

Replace order-sensitive folding condition evaluation with one shared deterministic model:

用一个共享的确定性模型替换依赖 condition 顺序的折叠求值：

```text
manual override
  > max(kind rule, all matching condition rules)
  > fallback when no rule matches
```

Visibility priority is `expanded > summary > collapsed > hidden`. Conditions only promote events through `expanded` or `summary`.

可见性优先级为 `expanded > summary > collapsed > hidden`。Condition 只能通过 `expanded` 或 `summary` 提升事件可见性。

## Completed Work / 已完成工作

- [x] Added `public/folding.js` as a browser-and-Node UMD module for folding constants, normalization, matching, evaluation, and override validation. / 新增 `public/folding.js`，作为浏览器与 Node 共用的 UMD 模块，负责折叠常量、规范化、匹配、求值和覆盖校验。
- [x] Kept built-in profile data in `src/folding.js`, re-exported the shared contract, and removed the frontend built-in mirror. / 将内置 profile 数据保留在 `src/folding.js`，重新导出共享契约，并移除前端内置镜像。
- [x] Loaded the shared module before navigation and app scripts, and reused shared `isUpdatePlanEvent()` in navigation. / 在 navigation 和 app 脚本前加载共享模块，并在 navigation 中复用共享 `isUpdatePlanEvent()`。
- [x] Restricted condition editing to `Disabled`, `展开`, and `摘要`; normalized draft condition order to prevent false dirty state. / 将 condition 编辑限制为 `Disabled`、`展开` 和 `摘要`；规范化 draft condition 顺序，避免伪 dirty 状态。
- [x] Initialized browser-local overrides through tolerant JSON parsing plus structural normalization and centralized override saves. / 通过容错 JSON 解析和结构规范化初始化浏览器本地覆盖，并统一覆盖保存入口。
- [x] Used prototype-free dictionaries and own-property checks so reserved keys such as `__proto__`, `constructor`, and `toString` remain ordinary data instead of inherited folding state. / 使用无原型字典和自有属性检查，使 `__proto__`、`constructor`、`toString` 等保留键保持为普通数据，而不会变成继承的折叠状态。
- [x] Added shared-module tests for priority, patch visibility, fallback, ordering, normalization, planning, malformed overrides, and server profiles. / 新增共享模块测试，覆盖优先级、patch 可见性、fallback、顺序、规范化、planning、异常 overrides 和服务端 profiles。
- [x] Updated bilingual product and design documentation. / 更新双语产品与设计文档。

## Rollout Cleanup / 发布清理

No runtime browser-storage migration was added because the tool has not been publicly released. Clear stale local development state once before manual acceptance:

由于工具尚未公开发布，本次不加入浏览器存储运行时迁移。人工验收前清理一次陈旧的本地开发状态：

```js
localStorage.removeItem('sessionAnalyzer.customProfiles');
localStorage.removeItem('sessionAnalyzer.overrides');
if ((localStorage.getItem('sessionAnalyzer.profile') || '').startsWith('custom:')) {
  localStorage.setItem('sessionAnalyzer.profile', 'narrative');
}
```

## Validation / 验证

- [x] `node --test`
- [x] `node --check 'public\folding.js'`
- [x] `node --check 'public\app.js'`
- [x] `node --check 'public\navigation.js'`
- [x] `node --check 'src\folding.js'`
- [x] `git diff --check`

## Outcome / 结果

Folding profiles now resolve conflicts deterministically from one implementation. Change-review patches remain expanded even when touched-file conditions also match, search-hit visibility is not reduced by condition order, and malformed stored overrides no longer prevent initialization.

折叠策略现在通过单一实现确定性解决冲突。改动审查中的 patch 即使同时命中 touched-files condition 也保持展开，搜索命中的可见性不会因 condition 顺序降低，并且异常存储 overrides 不再阻止初始化。
