import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "../store";
import {
  Division,
  Team,
  Identity,
  IDENTITY_LABEL,
  IDENTITY_COLOR,
  ECHELON_SYMBOL,
  TYPE_LABEL,
  effectiveness,
  effColor,
} from "../types";
import { renderSymbol } from "../symbols";
import { countTilesForBounds } from "../tiles/tileMath";
import { useSession } from "../session";
import SessionTab from "./SessionTab";

const IDENTITIES: Identity[] = ["friend", "hostile", "neutral", "unknown", "pending"];

export default function Sidebar() {
  const status = useSession((s) => s.status);
  const role = useSession((s) => s.role);
  const restricted = status === "connected" && role !== "gm";

  const [tab, setTab] = useState<"scenario" | "session">("scenario");
  // Show the Session tab once when a session starts.
  const wasOff = useRef(true);
  useEffect(() => {
    if (status !== "off" && wasOff.current) setTab("session");
    wasOff.current = status === "off";
  }, [status]);

  return (
    <aside className="wg-sidebar">
      <div className="wg-tabbar">
        <button
          className={tab === "scenario" ? "active" : ""}
          onClick={() => setTab("scenario")}
        >
          {restricted ? "Map" : "Scenario"}
        </button>
        <button
          className={tab === "session" ? "active" : ""}
          onClick={() => setTab("session")}
        >
          Session
          {status === "connected" && <span className="wg-tabdot" />}
        </button>
      </div>

      {tab === "session" ? (
        <section className="wg-panel">
          <SessionTab />
        </section>
      ) : (
        <ScenarioTab restricted={restricted} />
      )}
    </aside>
  );
}

function ScenarioTab({ restricted }: { restricted: boolean }) {
  const teams = useGameStore((s) => s.game.teams);
  const divisions = useGameStore((s) => s.game.divisions);
  const theatre = useGameStore((s) => s.game.theatre);
  const basemap = useGameStore((s) => s.game.basemap);
  const notes = useGameStore((s) => s.game.meta.notes);
  const hiddenTeamIds = useGameStore((s) => s.hiddenTeamIds);
  const selectedId = useGameStore((s) => s.selectedDivisionId);
  const layerVisible = useGameStore((s) => s.layerVisible);
  const bake = useGameStore((s) => s.bake);

  const updateMeta = useGameStore((s) => s.updateMeta);
  const startTheatreSelect = useGameStore((s) => s.startTheatreSelect);
  const clearTheatre = useGameStore((s) => s.clearTheatre);
  const selectingTheatre = useGameStore((s) => s.selectingTheatre);
  const setLayerVisible = useGameStore((s) => s.setLayerVisible);
  const runBake = useGameStore((s) => s.runBake);
  const cancelBake = useGameStore((s) => s.cancelBake);
  const clearBasemap = useGameStore((s) => s.clearBasemap);
  const addTeam = useGameStore((s) => s.addTeam);
  const updateTeam = useGameStore((s) => s.updateTeam);
  const removeTeam = useGameStore((s) => s.removeTeam);
  const toggleTeamHidden = useGameStore((s) => s.toggleTeamHidden);
  const addDivision = useGameStore((s) => s.addDivision);
  const selectDivision = useGameStore((s) => s.selectDivision);
  const recallDivision = useGameStore((s) => s.recallDivision);

  const [maxZoom, setMaxZoom] = useState(14);
  const [bakeImagery, setBakeImagery] = useState(true);
  const [bakeReference, setBakeReference] = useState(true);
  const minZoom = Math.min(6, maxZoom);

  const estimate = useMemo(() => {
    if (!theatre) return null;
    const n = countTilesForBounds(theatre.bounds, minZoom, maxZoom);
    const perLayer = (bakeImagery ? 1 : 0) + (bakeReference ? 1 : 0);
    const tiles = n * perLayer;
    const mb = (n * (bakeImagery ? 13 : 0) + n * (bakeReference ? 7 : 0)) / 1024;
    return { tiles, mb };
  }, [theatre, minZoom, maxZoom, bakeImagery, bakeReference]);

  return (
    <>
      {!restricted && (
        <>
          <section className="wg-panel">
            <h2>Theatre of operations</h2>
            {theatre ? (
              <p className="wg-muted wg-bounds">{fmtBounds(theatre.bounds)}</p>
            ) : (
              <p className="wg-muted">No theatre set — draw one to enable imagery download.</p>
            )}
            <div className="wg-row">
              <button className={selectingTheatre ? "active" : ""} onClick={startTheatreSelect}>
                {theatre ? "Redraw" : "Draw theatre"}
              </button>
              {theatre && <button onClick={clearTheatre}>Clear</button>}
            </div>
          </section>

          <section className="wg-panel">
            <h2>Basemap imagery</h2>
            {basemap ? (
              <p className="wg-muted">
                Baked{" "}
                {basemap.imagery ? `${basemap.imagery.tileCount} imagery` : ""}
                {basemap.imagery && basemap.reference ? " + " : ""}
                {basemap.reference ? `${basemap.reference.tileCount} reference` : ""} tiles
                · z{basemap.imagery?.minzoom ?? basemap.reference?.minzoom}–
                {basemap.imagery?.maxzoom ?? basemap.reference?.maxzoom}. Travels inside
                the .wargame file.
              </p>
            ) : (
              <p className="wg-muted">
                Streaming Esri tiles live. Download an area to make the scenario
                work offline and self-contained.
              </p>
            )}

            {bake?.running ? (
              <div className="wg-bake">
                <div className="wg-progress">
                  <i
                    style={{
                      width: bake.total ? `${(bake.done / bake.total) * 100}%` : "8%",
                    }}
                  />
                </div>
                <div className="wg-row wg-baketween">
                  <span className="wg-muted">{bake.label}</span>
                  <button onClick={cancelBake}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="wg-bakeform">
                <label className="wg-check">
                  <input
                    type="checkbox"
                    checked={bakeImagery}
                    onChange={(e) => setBakeImagery(e.target.checked)}
                  />
                  Satellite imagery
                </label>
                <label className="wg-check">
                  <input
                    type="checkbox"
                    checked={bakeReference}
                    onChange={(e) => setBakeReference(e.target.checked)}
                  />
                  Roads &amp; labels
                </label>
                <label className="wg-slider">
                  <span>
                    Detail: zoom {minZoom}–{maxZoom}
                  </span>
                  <input
                    type="range"
                    min={10}
                    max={17}
                    value={maxZoom}
                    onChange={(e) => setMaxZoom(Number(e.target.value))}
                  />
                </label>
                {estimate && (
                  <p className="wg-muted">
                    ≈ {estimate.tiles.toLocaleString()} tiles ·{" "}
                    {estimate.mb < 1
                      ? `${Math.round(estimate.mb * 1024)} KB`
                      : `${estimate.mb.toFixed(estimate.mb < 20 ? 1 : 0)} MB`}
                  </p>
                )}
                <button
                  className="primary"
                  disabled={!theatre || (!bakeImagery && !bakeReference)}
                  onClick={() =>
                    theatre &&
                    void runBake({
                      bounds: theatre.bounds,
                      minZoom,
                      maxZoom,
                      layers: { imagery: bakeImagery, reference: bakeReference },
                    })
                  }
                >
                  {theatre ? "Download imagery for theatre" : "Set a theatre first"}
                </button>
                {basemap && (
                  <button onClick={() => void clearBasemap()}>Clear baked imagery</button>
                )}
              </div>
            )}
            <p className="wg-tip">
              Imagery © Esri and its data providers. Downloaded for offline use
              under Esri's attribution terms.
            </p>
          </section>
        </>
      )}

      <section className="wg-panel">
        <h2>Map layers</h2>
        <label className="wg-check">
          <input
            type="checkbox"
            checked={layerVisible.imagery}
            onChange={(e) => setLayerVisible("imagery", e.target.checked)}
          />
          Satellite
        </label>
        <label className="wg-check">
          <input
            type="checkbox"
            checked={layerVisible.reference}
            onChange={(e) => setLayerVisible("reference", e.target.checked)}
          />
          Roads &amp; labels
        </label>
      </section>

      <section className="wg-panel">
        <h2>{restricted ? "Your order of battle" : "Order of battle"}</h2>
        {teams.length === 0 && (
          <p className="wg-muted">Waiting for the GM to release the first turn…</p>
        )}
        {teams.map((team) => {
          const roster = divisions.filter((d) => d.teamId === team.id);
          const deployed = roster.filter((d) => d.position).length;
          const hidden = hiddenTeamIds.includes(team.id);
          return (
            <div className="wg-team" key={team.id}>
              <div
                className="wg-team-head"
                style={{ borderLeftColor: IDENTITY_COLOR[team.identity] }}
              >
                {restricted ? (
                  <span className="wg-team-name" style={{ padding: "3px 4px" }}>
                    {team.name}
                  </span>
                ) : (
                  <input
                    className="wg-team-name"
                    value={team.name}
                    onChange={(e) => updateTeam(team.id, { name: e.target.value })}
                    spellCheck={false}
                  />
                )}
                <span className="wg-count">
                  {deployed}/{roster.length}
                </span>
                <button
                  className="wg-icon"
                  title={hidden ? "Show on map" : "Hide from map"}
                  onClick={() => toggleTeamHidden(team.id)}
                >
                  {hidden ? "🙈" : "👁"}
                </button>
                {!restricted && (
                  <button
                    className="wg-icon"
                    title="Remove team"
                    onClick={() => removeTeam(team.id)}
                  >
                    ✕
                  </button>
                )}
              </div>

              {!restricted && (
                <select
                  className="wg-identity"
                  value={team.identity}
                  onChange={(e) =>
                    updateTeam(team.id, { identity: e.target.value as Identity })
                  }
                >
                  {IDENTITIES.map((i) => (
                    <option key={i} value={i}>
                      {IDENTITY_LABEL[i]}
                    </option>
                  ))}
                </select>
              )}

              <ul className="wg-roster">
                {roster.map((d) => (
                  <RosterRow
                    key={d.id}
                    d={d}
                    team={team}
                    selected={selectedId === d.id}
                    restricted={restricted}
                    onSelect={() => selectDivision(d.id)}
                    onRecall={() => recallDivision(d.id)}
                  />
                ))}
              </ul>

              {!restricted && (
                <button className="wg-add" onClick={() => addDivision(team.id)}>
                  + Add division
                </button>
              )}
            </div>
          );
        })}
        {!restricted && (
          <button className="wg-add wg-add-team" onClick={addTeam}>
            + Add team
          </button>
        )}
      </section>

      <section className="wg-panel">
        <h2>Briefing notes</h2>
        <textarea
          className="wg-notes"
          value={notes}
          readOnly={restricted}
          placeholder="Situation, intent, special rules…"
          onChange={(e) => updateMeta({ notes: e.target.value })}
        />
      </section>

      <p className="wg-tip">
        {restricted
          ? "Drag your divisions to propose moves, then Submit from the Session tab."
          : "Drag a division onto the map to deploy it. Drag its symbol to reposition. Click any symbol to edit its condition."}
      </p>
    </>
  );
}

function RosterRow({
  d,
  team,
  selected,
  restricted,
  onSelect,
  onRecall,
}: {
  d: Division;
  team: Team;
  selected: boolean;
  restricted: boolean;
  onSelect: () => void;
  onRecall: () => void;
}) {
  const eff = effectiveness(d.status);
  const svg = useMemo(
    () => renderSymbol(d, team, { size: 20, detail: "none" }).svg,
    [d, team],
  );
  return (
    <li
      className={`wg-roster-row ${selected ? "selected" : ""} ${d.position ? "" : "reserve"}`}
      draggable={!restricted}
      onDragStart={(e) => {
        if (restricted) return;
        e.dataTransfer.setData("text/wg-division", d.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onSelect}
    >
      <span className="wg-roster-sym" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="wg-roster-name" title={`${ECHELON_SYMBOL[d.echelon]} · ${TYPE_LABEL[d.type]}`}>
        {d.name}
      </span>
      <span className="wg-roster-eff" style={{ color: effColor(eff) }}>
        {eff}
      </span>
      {d.position ? (
        !restricted && (
          <button
            className="wg-icon"
            title="Recall to reserve (remove from map)"
            onClick={(e) => {
              e.stopPropagation();
              onRecall();
            }}
          >
            ⤺
          </button>
        )
      ) : (
        <span className="wg-icon wg-reserve-tag" title="In reserve, off-map">
          R
        </span>
      )}
    </li>
  );
}

function fmtBounds(b: [number, number, number, number]): string {
  const f = (n: number) => n.toFixed(2);
  return `W ${f(b[0])}  S ${f(b[1])}  E ${f(b[2])}  N ${f(b[3])}`;
}
