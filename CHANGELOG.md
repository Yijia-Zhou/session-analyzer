# Changelog

## Unreleased / 未发布

### English

- Known follow-up: Simplified Chinese display catalogs are present but not complete; several display namespaces still contain English values until the external-review follow-up plan is completed.
- Known follow-up: package smoke and generated app bundle hardening remain tracked work; `require('session-analyzer')` does not start the server because `server.js` is guarded by `require.main === module`.

### 中文

- 已知后续项：简体中文展示 catalog 已存在但尚未完整；在外部评审后续计划完成前，若干展示 namespace 仍包含英文值。
- 已知后续项：package smoke 和生成 app bundle 加固仍在跟踪中；由于 `server.js` 受 `require.main === module` 保护，`require('session-analyzer')` 不会启动服务器。

## 0.1.0 - 2026-06-11

### English

- First pack-ready npm CLI release for local Codex session transcript viewing.
- Public interface: the `session-analyzer` CLI. Programmatic exports from `server.js` are internal and are not a stable API in v0.1.
- Scope: Codex transcripts only. Non-Codex sources are design pressure tests for future adapters, not supported importers in this release.
- Privacy model: the server binds to `127.0.0.1` by default, reads transcript files from disk, keeps derived indexes in memory, and does not upload transcript content.
- Includes searchable session lists, main/protocol/raw timeline layers, structured event details, raw JSONL drill-down, folding profiles, browser regression coverage, and English/Simplified Chinese display catalogs.
- The npm package does not include real Codex transcripts, test fixtures, or development execution plans.

### 中文

- 第一个可打包验证的 npm CLI 版本，用于本地查看 Codex session transcript。
- 公开接口是 `session-analyzer` CLI。`server.js` 导出的程序接口在 v0.1 中属于内部接口，不承诺稳定。
- 范围仅限 Codex transcript。非 Codex source 只作为未来 adapter 的设计压力测试，本版本不支持导入。
- 隐私模型：服务器默认绑定到 `127.0.0.1`，从磁盘读取 transcript 文件，派生索引只保存在内存中，不上传 transcript 内容。
- 包含可搜索 session 列表、main/protocol/raw 三层 timeline、结构化事件详情、原始 JSONL 下钻、折叠策略、浏览器回归覆盖，以及英文/简体中文展示 catalog。
- npm 包不包含真实 Codex transcript、测试 fixture 或开发执行计划。
