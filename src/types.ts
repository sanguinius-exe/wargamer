// ---------------------------------------------------------------------------
// Wargamer game-file schema (v2).
//
// A scenario is shared as a ".wargame" ZIP bundle:
//     scenario.json                 <- the GameFile below
//     tiles/imagery/{z}/{x}/{y}.jpg  <- baked Esri World Imagery (optional)
//     tiles/reference/{z}/{x}/{y}.png<- baked roads / labels overlay (optional)
//     tiles/meta.json               <- BasemapMeta below (optional)
//
// Units are drawn with real APP-6 / MIL-STD-2525C symbology (via milsymbol).
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 2;

// --- unit type -> 2525C function id (SIDC positions 5-10) -------------------

export type DivisionType =
  | "infantry"
  | "armor"
  | "mechanized"
  | "motorized"
  | "airborne"
  | "artillery"
  | "cavalry"
  | "marine"
  | "engineer";

export const FUNCTION_ID: Record<DivisionType, string> = {
  infantry: "UCI---",
  armor: "UCA---",
  mechanized: "UCIZ--",
  motorized: "UCIM--",
  airborne: "UCIA--",
  artillery: "UCF---",
  cavalry: "UCR---",
  marine: "UCIN--",
  engineer: "UCE---",
};

export const TYPE_LABEL: Record<DivisionType, string> = {
  infantry: "Infantry",
  armor: "Armored",
  mechanized: "Mechanized Infantry",
  motorized: "Motorized Infantry",
  airborne: "Airborne",
  artillery: "Field Artillery",
  cavalry: "Cavalry / Recon",
  marine: "Marine / Naval Infantry",
  engineer: "Engineer",
};

export const DIVISION_TYPES = Object.keys(FUNCTION_ID) as DivisionType[];

// --- echelon -> 2525C echelon code (SIDC position 12) ----------------------

export type Echelon = "corps" | "division" | "brigade" | "regiment";

export const ECHELON_CODE: Record<Echelon, string> = {
  corps: "J",
  division: "I",
  brigade: "H",
  regiment: "G",
};

export const ECHELON_SYMBOL: Record<Echelon, string> = {
  corps: "XXX",
  division: "XX",
  brigade: "X",
  regiment: "III",
};

export const ECHELONS = Object.keys(ECHELON_CODE) as Echelon[];

// --- side identity -> 2525C affiliation (SIDC position 2) -----------------

export type Identity = "friend" | "hostile" | "neutral" | "unknown" | "pending";

export const AFFILIATION_CODE: Record<Identity, string> = {
  friend: "F",
  hostile: "H",
  neutral: "N",
  unknown: "U",
  pending: "P",
};

export const IDENTITY_LABEL: Record<Identity, string> = {
  friend: "Friendly",
  hostile: "Hostile",
  neutral: "Neutral",
  unknown: "Unknown",
  pending: "Pending",
};

/** Standard frame colours, for roster accents that mirror the map symbol. */
export const IDENTITY_COLOR: Record<Identity, string> = {
  friend: "#4c8dff",
  hostile: "#ff4c4c",
  neutral: "#40c057",
  unknown: "#f2c94c",
  pending: "#f2c94c",
};

// --- posture (Wargamer's own field, shown as a staff comment) --------------

export type Posture =
  | "offensive"
  | "defensive"
  | "reserve"
  | "refit"
  | "withdrawing";

export const POSTURES: Posture[] = [
  "offensive",
  "defensive",
  "reserve",
  "refit",
  "withdrawing",
];

// --- condition ------------------------------------------------------------

export interface DivisionStatus {
  /** Manpower / equipment vs. full establishment (0-100). Low = damaged. */
  strengthPct: number;
  /** Training, cohesion, command & control (0-100). */
  readinessPct: number;
  /** Fuel, ammunition, spares on hand (0-100). */
  supplyPct: number;
  /** Will to fight (0-100). */
  moralePct: number;
  posture: Posture;
  fatigued: boolean;
}

export type Reinforced = "reinforced" | "reduced" | "reinforcedReduced" | null;

export interface Division {
  id: string;
  teamId: string;
  /** Rendered as the symbol's unique designation amplifier. */
  name: string;
  type: DivisionType;
  echelon: Echelon;
  /** Parent formation, shown as the higher-formation amplifier (optional). */
  higherFormation: string;
  isHQ: boolean;
  isTaskForce: boolean;
  reinforced: Reinforced;
  /** Map location, or null when the unit is held off-map in reserve. */
  position: { lng: number; lat: number } | null;
  status: DivisionStatus;
  notes: string;
}

export interface Team {
  id: string;
  name: string;
  /** APP-6 affiliation — drives the symbol *frame shape*. */
  identity: Identity;
  /** Optional custom colour; overrides the identity's default everywhere. */
  color?: string;
}

/** The colour to draw a team in — its custom colour, or its identity default. */
export function teamColor(team: Team): string {
  return team.color ?? IDENTITY_COLOR[team.identity];
}

/** Spread for extra teams beyond the five standard identities. */
export const TEAM_PALETTE = [
  "#4c8dff", "#ff6b6b", "#3fb950", "#f2c94c", "#a371f7",
  "#4dd0e1", "#ff9f43", "#e879f9", "#9ccc65", "#ff8a65",
];

export interface Theatre {
  /** [west, south, east, north] in degrees. */
  bounds: [number, number, number, number];
}

export interface BasemapLayerMeta {
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number];
  tileCount: number;
  attribution: string;
}

export interface BasemapMeta {
  imagery?: BasemapLayerMeta;
  reference?: BasemapLayerMeta;
  bakedAt: string;
}

export interface GameFile {
  version: number;
  meta: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    notes: string;
  };
  theatre: Theatre | null;
  /** Present when imagery has been baked into the bundle. */
  basemap: BasemapMeta | null;
  teams: Team[];
  divisions: Division[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scenario"
  );
}

export function defaultStatus(): DivisionStatus {
  return {
    strengthPct: 100,
    readinessPct: 100,
    supplyPct: 100,
    moralePct: 100,
    posture: "defensive",
    fatigued: false,
  };
}

/** Overall combat effectiveness, a weighted blend (0-100). */
export function effectiveness(s: DivisionStatus): number {
  const raw =
    0.4 * s.strengthPct +
    0.25 * s.readinessPct +
    0.2 * s.supplyPct +
    0.15 * s.moralePct;
  return Math.max(0, Math.min(100, Math.round(raw - (s.fatigued ? 8 : 0))));
}

export function effColor(pct: number): string {
  if (pct >= 70) return "#3fb950";
  if (pct >= 45) return "#d29922";
  return "#f85149";
}

/**
 * Assemble a 15-character 2525C SIDC from a division + its side's identity.
 * Position 4 (status) encodes operational condition from strength, so a
 * degraded unit shows the standard damaged / destroyed bar.
 */
export function buildSIDC(d: Division, identity: Identity): string {
  const affil = AFFILIATION_CODE[identity];
  const status =
    d.status.strengthPct <= 30 ? "X" : d.status.strengthPct <= 60 ? "D" : "C";
  const func = FUNCTION_ID[d.type]; // 6 chars
  const mod1 =
    d.isHQ && d.isTaskForce ? "B" : d.isHQ ? "A" : d.isTaskForce ? "E" : "-";
  const ech = ECHELON_CODE[d.echelon]; // 1 char
  return `S${affil}G${status}${func}${mod1}${ech}---`;
}

export function makeDivision(teamId: string, name: string): Division {
  return {
    id: uid(),
    teamId,
    name,
    type: "infantry",
    echelon: "division",
    higherFormation: "",
    isHQ: false,
    isTaskForce: false,
    reinforced: null,
    position: null,
    status: defaultStatus(),
    notes: "",
  };
}

export function makeTeam(name: string, identity: Identity): Team {
  return { id: uid(), name, identity };
}

// ---------------------------------------------------------------------------
// Sample scenario — a fictional sandbox on open steppe.
// ---------------------------------------------------------------------------

export function makeSampleGame(): GameFile {
  const now = new Date().toISOString();
  const blue = makeTeam("Blue Force", "friend");
  const red = makeTeam("Red Force", "hostile");

  const div = (
    team: Team,
    name: string,
    type: DivisionType,
    echelon: Echelon,
    lng: number | null,
    lat: number | null,
    extra: Omit<Partial<Division>, "status"> & { status?: Partial<DivisionStatus> },
  ): Division => ({
    ...makeDivision(team.id, name),
    type,
    echelon,
    position: lng != null && lat != null ? { lng, lat } : null,
    ...extra,
    status: { ...defaultStatus(), ...extra.status },
  });

  return {
    version: SCHEMA_VERSION,
    meta: {
      id: uid(),
      name: "Steppe Sandbox",
      createdAt: now,
      updatedAt: now,
      notes: "Fictional training scenario. Fresh order of battle, open terrain.",
    },
    theatre: { bounds: [65.6, 47.2, 71.4, 50.1] },
    basemap: null,
    teams: [blue, red],
    divisions: [
      div(blue, "1st Armored Division", "armor", "division", 67.1, 48.9, {
        higherFormation: "III Corps",
        status: { strengthPct: 92, supplyPct: 80, posture: "offensive" },
      }),
      div(blue, "3rd Infantry Division", "infantry", "division", 67.4, 48.4, {
        higherFormation: "III Corps",
        status: {
          strengthPct: 58,
          readinessPct: 82,
          posture: "defensive",
          fatigued: true,
        },
      }),
      div(blue, "5th Mechanized Brigade", "mechanized", "brigade", null, null, {
        higherFormation: "1st Armored Division",
        reinforced: "reinforced",
        status: { posture: "reserve" },
      }),
      div(red, "7th Guards Tank Division", "armor", "division", 69.9, 49.0, {
        status: {
          strengthPct: 44,
          supplyPct: 55,
          moralePct: 70,
          posture: "defensive",
        },
      }),
      div(red, "12th Motor Rifle Division", "motorized", "division", 69.6, 48.3, {
        status: { strengthPct: 88, posture: "defensive" },
      }),
      div(red, "4th Artillery Regiment", "artillery", "regiment", 70.2, 48.6, {
        isHQ: false,
        status: { strengthPct: 95, supplyPct: 60, posture: "reserve" },
      }),
    ],
  };
}
