# ADR-0008: Dashboard eval runs — in-process jobs on an ephemeral loopback gateway

- **Status:** accepted
- **Date:** 2026-06-11

## Context

The Forge (ADR-0006/0007 era dashboards) closed every step of the browser loop
except one: releases staged from the UI carried "no eval" and the operator had
to drop to `pf eval` to score them. Two design problems blocked in-browser
evals:

1. **Where does the agent connect?** The gateway serves only LIVE releases at
   `/mcp/<server>` — a staged release has no endpoint, and promoting it just to
   eval it would defeat the gate.
2. **Where does the run execute?** Eval runs take minutes (real agent loop,
   real upstream calls); a server action can't block on them, and we have no
   queue infrastructure yet.

There was also a store gap: an `EvalRun` could only enter a release at
creation (`createRelease({ evalRun })`), but forge-staged releases are created
*before* their eval exists.

## Decision

1. **`ReleaseStore.attachEvalRun(projectId, version, evalRun)`** (both
   backends): attaches — or replaces, latest run wins — the eval on a
   **staged** release and updates `evalRunId`. Live/retired/rolled-back
   releases are sealed history; their eval is the one they were promoted on.
   Manifest immutability is untouched.
2. **Ephemeral loopback gateway as the eval host.** The job materializes the
   staged manifest with the real `createGatewayApp` on `127.0.0.1:0` behind a
   one-time random key, with the production credential resolver (env→vault)
   and the shared audit store — eval tool calls hit the real upstream and are
   audited like any other traffic. The server dies with the job.
3. **In-process job runner, file-backed records.** Job state lives at
   `workspace/<projectId>/jobs/eval-v<N>.json` (running/succeeded/failed,
   per-task progress via the new `runEvalSuite onResult` callback). The server
   action validates fast (operator, suite, staged release, API key), writes
   the running record, and schedules execution with Next's `after()`; the
   project page polls the record and auto-refreshes while a job is active.
   An in-memory lock prevents double-launch; a "running" record without a
   live lock is surfaced as *interrupted* (server restarted mid-run).
4. **Eval suites are dashboard-managed workspace artifacts**
   (`workspace/<projectId>/eval-suite.json`), zod-validated on upload
   (`parseEvalSuite`) — file upload or pasted JSON, operator-gated, audited.
   Completed runs append a new `evalCompleted` audit event with both scores.

## Consequences

- The browser loop is closed: ingest → curate → stage → **eval** → promote,
  with the "no eval" chip replaced by real gauges before the promote decision.
- Single-process assumption (matches ADR-0005's single-operator stance): jobs
  die with the dashboard process and the lock is per-process. A real queue
  (DB-backed, worker pool) is the multi-tenant follow-up; the job-record
  format is the contract the UI already speaks, so the swap is additive.
- Hosting evals on a serverless platform would kill post-response work —
  the dashboard assumes a long-lived Node process (`next start`).
- Promotion remains a human decision: the gate is advisory at promote time
  (scores are displayed, not enforced) — enforcement at creation stays as is
  (ADR-0005). Revisit if design partners want hard promote gates.
