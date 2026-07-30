#!/usr/bin/env node
// Manually trigger a YuKon3t production deploy on Netlify's own servers
// (not a local build) and wait for it to finish, reporting the result.
//
// Usage:  node netlify-manual-deploy/trigger-deploy.mjs
//
// Why this exists instead of `netlify deploy --prod`: that command builds
// and bundles Edge Functions *locally* before uploading, and on this
// Windows machine that step reliably fails with a malformed-path error
// while bundling the Next.js middleware (see ../SECURITY.md, "Deployed to
// Netlify" section, problem #1). `netlify deploy --trigger` instead asks
// Netlify to pull the latest commit from GitHub and build it on their own
// Linux servers — the same mechanism the git-push webhook uses, just
// invoked on demand instead of automatically. This script is not the
// primary deploy path (a plain `git push` already auto-deploys via the
// webhook) — it's for redeploying without a new commit, e.g. after
// changing an environment variable.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SITE_ID = "bbcb23d0-2759-4457-a964-d5a823bd5df4";

async function netlifyApi(method, data) {
  const { stdout } = await run(
    "npx",
    ["netlify", "api", method, "--data", JSON.stringify(data)],
    { shell: true, maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function main() {
  console.log("Checking Netlify CLI login...");
  try {
    await run("npx", ["netlify", "status"], { shell: true });
  } catch {
    console.error(
      "Not logged in to Netlify CLI. Run `npx netlify login` first (opens a browser).",
    );
    process.exit(1);
  }

  const before = await netlifyApi("listSiteDeploys", { site_id: SITE_ID });
  const lastKnownId = before[0]?.id;

  console.log("Triggering a remote build on Netlify's servers...");
  await run("npx", ["netlify", "deploy", "--trigger", "--prod"], {
    shell: true,
    cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"),
  });

  console.log("Waiting for the new deploy to appear...");
  let deploy;
  for (let i = 0; i < 30; i++) {
    const deploys = await netlifyApi("listSiteDeploys", { site_id: SITE_ID });
    deploy = deploys.find((d) => d.id !== lastKnownId);
    if (deploy) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!deploy) {
    console.error("Timed out waiting for a new deploy to be registered.");
    process.exit(1);
  }

  console.log(`Deploy ${deploy.id} building — polling for completion...`);
  for (let i = 0; i < 60; i++) {
    const current = await netlifyApi("getDeploy", { deploy_id: deploy.id });
    if (current.state === "ready") {
      console.log(`✅ Deploy succeeded. Live at ${current.ssl_url ?? current.url}`);
      return;
    }
    if (current.state === "error") {
      console.error(`❌ Deploy failed: ${current.error_message}`);
      console.error(
        `Run: npx netlify logs --source deploy --follow  (right after re-triggering) to see the full build log — Netlify doesn't expose historical build logs via a simple API fetch.`,
      );
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  console.error("Timed out waiting for the deploy to finish.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
