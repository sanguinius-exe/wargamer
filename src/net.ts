import { GameFile, Division, SCHEMA_VERSION } from "./types";
import { useGameStore, setAutosavePaused } from "./store";
import { useSession, PlayerInfo, Submission } from "./session";
import { setActiveScenario } from "./tiles/tileStore";
import { playSubmitReceived, playTurnReleased } from "./sound";

// ---------------------------------------------------------------------------
// GM-run turn engine over the relay WebSocket (see /relay).
//
// The GM's client is authoritative: it holds the canonical GameFile in the
// game store and edits it freely. Players receive only a fog-of-war slice of
// it once per turn and *propose* position changes; the GM adjudicates and
// releases the next turn. The relay just forwards JSON between room members.
// ---------------------------------------------------------------------------

const RELAY_URL: string =
  import.meta.env.VITE_RELAY_URL ||
  (import.meta.env.DEV ? "ws://localhost:8787" : "");

interface ConnectOpts {
  sessionId: string;
  isHost: boolean;
  cid: string;
  name: string;
}

type Msg =
  | { t: "hello"; cid: string; name: string }
  | { t: "left"; cid: string }
  | {
      t: "lobby";
      gmCid: string;
      gmName: string;
      players: PlayerInfo[];
      turn: number;
      phase: "planning" | "adjudicating";
      visionKm: number;
    }
  | { t: "view"; forTeam: string; turn: number; game: GameFile }
  | { t: "propose"; cid: string; moves: Record<string, { lng: number; lat: number }> }
  | { t: "submit"; cid: string }
  | { t: "unsubmit"; cid: string }
  | { t: "reqview"; cid: string };

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closedByUser = false;
let opts: ConnectOpts | null = null;

let stashedGame: GameFile | null = null;
let lastAppliedTurn = 0;
let proposalRaf = 0;

// ---------------------------------------------------------------------------

export function connect(o: ConnectOpts): void {
  opts = o;
  closedByUser = false;
  lastAppliedTurn = 0;

  if (!RELAY_URL) {
    useSession.setState({
      status: "off",
      sessionId: null,
      error: "No session relay configured (set VITE_RELAY_URL).",
    });
    return;
  }

  if (!o.isHost) {
    // Preserve the player's own scenario; blank the board until the GM sends a view.
    stashedGame = useGameStore.getState().game;
    setAutosavePaused(true);
    useGameStore.setState({ game: emptyGame() });
  }

  openSocket();
}

function openSocket(): void {
  if (!opts) return;
  let retryMs = 800;
  let socket: WebSocket;
  try {
    socket = new WebSocket(
      `${RELAY_URL}?room=${encodeURIComponent(opts.sessionId)}&cid=${opts.cid}`,
    );
  } catch {
    useSession.setState({ status: "off", error: "Invalid relay URL." });
    return;
  }
  ws = socket;

  socket.onopen = () => {
    retryMs = 800;
    useSession.setState({ status: "connected" });
    send({ t: "hello", cid: opts!.cid, name: opts!.name });
    if (opts!.isHost) {
      broadcastLobby();
    } else {
      send({ t: "reqview", cid: opts!.cid });
    }
  };

  socket.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    let msg: Msg;
    try {
      msg = JSON.parse(ev.data) as Msg;
    } catch {
      return;
    }
    if (opts!.isHost) handleAsGM(msg);
    else handleAsPlayer(msg);
  };

  socket.onclose = () => {
    if (ws === socket) ws = null;
    if (closedByUser) return;
    useSession.setState({ status: "connecting" });
    reconnectTimer = setTimeout(openSocket, retryMs);
    retryMs = Math.min(Math.round(retryMs * 1.7), 10000);
  };
  socket.onerror = () => {
    /* onclose handles reconnect */
  };
}

export function disconnect(): void {
  closedByUser = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (proposalRaf) cancelAnimationFrame(proposalRaf);
  proposalRaf = 0;
  try {
    ws?.close(1000);
  } catch {
    /* already closed */
  }
  ws = null;
  if (opts && !opts.isHost && stashedGame) {
    setAutosavePaused(false);
    const g = stashedGame;
    useGameStore.setState({ game: g });
    void setActiveScenario(g.meta.id);
    useGameStore.setState((s) => ({ tileEpoch: s.tileEpoch + 1 }));
  }
  stashedGame = null;
  opts = null;
}

export function setName(name: string): void {
  if (opts) opts.name = name;
  send({ t: "hello", cid: opts?.cid ?? "", name });
}

// ---------------------------------------------------------------------------
// GM
// ---------------------------------------------------------------------------

function handleAsGM(msg: Msg): void {
  const s = useSession.getState();
  switch (msg.t) {
    case "hello": {
      if (msg.cid === opts!.cid) return;
      const players = upsertPlayer(s.players, {
        cid: msg.cid,
        name: msg.name,
        teamId: s.players.find((p) => p.cid === msg.cid)?.teamId ?? null,
        submitted: false,
        online: true,
      });
      useSession.setState({ players });
      broadcastLobby();
      break;
    }
    case "left": {
      if (!s.players.some((p) => p.cid === msg.cid)) return;
      useSession.setState({
        players: s.players.map((p) =>
          p.cid === msg.cid ? { ...p, online: false } : p,
        ),
      });
      broadcastLobby();
      break;
    }
    case "reqview": {
      const p = s.players.find((x) => x.cid === msg.cid);
      if (p?.teamId) sendView(p.teamId);
      break;
    }
    case "propose": {
      const p = s.players.find((x) => x.cid === msg.cid);
      const prev = s.submissions[msg.cid];
      const sub: Submission = {
        cid: msg.cid,
        name: p?.name ?? "?",
        teamId: p?.teamId ?? null,
        moves: msg.moves,
        submitted: prev?.submitted ?? false,
      };
      useSession.setState({ submissions: { ...s.submissions, [msg.cid]: sub } });
      break;
    }
    case "submit":
    case "unsubmit": {
      const submitted = msg.t === "submit";
      useSession.setState({
        players: s.players.map((p) =>
          p.cid === msg.cid ? { ...p, submitted } : p,
        ),
        submissions: s.submissions[msg.cid]
          ? { ...s.submissions, [msg.cid]: { ...s.submissions[msg.cid], submitted } }
          : s.submissions,
      });
      broadcastLobby();
      if (submitted) playSubmitReceived();
      break;
    }
  }
}

export function gmAssign(cid: string, teamId: string | null): void {
  const s = useSession.getState();
  useSession.setState({
    players: s.players.map((p) => (p.cid === cid ? { ...p, teamId, submitted: false } : p)),
  });
  broadcastLobby();
  const t = teamId ?? s.players.find((p) => p.cid === cid)?.teamId;
  if (t) sendView(t);
}

export function gmKick(cid: string): void {
  const s = useSession.getState();
  const { [cid]: _drop, ...rest } = s.submissions;
  void _drop;
  useSession.setState({
    players: s.players.filter((p) => p.cid !== cid),
    submissions: rest,
  });
  broadcastLobby();
}

export function gmSetVision(km: number): void {
  useSession.setState({ visionKm: km });
  broadcastLobby();
  for (const tid of assignedTeamIds()) sendView(tid);
}

export function gmStartAdjudication(): void {
  useSession.setState({ phase: "adjudicating" });
  broadcastLobby();
}

export function gmReleaseTurn(): void {
  const s = useSession.getState();
  const turn = s.turn + 1;
  useSession.setState({
    turn,
    phase: "planning",
    submissions: {},
    players: s.players.map((p) => ({ ...p, submitted: false })),
  });
  broadcastLobby();
  for (const tid of assignedTeamIds()) sendView(tid);
}

function assignedTeamIds(): string[] {
  const set = new Set<string>();
  for (const p of useSession.getState().players) if (p.teamId) set.add(p.teamId);
  return [...set];
}

function broadcastLobby(): void {
  const s = useSession.getState();
  send({
    t: "lobby",
    gmCid: opts!.cid,
    gmName: opts!.name,
    players: s.players,
    turn: s.turn,
    phase: s.phase,
    visionKm: s.visionKm,
  });
}

function sendView(teamId: string): void {
  const s = useSession.getState();
  const game = filterGameForTeam(useGameStore.getState().game, teamId, s.visionKm * 1000);
  send({ t: "view", forTeam: teamId, turn: s.turn, game });
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function handleAsPlayer(msg: Msg): void {
  if (msg.t === "lobby") {
    const me = msg.players.find((p) => p.cid === opts!.cid);
    const myTeamId = me?.teamId ?? null;
    const role = myTeamId ? "player" : "observer";
    useSession.setState({
      players: msg.players,
      gmName: msg.gmName,
      turn: msg.turn,
      phase: msg.phase,
      visionKm: msg.visionKm,
      myTeamId,
      role,
    });
    if (!myTeamId) {
      useGameStore.setState({ game: emptyGame() });
    } else {
      send({ t: "reqview", cid: opts!.cid });
    }
  } else if (msg.t === "view") {
    if (msg.forTeam !== useSession.getState().myTeamId) return;
    useGameStore.setState({ game: msg.game });
    if (msg.game.meta.id) void setActiveScenario(msg.game.meta.id);
    useGameStore.setState((st) => ({ tileEpoch: st.tileEpoch + 1 }));
    if (msg.turn !== lastAppliedTurn) {
      if (lastAppliedTurn !== 0) playTurnReleased(); // not on the first view
      lastAppliedTurn = msg.turn;
      useSession.setState({ proposals: {} });
    }
  }
}

export function playerSyncProposals(): void {
  if (proposalRaf) return;
  proposalRaf = requestAnimationFrame(() => {
    proposalRaf = 0;
    if (useSession.getState().phase !== "planning") return;
    send({ t: "propose", cid: opts!.cid, moves: useSession.getState().proposals });
  });
}

export function playerSubmit(): void {
  send({ t: "propose", cid: opts!.cid, moves: useSession.getState().proposals });
  send({ t: "submit", cid: opts!.cid });
  markSelfSubmitted(true);
}

export function playerRecall(): void {
  send({ t: "unsubmit", cid: opts!.cid });
  markSelfSubmitted(false);
}

function markSelfSubmitted(v: boolean): void {
  const s = useSession.getState();
  useSession.setState({
    players: s.players.map((p) => (p.cid === opts!.cid ? { ...p, submitted: v } : p)),
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function send(m: Msg): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function upsertPlayer(list: PlayerInfo[], p: PlayerInfo): PlayerInfo[] {
  const i = list.findIndex((x) => x.cid === p.cid);
  if (i === -1) return [...list, p];
  const next = list.slice();
  next[i] = { ...next[i], name: p.name, online: true };
  return next;
}

function haversineM(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Fog of war: your divisions + enemy divisions within visionM of any of them. */
export function filterGameForTeam(
  game: GameFile,
  teamId: string,
  visionM: number,
): GameFile {
  const mine: Division[] = [];
  const enemyOnMap: Division[] = [];
  for (const d of game.divisions) {
    if (d.teamId === teamId) mine.push(d);
    else if (d.position) enemyOnMap.push(d);
  }
  const eyes = mine.filter((d) => d.position).map((d) => d.position!);
  const visibleEnemies = enemyOnMap.filter((e) =>
    eyes.some((eye) => haversineM(eye, e.position!) <= visionM),
  );
  return { ...game, divisions: [...mine, ...visibleEnemies] };
}

function emptyGame(): GameFile {
  const now = new Date().toISOString();
  return {
    version: SCHEMA_VERSION,
    meta: { id: "session-blank", name: "Session", createdAt: now, updatedAt: now, notes: "" },
    theatre: null,
    basemap: null,
    teams: [],
    divisions: [],
  };
}
