/**
 * Park Picker — the theme selector. Renders every park in the registry as a
 * poster thumbnail. Playable parks are selectable and recolor the whole game on
 * tap; "coming soon" parks show as previews. Adding a park to themes.ts makes
 * it appear here automatically.
 */
import { PARK_THEMES } from "../themes";
import { useTheme } from "./ParkThemeProvider";
import { StarDivider } from "../art/Glyphs";
import "./ParkPicker.css";

export interface ParkPickerProps {
  /** Called after a playable park is chosen (e.g. to close a modal). */
  onPick?: (id: string) => void;
  /** Show the "★ Choose Your Park ★" header. */
  heading?: boolean;
  /** Layout density. */
  columns?: number;
}

export default function ParkPicker({
  onPick,
  heading = true,
  columns,
}: ParkPickerProps) {
  const { themeId, setThemeId } = useTheme();

  const handlePick = (id: string, available: boolean) => {
    if (!available) return;
    setThemeId(id);
    onPick?.(id);
  };

  return (
    <section className="picker">
      {heading && (
        <header className="picker__head">
          <StarDivider className="picker__rule" />
          <h3 className="picker__title">Choose Your Park</h3>
          <StarDivider className="picker__rule" />
        </header>
      )}
      <div
        className="picker__grid"
        style={
          columns
            ? { gridTemplateColumns: `repeat(${columns}, 1fr)` }
            : undefined
        }
      >
        {PARK_THEMES.map((park) => {
          const available = park.status === "available";
          const active = park.id === themeId;
          const Emblem = park.Emblem;
          return (
            <button
              key={park.id}
              type="button"
              className={[
                "park-card",
                active && "park-card--active",
                !available && "park-card--soon",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => handlePick(park.id, available)}
              disabled={!available}
              aria-pressed={active}
            >
              <span className="park-card__art">
                <Emblem className="park-card__emblem" />
                {!available && (
                  <span className="park-card__ribbon">Coming Soon</span>
                )}
                {active && (
                  <span className="park-card__check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </span>
              <span className="park-card__label">
                <span className="park-card__name">{park.displayName}</span>
                <span className="park-card__desig">{park.designation}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
