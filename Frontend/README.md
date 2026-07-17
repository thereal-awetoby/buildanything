# VibeForge

Your Monad-powered Builder OS — Vite + React + Tailwind frontend, with a tiny
Express server that proxies calls to Claude so your API key never touches
the browser.

## What changed from the Claude-artifact version

The dashboard was built and tested inside a Claude.ai artifact, which
provides two things a normal app doesn't have for free:

1. **`window.storage`** — an artifact-only persistence API. Replaced here
   with `src/lib/storage.js`, a matching interface backed by
   `localStorage`, so the rest of the app didn't need to change. This is
   per-browser, not per-account — swap it for a real backend (Postgres,
   Supabase, etc.) when you're ready to share data across devices or
   teammates.
2. **An authenticated fetch to `api.anthropic.com`** with no key in the
   request. Replaced here with a call to `/api/claude`, proxied by Vite
   to a small Express server (`server/index.js`) that attaches your real
   `ANTHROPIC_API_KEY` server-side.

Everything else — the two system prompts, the dashboard UI, the
multi-page nav — is unchanged.

## Setup

```bash
npm install
cp .env.example .env
# then paste your real key into .env:
# ANTHROPIC_API_KEY=sk-ant-...
```

Get a key from https://console.anthropic.com if you don't have one yet.

## Run it

```bash
npm run dev
```

This starts two processes together (via `concurrently`):
- the Express API on `http://localhost:3001`
- the Vite dev server on `http://localhost:5173`

Open `http://localhost:5173` — Vite proxies any `/api/*` request to the
Express server for you, so the frontend never needs to know the key exists.

## Project layout

```
server/index.js       Express server, holds the Anthropic API key, exposes POST /api/claude
src/App.jsx            The full dashboard (nav, capture, co-pilot, on-chain, analytics, settings)
src/lib/storage.js      localStorage-backed persistence
src/main.jsx            React entry point
tailwind.config.js       Tailwind content paths
```

## Before you deploy or commit

- `.env` is already git-ignored — don't commit your API key.
- If you deploy the frontend and backend separately (e.g. Vercel for the
  client, Railway/Render for the server), update the `/api` proxy in
  `vite.config.js` for dev, and point the client at your deployed server
  URL for prod — or serve both from the same origin if you don't want to
  deal with CORS.
- The On-Chain page and streak data are still hardcoded per the plan —
  swap them for real Monad contract reads (Builder A's `ABI` +
  `CONTRACT_ADDRESS`) whenever that's ready.
