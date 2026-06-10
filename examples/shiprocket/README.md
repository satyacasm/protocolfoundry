# Shiprocket → MCP server (Postman ingestion example)

`postman-collection.json` is Shiprocket's official public API collection
(92 requests, Postman v2.1). The native Postman ingestor turns it into a
hosted MCP server — format is auto-detected, same commands as OpenAPI:

```powershell
# 1. Ingest (auto-detects Postman vs OpenAPI)
npm run dev -w @protocolfoundry/cli -- ingest examples/shiprocket/postman-collection.json --project shiprocket -o graph.json

# 2. Generate a manifest for the core shipping workflow (curate your own subset)
npm run dev -w @protocolfoundry/cli -- generate graph.json --name shiprocket --select Create_Custom_Order,Get_all_Orders,Cancel_an_Order,List_of_Couriers,Check_Courier_Serviceability,Generate_AWB_for_Shipment,Request_for_Shipment_Pickup -o manifest.json

# 3. Connect YOUR Shiprocket API token (from their auth/login endpoint) via the vault
$env:PF_VAULT_KEY = (npm run -s dev -w @protocolfoundry/cli -- keygen)
npm run dev -w @protocolfoundry/cli -- vault set PF_CRED_BEARER_TOKEN --secret "<your shiprocket token>"

# 4. Host it with scoped agent tokens
$env:PF_GATEWAY_TOKEN_SECRET = (npm run -s dev -w @protocolfoundry/cli -- keygen)
$env:PF_MANIFEST_PATH = "manifest.json"
npm run dev -w @protocolfoundry/gateway
npm run dev -w @protocolfoundry/cli -- token issue --server shiprocket --scopes read,write --days 30
```

## What the ingestor extracts from a Postman collection

- **Operations** from every request (folders → tags), effect class from the
  HTTP method, descriptions from the Postman docs text.
- **Input schemas inferred from example bodies** — `create_custom_order`
  gets its 40+ typed arguments from the collection's example JSON.
- **Auth**: explicit bearer/apikey/basic per request; `noauth` opts out;
  "inherit" requests fall back to the collection's dominant scheme (here:
  bearer — Shiprocket's `Authorization: Bearer {{token}}` headers).
- **Multi-host**: `apiv2.shiprocket.in` is `default`; the serviceability
  host gets its own baseUrl ref automatically.
- Unresolved `{{var}}`/`:param` path segments become path parameters;
  known collection variables are substituted in place.

## Known limitations (Postman has no formal schemas)

- "Required" is unknowable → only path params are marked required; the
  LLM curation pass and human review are the quality layer on top.
- `formdata` uploads are mapped as body fields but the gateway sends JSON —
  verify multipart endpoints before exposing them.
- Example-based inference reflects one example; union types/optional nesting
  may be incomplete.
