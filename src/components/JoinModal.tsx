/**
 * Join-by-code modal: enter a room code + your name to take an open seat.
 */
import { useState } from "react";
import Modal from "./Modal";
import { gameApi } from "../game/supabaseClient";
import { elog } from "../game/debug";
import type { OnlineSession } from "../game/onlineSession";
import "./JoinModal.css";

export default function JoinModal({
  open,
  onClose,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  onJoined: (session: OnlineSession) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (!gameApi || busy) return;
    const c = code.trim().toUpperCase();
    if (c.length < 4) {
      setError("Enter the room code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await gameApi.join(c, name.trim() || "Player");
      onJoined({
        gameId: r.gameId,
        seatToken: r.seatToken,
        code: c,
        seatIndex: r.seatIndex,
      });
    } catch (e) {
      elog("net", "join failed", e);
      setError((e as Error).message || "Couldn't join the game.");
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="join-title">
      <div className="join">
        <h2 className="join__title" id="join-title">
          Join a Game
        </h2>
        <label className="join__label">
          Room Code
          <input
            className="join__input join__input--code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={5}
            autoCapitalize="characters"
            placeholder="ABCDE"
          />
        </label>
        <label className="join__label">
          Your Name
          <input
            className="join__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={14}
            placeholder="Your name"
          />
        </label>
        {error && <p className="join__error">{error}</p>}
        <button
          className="join__btn"
          type="button"
          onClick={join}
          disabled={busy}
        >
          {busy ? "Joining…" : "Join Game"}
        </button>
      </div>
    </Modal>
  );
}
