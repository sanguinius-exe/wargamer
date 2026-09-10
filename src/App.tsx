import { useEffect } from "react";
import MapView from "./map/MapView";
import Topbar from "./components/Topbar";
import Sidebar from "./components/Sidebar";
import DivisionEditor from "./components/DivisionEditor";
import { useGameStore } from "./store";

export default function App() {
  const selectedId = useGameStore((s) => s.selectedDivisionId);
  const toast = useGameStore((s) => s.toast);
  const importFile = useGameStore((s) => s.importFile);
  const selectingTheatre = useGameStore((s) => s.selectingTheatre);
  const cancelTheatreSelect = useGameStore((s) => s.cancelTheatreSelect);
  const selectDivision = useGameStore((s) => s.selectDivision);

  // Drop a .wargame.json / .json file anywhere on the window to load it.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = Array.from(files).find((f) => /\.(json|wargame|zip)$/i.test(f.name));
      if (!file) return;
      e.preventDefault();
      file.arrayBuffer().then(importFile);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [importFile]);

  // Esc cancels theatre drawing, otherwise closes the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectingTheatre) cancelTheatreSelect();
      else selectDivision(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectingTheatre, cancelTheatreSelect, selectDivision]);

  return (
    <div className="wg-app">
      <Topbar />
      <div className="wg-body">
        <Sidebar />
        <div className="wg-map-wrap">
          <MapView />
          {selectingTheatre && (
            <div className="wg-hint">
              Click two corners on the map to set the theatre of operations · Esc to cancel
            </div>
          )}
        </div>
        {selectedId && <DivisionEditor key={selectedId} />}
      </div>
      {toast && <div className={`wg-toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
