import { z } from "zod";
import { ConnectorConfig } from "./connector.js";

/**
 * A CurationProposal is the LLM curation pass's output artifact: suggested
 * improvements to tool names/descriptions and composed task-level tools.
 * It is ALWAYS reviewed by a human before being applied to a manifest
 * (docs/05-security-model.md — nothing ships without approval).
 *
 * Note: shapes here avoid z.record because the proposal is also used as an
 * LLM structured-output schema, where open-ended objects are not supported.
 */

/** Rename/redescribe one 1:1 tool. */
export const ToolRefinement = z.object({
  operationId: z.string(),
  /** Agent-friendly snake_case name, e.g. get_weather_forecast. */
  toolName: z.string(),
  /** Rewritten agent-facing description: what it does, when to call it. */
  description: z.string(),
});
export type ToolRefinement = z.infer<typeof ToolRefinement>;

export const ProposedArgument = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string(),
  required: z.boolean(),
});
export type ProposedArgument = z.infer<typeof ProposedArgument>;

export const ProposedBinding = z.object({
  /** Upstream argument name to bind. */
  arg: z.string(),
  /** `$args.<name>`, `$steps[<n>].output.<path>`, or a literal value. */
  expression: z.string(),
});
export type ProposedBinding = z.infer<typeof ProposedBinding>;

export const ProposedStep = z.object({
  operationId: z.string(),
  bindings: z.array(ProposedBinding),
});
export type ProposedStep = z.infer<typeof ProposedStep>;

/** A task-level tool composing multiple operations into one business action. */
export const ComposedToolProposal = z.object({
  name: z.string(),
  description: z.string(),
  arguments: z.array(ProposedArgument),
  steps: z.array(ProposedStep).min(1),
  /** Why this composition matches a real user task. Shown to the reviewer. */
  rationale: z.string(),
});
export type ComposedToolProposal = z.infer<typeof ComposedToolProposal>;

export const ExposureWarning = z.object({
  operationId: z.string(),
  /** Why exposing this operation to agents deserves extra scrutiny. */
  reason: z.string(),
});
export type ExposureWarning = z.infer<typeof ExposureWarning>;

export const CurationProposal = z.object({
  proposalVersion: z.literal(1),
  projectId: z.string(),
  refinements: z.array(ToolRefinement),
  composedTools: z.array(ComposedToolProposal),
  warnings: z.array(ExposureWarning),
  /** Derived sanctioned-connect configs keyed by authRequirementId (ADR-0013). */
  connectorConfigs: z.record(ConnectorConfig).default({}),
  /** Model that produced the proposal, e.g. claude-opus-4-8; "human" if hand-written. */
  proposedBy: z.string(),
  createdAt: z.string().datetime(),
});
export type CurationProposal = z.infer<typeof CurationProposal>;
