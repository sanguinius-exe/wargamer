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
  | "engineer"
  // naval
  | "carrier"
  | "battleship"
  | "heavyCruiser"
  | "lightCruiser"
  | "destroyer"
  | "frigate"
  | "littoral"
  | "amphibious"
  | "mineWarfare"
  | "patrol"
  | "auxiliary"
  | "submarine";

/** Which 2525C battle dimension (SIDC position 3) a unit type lives in. */
export type UnitDomain = "ground" | "sea" | "subsurface";

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
  carrier: "CLCV--",
  battleship: "CLBB--",
  heavyCruiser: "CLCC--",
  lightCruiser: "CLCC--",
  destroyer: "CLDD--",
  frigate: "CLFF--",
  littoral: "CLLL--",
  amphibious: "CA----",
  mineWarfare: "CM----",
  patrol: "CP----",
  auxiliary: "N-----",
  submarine: "S-----",
};

const DIMENSION_CODE: Record<UnitDomain, string> = {
  ground: "G",
  sea: "S",
  subsurface: "U",
};

export function unitDomain(t: DivisionType): UnitDomain {
  if (t === "submarine") return "subsurface";
  return FUNCTION_ID[t].startsWith("U") ? "ground" : "sea";
}

/** Ships and submarines — no echelon, drawn in the sea frames. */
export function isNaval(t: DivisionType): boolean {
  return unitDomain(t) !== "ground";
}

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
  carrier: "Aircraft Carrier (CV)",
  battleship: "Battleship",
  heavyCruiser: "Heavy Cruiser (CA)",
  lightCruiser: "Light Cruiser (CL)",
  destroyer: "Destroyer",
  frigate: "Frigate",
  littoral: "Littoral Combat Ship / Corvette",
  amphibious: "Amphibious Warfare Ship",
  mineWarfare: "Mine Warfare Vessel",
  patrol: "Patrol Boat",
  auxiliary: "Auxiliary / Replenishment",
  submarine: "Submarine",
};

/**
 * Hull classification drawn inside the ship frame in place of milsymbol's
 * own label. 2525C has one cruiser code (it labels "CC") and draws the
 * carrier as a bare glyph, so these classes reuse the cruiser symbol with
 * their own letters.
 */
export const HULL_LABEL: Partial<Record<DivisionType, string>> = {
  carrier: "CV",
  heavyCruiser: "CA",
  lightCruiser: "CL",
};

export const DIVISION_TYPES = Object.keys(FUNCTION_ID) as DivisionType[];
export const GROUND_TYPES = DIVISION_TYPES.filter((t) => !isNaval(t));
export const NAVAL_TYPES = DIVISION_TYPES.filter(isNaval);

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

/**
 * Naval condition, carried only by ships and submarines. Their readiness,
 * supply, posture and fatigue still live in DivisionStatus; hull integrity
 * stands in for strength, and these replace morale.
 */
export interface NavalStatus {
  /** Structural condition of the hull (0-100). Low = damaged. */
  hullPct: number;
  /** Radar / sonar / EW suite condition (0-100). */
  sensorPct: number;
  /** Offensive anti-ship / land-attack missile reach. */
  missileRangeKm: number;
  /** Air-defence engagement envelope. */
  airDefenseRangeKm: number;
  /** Detection range with sensors fully working. */
  sensorRangeKm: number;
}

type NavalRanges = Pick<NavalStatus, "missileRangeKm" | "airDefenseRangeKm" | "sensorRangeKm">;

/** Rough per-class starting ranges (km); the GM tunes them per unit. */
const NAVAL_RANGES: Partial<Record<DivisionType, NavalRanges>> = {
  carrier: { missileRangeKm: 0, airDefenseRangeKm: 5, sensorRangeKm: 40 },
  battleship: { missileRangeKm: 15, airDefenseRangeKm: 2, sensorRangeKm: 15 },
  heavyCruiser: { missileRangeKm: 30, airDefenseRangeKm: 15, sensorRangeKm: 35 },
  lightCruiser: { missileRangeKm: 20, airDefenseRangeKm: 10, sensorRangeKm: 25 },
  destroyer: { missileRangeKm: 25, airDefenseRangeKm: 15, sensorRangeKm: 30 },
  frigate: { missileRangeKm: 18, airDefenseRangeKm: 5, sensorRangeKm: 20 },
  littoral: { missileRangeKm: 10, airDefenseRangeKm: 1, sensorRangeKm: 10 },
  amphibious: { missileRangeKm: 0, airDefenseRangeKm: 3, sensorRangeKm: 15 },
  mineWarfare: { missileRangeKm: 0, airDefenseRangeKm: 0.5, sensorRangeKm: 4 },
  patrol: { missileRangeKm: 4, airDefenseRangeKm: 0.5, sensorRangeKm: 4 },
  auxiliary: { missileRangeKm: 0, airDefenseRangeKm: 0.5, sensorRangeKm: 6 },
  submarine: { missileRangeKm: 25, airDefenseRangeKm: 0, sensorRangeKm: 10 },
};

export function defaultNaval(t: DivisionType): NavalStatus {
  return {
    hullPct: 100,
    sensorPct: 100,
    ...(NAVAL_RANGES[t] ?? NAVAL_RANGES.destroyer!),
  };
}

/** Detection range actually achieved, scaled by sensor integrity (metres). */
export function effectiveSensorM(n: NavalStatus): number {
  return n.sensorRangeKm * 1000 * (n.sensorPct / 100);
}

export type RangeKind = "missile" | "airDefense" | "sensor";

/** Map ring colours for each naval range kind. */
export const RANGE_COLOR: Record<RangeKind, string> = {
  missile: "#ff9f43",
  airDefense: "#4dd0e1",
  sensor: "#e6edf3",
};

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
  /** Present on naval units; null for ground units. */
  naval: NavalStatus | null;
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

/** Strength for ground units, hull integrity for naval ones (0-100). */
export function conditionPct(d: Division): number {
  return isNaval(d.type) && d.naval ? d.naval.hullPct : d.status.strengthPct;
}

/** Overall combat effectiveness, a weighted blend (0-100). */
export function effectiveness(d: Division): number {
  const s = d.status;
  const raw =
    isNaval(d.type) && d.naval
      ? 0.4 * d.naval.hullPct +
        0.2 * d.naval.sensorPct +
        0.2 * s.readinessPct +
        0.2 * s.supplyPct
      : 0.4 * s.strengthPct +
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
 * Position 4 (status) encodes operational condition from strength (hull
 * integrity for naval units), so a
 * degraded unit shows the standard damaged / destroyed bar.
 */
export function buildSIDC(d: Division, identity: Identity): string {
  const affil = AFFILIATION_CODE[identity];
  const naval = isNaval(d.type);
  const dim = DIMENSION_CODE[unitDomain(d.type)];
  const cond = conditionPct(d);
  const status = cond <= 30 ? "X" : cond <= 60 ? "D" : "C";
  const func = FUNCTION_ID[d.type]; // 6 chars
  const mod1 =
    d.isHQ && d.isTaskForce ? "B" : d.isHQ ? "A" : d.isTaskForce ? "E" : "-";
  // Echelon is a land-unit amplifier; ships and boats leave it blank.
  const ech = naval ? "-" : ECHELON_CODE[d.echelon]; // 1 char
  return `S${affil}${dim}${status}${func}${mod1}${ech}---`;
}

export function makeDivision(
  teamId: string,
  name: string,
  type: DivisionType = "infantry",
): Division {
  return {
    id: uid(),
    teamId,
    name,
    type,
    echelon: "division",
    higherFormation: "",
    isHQ: false,
    isTaskForce: false,
    reinforced: null,
    position: null,
    status: defaultStatus(),
    naval: isNaval(type) ? defaultNaval(type) : null,
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
