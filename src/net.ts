import * as Y from "yjs";
import { joinRoom, selfId } from "trystero/torrent";
import { GameFile, Division, SCHEMA_VERSION, uid } from "./types";
import { useGameStore } from "./store";
import { setActiveScenario } from "./tiles/tileStore";

// ---------------------------------------------------------------------------
// Peer-to-peer session sync. No server: state lives in a Yjs CRDT document
// that every participant holds a copy of; Trystero relays doc updates over
// WebRTC data channels (using public Nostr relays only for the initial
// handshake). Yjs merges concurrent edits deterministically, so there is no
// authority — anyone can move anything and everyone converges.
// ---------------------------------------------------------------------------

interface Hooks {
  onStatus: (s: "connecting" | "connected") => void;
  onPeers: (peers: { id: string; name: string; color: string }[]) => void;
  onError: (msg: string) => void;
}

const ORIGIN = "local"; // tags Yjs transactions we initiated

// Public WebTorrent trackers, used purely for the WebRTC handshake
// (offer/answer/ICE). Trackers are built for anonymous peer discovery, unlike
// Nostr relays which increasingly gate unknown keys. Swap/extend if peers
// stop finding each other.
const TRACKER_URLS = [
  "wss://tracker.webtorrent.dev",
  "wss://tracker.openwebtorrent.com",
];
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

const copyBytes = (u: Uint8Array): Uint8Array => u.slice();

type Room = ReturnType<typeof joinRoom>;

let doc: Y.Doc | null = null;
let room: Room | null = null;
let teardown: (() => void) | null = null;
let hooks: Hooks | null = null;

let applyingRemote = false;
let selfName = "";
let selfColor = "";
let lastScenarioId: string | null = null;
const peerMeta = new Map<string, { name: string; color: string }>();
let broadcastMeta: (() => void) | null = null;

// ---------------------------------------------------------------------------

export function connect(id: string, isHost: boolean, name: string, h: Hooks): void {
  hooks = h;
  selfName = name;

  doc = new Y.Doc();
  const yGame = doc.getMap<unknown>("game");
  if (!yGame.has("divisions")) {
    doc.transact(() => yGame.set("divisions", new Y.Map<Division>()), ORIGIN);
  }

  try {
    room = joinRoom(
      { appId: "wargamer-v1", password: id, relayUrls: TRACKER_URLS },
      `s-${id}`,
    );
  } catch {
    h.onError("Could not start the peer connection.");
    return;
  }
  selfColor = colorFor(selfId || id);

  const [sendUpdate, getUpdate] = room.makeAction<Uint8Array>("y-up");
  const [sendState, getState] = room.makeAction<Uint8Array>("y-st");
  const [sendMetaAction, getMeta] =
    room.makeAction<{ name: string; color: string }>("meta");
  broadcastMeta = () => sendMetaAction({ name: selfName, color: selfColor });

  // Yjs document update -> broadcast to peers (unless it came from a peer).
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote" && room) sendUpdate(copyBytes(update));
  };
  doc.on("update", onDocUpdate);

  getUpdate((data) => {
    if (doc) Y.applyUpdate(doc, new Uint8Array(data), "remote");
  });
  getState((data) => {
    if (doc) Y.applyUpdate(doc, new Uint8Array(data), "remote");
  });
  getMeta((m, peerId) => {
    peerMeta.set(peerId, m);
    pushPeers();
  });

  let connected = false;
  const markConnected = () => {
    if (!connected) {
      connected = true;
      hooks?.onStatus("connected");
    }
  };

  room.onPeerJoin((peerId) => {
    markConnected();
    if (doc) sendState(copyBytes(Y.encodeStateAsUpdate(doc)), peerId);
    sendMetaAction({ name: selfName, color: selfColor }, peerId);
  });
  room.onPeerLeave((peerId) => {
    peerMeta.delete(peerId);
    pushPeers();
  });
  const connectTimer = setTimeout(markConnected, 3000);

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
    clearTimeout(connectTimer);
    if (raf) cancelAnimationFrame(raf);
    doc?.off("update", onDocUpdate);
    yGame.unobserveDeep(yObserver);
    storeUnsub();
  };

  h.onStatus("connecting");
  pushPeers();

  // The host owns the starting scenario; publish it now. Guests just apply
  // whatever arrives.
  if (isHost) pushFull(useGameStore.getState().game);
}

export function disconnect(): void {
  teardown?.();
  teardown = null;
  try {
    room?.leave();
  } catch {
    /* ignore */
  }
  room = null;
  doc?.destroy();
  doc = null;
  peerMeta.clear();
  applyingRemote = false;
  hooks = null;
  broadcastMeta = null;
}

export function setName(name: string): void {
  selfName = name;
  broadcastMeta?.();
}

// ---------------------------------------------------------------------------

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
  const divsMap = yGame.get("divisions") as Y.Map<Division> | undefined;
  const order = (yGame.get("order") as string[] | undefined) ?? [];
  const divisions: Division[] = [];
  const seen = new Set<string>();
  for (const did of order) {
    const d = divsMap?.get(did);
    if (d) {
      divisions.push(clone(d));
      seen.add(did);
    }
  }
  divsMap?.forEach((d, did) => {
    if (!seen.has(did)) divisions.push(clone(d));
  });

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
  const divs = yGame.get("divisions") as Y.Map<unknown> | undefined;
  if (!yGame.get("meta") && (!divs || divs.size === 0)) return;

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
  const yDivs = yGame.get("divisions") as Y.Map<Division>;
  doc.transact(() => {
    if (a.meta !== b.meta) yGame.set("meta", b.meta);
    if (a.theatre !== b.theatre) yGame.set("theatre", b.theatre);
    if (a.basemap !== b.basemap) yGame.set("basemap", b.basemap);
    if (a.teams !== b.teams) yGame.set("teams", b.teams);
    if (a.divisions !== b.divisions) {
      const before = index(a.divisions);
      const after = index(b.divisions);
      for (const d of b.divisions) if (before[d.id] !== d) yDivs.set(d.id, d);
      for (const d of a.divisions) if (!after[d.id]) yDivs.delete(d.id);
      const ao = a.divisions.map((d) => d.id).join("|");
      const bo = b.divisions.map((d) => d.id).join("|");
      if (ao !== bo) yGame.set("order", b.divisions.map((d) => d.id));
    }
  }, ORIGIN);
}

function pushFull(g: GameFile): void {
  if (!doc) return;
  const yGame = doc.getMap<unknown>("game");
  const yDivs = yGame.get("divisions") as Y.Map<Division>;
  doc.transact(() => {
    yGame.set("meta", g.meta);
    yGame.set("theatre", g.theatre);
    yGame.set("basemap", g.basemap);
    yGame.set("teams", g.teams);
    yDivs.clear();
    for (const d of g.divisions) yDivs.set(d.id, d);
    yGame.set("order", g.divisions.map((d) => d.id));
  }, ORIGIN);
}
