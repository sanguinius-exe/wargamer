import ms from "milsymbol";
import type { SymbolOptions } from "milsymbol";
import {
  Division,
  Team,
  buildSIDC,
  effectiveness,
  IDENTITY_LABEL,
} from "./types";

ms.setStandard("2525");

export interface SymbolRender {
  svg: string;
  width: number;
  height: number;
  /** Anchor offset (px from top-left) that sits on the geographic point. */
  anchor: { x: number; y: number };
}

export type SymbolDetail =
  | "full" // editor preview: frame + icon + every text amplifier
  | "icon" // map marker: frame + icon + echelon + reinforced glyph, NO text
  | "none"; // roster: bare frame + icon

interface Opts {
  size?: number;
  /** How many text amplifiers to draw. */
  detail?: SymbolDetail;
}

const cache = new Map<string, SymbolRender>();

export function renderSymbol(
  d: Division,
  team: Team,
  opts: Opts = {},
): SymbolRender {
  const size = opts.size ?? 34;
  const detail = opts.detail ?? "full";
  const sidc = buildSIDC(d, team.identity);
  const eff = effectiveness(d.status);

  const key = [
    sidc,
    size,
    detail,
    d.name,
    d.higherFormation,
    d.reinforced ?? "",
    d.status.posture,
    d.status.fatigued ? 1 : 0,
    eff,
  ].join("|");

  const hit = cache.get(key);
  if (hit) return hit;

  // milsymbol chokes on amplifier keys whose value is undefined, so only
  // add a key when it carries a real string.
  const options: SymbolOptions = { size };
  if (detail !== "none") {
    const rr = reinforcedGlyph(d.reinforced);
    if (rr) options.reinforcedReduced = rr;
  }
  if (detail === "full") {
    if (d.name) options.uniqueDesignation = d.name;
    options.combatEffectiveness = `${eff}%`;
    if (d.higherFormation) options.higherFormation = d.higherFormation;
    const sc = staffComment(d);
    if (sc) options.staffComments = sc;
    // On the dark editor panel plain black text vanishes — white with a halo.
    options.infoColor = "#ffffff";
    options.infoOutlineColor = "#000000";
    options.infoOutlineWidth = 4;
    options.infoSize = 40;
  }

  const symbol = new ms.Symbol(sidc, options);

  const s = symbol.getSize();
  const a = symbol.getAnchor();
  const out: SymbolRender = {
    svg: symbol.asSVG(),
    width: s.width,
    height: s.height,
    anchor: { x: a.x, y: a.y },
  };
  cache.set(key, out);
  return out;
}

function reinforcedGlyph(r: Division["reinforced"]): string | undefined {
  if (r === "reinforced") return "+";
  if (r === "reduced") return "-";
  if (r === "reinforcedReduced") return "±";
  return undefined;
}

function staffComment(d: Division): string | undefined {
  const bits: string[] = [];
  bits.push(d.status.posture.slice(0, 3).toUpperCase());
  if (d.status.fatigued) bits.push("FATG");
  return bits.join(" ");
}

/** Human-readable SIDC breakdown for the editor. */
export function describeSymbol(d: Division, team: Team): string {
  return `${IDENTITY_LABEL[team.identity]} · ${buildSIDC(d, team.identity)}`;
}
