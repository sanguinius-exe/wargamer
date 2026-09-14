/**
 * Wargamer relay — a dumb per-room WebSocket broadcaster.
 *
 * One Durable Object instance per session id holds every participant's socket
 * and forwards each message to the others, stamping a verified `_from` (the
 * cid a socket connected with — see the duplicate-cid check below) onto each
 * one so the client (src/net.ts) can tell who genuinely sent a message from
 * who a message merely claims to be from. It never reads or stores game
 * content itself; all game/turn logic lives in the browser. Runs on
 * Cloudflare's free plan.
 */

export interface Env {
  ROOM: DurableObjectNamespace;
  // Shared secret the client build embeds as VITE_RELAY_TOKEN. Set via
  // `wrangler secret put RELAY_TOKEN`. When unset (e.g. local `wrangler dev`),
  // the check is skipped and the relay stays open, as before.
  RELAY_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Gate everything, including the plain-text banner, so unauthenticated
    // scanners/bots get an opaque 403 instead of confirmation this is a
    // wargamer relay.
    if (env.RELAY_TOKEN && url.searchParams.get("token") !== env.RELAY_TOKEN) {
      return new Response("forbidden", { status: 403 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("wargamer relay: connect a WebSocket with ?room=<id>", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    const room = url.searchParams.get("room");
    if (!room) return new Response("missing ?room", { status: 400 });

    const stub = env.ROOM.get(env.ROOM.idFromName(room));
    return stub.fetch(request);
  },
};

export class Room {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cid = url.searchParams.get("cid") ?? crypto.randomUUID();

    // Refuse a second live socket claiming a cid already in use in this room.
    // cid is how participants tell each other "who sent this" (src/net.ts
    // trusts it to decide e.g. who the real GM is) — letting two sockets
    // share one would let a participant forge messages as someone else. A
    // stale socket clears within moments of really closing, so a genuine
    // reconnect (same person, new socket) just retries — net.ts already does.
    for (const peer of this.state.getWebSockets()) {
      const att = peer.deserializeAttachment() as { cid?: string } | null;
      if (att?.cid === cid) {
        return new Response("cid already connected", { status: 409 });
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ cid });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // Stamp the verified sender cid (bound to this socket at connect time)
    // onto every JSON message before forwarding, so peers can tell a message
    // that's genuinely from someone from one that merely *claims* to be —
    // the message body itself is otherwise untouched and unread.
    let out: ArrayBuffer | string = message;
    if (typeof message === "string") {
      const att = ws.deserializeAttachment() as { cid?: string } | null;
      if (att?.cid) {
        try {
          const obj = JSON.parse(message) as Record<string, unknown>;
          if (obj && typeof obj === "object") {
            obj._from = att.cid;
            out = JSON.stringify(obj);
          }
        } catch {
          /* not JSON; forward as-is */
        }
      }
    }
    for (const peer of this.state.getWebSockets()) {
      if (peer === ws) continue;
      try {
        peer.send(out);
      } catch {
        /* peer is going away */
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as { cid?: string } | null;
    if (att?.cid) {
      const bye = JSON.stringify({ t: "left", cid: att.cid });
      for (const peer of this.state.getWebSockets()) {
        if (peer === ws) continue;
        try {
          peer.send(bye);
        } catch {
          /* ignore */
        }
      }
    }
    try {
      ws.close(1000);
    } catch {
      /* already closed */
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011);
    } catch {
      /* ignore */
    }
  }
}
