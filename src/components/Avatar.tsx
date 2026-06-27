/**
 * Circular avatar — a character portrait image, an emoji, or the SVG fallback
 * art, in that order of preference. Shared by the solo and online boards.
 */
import { AVATAR_ART, MountainAvatar } from "../art/Avatars";

export default function Avatar({
  avatarKey,
  emoji,
  image,
  className,
}: {
  avatarKey: string;
  emoji?: string;
  image?: string;
  className?: string;
}) {
  const Art = AVATAR_ART[avatarKey] ?? MountainAvatar;
  return (
    <span className={`avatar ${className ?? ""}`}>
      {image ? (
        <img className="avatar__img" src={image} alt="" />
      ) : emoji ? (
        <span className="avatar__emoji">{emoji}</span>
      ) : (
        <Art />
      )}
    </span>
  );
}
