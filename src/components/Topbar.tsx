import { useRef } from "react";
import { useGameStore } from "../store";

export default function Topbar() {
  const name = useGameStore((s) => s.game.meta.name);
  const updateMeta = useGameStore((s) => s.updateMeta);
  const newGame = useGameStore((s) => s.newGame);
  const exportGame = useGameStore((s) => s.exportGame);
  const importFile = useGameStore((s) => s.importFile);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="wg-topbar">
      <div className="wg-brand">
        <span className="wg-brand-mark">▚</span> Wargamer
      </div>

      <input
        className="wg-scenario-name"
        value={name}
        onChange={(e) => updateMeta({ name: e.target.value })}
        aria-label="Scenario name"
        spellCheck={false}
      />

      <div className="wg-topbar-actions">
        <button
          onClick={() => {
            if (confirm("Start a new scenario? Unsaved changes are lost.")) newGame();
          }}
        >
          New
        </button>
        <button onClick={() => fileRef.current?.click()}>Import…</button>
        <button className="primary" onClick={() => void exportGame()}>
          Export .wargame
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".wargame,.json,application/zip,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) f.arrayBuffer().then(importFile);
          e.target.value = "";
        }}
      />
    </header>
  );
}
