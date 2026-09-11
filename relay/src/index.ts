/**
 * Wargamer relay — a dumb per-room WebSocket broadcaster.
 *
 * One Durable Object instance per session id holds every participant's socket
 * and forwards each message to the others verbatim. It never inspects or stores
 * game state; all sync logic (Yjs merge, presence, late-join catch-up) lives in
 * the browser (src/net.ts). Runs on Cloudflare's free plan.
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

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ cid });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    for (const peer of this.state.getWebSockets()) {
      if (peer === ws) continue;
      try {
        peer.send(message);
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
