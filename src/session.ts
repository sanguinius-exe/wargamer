import { create } from "zustand";

// Lightweight always-loaded session state. The heavy networking (Yjs +
// Trystero/WebRTC) lives in ./net and is loaded on demand the first time a
// session starts, so it stays out of the initial bundle.

export interface Peer {
  id: string;
  name: string;
  color: string;
}

type Status = "off" | "connecting" | "connected";

interface SessionStore {
  status: Status;
  sessionId: string | null;
  isHost: boolean;
  selfName: string;
  peers: Peer[];
  error: string | null;
  start: (sessionId?: string) => void;
  leave: () => void;
  setSelfName: (name: string) => void;
}

const CALLSIGNS = [
  "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
  "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa",
];

function genName(): string {
  const c = CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)];
  return `${c}-${1 + Math.floor(Math.random() * 9)}`;
}

function loadName(): string {
  try {
    return localStorage.getItem("wargamer:name") || genName();
  } catch {
    return genName();
  }
}

type NetModule = typeof import("./net");
let net: NetModule | null = null;

export const useSession = create<SessionStore>((set, get) => ({
  status: "off",
  sessionId: null,
  isHost: false,
  selfName: loadName(),
  peers: [],
  error: null,

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
    set({ status: "connecting", sessionId: id, isHost, error: null, peers: [] });
    try {
      history.replaceState(null, "", `#s=${id}`);
    } catch {
      /* ignore */
    }

    import("./net")
      .then((m) => {
        net = m;
        m.connect(id, isHost, get().selfName, {
          onStatus: (s) => set({ status: s }),
          onPeers: (peers) => set({ peers }),
          onError: (msg) => {
            net = null;
            clearHash();
            set({ status: "off", sessionId: null, peers: [], error: msg });
          },
        });
      })
      .catch(() => {
        clearHash();
        set({
          status: "off",
          sessionId: null,
          error: "Could not load the session module.",
        });
      });
  },

  leave: () => {
    net?.disconnect();
    net = null;
    clearHash();
    set({ status: "off", sessionId: null, isHost: false, peers: [], error: null });
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
}));

function clearHash() {
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    /* ignore */
  }
}
