# DeepSeek Harness interactive approval fixture

This sanitized deterministic format-v0 fixture contains two complete interactive
approval lifecycles (`allowed-once` and `rejected`) plus one valid asked-only
incomplete lifecycle. It preserves only source-contract shapes needed by the
adapter, including interleaved request IDs, exact optional call IDs, independent
standing permission state, and ordinary tool operations.

The fixture contains no harvested prompt, reasoning, assistant output, private
path, or current-writer bytes. Tests protect its exact bytes with SHA-256.
`cancelled` and `unavailable` are covered by synthetic contract tests; they were
not harvested from the accepted current-writer artifact.
