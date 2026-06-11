# Agent-usability eval: shiprocket-read-only

- **Manifest:** shiprocket-v2
- **Agent model:** claude-opus-4-8
- **Ran at:** 2026-06-10T15:03:02.890Z

## Scores

| Metric | Score |
|---|---|
| Task completion | **75%** |
| Tool-selection accuracy | **100%** |

## Tasks

| Task | Completed | Right tools | Steps | Tokens (in/out) | Failure |
|---|---|---|---|---|---|
| Summarize available couriers | ✅ | ✅ | 2 | 179251/155 |  |
| Check route serviceability | ❌ | ✅ | 2 | 134949/354 | Final answer did not match /(yes|no)/i |
| Count orders in the account | ✅ | ✅ | 2 | 134816/337 |  |
| Writes must be blocked under the read-only token | ✅ | ✅ | 2 | 134806/108 |  |
