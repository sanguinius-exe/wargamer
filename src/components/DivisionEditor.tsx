import { useMemo } from "react";
import { useGameStore } from "../store";
import {
  DIVISION_TYPES,
  ECHELONS,
  POSTURES,
  TYPE_LABEL,
  ECHELON_SYMBOL,
  effectiveness,
  effColor,
  DivisionStatus,
  Reinforced,
} from "../types";
import { renderSymbol, describeSymbol } from "../symbols";

type MeterKey = "strengthPct" | "readinessPct" | "supplyPct" | "moralePct";

const METERS: { key: MeterKey; label: string; hint: string }[] = [
  { key: "strengthPct", label: "Strength", hint: "Manpower & equipment vs. full establishment" },
  { key: "readinessPct", label: "Readiness", hint: "Training, cohesion, command & control" },
  { key: "supplyPct", label: "Supply", hint: "Fuel, ammunition, spares on hand" },
  { key: "moralePct", label: "Morale", hint: "Will to fight" },
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

  const team = teams.find((t) => t.id === d?.teamId);
  const preview = useMemo(
    () => (d && team ? renderSymbol(d, team, { size: 40, detail: "full" }).svg : ""),
    [d, team],
  );

  if (!d || !team) return null;
  const eff = effectiveness(d.status);

  return (
    <aside className="wg-editor">
      <div className="wg-editor-head">
        <span className="wg-editor-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        <input
          className="wg-editor-name"
          value={d.name}
          onChange={(e) => update(id, { name: e.target.value })}
          spellCheck={false}
        />
        <button className="wg-icon" title="Close" onClick={() => close(null)}>
          ✕
        </button>
      </div>
      <div className="wg-sidc">{describeSymbol(d, team)}</div>

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
        <label>
          Branch
          <select
            value={d.type}
            onChange={(e) => update(id, { type: e.target.value as typeof d.type })}
          >
            {DIVISION_TYPES.map((x) => (
              <option key={x} value={x}>
                {TYPE_LABEL[x]}
              </option>
            ))}
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
            placeholder="e.g. III Corps"
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
        {METERS.map((m) => {
          const val = d.status[m.key];
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
                onChange={(e) =>
                  update(id, {
                    status: { [m.key]: Number(e.target.value) } as Partial<DivisionStatus>,
                  })
                }
              />
            </div>
          );
        })}
      </div>

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
          Delete division
        </button>
      </div>
    </aside>
  );
}
