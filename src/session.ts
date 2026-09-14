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
  /** a short note the player attached to this turn's proposal */
  note?: string;
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
  /** player: my note to the GM this turn, editable until submitted */
  noteDraft: string;
  /** player: the GM's most recent reply, cleared when a new turn starts */
  gmNote: string | null;
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
  replyToPlayer: (cid: string, text: string) => void;

  // player
  propose: (divId: string, lngLat: [number, number]) => void;
  clearProposal: (divId: string) => void;
  setNoteDraft: (text: string) => void;
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

// If the GM's own tab reloads mid-game (crash, accidental refresh, mobile
// browser reclaiming memory), the app's normal auto-join effect re-enters
// with a session id from the URL, which used to mean "isHost = false" — the
// GM would silently rejoin as an observer and the whole room would go
// headless (nobody left broadcasting lobby/view). These two sessionStorage
// entries (scoped to this exact tab, not shared with other tabs/devices —
// unlike localStorage) let a reload recognize "this tab created this room"
// and resume as GM with the turn/phase/roster it last knew, instead of
// rolling everyone back to a fresh Turn 1.
const hostFlagKey = (id: string) => `wargamer:gmroom:${id}`;
const gmStateKey = (id: string) => `wargamer:gmsession:${id}`;

type GmResumeState = Pick<SessionStore, "turn" | "phase" | "visionKm" | "players" | "submissions">;

function loadGmResumeState(id: string): Partial<GmResumeState> {
  try {
    const raw = sessionStorage.getItem(gmStateKey(id));
    return raw ? (JSON.parse(raw) as Partial<GmResumeState>) : {};
  } catch {
    return {};
  }
}

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
  noteDraft: "",
  gmNote: null,
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
    // A fresh "Start session as GM" click always makes you host. A reload of
    // that same GM tab re-enters here with the room's id from the URL hash
    // instead — recognize that case via the flag set below so it resumes as
    // GM rather than joining its own room as a stray observer.
    let wasHost = false;
    try {
      wasHost = sessionStorage.getItem(hostFlagKey(id)) === "1";
    } catch {
      /* ignore */
    }
    const isHost = sessionId == null || wasHost;
    if (isHost) {
      try {
        sessionStorage.setItem(hostFlagKey(id), "1");
      } catch {
        /* ignore */
      }
    }
    const resume = wasHost ? loadGmResumeState(id) : {};
    // Stable per-tab id so a reload reconnects to the same seat.
    const cidKey = `wargamer:cid:${id}`;
    let cid: string;
    try {
      cid =
        sessionStorage.getItem(cidKey) ??
        (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
      sessionStorage.setItem(cidKey, cid);
    } catch {
      cid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    }
    set({
      status: "connecting",
      sessionId: id,
      error: null,
      selfCid: cid,
      role: isHost ? "gm" : "observer",
      players: resume.players ?? [],
      turn: resume.turn ?? 1,
      phase: resume.phase ?? "planning",
      visionKm: resume.visionKm ?? get().visionKm,
      myTeamId: null,
      proposals: {},
      noteDraft: "",
      gmNote: null,
      submissions: resume.submissions ?? {},
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
    try {
      const id = get().sessionId;
      if (id) {
        sessionStorage.removeItem(`wargamer:cid:${id}`);
        sessionStorage.removeItem(hostFlagKey(id));
        sessionStorage.removeItem(gmStateKey(id));
      }
    } catch {
      /* ignore */
    }
    set({
      status: "off",
      sessionId: null,
      error: null,
      role: "observer",
      players: [],
      gmName: "",
      myTeamId: null,
      proposals: {},
      noteDraft: "",
      gmNote: null,
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
  replyToPlayer: (cid, text) => {
    const clean = text.trim().slice(0, 280);
    if (clean) net?.gmSendReply(cid, clean);
  },

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
  setNoteDraft: (text) => {
    set({ noteDraft: text.slice(0, 280) });
    net?.playerSyncProposals();
  },
  submitMoves: () => net?.playerSubmit(),
  recallMoves: () => net?.playerRecall(),
}));

// Keep a running snapshot of GM-owned session state so a reload of the GM's
// own tab (see hostFlagKey/gmStateKey above) can resume mid-game instead of
// rolling the whole room back to a fresh Turn 1.
let lastGmSnapshot = "";
useSession.subscribe((state) => {
  if (state.role !== "gm" || !state.sessionId || state.status !== "connected") return;
  const snapshot: GmResumeState = {
    turn: state.turn,
    phase: state.phase,
    visionKm: state.visionKm,
    players: state.players,
    submissions: state.submissions,
  };
  const serialized = JSON.stringify(snapshot);
  if (serialized === lastGmSnapshot) return;
  lastGmSnapshot = serialized;
  try {
    sessionStorage.setItem(gmStateKey(state.sessionId), serialized);
  } catch {
    /* storage full/unavailable — the GM just resumes at Turn 1 on reload */
  }
});


