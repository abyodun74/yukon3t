# Manual Netlify deploy for YuKon3t

Two ways to deploy YuKon3t to Netlify without opening a browser:

## 1. Push to `master` (primary path)

```bash
git push origin master
```

A GitHub webhook (created via `gh api repos/abyodun74/yukon3t/hooks`, pointing
at a Netlify Build Hook) automatically triggers a production build on
Netlify's own servers on every push. This is the normal, everyday path —
most changes should just go through this.

## 2. Manual trigger, no new commit (`trigger-deploy.mjs`)

```bash
node netlify-manual-deploy/trigger-deploy.mjs
```

Use this when you need to redeploy the *current* `master` without a new
commit — e.g. after changing a Netlify environment variable (env var
changes don't take effect until the next build). It runs
`netlify deploy --trigger --prod`, which asks Netlify to pull the latest
commit and build it remotely, then polls until the deploy finishes and
reports success/failure.

Requires the Netlify CLI to already be logged in (`npx netlify login`,
opens a browser — one-time, tied to your Netlify account).

## Why not `netlify deploy --prod` directly?

That command builds **and bundles Edge Functions locally** before
uploading. On this Windows machine, the local Edge Function bundler
reliably fails on YuKon3t's middleware with a malformed-path error — a bug
in Netlify CLI's Windows path handling, not anything in this app (see
`../SECURITY.md`, "Deployed to Netlify" section, problem #1, for the full
diagnosis). Both paths above build on Netlify's Linux servers instead,
which never hits this bug.

## Custom domain

`yukon3t.com` (registered through Netlify Domains) is linked to this site
as its custom domain — `AUTH_URL` and `NEXT_PUBLIC_APP_URL` are set to
`https://yukon3t.com` in Netlify's env vars accordingly. If the R2 bucket's
CORS policy or any other domain-specific config is ever updated, remember
`yukon3t.com` needs to be included alongside `yukon3t.vercel.app`,
`yukon3t.netlify.app`, and `localhost:3000`.
