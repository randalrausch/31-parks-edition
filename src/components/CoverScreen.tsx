/**
 * Pass-the-device screen — shown between human turns so the next player can't
 * see the previous player's hand. Only appears when more than one human is in
 * the game.
 */
import { AVATAR_ART, MountainAvatar } from "../art/Avatars";
import LogFeed from "./LogFeed";
import type { LogEntry } from "../game/engine";
import "./CoverScreen.css";

export default function CoverScreen({
  name,
  avatarKey,
  log,
  onReady,
}: {
  name: string;
  avatarKey: string;
  log: LogEntry[];
  onReady: () => void;
}) {
  const Art = AVATAR_ART[avatarKey] ?? MountainAvatar;
  return (
    <div className="cover">
      <div className="cover__inner">
        <span className="cover__eyebrow">Pass the device to</span>
        <span className="cover__avatar">
          <Art />
        </span>
        <h2 className="cover__name">{name}</h2>
        <p className="cover__hint">Cards are hidden until you're ready.</p>

        <div className="cover__report">
          <span className="cover__report-title">
            At the table since the deal
          </span>
          <LogFeed
            entries={log}
            emptyText="The cards have just been dealt — you're up first."
          />
        </div>

        <button className="cover__btn" type="button" onClick={onReady}>
          Show My Hand
        </button>
      </div>
    </div>
  );
}
