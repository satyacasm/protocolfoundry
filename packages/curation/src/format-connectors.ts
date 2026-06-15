import type { ConnectorConfig } from "@protocolfoundry/core";

/** Human-readable summary of derived connector configs for the curation review print. */
export function formatConnectorConfigs(configs: Record<string, ConnectorConfig>): string {
  const ids = Object.keys(configs);
  if (ids.length === 0) return "No connector configs derived (credentials use manual paste).";
  return ids
    .map((authId) => {
      const c = configs[authId]!;
      const where = c.discovery ? `OIDC discovery (${c.discovery.issuer})` : "explicit endpoints";
      const rows = c.produces.map((p) => p.vaultRowId).join(", ");
      const rotation = c.rotation ? ` · rotation: ${c.rotation}` : "";
      return `  ${authId} → ${c.id} [${where}] captures ${c.params.callbackParam} → ${rows}${rotation}`;
    })
    .join("\n");
}
