import * as Y from "yjs";
import { GameFile, Division, SCHEMA_VERSION, uid } from "./types";
import { useGameStore } from "./store";
import { setActiveScenario } from "./tiles/tileStore";

// ---------------------------------------------------------------------------
// Shared session sync. The game state is a Yjs CRDT document every participant
// holds a copy of; a tiny Cloudflare Worker (see /relay) relays doc updates
// between the members of one room over a WebSocket. Yjs merges concurrent edits
// deterministically, so there is no authority — anyone edits, everyone
// converges. The relay never sees game state, only opaque bytes.
// ---------------------------------------------------------------------------

const RELAY_URL: string =
  import.meta.env.VITE_RELAY_URL ||
  (import.meta.env.DEV ? "ws://localhost:8787" : "");

interface Hooks {
  onStatus: (s: "connecting" | "connected") => void;
  onPeers: (peers: { id: string; name: string; color: string }[]) => void;
  onError: (msg: string) => void;
}

const ORIGIN = "local"; // tags Yjs transactions we initiated

// Binary frame tags (first byte).
const T_UPDATE = 1;
const T_STATE = 2;

const PALETTE = [
  "#4c8dff", "#ff6b6b", "#3fb950", "#f2c94c",
  "#a371f7", "#4dd0e1", "#ff9f43", "#e879f9",
];

function colorFor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const clone = <T>(v: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);

function frame(tag: number, bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.length + 1);
  out[0] = tag;
  out.set(bytes, 1);
  return out.buffer;
}

let doc: Y.Doc | null = null;
let ws: WebSocket | null = null;
let teardown: (() => void) | null = null;
let hooks: Hooks | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closedByUser = false;

let applyingRemote = false;
let roomId = "";
let selfCid = "";
let selfName = "";
let selfColor = "";
let lastScenarioId: string | null = null;
const peerMeta = new Map<string, { name: string; color: string }>();

interface Ctrl {
  t: "hello" | "meta" | "left";
  cid: string;
  name?: string;
  color?: string;
}

// ---------------------------------------------------------------------------

export function connect(id: string, isHost: boolean, name: string, h: Hooks): void {
  hooks = h;
  selfName = name;
  roomId = id;
  selfCid = uid();
  selfColor = colorFor(selfCid);
  closedByUser = false;

  if (!RELAY_URL) {
    h.onError("No session relay configured (set VITE_RELAY_URL).");
    return;
  }

  doc = new Y.Doc();
  const yGame = doc.getMap<unknown>("game");
  // Flat keys only: meta/theatre/basemap/teams/order as plain values, and each
  // division under "div:<id>". No nested Y types — two peers independently
  // creating the same nested Y.Map would conflict and drop one side's contents.

  // Yjs document update -> broadcast (unless it came from a peer).
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote" && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(frame(T_UPDATE, update));
    }
  };
  doc.on("update", onDocUpdate);

  // Yjs -> local store.
  const yObserver = (_events: unknown, txn: Y.Transaction) => {
    if (txn.origin === ORIGIN) return;
    pullFromY();
  };
  yGame.observeDeep(yObserver);

  // Local store -> Yjs, coalesced to one flush per frame (drag storms).
  let prevGame = useGameStore.getState().game;
  lastScenarioId = prevGame.meta.id;
  let raf = 0;
  const flush = () => {
    raf = 0;
    const cur = useGameStore.getState().game;
    if (cur !== prevGame && !applyingRemote) pushDiff(prevGame, cur);
    prevGame = cur;
  };
  const storeUnsub = useGameStore.subscribe((s) => {
    if (s.game === prevGame) return;
    if (applyingRemote) {
      prevGame = s.game;
      return;
    }
    if (!raf) raf = requestAnimationFrame(flush);
  });

  teardown = () => {
    if (raf) cancelAnimationFrame(raf);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    doc?.off("update", onDocUpdate);
    yGame.unobserveDeep(yObserver);
    storeUnsub();
  };

  h.onStatus("connecting");
  openSocket();

  // The host owns the starting scenario; publish it into the doc now.
  if (isHost) pushFull(useGameStore.getState().game);
}

function openSocket(): void {
  let retryMs = 800;
  let socket: WebSocket;
  try {
    socket = new WebSocket(
      `${RELAY_URL}?room=${encodeURIComponent(roomId)}&cid=${selfCid}`,
    );
  } catch {
    hooks?.onError("Invalid relay URL.");
    return;
  }
  socket.binaryType = "arraybuffer";
  ws = socket;

  socket.onopen = () => {
    retryMs = 800;
    hooks?.onStatus("connected");
    sendCtrl({ t: "hello", cid: selfCid, name: selfName, color: selfColor });
    if (doc) socket.send(frame(T_STATE, Y.encodeStateAsUpdate(doc)));
  };

  socket.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      try {
        handleCtrl(JSON.parse(ev.data) as Ctrl);
      } catch {
        /* ignore malformed control frame */
      }
      return;
    }
    const view = new Uint8Array(ev.data as ArrayBuffer);
    const tag = view[0];
    if ((tag === T_UPDATE || tag === T_STATE) && doc) {
      Y.applyUpdate(doc, view.subarray(1), "remote");
    }
  };

  socket.onclose = () => {
    if (ws === socket) ws = null;
    if (closedByUser) return;
    if (peerMeta.size) {
      peerMeta.clear();
      pushPeers();
    }
    hooks?.onStatus("connecting");
    reconnectTimer = setTimeout(openSocket, retryMs);
    retryMs = Math.min(Math.round(retryMs * 1.7), 10000);
  };

  socket.onerror = () => {
    /* an onclose follows; reconnect handled there */
  };
}

function handleCtrl(m: Ctrl): void {
  if (!m || !m.cid || m.cid === selfCid) return;
  if (m.t === "hello") {
    const known = peerMeta.has(m.cid);
    peerMeta.set(m.cid, { name: m.name ?? "?", color: m.color ?? "#8892a0" });
    pushPeers();
    if (!known) {
      // Introduce ourselves back and hand them the current doc state.
      sendCtrl({ t: "hello", cid: selfCid, name: selfName, color: selfColor });
      if (doc && ws?.readyState === WebSocket.OPEN) {
        ws.send(frame(T_STATE, Y.encodeStateAsUpdate(doc)));
      }
    }
  } else if (m.t === "meta") {
    peerMeta.set(m.cid, { name: m.name ?? "?", color: m.color ?? "#8892a0" });
    pushPeers();
  } else if (m.t === "left") {
    if (peerMeta.delete(m.cid)) pushPeers();
  }
}

export function disconnect(): void {
  closedByUser = true;
  teardown?.();
  teardown = null;
  try {
    ws?.close(1000);
  } catch {
    /* already closed */
  }
  ws = null;
  doc?.destroy();
  doc = null;
  peerMeta.clear();
  applyingRemote = false;
  hooks = null;
}

export function setName(name: string): void {
  selfName = name;
  sendCtrl({ t: "meta", cid: selfCid, name, color: selfColor });
}

// ---------------------------------------------------------------------------

function sendCtrl(m: Ctrl): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function pushPeers(): void {
  hooks?.onPeers(
    [...peerMeta.entries()].map(([id, m]) => ({ id, name: m.name, color: m.color })),
  );
}

function index(list: Division[]): Record<string, Division> {
  const m: Record<string, Division> = {};
  for (const d of list) m[d.id] = d;
  return m;
}

function readGame(yGame: Y.Map<unknown>): GameFile {
  const order = (yGame.get("order") as string[] | undefined) ?? [];
  const byId = new Map<string, Division>();
  yGame.forEach((v, k) => {
    if (k.startsWith("div:")) byId.set(k.slice(4), v as Division);
  });
  const divisions: Division[] = [];
  for (const did of order) {
    const d = byId.get(did);
    if (d) {
      divisions.push(clone(d));
      byId.delete(did);
    }
  }
  for (const d of byId.values()) divisions.push(clone(d));

  const meta = yGame.get("meta") as GameFile["meta"] | undefined;
  const theatre = yGame.get("theatre") as GameFile["theatre"] | undefined;
  const basemap = yGame.get("basemap") as GameFile["basemap"] | undefined;
  const teams = yGame.get("teams") as GameFile["teams"] | undefined;

  return {
    version: SCHEMA_VERSION,
    meta: meta
      ? clone(meta)
      : {
          id: uid(),
          name: "Shared Scenario",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          notes: "",
        },
    theatre: theatre ? clone(theatre) : null,
    basemap: basemap ? clone(basemap) : null,
    teams: teams ? teams.map((t) => clone(t)) : [],
    divisions,
  };
}

function pullFromY(): void {
  if (!doc) return;
  const yGame = doc.getMap<unknown>("game");
  if (!yGame.get("meta")) return; // nothing meaningful has arrived yet

  applyingRemote = true;
  try {
    const game = readGame(yGame);
    useGameStore.setState({ game });
    if (game.meta.id !== lastScenarioId) {
      lastScenarioId = game.meta.id;
      void setActiveScenario(game.meta.id);
      useGameStore.setState((s) => ({ tileEpoch: s.tileEpoch + 1 }));
    }
  } finally {
    applyingRemote = false;
  }
}

function pushDiff(a: GameFile, b: GameFile): void {
  if (!doc) return;
  const yGame = doc.getMap<unknown>("game");
  doc.transact(() => {
    if (a.meta !== b.meta) yGame.set("meta", b.meta);
    if (a.theatre !== b.theatre) yGame.set("theatre", b.theatre);
    if (a.basemap !== b.basemap) yGame.set("basemap", b.basemap);
    if (a.teams !== b.teams) yGame.set("teams", b.teams);
    if (a.divisions !== b.divisions) {
      const before = index(a.divisions);
      const after = index(b.divisions);
      for (const d of b.divisions) if (before[d.id] !== d) yGame.set(`div:${d.id}`, d);
      for (const d of a.divisions) if (!after[d.id]) yGame.delete(`div:${d.id}`);
      const ao = a.divisions.map((d) => d.id).join("|");
      const bo = b.divisions.map((d) => d.id).join("|");
      if (ao !== bo) yGame.set("order", b.divisions.map((d) => d.id));
    }
  }, ORIGIN);
}

function pushFull(g: GameFile): void {
  if (!doc) return;
  const yGame = doc.getMap<unknown>("game");
  doc.transact(() => {
    yGame.set("meta", g.meta);
    yGame.set("theatre", g.theatre);
    yGame.set("basemap", g.basemap);
    yGame.set("teams", g.teams);
    const stale: string[] = [];
    yGame.forEach((_v, k) => {
      if (k.startsWith("div:")) stale.push(k);
    });
    for (const k of stale) yGame.delete(k);
    for (const d of g.divisions) yGame.set(`div:${d.id}`, d);
    yGame.set("order", g.divisions.map((d) => d.id));
  }, ORIGIN);
}
