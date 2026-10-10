#!/bin/sh
# Applies pending Prisma migrations before a production build only. Preview/
# branch builds (Vercel VERCEL_ENV=preview, Netlify CONTEXT=deploy-preview or
# branch-deploy) and local `npm run build` skip this, so a migration on an
# unmerged branch never touches the shared production database early — see
# CLAUDE.md's "Dual deployment" section for why Vercel and Netlify share one
# Neon database. Run manually (`prisma migrate deploy`) if you ever need to
# apply a migration outside of a production build.

# Reads migration files only (no database): refuses to build if a migration
# drops one of the hand-written pgvector HNSW indexes — see the script's own
# comment. Runs on every build so it is caught before a production deploy,
# and always before `prisma migrate deploy` below.
node scripts/check-migrations-no-hnsw-drop.mjs || exit 1

if [ "$VERCEL_ENV" = "production" ] || [ "$CONTEXT" = "production" ]; then
  echo "Production build detected — running prisma migrate deploy"
  npx prisma migrate deploy
fi
