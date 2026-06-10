# ADR-0004: Curation as a reviewed proposal artifact; evals as the quality gate

- **Status:** accepted
- **Date:** 2026-06-10

## Context

Phase 2 adds the two differentiating layers (docs/02-product-strategy.md):
LLM curation (task-level tools instead of raw endpoints) and agent-usability
evals. Both involve an LLM; both must be trustworthy enough for the
human-in-the-loop story to hold.

## Decision

1. **Curation output is a `CurationProposal` artifact, never a manifest.**
   The LLM proposes refinements (names/descriptions), composed task-level
   tools, and exposure warnings. A human approves (fully or partially) and
   only `applyCuration` produces the manifest. The LLM cannot ship anything.
2. **Proposals are validated defensively:** hallucinated operationIds are
   dropped on parse; composed tools referencing unknown operations are
   discarded; tool names are re-sanitized; compositions containing destructive
   steps inherit the per-call approval gate.
3. **The LLM boundary is an interface** (`Curator`, `AgentModel`), so the
   entire pipeline is testable with scripted fakes and no API key. Real
   implementations use the Anthropic SDK: `claude-opus-4-8` by default,
   adaptive thinking, structured outputs (`output_config.format` with a zod
   schema) for the proposal.
4. **Evals run real agent loops** against a hosted endpoint over MCP (not
   simulated tool calls): list tools → model turn → execute tool calls →
   repeat. Scores: task completion (regex on final answer), tool-selection
   accuracy (expected ⊆ called), steps, token cost. Output is a core
   `EvalRun` plus markdown report/comparison artifacts.

## Consequences

- The curation quality bar is enforced structurally, not by trusting model
  output — aligned with the security model.
- Eval results are comparable across manifests (naive vs curated) and across
  agent models, which is the Phase 2 exit metric and the marketing number.
- Running evals costs LLM tokens; suites should stay small and targeted.
  Scripted-agent tests keep CI free.
- Release gating (eval-gated immutable releases) still needs a release store —
  deferred to Phase 3 alongside the database.
