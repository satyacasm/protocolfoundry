import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PLATFORM = process.platform;
const TARGET = PLATFORM === "win32" ? "node22-win-x64" : PLATFORM === "darwin" ? "node22-macos-x64" : "node22-linux-x64";
const BINARY_NAME = PLATFORM === "win32" ? "pf.exe" : "pf";

async function main() {
  console.log("🚀 Starting distribution build...");

  // 1. Cleanup and prepare dist. A locked binary (a still-running `pf serve`)
  // must abort here with a clear message — pkg's own EPERM later is cryptic.
  try {
    rmSync("dist/customer-release", { recursive: true, force: true });
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EBUSY") {
      console.error(
        `❌ dist/customer-release/${BINARY_NAME} is locked by a running process.\n` +
          `   Stop any running pf instances (e.g. a "pf serve" you started for testing) and retry.\n` +
          (PLATFORM === "win32" ? `   PowerShell: Stop-Process -Name pf -Force\n` : `   Shell: pkill -f '^\\./pf'\n`),
      );
      process.exit(1);
    }
    throw err;
  }
  mkdirSync("dist/customer-release", { recursive: true });

  // 2. Bundle with esbuild
  console.log("📦 Bundling CLI and Gateway...");
  execSync(
    `npx esbuild apps/cli/src/index.ts --bundle --platform=node --target=node22 --outfile=dist/pf-bundle.cjs --minify --sourcemap`,
    { stdio: "inherit" }
  );

  // 3. Create native binary with pkg
  console.log(`🔨 Creating native binary for ${TARGET}...`);
  // We use .cjs to ensure pkg treats it as CommonJS if needed, or just .js
  execSync(
    `npx pkg dist/pf-bundle.cjs --targets ${TARGET} --output dist/customer-release/${BINARY_NAME}`,
    { stdio: "inherit" }
  );

  // 4. Generate README
  console.log("📝 Generating README...");
  const readme = `# ProtocolFoundry CLI

The all-in-one tool for building, testing, and serving eval-tested MCP servers.

## Quick Start

1. **Serve a static manifest**:
   \`\`\`bash
   ./pf serve --manifest ./manifest.json
   \`\`\`

2. **Serve live releases from a directory**:
   \`\`\`bash
   ./pf serve --dir ./releases
   \`\`\`

3. **Ingest a spec**:
   \`\`\`bash
   ./pf ingest https://api.example.com/openapi.json --project my-project
   \`\`\`

## Configuration

The gateway requires authentication. Set one of these environment variables:
- \`PF_GATEWAY_API_KEY\`: A static secret for full access.
- \`PF_GATEWAY_TOKEN_SECRET\`: Secret for verifying scoped tokens (minted via \`pf token issue\`).

For LLM-powered curation and extraction:
- \`ANTHROPIC_API_KEY\`: Required for \`pf curate\` and \`pf ingest\` from docs pages.

## Usage Guide

Run \`./pf\` for a full list of commands.
`;
  writeFileSync("dist/customer-release/README.md", readme);

  console.log(`\n✅ Build complete! Grab your bundle from dist/customer-release/`);
}

main().catch(err => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
