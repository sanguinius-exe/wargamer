import { create } from "zustand";
import {
  GameFile,
  Division,
  DivisionStatus,
  Team,
  Identity,
  SCHEMA_VERSION,
  makeSampleGame,
  makeDivision,
  makeTeam,
  slug,
  uid,
  TEAM_PALETTE,
} from "./types";
import { normalizeGame } from "./schema";
import {
  setActiveScenario,
  putTiles,
  clearScenarioTiles,
  allActiveTiles,
  activeTileCount,
} from "./tiles/tileStore";
import { registerTileProtocol } from "./tiles/protocol";
import { bakeBasemap, BakeResult } from "./tiles/bake";
import { packBundle, readBundle } from "./tiles/bundle";

export { normalizeGame };

const AUTOSAVE_KEY = "wargamer:autosave:v2";

type LngLat = [number, number];

export interface DeepDivisionPatch {
  name?: string;
  type?: Division["type"];
  echelon?: Division["echelon"];
  teamId?: string;
  notes?: string;
  higherFormation?: string;
  isHQ?: boolean;
  isTaskForce?: boolean;
  reinforced?: Division["reinforced"];
  position?: Division["position"];
  status?: Partial<DivisionStatus>;
}

interface Toast {
  kind: "info" | "error";
  msg: string;
}

export interface BakeProgress {
  running: boolean;
  done: number;
  total: number;
  label: string;
}

export interface BakeRequest {
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  layers: { imagery: boolean; reference: boolean };
}

interface State {
  game: GameFile;
  selectedDivisionId: string | null;
  /** Right-click-drag box selection on the map, for moving several at once. */
  selectedIds: string[];
  hiddenTeamIds: string[];
  layerVisible: { imagery: boolean; reference: boolean };
  selectingTheatre: boolean;
  theatreDraft: LngLat | null;
  toast: Toast | null;
  bake: BakeProgress | null;
  /** Bumped whenever baked tiles change, so the map can refresh its sources. */
  tileEpoch: number;

  newGame: () => void;
  importFile: (buf: ArrayBuffer) => Promise<void>;
  exportGame: () => Promise<void>;
  updateMeta: (patch: Partial<GameFile["meta"]>) => void;

  startTheatreSelect: () => void;
  cancelTheatreSelect: () => void;
  clearTheatre: () => void;
  theatreClick: (p: LngLat) => void;

  setLayerVisible: (layer: "imagery" | "reference", on: boolean) => void;
  runBake: (req: BakeRequest) => Promise<void>;
  cancelBake: () => void;
  clearBasemap: () => Promise<void>;

  addTeam: () => void;
  updateTeam: (id: string, patch: Partial<Omit<Team, "id">>) => void;
  removeTeam: (id: string) => void;
  toggleTeamHidden: (id: string) => void;

  addDivision: (teamId: string) => void;
  updateDivision: (id: string, patch: DeepDivisionPatch) => void;
  removeDivision: (id: string) => void;
  deployDivision: (id: string, p: LngLat) => void;
  moveDivision: (id: string, p: LngLat) => void;
  recallDivision: (id: string) => void;
  selectDivision: (id: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  moveDivisions: (moves: Record<string, LngLat>) => void;

  showToast: (kind: Toast["kind"], msg: string) => void;
}

function loadAutosave(): GameFile | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return normalizeGame(JSON.parse(raw));
  } catch {
    return null;
  }
}

function mergeDivision(d: Division, p: DeepDivisionPatch): Division {
  return {
    ...d,
    name: p.name ?? d.name,
    type: p.type ?? d.type,
    echelon: p.echelon ?? d.echelon,
    teamId: p.teamId ?? d.teamId,
    notes: p.notes ?? d.notes,
    higherFormation: p.higherFormation ?? d.higherFormation,
    isHQ: p.isHQ ?? d.isHQ,
    isTaskForce: p.isTaskForce ?? d.isTaskForce,
    reinforced: "reinforced" in p ? p.reinforced! : d.reinforced,
    position: "position" in p ? p.position! : d.position,
    status: p.status ? { ...d.status, ...p.status } : d.status,
  };
}

function boundsFromCorners(a: LngLat, b: LngLat): GameFile["theatre"] {
  return {
    bounds: [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ],
  };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let bakeAbort: AbortController | null = null;

const initialGame = loadAutosave() ?? makeSampleGame();

registerTileProtocol();
void setActiveScenario(initialGame.meta.id);

export const useGameStore = create<State>((set, get) => ({
  game: initialGame,
  selectedDivisionId: null,
  selectedIds: [],
  hiddenTeamIds: [],
  layerVisible: { imagery: true, reference: true },
  selectingTheatre: false,
  theatreDraft: null,
  toast: null,
  bake: null,
  tileEpoch: 0,

  newGame: () => {
    const now = new Date().toISOString();
    const id = uid();
    set({
      game: {
        version: SCHEMA_VERSION,
        meta: { id, name: "Untitled Scenario", createdAt: now, updatedAt: now, notes: "" },
        theatre: null,
        basemap: null,
        teams: [makeTeam("Blue Force", "friend"), makeTeam("Red Force", "hostile")],
        divisions: [],
      },
      selectedDivisionId: null,
      selectedIds: [],
      hiddenTeamIds: [],
      selectingTheatre: false,
      theatreDraft: null,
    });
    void setActiveScenario(id).then(() => set((s) => ({ tileEpoch: s.tileEpoch + 1 })));
    get().showToast("info", "New scenario started.");
  },

  importFile: async (buf) => {
    try {
      const { game, tiles } = await readBundle(buf);
      set({
        game,
        selectedDivisionId: null,
        selectedIds: [],
        hiddenTeamIds: [],
        selectingTheatre: false,
        theatreDraft: null,
      });
      await setActiveScenario(game.meta.id);
      if (tiles.length) await putTiles(game.meta.id, tiles);
      set((s) => ({ tileEpoch: s.tileEpoch + 1 }));
      const withTiles = tiles.length ? ` with ${tiles.length} map tiles` : "";
      get().showToast("info", `Loaded "${game.meta.name}"${withTiles}.`);
    } catch (err) {
      get().showToast("error", err instanceof Error ? err.message : "Could not read that file.");
    }
  },

  exportGame: async () => {
    const g = get().game;
    const out: GameFile = { ...g, meta: { ...g.meta, updatedAt: new Date().toISOString() } };
    try {
      const blob = await packBundle(out, allActiveTiles());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(g.meta.name)}.wargame`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      get().showToast("error", "Export failed while packing the bundle.");
    }
  },

  updateMeta: (patch) =>
    set((s) => ({ game: { ...s.game, meta: { ...s.game.meta, ...patch } } })),

  startTheatreSelect: () =>
    set({ selectingTheatre: true, theatreDraft: null, selectedDivisionId: null }),

  cancelTheatreSelect: () => set({ selectingTheatre: false, theatreDraft: null }),

  clearTheatre: () =>
    set((s) => ({ game: { ...s.game, theatre: null }, selectingTheatre: false, theatreDraft: null })),

  theatreClick: (p) => {
    const draft = get().theatreDraft;
    if (!draft) {
      set({ theatreDraft: p });
      return;
    }
    set((s) => ({
      game: { ...s.game, theatre: boundsFromCorners(draft, p) },
      selectingTheatre: false,
      theatreDraft: null,
    }));
    get().showToast("info", "Theatre of operations set.");
  },

  setLayerVisible: (layer, on) =>
    set((s) => ({ layerVisible: { ...s.layerVisible, [layer]: on } })),

  runBake: async (req) => {
    if (get().bake?.running) return;
    const scenarioId = get().game.meta.id;
    bakeAbort = new AbortController();
    set({
      bake: { running: true, done: 0, total: 0, label: "Contacting imagery server…" },
    });
    let result: BakeResult;
    try {
      result = await bakeBasemap({
        bounds: req.bounds,
        minZoom: req.minZoom,
        maxZoom: req.maxZoom,
        layers: req.layers,
        signal: bakeAbort.signal,
        onProgress: (done, total) =>
          set({
            bake: { running: true, done, total, label: `Downloading tiles… ${done}/${total}` },
          }),
        onTiles: (entries) => {
          void putTiles(scenarioId, entries);
        },
      });
    } catch (err) {
      set({ bake: null });
      if ((err as DOMException)?.name === "AbortError") {
        get().showToast("info", "Imagery download cancelled.");
      } else {
        get().showToast("error", "Imagery download failed.");
      }
      return;
    } finally {
      bakeAbort = null;
    }

    set((s) => ({
      game: {
        ...s.game,
        basemap: {
          imagery: result.imagery,
          reference: result.reference,
          bakedAt: new Date().toISOString(),
        },
      },
      bake: null,
      tileEpoch: s.tileEpoch + 1,
      layerVisible: {
        imagery: result.imagery ? true : s.layerVisible.imagery,
        reference: result.reference ? true : s.layerVisible.reference,
      },
    }));
    get().showToast("info", `Baked ${activeTileCount()} tiles into the scenario.`);
  },

  cancelBake: () => {
    bakeAbort?.abort();
  },

  clearBasemap: async () => {
    const scenarioId = get().game.meta.id;
    await clearScenarioTiles(scenarioId);
    set((s) => ({
      game: { ...s.game, basemap: null },
      tileEpoch: s.tileEpoch + 1,
    }));
    get().showToast("info", "Baked imagery cleared.");
  },

  addTeam: () =>
    set((s) => {
      const used = new Set(s.game.teams.map((t) => t.identity));
      const order: Identity[] = ["friend", "hostile", "neutral", "unknown", "pending"];
      const identity = order.find((i) => !used.has(i)) ?? "neutral";
      const usedColors = new Set(s.game.teams.map((t) => t.color));
      // Give extra teams a distinct colour out of the box; the first two keep
      // their identity default.
      const color =
        s.game.teams.length >= 2
          ? TEAM_PALETTE.find((c) => !usedColors.has(c))
          : undefined;
      const team = makeTeam(`Team ${s.game.teams.length + 1}`, identity);
      if (color) team.color = color;
      return { game: { ...s.game, teams: [...s.game.teams, team] } };
    }),

  updateTeam: (id, patch) =>
    set((s) => ({
      game: {
        ...s.game,
        teams: s.game.teams.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      },
    })),

  removeTeam: (id) => {
    if (get().game.divisions.some((d) => d.teamId === id)) {
      get().showToast("error", "Remove or reassign this team's divisions first.");
      return;
    }
    if (get().game.teams.length <= 1) {
      get().showToast("error", "A scenario needs at least one team.");
      return;
    }
    set((s) => ({
      game: { ...s.game, teams: s.game.teams.filter((t) => t.id !== id) },
      hiddenTeamIds: s.hiddenTeamIds.filter((t) => t !== id),
    }));
  },

  toggleTeamHidden: (id) =>
    set((s) => ({
      hiddenTeamIds: s.hiddenTeamIds.includes(id)
        ? s.hiddenTeamIds.filter((t) => t !== id)
        : [...s.hiddenTeamIds, id],
    })),

  addDivision: (teamId) =>
    set((s) => {
      const n = s.game.divisions.filter((d) => d.teamId === teamId).length + 1;
      const d = makeDivision(teamId, `${ordinal(n)} Division`);
      return {
        game: { ...s.game, divisions: [...s.game.divisions, d] },
        selectedDivisionId: d.id,
      };
    }),

  updateDivision: (id, patch) =>
    set((s) => ({
      game: {
        ...s.game,
        divisions: s.game.divisions.map((d) =>
          d.id === id ? mergeDivision(d, patch) : d,
        ),
      },
    })),

  removeDivision: (id) =>
    set((s) => ({
      game: { ...s.game, divisions: s.game.divisions.filter((d) => d.id !== id) },
      selectedDivisionId: s.selectedDivisionId === id ? null : s.selectedDivisionId,
      selectedIds: s.selectedIds.filter((x) => x !== id),
    })),

  deployDivision: (id, [lng, lat]) => get().updateDivision(id, { position: { lng, lat } }),
  moveDivision: (id, [lng, lat]) => get().updateDivision(id, { position: { lng, lat } }),
  moveDivisions: (moves) =>
    set((s) => ({
      game: {
        ...s.game,
        divisions: s.game.divisions.map((d) =>
          moves[d.id] ? { ...d, position: { lng: moves[d.id][0], lat: moves[d.id][1] } } : d,
        ),
      },
    })),
  recallDivision: (id) => get().updateDivision(id, { position: null }),
  selectDivision: (id) => set({ selectedDivisionId: id }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),

  showToast: (kind, msg) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { kind, msg } });
    toastTimer = setTimeout(() => set({ toast: null }), 4200);
  },
}));

// Autosave the scenario JSON (not tiles — those live in IndexedDB / the bundle).
// Paused while a player is in a session, so their local scenario isn't
// overwritten by the fog-of-war view they receive from the GM.
let autosavePaused = false;
export function setAutosavePaused(v: boolean): void {
  autosavePaused = v;
}

useGameStore.subscribe((s) => {
  if (autosavePaused) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(s.game));
  } catch {
    /* storage full or unavailable */
  }
});

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}


