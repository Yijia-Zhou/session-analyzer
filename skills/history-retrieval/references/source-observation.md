# Observe source changes without chasing the caller

Use `observe` only when the question needs information about changes outside the service's fixed snapshot and `status.capabilities.operations` lists it. Ordinary `status`, search, context and reads do not trigger this check. A successful old evidence read and an observation of source changes answer different questions; report them separately.

```sh
session-analyzer history observe --endpoint http://127.0.0.1:17891
session-analyzer history observe --endpoint http://127.0.0.1:17891 --caller-session "<known-caller-sessionId>" --max-files 10000 --limit 8 --max-bytes 24000
```

`--caller-session` is optional and asserts the caller's known Session ID. Do not guess from the newest Session, a filename or matching text. Omit it when the identity is unknown. An ID absent from the old index is accepted with `caller.indexedSessionMatched:false`; this is unresolved association, not a request to rebuild. Exact indexed matches separate caller-associated and other file counts. They do not exclude the Session, authenticate the actor or classify its new content as retrieval echoes. Shared dependencies can also affect other Sessions; `unattributed` files may belong to the caller or another project.

The observation compares physical file metadata with the captured baseline. Read its scope, baseline and check intervals, partial status, gaps, omitted items and unchecked controls before interpreting differences. Candidate discovery includes files outside the project's admitted evidence; new candidates have unknown project membership. Missing or incomplete baseline coverage leaves prior existence unknown. Unchanged metadata does not prove unchanged content, and growth does not prove append-only history. Compressed physical bytes and accepted decoded bytes are different measures.

Continuous writing by the active caller is normal, including the tools used for this task. Preserve the task's evidence cutoff, read enough evidence to answer, and state the observed changes or remaining uncertainty. There is no refresh-required signal. Do not repeat observe → rebuild → observe until the caller stops growing; the check and its response may themselves become new log records.

If later evidence is necessary, explicitly start a new history service snapshot and search/read again. A separate port can keep the old reader service reachable while the new snapshot is built. Old refs, cursors and URLs retain their original scope; stopping or restarting their service does not preserve an old version behind the same link. Obtain and verify new entries from the new service.

`maxFiles` bounds observation work, while `limit` and `maxBytes` bound returned detail. Supported ranges are 1–100000 files, 1–100 items and 4096–1048576 serialized bytes; defaults are 10000, 8 and 24000. An omitted or unexamined item is not an unchanged item. Observation has no cursor: another call starts a new observation against the original baseline, not the next page. Increase a bound only when the missing information matters and the task budget permits; repeated checks cannot repair an incomplete original baseline. After cancellation, retain uncertainty or make one deliberate new check when useful.
