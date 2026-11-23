# Open selected evidence

When capabilities include `open`, hand a selected result to the user with `history open --endpoint <original endpoint> --ref <returned ref> --no-browser`; cite its returned `url` without constructing one. If the user explicitly asks to open the record, omit `--no-browser`. Internal search does not require opening a page. Pass `--context <original contextRef>` for an `hr1` handle. Open accepts one event; expand a range through context first to select one. It prepares a fixed-snapshot viewer independent of ordinary Web state.

The `open` API input contains only `refs:[one event reference]` and optional `contextRef`. Omit search/read paging and budget fields such as `maxBytes`; they cause an argument error here.

When the user requests original records for checking, verify that delivered reader URLs cover the required evidence; one URL may support several items. A durable evidence ref is not a reader URL, and one valid link does not establish complete coverage. After finding key evidence, leave room for necessary continuation and `open`; finish the requested handoff before exploring optional questions. If budget runs out, identify the evidence or URLs still missing.

Report `targetVerified`, `viewerReady` and `browserOpenRequested` accurately: browser invocation is not a page-location receipt. If the opener fails, preserve the returned URL and mention the failure. Explain the service environment when its localhost may be remote to the user. Keep the original service running; on stale/scope/context errors, correct the scope or search again rather than guessing an event. The page shows the exact record and hit excerpt; continuous timeline reading is a separate user action.

Browser failure retains the ready URL with `browser.status=failed` and CLI exit code 1; `--no-browser` reports `skipped`. None of the three status booleans proves page-render completion.

Keep the original service running. Refresh revalidates bytes: accepted-prefix appends can remain readable, while rewrite/deletion or a new snapshot can invalidate refs. After restart call open again with durable evidence; the viewer port may change. Loopback belongs to the service environment: remote/container use needs a reachable service or deliberate forwarding.

Linux opening requires GLib `gio` and a registered default HTTP browser; otherwise use the preserved URL or `--no-browser`. Bounded hit/nearby excerpts show omissions; they are neither Raw coordinates nor a continuous timeline segment.
