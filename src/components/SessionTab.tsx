import { useState, type CSSProperties } from "react";
import { useSession, type Submission } from "../session";
import { useGameStore } from "../store";
import { teamColor, type Division, type Team } from "../types";
import { soundEnabled, setSoundEnabled } from "../sound";

export default function SessionTab() {
  const status = useSession((s) => s.status);
  const error = useSession((s) => s.error);
  const start = useSession((s) => s.start);
  const leave = useSession((s) => s.leave);
  const selfName = useSession((s) => s.selfName);
  const setSelfName = useSession((s) => s.setSelfName);
  const [joinCode, setJoinCode] = useState("");

  if (status === "off") {
    return (
      <div className="wg-session">
        <input
          className="wg-name-input"
          value={selfName}
          onChange={(e) => setSelfName(e.target.value)}
          aria-label="Your name"
          spellCheck={false}
        />
        <button className="primary wg-full" onClick={() => start()}>
          Start session as GM
        </button>
        <div className="wg-join">
          <input
            placeholder="join code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            spellCheck={false}
          />
          <button disabled={joinCode.trim().length < 4} onClick={() => start(joinCode.trim())}>
            Join
          </button>
        </div>
        <p className="wg-tip">
          The GM assigns players to teams. Players see only their own divisions
          plus nearby enemies, and propose moves each turn for the GM to
          adjudicate.
        </p>
        {error && <p className="wg-session-err">{error}</p>}
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="wg-session">
        <p className="wg-muted">Connecting…</p>
        <button className="wg-full" onClick={leave}>
          Cancel
        </button>
        {error && <p className="wg-session-err">{error}</p>}
      </div>
    );
  }

  return <ConnectedPanel />;
}

function ConnectedPanel() {
  const sessionId = useSession((s) => s.sessionId);
  const role = useSession((s) => s.role);
  const leave = useSession((s) => s.leave);
  const showToast = useGameStore((s) => s.showToast);

  const [snd, setSnd] = useState(soundEnabled());
  const toggleSound = () => {
    const v = !snd;
    setSnd(v);
    setSoundEnabled(v);
  };

  const inviteLink =
    sessionId && `${location.origin}${location.pathname}#s=${sessionId}`;
  const copyInvite = () => {
    if (!inviteLink) return;
    navigator.clipboard
      ?.writeText(inviteLink)
      .then(() => showToast("info", "Invite link copied."))
      .catch(() => showToast("error", "Link is in the address bar."));
  };

  return (
    <div className="wg-session">
      <div className="wg-session-code">
        <code>{sessionId}</code>
        <span className="wg-muted">{role === "gm" ? "you are GM" : role}</span>
        <button
          className="wg-icon"
          title={snd ? "Mute session sounds" : "Unmute session sounds"}
          onClick={toggleSound}
        >
          {snd ? "🔔" : "🔕"}
        </button>
      </div>
      <button className="wg-full" onClick={copyInvite}>
        Copy invite link
      </button>

      {role === "gm" && <GmView />}
      {role === "player" && <PlayerView />}
      {role === "observer" && <ObserverView />}

      <button className="danger wg-full" onClick={leave}>
        Leave session
      </button>
    </div>
  );
}

/* ---------- GM ---------- */

function GmView() {
  const players = useSession((s) => s.players);
  const turn = useSession((s) => s.turn);
  const phase = useSession((s) => s.phase);
  const visionKm = useSession((s) => s.visionKm);
  const submissions = useSession((s) => s.submissions);
  const assign = useSession((s) => s.assign);
  const kick = useSession((s) => s.kick);
  const setVisionKm = useSession((s) => s.setVisionKm);
  const startAdjudication = useSession((s) => s.startAdjudication);
  const releaseTurn = useSession((s) => s.releaseTurn);
  const replyToPlayer = useSession((s) => s.replyToPlayer);

  const teams = useGameStore((s) => s.game.teams);
  const moveDivision = useGameStore((s) => s.moveDivision);
  const divisions = useGameStore((s) => s.game.divisions);

  const assigned = players.filter((p) => p.teamId);
  const submittedCount = assigned.filter((p) => p.submitted).length;

  const applyAll = (cid: string) => {
    const sub = submissions[cid];
    if (!sub) return;
    for (const [id, pos] of Object.entries(sub.moves)) {
      moveDivision(id, [pos.lng, pos.lat]);
    }
  };

  return (
    <>
      <div className="wg-turnbar">
        <strong>Turn {turn}</strong>
        <span className={`wg-phase wg-phase-${phase}`}>{phase}</span>
      </div>

      <label className="wg-slider">
        <span>Vision range: {visionKm.toFixed(1)} km</span>
        <input
          type="range"
          min={1}
          max={30}
          step={0.5}
          value={visionKm}
          onChange={(e) => setVisionKm(Number(e.target.value))}
        />
      </label>

      <h3 className="wg-subhead">Players</h3>
      {players.length === 0 && <p className="wg-muted">No one has joined yet.</p>}
      <ul className="wg-plist">
        {players.map((p) => (
          <li key={p.cid} className={`wg-prow ${p.online ? "" : "offline"}`}>
            <span className="wg-pname">{p.name}</span>
            <select
              value={p.teamId ?? ""}
              onChange={(e) => assign(p.cid, e.target.value || null)}
            >
              <option value="">— unassigned —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {p.submitted && <span className="wg-tick" title="Submitted">✓</span>}
            <button className="wg-icon" title="Remove" onClick={() => kick(p.cid)}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      {phase === "planning" ? (
        <>
          <p className="wg-muted">
            {submittedCount}/{assigned.length || 0} players submitted.
          </p>
          <button
            className="primary wg-full"
            disabled={assigned.length === 0}
            onClick={startAdjudication}
          >
            Start adjudication
          </button>
        </>
      ) : (
        <>
          <h3 className="wg-subhead">Proposals</h3>
          {Object.values(submissions).length === 0 && (
            <p className="wg-muted">No proposals were submitted.</p>
          )}
          <ul className="wg-sublist">
            {Object.values(submissions).map((sub) => (
              <ProposalRow
                key={sub.cid}
                sub={sub}
                team={teams.find((t) => t.id === sub.teamId)}
                divisions={divisions}
                onApply={() => applyAll(sub.cid)}
                onMove={moveDivision}
                onReply={(text) => replyToPlayer(sub.cid, text)}
              />
            ))}
          </ul>
          <button className="primary wg-full" onClick={releaseTurn}>
            Release turn {turn} → {turn + 1}
          </button>
          <p className="wg-tip">
            "apply" snaps a division to a proposed spot; you can also just drag
            divisions on the map. Release publishes the new positions to every
            team's fog-of-war view.
          </p>
        </>
      )}
    </>
  );
}

function ProposalRow({
  sub,
  team,
  divisions,
  onApply,
  onMove,
  onReply,
}: {
  sub: Submission;
  team: Team | undefined;
  divisions: Division[];
  onApply: () => void;
  onMove: (id: string, lngLat: [number, number]) => void;
  onReply: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const n = Object.keys(sub.moves).length;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onReply(text);
    setDraft("");
  };

  return (
    <li>
      <div className="wg-subrow">
        <span
          className="wg-dot"
          style={{ "--c": team ? teamColor(team) : "#888" } as CSSProperties}
        />
        <span className="wg-pname">{sub.name}</span>
        <span className="wg-muted">
          {n} move{n === 1 ? "" : "s"}
          {sub.submitted ? " · submitted" : " · draft"}
        </span>
        <button className="wg-icon" onClick={onApply}>
          apply
        </button>
      </div>
      <ul className="wg-movelist">
        {Object.entries(sub.moves).map(([id, pos]) => {
          const d = divisions.find((x) => x.id === id);
          return (
            <li key={id}>
              <button className="wg-movebtn" onClick={() => onMove(id, [pos.lng, pos.lat])}>
                {d?.name ?? id.slice(0, 6)} → {pos.lat.toFixed(3)}, {pos.lng.toFixed(3)}
              </button>
            </li>
          );
        })}
      </ul>
      {sub.note && <p className="wg-note">“{sub.note}”</p>}
      <div className="wg-replybox">
        <input
          placeholder="Reply to this player…"
          value={draft}
          maxLength={280}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="wg-icon" disabled={!draft.trim()} onClick={send}>
          send
        </button>
      </div>
    </li>
  );
}

/* ---------- player ---------- */

function PlayerView() {
  const turn = useSession((s) => s.turn);
  const phase = useSession((s) => s.phase);
  const myTeamId = useSession((s) => s.myTeamId);
  const proposals = useSession((s) => s.proposals);
  const noteDraft = useSession((s) => s.noteDraft);
  const setNoteDraft = useSession((s) => s.setNoteDraft);
  const gmNote = useSession((s) => s.gmNote);
  const players = useSession((s) => s.players);
  const selfCid = useSession((s) => s.selfCid);
  const clearProposal = useSession((s) => s.clearProposal);
  const submitMoves = useSession((s) => s.submitMoves);
  const recallMoves = useSession((s) => s.recallMoves);

  const teams = useGameStore((s) => s.game.teams);
  const divisions = useGameStore((s) => s.game.divisions);

  const team = teams.find((t) => t.id === myTeamId);
  const me = players.find((p) => p.cid === selfCid);
  const submitted = !!me?.submitted;
  const proposed = Object.entries(proposals);

  return (
    <>
      <div className="wg-turnbar">
        <strong>Turn {turn}</strong>
        <span className={`wg-phase wg-phase-${phase}`}>{phase}</span>
      </div>
      <p className="wg-muted">
        Team: <b style={{ color: team ? teamColor(team) : undefined }}>{team?.name ?? "—"}</b>
      </p>

      {gmNote && (
        <div className="wg-gmnote">
          <span className="wg-subhead">From the GM</span>
          <p>{gmNote}</p>
        </div>
      )}

      {phase === "adjudicating" ? (
        <p className="wg-muted">The GM is adjudicating this turn…</p>
      ) : submitted ? (
        <>
          <p className="wg-muted">Submitted — waiting for the GM.</p>
          {noteDraft && <p className="wg-note">Your note: “{noteDraft}”</p>}
          <button className="wg-full" onClick={recallMoves}>
            Recall my moves
          </button>
        </>
      ) : (
        <>
          <h3 className="wg-subhead">Proposed moves ({proposed.length})</h3>
          {proposed.length === 0 && (
            <p className="wg-muted">Drag your divisions on the map to propose moves.</p>
          )}
          <ul className="wg-movelist">
            {proposed.map(([id, pos]) => {
              const d = divisions.find((x) => x.id === id);
              return (
                <li key={id}>
                  <span>{d?.name ?? id.slice(0, 6)}</span>
                  <span className="wg-muted">
                    {pos.lat.toFixed(3)}, {pos.lng.toFixed(3)}
                  </span>
                  <button className="wg-icon" onClick={() => clearProposal(id)}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          <textarea
            className="wg-notefield"
            placeholder="Optional note to the GM this turn…"
            value={noteDraft}
            maxLength={280}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <button
            className="primary wg-full"
            disabled={proposed.length === 0 && !noteDraft.trim()}
            onClick={submitMoves}
          >
            Submit moves to GM
          </button>
        </>
      )}

      <h3 className="wg-subhead">In this session</h3>
      <ul className="wg-plist">
        {players.map((p) => {
          const t = teams.find((x) => x.id === p.teamId);
          return (
            <li key={p.cid} className={`wg-prow ${p.online ? "" : "offline"}`}>
              <span
                className="wg-dot"
                style={{ "--c": t ? teamColor(t) : "#888" } as CSSProperties}
              />
              <span className="wg-pname">
                {p.name}
                {p.cid === selfCid ? " (you)" : ""}
              </span>
              {p.submitted && <span className="wg-tick">✓</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ---------- observer ---------- */

function ObserverView() {
  const players = useSession((s) => s.players);
  const gmName = useSession((s) => s.gmName);
  return (
    <>
      <p className="wg-muted">
        Waiting for the GM{gmName ? ` (${gmName})` : ""} to assign you to a team.
      </p>
      <h3 className="wg-subhead">In this session</h3>
      <ul className="wg-plist">
        {players.map((p) => (
          <li key={p.cid} className="wg-prow">
            <span className="wg-pname">{p.name}</span>
            <span className="wg-muted">{p.teamId ? "assigned" : "lobby"}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
