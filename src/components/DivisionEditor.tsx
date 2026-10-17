import { useMemo } from "react";
import { useGameStore } from "../store";
import { useSession } from "../session";
import {
  GROUND_TYPES,
  NAVAL_TYPES,
  isNaval,
  ECHELONS,
  POSTURES,
  TYPE_LABEL,
  ECHELON_SYMBOL,
  effectiveness,
  effColor,
  DivisionStatus,
  NavalStatus,
  Reinforced,
  defaultNaval,
} from "../types";
import { renderSymbol, describeSymbol } from "../symbols";

type StatusKey = "strengthPct" | "readinessPct" | "supplyPct" | "moralePct";
type NavalPctKey = "hullPct" | "sensorPct";
type RangeKey = "missileRangeKm" | "airDefenseRangeKm" | "sensorRangeKm";

/** A 0-100 slider, stored either on `status` or on `naval`. */
type Meter =
  | { src: "status"; key: StatusKey; label: string; hint: string }
  | { src: "naval"; key: NavalPctKey; label: string; hint: string };

const GROUND_METERS: Meter[] = [
  { src: "status", key: "strengthPct", label: "Strength", hint: "Manpower & equipment vs. full establishment" },
  { src: "status", key: "readinessPct", label: "Readiness", hint: "Training, cohesion, command & control" },
  { src: "status", key: "supplyPct", label: "Supply", hint: "Fuel, ammunition, spares on hand" },
  { src: "status", key: "moralePct", label: "Morale", hint: "Will to fight" },
];

const NAVAL_METERS: Meter[] = [
  { src: "naval", key: "hullPct", label: "Hull integrity", hint: "Structural condition of the hull" },
  { src: "naval", key: "sensorPct", label: "Sensor integrity", hint: "Radar, sonar & EW suite condition" },
  { src: "status", key: "readinessPct", label: "Readiness", hint: "Crew training, damage control, C2" },
  { src: "status", key: "supplyPct", label: "Supply", hint: "Fuel, missiles & munitions on hand" },
];

const RANGES: { key: RangeKey; label: string; hint: string }[] = [
  { key: "missileRangeKm", label: "Missile range", hint: "Anti-ship / land-attack missile reach" },
  { key: "airDefenseRangeKm", label: "Air defense range", hint: "Air-defence engagement envelope" },
  { key: "sensorRangeKm", label: "Sensor range", hint: "Detection range with sensors fully working" },
];

const REINFORCED_OPTS: { value: string; label: string }[] = [
  { value: "", label: "As establishment" },
  { value: "reinforced", label: "Reinforced (+)" },
  { value: "reduced", label: "Reduced (−)" },
  { value: "reinforcedReduced", label: "Reinforced & reduced (±)" },
];

export default function DivisionEditor() {
  const id = useGameStore((s) => s.selectedDivisionId)!;
  const d = useGameStore((s) => s.game.divisions.find((x) => x.id === id));
  const teams = useGameStore((s) => s.game.teams);
  const update = useGameStore((s) => s.updateDivision);
  const remove = useGameStore((s) => s.removeDivision);
  const recall = useGameStore((s) => s.recallDivision);
  const close = useGameStore((s) => s.selectDivision);

  const readOnly = useSession(
    (s) => s.status === "connected" && s.role !== "gm",
  );

  const team = teams.find((t) => t.id === d?.teamId);
  const preview = useMemo(
    () => (d && team ? renderSymbol(d, team, { size: 40, detail: "full" }).svg : ""),
    [d, team],
  );

  if (!d || !team) return null;
  const eff = effectiveness(d);
  const naval = isNaval(d.type);
  const nv = d.naval ?? defaultNaval(d.type);
  const meters = naval ? NAVAL_METERS : GROUND_METERS;

  return (
    <aside className="wg-editor">
      <div className="wg-editor-head">
        <span className="wg-editor-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        <input
          className="wg-editor-name"
          value={d.name}
          onChange={(e) => update(id, { name: e.target.value })}
          spellCheck={false}
          disabled={readOnly}
        />
        <button className="wg-icon" title="Close" onClick={() => close(null)}>
          ✕
        </button>
      </div>
      <div className="wg-sidc">{describeSymbol(d, team)}</div>
      {readOnly && (
        <p className="wg-tip">Read-only — the GM controls unit condition.</p>
      )}
      <fieldset className="wg-editor-fs" disabled={readOnly}>

      <div className="wg-eff-summary">
        <span>Combat effectiveness</span>
        <strong style={{ color: effColor(eff) }}>{eff}%</strong>
      </div>

      <div className="wg-field-grid">
        <label>
          Side
          <select value={d.teamId} onChange={(e) => update(id, { teamId: e.target.value })}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {!naval && (
          <label>
            Echelon
            <select
              value={d.echelon}
              onChange={(e) => update(id, { echelon: e.target.value as typeof d.echelon })}
            >
              {ECHELONS.map((x) => (
                <option key={x} value={x}>
                  {x} ({ECHELON_SYMBOL[x]})
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {naval ? "Class" : "Branch"}
          <select
            value={d.type}
            onChange={(e) => update(id, { type: e.target.value as typeof d.type })}
          >
            <optgroup label="Ground">
              {GROUND_TYPES.map((x) => (
                <option key={x} value={x}>
                  {TYPE_LABEL[x]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Naval">
              {NAVAL_TYPES.map((x) => (
                <option key={x} value={x}>
                  {TYPE_LABEL[x]}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          Posture
          <select
            value={d.status.posture}
            onChange={(e) =>
              update(id, { status: { posture: e.target.value as DivisionStatus["posture"] } })
            }
          >
            {POSTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Higher formation
          <input
            value={d.higherFormation}
            placeholder={naval ? "e.g. Carrier Strike Group 2" : "e.g. III Corps"}
            onChange={(e) => update(id, { higherFormation: e.target.value })}
          />
        </label>
        <label>
          Strength modifier
          <select
            value={d.reinforced ?? ""}
            onChange={(e) => update(id, { reinforced: (e.target.value || null) as Reinforced })}
          >
            {REINFORCED_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="wg-flags">
        <label className="wg-check">
          <input
            type="checkbox"
            checked={d.isHQ}
            onChange={(e) => update(id, { isHQ: e.target.checked })}
          />
          Headquarters
        </label>
        <label className="wg-check">
          <input
            type="checkbox"
            checked={d.isTaskForce}
            onChange={(e) => update(id, { isTaskForce: e.target.checked })}
          />
          Task force
        </label>
        <label className="wg-check">
          <input
            type="checkbox"
            checked={d.status.fatigued}
            onChange={(e) => update(id, { status: { fatigued: e.target.checked } })}
          />
          Fatigued
        </label>
      </div>

      <div className="wg-meters">
        {meters.map((m) => {
          const val = m.src === "naval" ? nv[m.key] : d.status[m.key];
          return (
            <div className="wg-meter" key={m.key}>
              <div className="wg-meter-top">
                <span title={m.hint}>{m.label}</span>
                <span className="wg-meter-val">{val}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={val}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  update(
                    id,
                    m.src === "naval"
                      ? { naval: { [m.key]: v } as Partial<NavalStatus> }
                      : { status: { [m.key]: v } as Partial<DivisionStatus> },
                  );
                }}
              />
            </div>
          );
        })}
      </div>

      {naval && (
        <div className="wg-ranges">
          <div className="wg-ranges-head">
            <span>Weapon & sensor ranges</span>
            <button
              type="button"
              className="wg-link"
              title="Reset ranges to this class's defaults"
              onClick={() => {
                const def = defaultNaval(d.type);
                update(id, {
                  naval: {
                    missileRangeKm: def.missileRangeKm,
                    airDefenseRangeKm: def.airDefenseRangeKm,
                    sensorRangeKm: def.sensorRangeKm,
                  },
                });
              }}
            >
              Class defaults
            </button>
          </div>
          <div className="wg-field-grid">
            {RANGES.map((r) => (
              <label key={r.key} title={r.hint}>
                {r.label} (km)
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={nv[r.key]}
                  onChange={(e) =>
                    update(id, {
                      naval: { [r.key]: Math.max(0, Number(e.target.value) || 0) },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {nv.sensorPct < 100 && (
            <p className="wg-tip">
              Effective sensor range ≈{" "}
              {Math.round((nv.sensorRangeKm * nv.sensorPct) / 100)} km at{" "}
              {nv.sensorPct}% integrity.
            </p>
          )}
        </div>
      )}

      <label className="wg-field-full">
        Unit notes
        <textarea
          value={d.notes}
          placeholder="Casualties, attachments, damage detail, orders…"
          onChange={(e) => update(id, { notes: e.target.value })}
        />
      </label>

        <div className="wg-editor-actions">
          {d.position && <button onClick={() => recall(id)}>Recall to reserve</button>}
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete ${d.name}?`)) remove(id);
            }}
          >
            {naval ? "Delete unit" : "Delete division"}
          </button>
        </div>
      </fieldset>
    </aside>
  );
}
