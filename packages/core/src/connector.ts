import { z } from "zod";

/**
 * Declarative connector config (ADR-0012): data, never code. Carried in the
 * manifest keyed by authRequirementId, interpreted by @protocolfoundry/connectors.
 * Holds references and instructions only — secrets live in the vault.
 */

/** App-level credential the operator registers once (client id/secret, api_key/secret). */
export const ConnectorAppCredential = z.object({
  id: z.string(),
  label: z.string(),
  valueFormat: z.string(),
});
export type ConnectorAppCredential = z.infer<typeof ConnectorAppCredential>;

export const ConnectorParams = z.object({
  scopes: z.array(z.string()).default([]),
  pkce: z.boolean().default(false),
  /** The param the provider redirects back with, e.g. "code" or "request_token". */
  callbackParam: z.string().default("code"),
  responseType: z.string().default("code"),
  grantType: z.string().default("authorization_code"),
});
export type ConnectorParams = z.infer<typeof ConnectorParams>;

/** Fixed, safe transform vocabulary for the non-standard residue — NOT arbitrary code. */
export const ExchangeStep = z.discriminatedUnion("op", [
  z.object({ op: z.literal("concat"), inputs: z.array(z.string()).min(1), as: z.string() }),
  z.object({ op: z.literal("sha256"), input: z.string(), as: z.string() }),
]);
export type ExchangeStep = z.infer<typeof ExchangeStep>;

/** A custom token-exchange request (only needed for non-standard providers). */
export const ExchangeRequest = z.object({
  method: z.enum(["GET", "POST"]).default("POST"),
  /** Which resolved endpoint to call. Only the token endpoint for now. */
  urlRef: z.literal("token").default("token"),
  /** Form-body fields: field name -> value-bag key. */
  body: z.record(z.string()).default({}),
  /** Header name -> value-bag key. */
  headers: z.record(z.string()).default({}),
});
export type ExchangeRequest = z.infer<typeof ExchangeRequest>;

export const ConnectorConfig = z
  .object({
    id: z.string(),
    discovery: z.object({ issuer: z.string().url() }).optional(),
    authorizeUrl: z.string().url().optional(),
    tokenUrl: z.string().url().optional(),
    appCredentials: z.array(ConnectorAppCredential).default([]),
    params: ConnectorParams.default({}),
    /** Derived values computed before exchange (non-standard residue). */
    derive: z.array(ExchangeStep).default([]),
    /** Custom exchange request; omitted = standard authorization-code token POST. */
    exchange: ExchangeRequest.optional(),
    /** Produced secrets: which vault row gets which value-bag key. */
    produces: z
      .array(z.object({ vaultRowId: z.string(), from: z.string() }))
      .min(1),
    /** Expiry/rotation note surfaced to operators, e.g. "expires daily". */
    rotation: z.string().optional(),
  })
  .refine((c) => Boolean(c.discovery) || Boolean(c.authorizeUrl), {
    message: "connector needs discovery.issuer or an explicit authorizeUrl",
  });
export type ConnectorConfig = z.infer<typeof ConnectorConfig>;
