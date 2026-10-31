# WorkBuddy native history adaptation / WorkBuddy 原生历史适配

## Goal and baseline / 目标与基线

Implement a source-owned reader and useful presentation for WorkBuddy / CodeBuddy native engine JSONL in a new branch from `v0.3.0-development`. The branch is `feat/workbuddy-session-adapter`, based on `433476e4ac9e2d9ff21d53b99bb75df93083c36f`. / 从所列开发基线创建新分支，实现来源独立的 WorkBuddy／CodeBuddy 引擎原生 JSONL 阅读与实用呈现；分支与基线如上。

The initial producer evidence is the official npm package `@tencent-ai/codebuddy-code@2.179.0`, its shipped persistence types/implementation and isolated real producer probes. Desktop-only WorkBuddy storage and stream-json stdout are not automatically equivalent to this format. No real transcripts or credentials enter repository fixtures. / 首个 producer 依据为所列官方 npm 包、随包持久化类型／实现及隔离真实探针。WorkBuddy 桌面端专属存储与 stream-json 标准输出不自动视为同一格式；真实转录和凭据不进入仓库 fixture。

## Work / 工作

- [x] Inspect clean checkout and create the requested baseline branch. / 检查干净工作区并从指定基线建分支。
- [x] Delegate core implementation, registry integration and independent writer investigation. / 委派核心实现、registry 接入和独立 writer 调查。
- [x] Pin writer facts and document mapping/unsupported boundaries. / 固定 writer 事实并记录映射／未支持边界。
- [x] Implement discovery, indexed/materialized reading, Main/Protocol/Raw, search and structured Detail. / 实现发现、索引／物化阅读、主／协议／原始层、搜索和结构化详情。
- [x] Integrate CLI, chooser, packaging and bilingual user documentation. / 接入 CLI、选择器、打包及双语使用说明。
- [x] Validate synthetic adversarial cases, real producer readback and desktop/mobile browser reading. / 验证合成边界情况、真实 producer 回读及桌面／移动浏览器阅读。
- [x] Obtain fresh independent review, fix findings and record final checks. / 完成独立新上下文审查、修复发现并记录最终检查。

## Validation record / 验证记录

Runtime: Linux, Node `24.19.0`, npm `12.0.2` from `/workspace/.tooling/npm/bin/npm`. Tests and outcomes will be recorded after execution, separately from source inspection and CI. / 运行环境如上；测试及结果在实际执行后记录，与来源检查和 CI 证据分开。

The source checkout's generated-asset policy applies: build before browser/package verification, omit generated asset changes from a development commit, and rebuild for the final local preview. / 遵循源码 checkout 的生成资产规则：浏览器／安装包验证前构建，开发提交不含生成资产变更，最终本地预览重新构建。


## Executed acceptance / 已执行验收

- Full Node suite: **2148 passed, 0 failed** on Linux / Node 24.19.0 / npm 12.0.2. Includes 21 WorkBuddy core cases and 8 structured Detail cases. / 完整 Node 套件通过 2148 项，失败 0 项；包含 21 项 WorkBuddy 核心及 8 项结构化详情测试。
- WorkBuddy browser suite: **2/2 passed**, widths 1440 and 390; search→paired tool Detail→Raw, Timeline/Trajectory, completed task snapshot and explicit compaction reading. / 浏览器套件在所列桌面／移动宽度均通过，覆盖配对工具追溯、时间线／轨迹、已完成任务快照及明确压缩记录。
- The pinned Playwright Chromium download was denied by this environment's network policy. The executed browser checks used installed `/usr/bin/chromium` **154.0.8037.57** with Playwright 1.60.0 via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. This is not a claim that the pinned downloaded browser or other operating systems were tested. / 环境网络策略阻止固定 Playwright Chromium 下载；实际使用所列已安装浏览器和显式环境变量运行，不声明已测试固定下载版本或其他操作系统。
- Installed package smoke passed for all six sources, including WorkBuddy Timeline→Detail→Raw and history status→search→context→read→Raw→open. Build and generated-asset check passed. / 六个来源的安装包 smoke 均通过，包括 WorkBuddy 查看及历史检索闭环；构建和生成资产检查通过。
- Real CodeBuddy 2.179.0 readback: **7 sessions, 72 physical Raw records, 85 logical Detail reads, 10 paired calls, 1 explicit compaction**, zero source diagnostics. Each exact Raw line matched its producer file, and all source bytes remained unchanged. The corpus consists of isolated task probes and the earlier authentication checks, not a broad desktop corpus. / 真实回读数量如上，来源诊断为 0；每条精确 Raw 行与 producer 文件匹配，所有来源字节保持不变。语料为隔离任务探针和此前认证检查，不是广泛桌面语料。
- Final local viewer started at `http://127.0.0.1:17890` with `--source workbuddy --repo /workspace/work/buddy --workbuddy-home /workspace/work/buddy/config`; indexing succeeded with 7 sessions and zero diagnostics. / 最终本地查看器以所列参数启动，索引成功，7 个会话且无诊断。
- No CI, push, release or publication was performed. / 未执行 CI、推送、release 或发布。

## Independent review / 独立审查

A fresh-context `gpt-6.1-sol` reviewer examined the proposed diff against `433476e4ac9e2d9ff21d53b99bb75df93083c36f`, including new untracked files. The reviewer independently executed core **21/21**, Detail **8/8** and `git diff --check`; it reported no actionable findings after revision. An independent `gpt-6-astra` source review pinned the producer semantics, with no runtime-test claim. / 新上下文审查者基于所列基线检查全部拟提交变更及新增文件；独立执行所列测试和差异检查，修订后无待处理发现。另有独立来源审查固定 producer 语义，不将静态检查称为运行时测试。

Resolved findings include old-session/new-index snapshot mixing, spilled query-store cleanup on cancellation, runtime recovery prompts misclassified as person requests, empty assistant error visibility, completed task snapshots, prototype-like unknown tool names and parallel tool-result ownership. / 已解决旧会话与新索引快照混用、取消后的磁盘查询存储清理、运行时恢复提示误归类、空内容助手错误可见性、已完成任务快照、原型同名未知工具及并行工具结果归属。

Reviewed implementation SHA-256: `workbuddy-logical.js` = `46a5bcbc67cda393cfd47f91e81c50154fec76139b8995ac299c3f23e400a83f`; `workbuddy.js` = `afd6ffe7bf3d695a417e102d3aa93f5161432635f6521baf7d6c2663006fee1c`; `workbuddy-detail.js` = `6cb39cf8e067657ce28dac8d296bf846a924f53c8182d903fc0950ab533af2ef`. / 已审查实现的摘要如上。

## Deliberate boundaries / 明确边界

This delivers the pinned native engine profile and a recorded-history view, not all WorkBuddy desktop storage formats or an active-lane interpreter. Earlier physical resend/rewind history remains visible with explicit notices. Media/artifact references and REPL nested calls are inspectable evidence, not automatically fetched payloads or a reconstructed nested execution tree. Cross-file forks without durable evidence remain unlinked. / 本次交付固定原生引擎 profile 与已记录历史视图，不覆盖所有桌面存储格式，也不是活动 lane 解释器。较早重发／回退历史在明确提示下保持可见。媒体／工件引用和 REPL 嵌套调用为可检查依据，不自动获取 payload 或重建嵌套执行树；缺少持久依据的跨文件 fork 不建立链接。
