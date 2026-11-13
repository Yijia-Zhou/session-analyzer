# Project path interpretation / 项目路径解释

Status: implementation in progress on base `64f5b3ab351c3be6840396ddb1e8194ab102b4dc`; cross-platform acceptance is not yet complete. / 状态：基于所列提交实施中；跨平台验收尚未完成。

## Contract / 契约

Project identity and lexical directory containment share one interpreted descriptor. Filesystem resolution and source-read authorization remain independent. A project key never becomes an `open` path or a Raw owner key. Existing `fs-path` and scheduled-origin helpers retain their separate responsibilities. / 项目身份与词法目录包含共用解释后的描述；文件系统解析及来源读取授权独立。项目 key 不作为 open 路径或 Raw 归属 key。既有 fs-path 与定时来源 helper 保持各自职责。

Version 1 keys encode namespace, complete volume root, normalized components and comparison policy. Evidence (`syntax`, `producer`, `user`, `legacy`) is separate from identity. POSIX preserves case and literal backslashes; Windows retains the existing lowercase logical comparison convention, without promising physical case insensitivity. Ordinary UNC requires server plus share, including the share root itself. Component containment cannot cross a server/share/drive root or confuse `project` and `project-2`. / 第 1 版 key 编码 namespace、完整卷根、规范组件及比较策略；依据与身份分开。POSIX 保留大小写和字面反斜杠；Windows 沿用小写逻辑比较约定，不承诺物理文件系统不区分大小写。普通 UNC 必须包含 server 与 share，共享根本身合法；组件包含不跨 server／share／drive 根，不混淆相邻前缀。

Exactly two leading forward slashes lack universal historical-platform evidence. Existing JSONL admission therefore defaults to POSIX compatibility, preserves raw cwd and reports `PROJECT_PATH_LEGACY_ASSUMPTION`. Explicit physical artifact/container rules can choose ordinary UNC or POSIX for otherwise unknown double-slash records. Three or more forward slashes remain POSIX. Source kind, selected project, Analyzer OS and local existence never determine historical semantics. Reliable conflicting source semantics return conflict rather than fallback; no generic producer-platform field is invented. / 恰好双前导正斜杠缺少通用历史平台依据。既有 JSONL 准入默认保留 POSIX 兼容解释、原始 cwd 并报告兼容假设；明确物理工件／容器规则可选择普通 UNC 或 POSIX。三个以上正斜杠仍按 POSIX。来源类型、选定项目、Analyzer OS 及本机存在性不决定历史语义；可靠来源证据冲突时报告冲突，不回退，也不虚构通用平台字段。

NUL, empty or wrongly typed paths, historical relative paths, drive-relative/root-relative Windows forms, and malformed UNC roots have no ordinary project identity. Device/extended namespaces remain unsupported by the ordinary interpreter. Existing native-backslash namespace spellings use an opt-in, separate compatibility identity at the Node input boundary so existing history remains readable; the prefix stays intact, there is no ordinary-path alias, and `PROJECT_PATH_NAMESPACE_COMPATIBILITY` records that limit. This does not authorize device I/O or expand a source reader's admission. Physical source-root readers keep their existing namespace handling. Mapped drives, host aliases and WSL mounts are not merged. Exact file-activity paths retain their own treatment of `..`. / NUL、空值、错误类型、历史相对路径、Windows 盘符相对／根相对形式及不完整 UNC 根不具有普通项目身份。普通解释器仍不支持设备／extended namespace；Node 输入边界对既有原生反斜杠写法显式采用独立兼容身份，以保留历史阅读能力。前缀完整保留，不产生普通路径别名，并以 PROJECT_PATH_NAMESPACE_COMPATIBILITY 记录其限制；这不授权设备 I/O，也不扩大来源 reader 准入。物理来源根 reader 保持现有 namespace 处理。不合并映射盘、主机别名或 WSL 挂载；精确文件活动路径独立处理 ..。

## Configuration and scope / 配置与范围

Analyzer reading configuration is a source-config map. Rules bind `sourceKind`, local `sourceHome` and physical locators, never cwd or interpreted keys. Rule scopes are `artifact` (one exact locator) or `container` (directory components, including new descendants). Paths are relative to sourceHome or explicit absolute paths inside it. Overlapping disagreeing rules are rejected; no scan-order precedence or per-row editor is provided. Choosing container `.` explicitly affects all relevant unknown records in that source root. Source bytes, producer configuration and desktop databases are never rewritten. / Analyzer 读取配置按来源存储。规则绑定来源类型、本机来源根及物理 locator，不依据 cwd 或解释后 key；artifact 指精确工件，container 指目录组件范围并包含新后代。路径相对来源根或为根内绝对路径；重叠冲突规则拒绝，不按扫描顺序取胜，也不提供逐行编辑器。明确选择容器 . 将影响同根全部相关未知记录；不改写来源字节、producer 配置或桌面数据库。

Local scope identity uses the host path API after resolving configuration input once. Windows scope serialization folds case for sourceHome and rule locators; POSIX preserves case and literal backslashes. The context's physical `sourceHome` keeps its configured spelling for readers; `sourceHomeIdentity` is separate comparison data. Namespace prefixes and configured symlink aliases remain distinct; this does not use realpath or authorize reads. Equivalent home edits retain the existing configured spelling and inherit omitted rules; an explicit empty rule set still clears them. Captured serialization, policy digests, history scope and pi navigation scope use the same native identity, so equivalent spelling preserves current/running work and reference scope. Legacy pre-policy history migration retains its existing narrow gate. / 本机范围身份在配置输入一次解析后使用宿主 path API。Windows 对序列化上下文中的 sourceHome 与规则 locator 统一大小写；POSIX 保留大小写及字面反斜杠。上下文的物理 sourceHome 保留配置拼写供 reader 使用，sourceHomeIdentity 单独用于比较。namespace 前缀与配置的 symlink 别名仍区分，不使用 realpath，也不授权读取。等价 home 编辑保留既有配置拼写并继承省略的规则；显式空集仍清除规则。捕获序列化、策略摘要、history scope 与 pi 导航 scope 使用相同本机身份，因此等价拼写保留当前／在途工作及引用范围。策略引入前的旧 history 引用迁移继续保留既有窄门槛。

```json
{
  "workbuddy": {
    "home": "/synthetic/buddy",
    "projectPathRules": [
      { "scope": "container", "path": "projects/explicit-container", "interpretation": "unc" }
    ]
  }
}
```

`--path-config <file>` supplies the same JSON to normal startup and `history serve`; relative home entries are resolved against the config file directory once. `--project-path-semantics windows|posix` interprets only the selected project input, allowing an explicitly UNC `//server/share/project` without changing any record's meaning. A selected historical project need not exist locally. Local relative project inputs resolve once at the local input boundary; historical relative cwd never borrows Analyzer cwd. / 普通启动及 history serve 使用同一配置文件入口；相对 home 按配置文件目录一次解析。项目输入语义选项仅解释所选项目，允许明确 UNC 的正斜杠写法而不改变记录含义。历史项目无需本机存在；本机相对项目输入仅在入口一次解析，历史相对 cwd 不借用 Analyzer cwd。

## Lifecycle and adapters / 生命周期与来源

Each scan/job captures a canonical versioned context and digest. Discovery keys, configuration/transcript list merging, candidate membership, final `matchesRepo`, index reuse and materialization use that context. Policy changes cancel/retire old active state, invalidate discovery caches and reject stale responses. Strict materialization captures and rechecks the serialized context. History and pi references include project identity and context; old references cannot redirect under a different policy. Browser saved entries/bookmarks are retained; ambiguous or cross-policy entries pause automatic restoration with a notice. / 每次扫描／作业捕获规范的版本化上下文及摘要；发现、配置／转录列表合并、候选归属、最终 matchesRepo、索引复用及物化统一使用。策略变化取消／退役旧状态、失效发现缓存并拒绝旧响应；严格物化捕获及回验序列化上下文。历史与 pi 引用包含项目身份及上下文，不跨策略重定向；保存项／书签保留，歧义或跨策略时暂停自动恢复并提示。

Claude clusters retain unsupported/conflicting cwd evidence as inference blockers. Under explicit UNC, two directly associated slash variants plus one metadata-only session may form one cluster and admit three Sessions, with the third remaining `container-inferred`. Distinct POSIX projects stay distinct. Existing pointer/fork/subagent gates remain. pi counts branches; DeepSeek uses the initial header; WorkBuddy scheduled-origin uses its own evidence; OpenCode retains host-path admission and the worktree/directory OR filter. / Claude 聚类保留不支持／冲突 cwd 作为推断阻断证据。明确 UNC 下，两条直接归属变体加一条无 cwd 可形成唯一 cluster 并接纳三条，第三条仍为 container-inferred；不同 POSIX 项目保持分离。指针／分叉／subagent 门槛不变。pi 按分支计数，DeepSeek 使用初始 header，WorkBuddy 定时来源证据独立，OpenCode 保留宿主路径准入及 OR 筛选。

## Evidence and limits / 依据与限制

All regression inputs are synthetic. Pure lexical tests do not establish physical filesystem behavior. Linux acceptance separately creates case-distinct paths, literal-backslash names and symlink boundaries; Windows acceptance must use a complete candidate checkout with native localhost UNC and junctions. Remote SMB/DFS/NAS, Windows symlinks and case-sensitive Windows directories are not newly promised. / 回归输入全部为合成数据；纯词法测试不证明物理文件系统行为。Linux 单独创建大小写不同路径、字面反斜杠名称及 symlink 边界；Windows 需完整候选 checkout 上的原生 localhost UNC 与 junction 实测。不新增远端 SMB／DFS／NAS、Windows symlink 及大小写敏感 Windows 目录的支持承诺。

The [active plan](../exec-plans/active/2026-11-12-project-path-interpretation.md) tracks failed target assertions, implementation, native evidence and outstanding gates. / [执行计划](../exec-plans/active/2026-11-12-project-path-interpretation.md)记录失败目标断言、实施、原生依据及未完成门槛。
