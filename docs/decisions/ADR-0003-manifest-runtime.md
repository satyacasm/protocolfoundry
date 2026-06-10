# ADR-0003: Manifest-interpreted gateway instead of per-customer codegen

- **Status:** accepted
- **Date:** 2026-06-10

## Context

Two ways to "generate an MCP server" for each customer:

1. **Codegen:** emit a standalone TypeScript server per customer, build it, deploy
   one process/container per customer.
2. **Manifest + interpreter:** emit a declarative, versioned JSON manifest
   (tools, schemas, upstream call mappings, auth bindings, scopes) that a shared
   multi-tenant gateway interprets at runtime.

The business model is managed hosting of potentially thousands of servers, with
instant updates, rollbacks, audit, and security patching.

## Decision

Manifest + interpreter. The Generator's output artifact is an `McpServerManifest`;
a Release is an immutable pointer to a manifest version; the Gateway loads
releases and serves each as an MCP endpoint.

## Consequences

- **Ops:** one runtime to patch, scale, and secure. A release/rollback is a
  pointer swap, not a deploy.
- **Trust:** the manifest is a human-reviewable, diffable statement of exactly
  what the server can do — this powers the approval workflow and audit story.
- **Constraint:** tool behavior is limited to what the manifest schema can
  express (HTTP call chains, mappings, pagination policies). Mitigation: a
  `custom` tool kind referencing sandboxed code modules (e.g. isolates) can be
  added later for the long tail.
- **Versioning discipline:** the manifest schema itself must be versioned from
  day one (`manifestVersion` field) since old releases must keep serving.
