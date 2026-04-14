# `.playwright-mcp`

Generated MCP Playwright artifacts land here during manual QA runs.

Default rule:

- timestamped runtime artifacts are ignored
- curated QA evidence can be kept under `.playwright-mcp/qa/`

Examples of files worth keeping in `qa/`:

- a stable repro snapshot for a known production bug
- a console log tied to a specific issue
- a before/after artifact for regression verification
