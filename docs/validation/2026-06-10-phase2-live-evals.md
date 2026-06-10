# Validation run: live curation + evals (Taskboard) — 2026-06-10

First end-to-end run of the Phase 2 pipeline with real Claude calls
(`claude-opus-4-8` for both curation and the eval agent). Pipeline exercised:
`pf curate` → human review/edit → `pf apply` → gateway hosting naive + curated
manifests side by side → `pf eval` against each → comparison report.

## What the live run proved

1. **Curation works end-to-end.** Claude returned a valid structured proposal:
   5 refinements with when-to-call descriptions, 1 composed tool
   (`createTask → completeTask` with a correct `$steps[0].output.id` binding),
   and a warning flagging `deleteTask` as destructive — independently matching
   our approval-gate design.
2. **Human review earned its keep immediately.** The proposed composed-tool
   name (`create_and_assign_task`) didn't match its behavior (create +
   complete); the reviewer renamed it to `log_completed_task` before applying.
   Exactly the workflow ADR-0004 prescribes.
3. **The composed tool wins when adopted.** Run A, task "create and complete":
   curated agent used `log_completed_task` — **2 steps vs 3, 2492 vs 3022
   input tokens** (~18% fewer) for the same outcome.
4. **Evals surface real behavioral differences, not vibes.** Two findings the
   harness caught that we would not have predicted:
   - **Description-level safety:** on the curated server the agent *refused to
     call* `delete_task` at all (the curated description says "call only when
     a user explicitly wants to remove a task… cannot be undone") — the
     deletion was blocked one layer *before* the gateway's approval gate.
     Defense in depth, caught only because the audit log showed no
     `delete_task` invocation.
   - **Composed-tool adoption is inconsistent:** run A used the composed tool,
     run B chained the two underlying tools instead. Root cause: the
     description lacked a prescriptive trigger ("call this INSTEAD of X then
     Y"). Fixed in the curation prompt the same day.

## Final numbers (outcome-based suite, 3 tasks)

| Metric | naive | curated |
|---|---|---|
| Task completion | 100% | 100% |
| Tool-selection accuracy | 100% | 67%* |

\* the single miss is the composed-tool-adoption flake above — completion was
unaffected.

**Honest read:** on a clean 5-operation API, a frontier agent aces the naive
server too — completion can't differentiate here. The deltas that matter at
this scale are steps/tokens (composed tool) and safety behavior (curated
descriptions). The completion-rate gap that sells the product must be
demonstrated on a large/messy API (Petstore 19 ops, GitHub ~900) where naive
servers actually fail agents. That is the next validation target.

## Lessons folded back into the product

1. Eval tasks must score **outcomes**, not paths or phrasings — the original
   "deletion blocked" task required the literal word "approval" and a
   `delete_task` call; an agent that refused earlier (safer!) scored 0.
   Suite updated to outcome-based patterns.
2. Composed-tool descriptions now must include prescriptive triggers
   ("use INSTEAD of A then B") — curation prompt updated; aligns with
   documented Opus 4.8 tool-triggering behavior.
3. `expectedTools` measures *adoption* of curated tools, distinct from
   correctness; keep both metrics but interpret them separately.
4. Eval runs against a **stateful** upstream accumulate data across runs —
   fine for these tasks, but suites needing clean state will want a reset hook
   (backlog for the evals package).
