import { create } from "zustand";

// GM-run session state. One participant is the GM (session host); everyone else
// is a player assigned to a team, or an unassigned observer. Players only see
// their own divisions plus enemies within vision range, and they *propose*
// moves rather than making them — the GM adjudicates and releases each turn.
// The heavy networking lives in ./net, loaded on demand.

export type Phase = "planning" | "adjudicating";
export type Role = "gm" | "player" | "observer";

export interface PlayerInfo {
  cid: string;
  name: string;
  teamId: string | null;
  submitted: boolean;
  online: boolean;
}

export interface Submission {
  cid: string;
  name: string;
  teamId: string | null;
  moves: Record<string, { lng: number; lat: number }>;
  submitted: boolean;
}

interface SessionStore {
  status: "off" | "connecting" | "connected";
  sessionId: string | null;
  error: string | null;

  role: Role;
  selfCid: string;
  selfName: string;
  gmName: string;

  players: PlayerInfo[];
  turn: number;
  phase: Phase;
  visionKm: number;

  myTeamId: string | null;
  /** player: my proposed positions this turn, keyed by division id */
  proposals: Record<string, { lng: number; lat: number }>;
  /** gm: proposals received from players, keyed by their cid */
  submissions: Record<string, Submission>;

  start: (sessionId?: string) => void;
  leave: () => void;
  setSelfName: (n: string) => void;

  // gm
  assign: (cid: string, teamId: string | null) => void;
  setVisionKm: (km: number) => void;
  startAdjudication: () => void;
  releaseTurn: () => void;
  kick: (cid: string) => void;

  // player
  propose: (divId: string, lngLat: [number, number]) => void;
  clearProposal: (divId: string) => void;
  submitMoves: () => void;
  recallMoves: () => void;
}

const CALLSIGNS = [
  "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
  "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa",
];
const genName = () =>
  `${CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]}-${1 + Math.floor(Math.random() * 9)}`;

function loadName(): string {
  try {
    return localStorage.getItem("wargamer:name") || genName();
  } catch {
    return genName();
  }
}

type NetModule = typeof import("./net");
let net: NetModule | null = null;

const clearHash = () => {
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    /* ignore */
  }
};

export const useSession = create<SessionStore>((set, get) => ({
  status: "off",
  sessionId: null,
  error: null,
  role: "observer",
  selfCid: "",
  selfName: loadName(),
  gmName: "",
  players: [],
  turn: 1,
  phase: "planning",
  visionKm: 7.5,
  myTeamId: null,
  proposals: {},
  submissions: {},

  start: (sessionId) => {
    if (get().status !== "off") return;
    const id = (sessionId ?? Math.random().toString(36).slice(2, 8))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (id.length < 4 || id.length > 12) {
      set({ error: "Session codes are 4–12 letters/numbers." });
      return;
    }
    const isHost = sessionId == null;
    const cid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    set({
      status: "connecting",
      sessionId: id,
      error: null,
      selfCid: cid,
      role: isHost ? "gm" : "observer",
      players: [],
      turn: 1,
      phase: "planning",
      myTeamId: null,
      proposals: {},
      submissions: {},
    });
    try {
      history.replaceState(null, "", `#s=${id}`);
    } catch {
      /* ignore */
    }
    import("./net")
      .then((m) => {
        net = m;
        m.connect({ sessionId: id, isHost, cid, name: get().selfName });
      })
      .catch(() => {
        clearHash();
        set({ status: "off", sessionId: null, error: "Could not load the session module." });
      });
  },

  leave: () => {
    net?.disconnect();
    net = null;
    clearHash();
    set({
      status: "off",
      sessionId: null,
      error: null,
      role: "observer",
      players: [],
      gmName: "",
      myTeamId: null,
      proposals: {},
      submissions: {},
    });
  },

  setSelfName: (name) => {
    const clean = name.trim().slice(0, 24) || get().selfName;
    set({ selfName: clean });
    try {
      localStorage.setItem("wargamer:name", clean);
    } catch {
      /* ignore */
    }
    net?.setName(clean);
  },

  assign: (cid, teamId) => net?.gmAssign(cid, teamId),
  setVisionKm: (km) => {
    set({ visionKm: km });
    net?.gmSetVision(km);
  },
  startAdjudication: () => net?.gmStartAdjudication(),
  releaseTurn: () => net?.gmReleaseTurn(),
  kick: (cid) => net?.gmKick(cid),

  propose: (divId, [lng, lat]) => {
    set((s) => ({ proposals: { ...s.proposals, [divId]: { lng, lat } } }));
    net?.playerSyncProposals();
  },
  clearProposal: (divId) => {
    set((s) => {
      const next = { ...s.proposals };
      delete next[divId];
      return { proposals: next };
    });
    net?.playerSyncProposals();
  },
  submitMoves: () => net?.playerSubmit(),
  recallMoves: () => net?.playerRecall(),
}));

