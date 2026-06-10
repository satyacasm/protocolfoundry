/**
 * Starts the example Taskboard upstream (the "customer's SaaS") standalone —
 * used when hosting taskboard manifests outside the test suite.
 * Env: PF_UPSTREAM_PORT (default 4810), PF_UPSTREAM_KEY (default demo-key).
 */
import { createTaskboardApp } from "../examples/taskboard/upstream.js";

const port = Number(process.env.PF_UPSTREAM_PORT ?? 4810);
const apiKey = process.env.PF_UPSTREAM_KEY ?? "demo-key";

createTaskboardApp(apiKey).listen(port, () => {
  console.log(`[taskboard] upstream listening on http://localhost:${port} (X-API-Key: ${apiKey})`);
});
