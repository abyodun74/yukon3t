# YuKon3t

A global social platform for making real, verified connections across cultures, interests, and borders — **Circles** (free interest/identity communities), **Collab Boards** (cross-country skill exchange, volunteering, and study groups), 1:1 messaging, live voice/video calls, and live streaming.

Every account verifies its email before DMs unlock, and every moderation action comes with a stated reason and an appeal path.

## Stack

Next.js 16 (App Router, Server Components + Server Actions) · NextAuth v5 · Prisma 7 + Postgres (Neon) · Tailwind 4 · Vitest. Shipped as a web app and, via Capacitor, native Android/iOS wrappers.

## Getting started

```bash
npm install
cp .env.example .env   # fill in the values you need — see the comments in that file
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Useful scripts

```bash
npm run typecheck         # tsc --noEmit
npm run lint               # eslint
npm test                   # vitest run
npm run db:studio          # browse the database
npx cap sync android        # after changing native plugins/capacitor.config.ts
```

See `CLAUDE.md` for a full architecture walkthrough (auth, media pipeline, moderation, dual Vercel/Netlify deployment) and `SECURITY.md` for the security control list.
