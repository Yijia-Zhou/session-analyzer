-- Minimized synthetic schema of the tables used by the OpenCode 2.1.4 reader.
-- Authority: anomalyco/opencode 68bc26b7da1990ce10ffecfbc1e09eb13aa5d824
-- packages/core/src/session/sql.ts, project/sql.ts, worktree/sql.ts.
CREATE TABLE project (
 id TEXT PRIMARY KEY, worktree TEXT NOT NULL, vcs TEXT, name TEXT,
 icon_url TEXT, icon_url_override TEXT, icon_color TEXT,
 time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
 time_initialized INTEGER, time_active INTEGER NOT NULL DEFAULT 0,
 time_archived INTEGER, sandboxes TEXT NOT NULL, commands TEXT
);
CREATE TABLE worktree (
 project_id TEXT NOT NULL REFERENCES project(id), directory TEXT NOT NULL,
 strategy TEXT, time_created INTEGER NOT NULL, PRIMARY KEY(project_id,directory)
);
CREATE TABLE session_v2 (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id),
 workspace_id TEXT, parent_id TEXT, fork_session_id TEXT, fork_boundary TEXT,
 slug TEXT NOT NULL, directory TEXT NOT NULL, path TEXT, title TEXT,
 version TEXT NOT NULL, share_url TEXT, summary_additions INTEGER,
 summary_deletions INTEGER, summary_files INTEGER, summary_diffs TEXT,
 metadata TEXT, cost REAL NOT NULL DEFAULT 0,
 tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0,
 tokens_reasoning INTEGER NOT NULL DEFAULT 0, tokens_cache_read INTEGER NOT NULL DEFAULT 0,
 tokens_cache_write INTEGER NOT NULL DEFAULT 0, revert TEXT, permission TEXT,
 agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
 time_idle INTEGER, time_viewed INTEGER, idle_outcome TEXT,
 time_compacting INTEGER, time_archived INTEGER, time_suspended INTEGER,
 resume_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX session_v2_project_idx ON session_v2(project_id);
CREATE INDEX session_v2_parent_idx ON session_v2(parent_id);
CREATE TABLE session_message (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session_v2(id),
 type TEXT NOT NULL, seq INTEGER NOT NULL,
 time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message(session_id,seq);
-- This stable-version marker is deliberately absent from the researched dev schema.
CREATE TABLE session_pending (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
 delivery TEXT, admitted_seq INTEGER NOT NULL, time_created INTEGER NOT NULL
);
