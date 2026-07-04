/**
 * Shown when the live backend speaks a newer wire protocol than this tab
 * (PROTOCOL_VERSION mismatch). Used both before a game starts (OnlineRoot's
 * preflight) and mid-game (a protocol bump deploys backend-first, so an
 * in-flight tab starts getting 426s) — one component so the two paths can't
 * drift in wording or behavior.
 */
export default function UpdatePrompt() {
  return (
    <div className="lobby">
      <div className="lobby__panel">
        <h1 className="lobby__title">Update Available</h1>
        <p className="lobby__waiting">
          Online play was updated. Refresh the page to get the latest version, then start or rejoin
          your game.
        </p>
        <button className="lobby__leave" type="button" onClick={() => window.location.reload()}>
          Refresh
        </button>
      </div>
    </div>
  );
}
