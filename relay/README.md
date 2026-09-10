# wargamer-relay

A ~60-line Cloudflare Worker + Durable Object that relays WebSocket messages
between the participants of one Wargamer session. It never sees game state — the
browser holds a Yjs CRDT and this just forwards the bytes. One Durable Object
instance per session id, so everyone in a room lands in the same place.

Fits the Cloudflare **free plan** (Durable Objects free tier, SQLite-backed
class, no storage used).

## Run locally

```bash
cd relay
npm install
npm run dev            # ws://localhost:8787
```

The app already points at `ws://localhost:8787` in dev (`import.meta.env.DEV`).

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
# wargamer/.env  (or the GitHub Actions build env)
VITE_RELAY_URL=wss://wargamer-relay.<your-subdomain>.workers.dev
```

Rebuild / redeploy the app and shared sessions will use it.

## Protocol

- Client connects to `wss://…/?room=<id>&cid=<client-id>`.
- Every message a client sends is forwarded verbatim to the other clients in the
  same room. Binary frames carry Yjs updates (1-byte tag + payload); string
  frames are JSON control messages (`hello`, `meta`).
- When a socket closes, the room broadcasts `{"t":"left","cid":…}` so peers can
  drop it from their presence list.
