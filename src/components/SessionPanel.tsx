import { useState, type CSSProperties } from "react";
import { useSession } from "../session";
import { useGameStore } from "../store";

export default function SessionPanel() {
  const status = useSession((s) => s.status);
  const sessionId = useSession((s) => s.sessionId);
  const peers = useSession((s) => s.peers);
  const selfName = useSession((s) => s.selfName);
  const isHost = useSession((s) => s.isHost);
  const error = useSession((s) => s.error);
  const start = useSession((s) => s.start);
  const leave = useSession((s) => s.leave);
  const setSelfName = useSession((s) => s.setSelfName);

  const hasBasemap = useGameStore((s) => !!s.game.basemap);
  const showToast = useGameStore((s) => s.showToast);

  const [joinCode, setJoinCode] = useState("");

  const inviteLink =
    sessionId && `${location.origin}${location.pathname}#s=${sessionId}`;

  const copyInvite = () => {
    if (!inviteLink) return;
    navigator.clipboard
      ?.writeText(inviteLink)
      .then(() => showToast("info", "Invite link copied."))
      .catch(() => showToast("error", "Could not copy — link is in the address bar."));
  };

  return (
    <section className="wg-panel wg-session">
      <h2>Session</h2>

      {status === "off" && (
        <>
          <input
            className="wg-name-input"
            value={selfName}
            onChange={(e) => setSelfName(e.target.value)}
            aria-label="Your name"
            spellCheck={false}
          />
          <button className="primary wg-full" onClick={() => start()}>
            Start shared session
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
            Peer-to-peer, no server. Everyone with the link edits the same map in
            real time.
          </p>
        </>
      )}

      {status === "connecting" && (
        <>
          <p className="wg-muted">Connecting to session {sessionId}…</p>
          <button className="wg-full" onClick={leave}>
            Cancel
          </button>
        </>
      )}

      {status === "connected" && (
        <>
          <div className="wg-session-code">
            <code>{sessionId}</code>
            <span className="wg-muted">{isHost ? "hosting" : "joined"}</span>
          </div>
          <button className="wg-full" onClick={copyInvite}>
            Copy invite link
          </button>

          <div className="wg-peers">
            <span className="wg-peer" style={{ "--c": "#8892a0" } as CSSProperties}>
              <input
                className="wg-name-inline"
                value={selfName}
                onChange={(e) => setSelfName(e.target.value)}
                aria-label="Your name"
                spellCheck={false}
              />
              <span className="wg-muted">you</span>
            </span>
            {peers.map((p) => (
              <span
                key={p.id}
                className="wg-peer"
                style={{ "--c": p.color } as CSSProperties}
              >
                {p.name}
              </span>
            ))}
            {peers.length === 0 && (
              <span className="wg-muted wg-peer-wait">waiting for others…</span>
            )}
          </div>

          {hasBasemap && (
            <p className="wg-tip">
              This scenario has baked imagery — others should open the same
              <code> .wargame</code> file to see it (positions still sync
              regardless).
            </p>
          )}
          <button className="danger wg-full" onClick={leave}>
            Leave session
          </button>
        </>
      )}

      {error && <p className="wg-session-err">{error}</p>}
    </section>
  );
}
