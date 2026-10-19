import { useEffect } from "react";
import { useGameStore } from "../store";
import { useSession } from "../session";
import { haversineM, bearingDeg, fmtDistance } from "../geo";

/**
 * GM measuring tool: a toggle over the map plus a readout of each leg's
 * distance and bearing. Hidden from players and observers in a session;
 * solo editing counts as GM.
 */
export default function RulerTool() {
  const allowed = useSession((s) => s.status !== "connected" || s.role === "gm");
  const active = useGameStore((s) => s.rulerActive);
  const points = useGameStore((s) => s.rulerPoints);
  const done = useGameStore((s) => s.rulerDone);
  const cursor = useGameStore((s) => s.rulerCursor);
  const setActive = useGameStore((s) => s.setRulerActive);

  // Joining a session as a player mid-measurement drops the tool.
  useEffect(() => {
    if (!allowed && active) setActive(false);
  }, [allowed, active, setActive]);

  if (!allowed) return null;

  const ends = !done && cursor && points.length ? [...points, cursor] : points;
  const legs = ends.slice(1).map((p, i) => {
    const a = { lng: ends[i][0], lat: ends[i][1] };
    const b = { lng: p[0], lat: p[1] };
    return { m: haversineM(a, b), brg: bearingDeg(a, b), live: !done && i === ends.length - 2 && !!cursor };
  });
  const total = legs.reduce((sum, l) => sum + l.m, 0);

  return (
    <div className="wg-ruler">
      <button
        className={active ? "primary" : ""}
        title="Measure distance and bearing on the map (GM only)"
        onClick={() => setActive(!active)}
      >
        📏 Ruler
      </button>
      {active && (
        <div className="wg-ruler-panel">
          {legs.length === 0 ? (
            <p className="wg-tip">Click the map to start measuring.</p>
          ) : (
            <>
              <ol className="wg-ruler-legs">
                {legs.map((l, i) => (
                  <li key={i} className={l.live ? "live" : ""}>
                    <span>{fmtDistance(l.m)}</span>
                    <span className="wg-ruler-brg">{Math.round(l.brg).toString().padStart(3, "0")}°</span>
                  </li>
                ))}
              </ol>
              {legs.length > 1 && (
                <div className="wg-ruler-total">
                  <span>Total</span>
                  <strong>{fmtDistance(total)}</strong>
                </div>
              )}
            </>
          )}
          <p className="wg-tip">
            Click to add points · double-click or Enter to finish · Backspace undoes · Esc exits
          </p>
        </div>
      )}
    </div>
  );
}
