# wargamer-relay

A ~60-line Cloudflare Worker + Durable Object that relays JSON messages
between the participants of one Wargamer session. It never sees game state —
the GM's browser holds the canonical game and this just forwards bytes. One
Durable Object instance per session id (room), so everyone in a room lands in
the same place.

Fits the Cloudflare **free plan** (Durable Objects free tier, SQLite-backed
class, no storage used).

## Run locally

```bash
cd relay
npm install
npm run dev            # ws://localhost:8787
```

The app already points at `ws://localhost:8787` in dev (`import.meta.env.DEV`),
and locally there's no token check unless you set one (see below).

## Deploy

```bash
cd relay
npm install
npx wrangler login     # once, opens a browser
npm run deploy
```

Wrangler prints the URL, e.g. `https://wargamer-relay.<your-subdomain>.workers.dev`.
Point the app at it by setting the build-time env var:

```
# wargamer/.env  (or the GitHub Actions repo variable)
VITE_RELAY_URL=wss://wargamer-relay.<your-subdomain>.workers.dev
```

Rebuild / redeploy the app and shared sessions will use it.

## Locking it down with a shared token (optional)

By default the relay is a fully public, unauthenticated endpoint — anyone who
finds the URL (bots and scanners on `*.workers.dev` domains included) gets a
response, and anyone who guesses/leaks a room code can join that room. A
shared secret closes the first hole: the Worker rejects every request
(including the plain-text banner) that doesn't carry a matching `?token=`.

1. Pick a random value, e.g. `openssl rand -hex 20`.
2. Set it as a Worker secret:
   ```bash
   cd relay
   npx wrangler secret put RELAY_TOKEN
   ```
3. Set the **same** value as a GitHub Actions repo *secret* named
   `VITE_RELAY_TOKEN` (Settings → Secrets and variables → Actions), then
   redeploy the site.

With `RELAY_TOKEN` unset (the default, and always true for local `wrangler dev`
unless you also run `wrangler secret put` there), the relay stays open exactly
as before — nothing breaks if you skip this.

Note this is *not* per-player authentication: the token is baked into the
public JS bundle, so it stops blind/automated traffic from ever reaching the
relay, not a determined person who inspects your deployed site's network
requests. Room codes remain the only thing separating one game from another.

## Protocol

- Client connects to `wss://…/?room=<id>&cid=<client-id>[&token=<secret>]`.
- Every message is a JSON string, forwarded verbatim to the other clients in
  the same room (`hello`, `lobby`, `view`, `propose`, `submit`, `unsubmit`,
  `reqview` — see `src/net.ts` for the full shape). The relay never parses or
  stores them; it just broadcasts.
- When a socket closes, the room broadcasts `{"t":"left","cid":…}` so peers can
  drop it from their presence list.
