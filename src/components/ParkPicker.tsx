/**
 * Park Picker — the theme selector. Renders every park in the registry as a
 * poster-style card: the park's actual scene art (raster, then SVG, then the
 * emblem as a last resort) under a nameplate, with its tagline and a strip
 * previewing the palette that recolors the whole game. Playable parks are
 * selectable and recolor on tap; "coming soon" parks show as dimmed previews.
 * Adding a park to themes.ts makes it appear here automatically.
 */
import type { CSSProperties } from "react";
import { PARK_THEMES } from "../themes";
import type { ThemePalette } from "../types";
import { useTheme } from "./ParkThemeProvider";
import { StarDivider } from "../art/Glyphs";
import ParkScene from "./ParkScene";
import "./ParkPicker.css";

export interface ParkPickerProps {
  /** Called after a playable park is chosen (e.g. to close a modal). */
  onPick?: (id: string) => void;
  /** Show the "★ Choose Your Park ★" header. */
  heading?: boolean;
  /** Layout density. */
  columns?: number;
}

/** Palette keys previewed in each card's color bar, dark → bright. */
const SWATCH_KEYS: (keyof ThemePalette)[] = ["primary", "secondary", "soft", "gold", "ember"];

export default function ParkPicker({ onPick, heading = true, columns }: ParkPickerProps) {
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
        style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}
      >
        {PARK_THEMES.map((park) => {
          const available = park.status === "available";
          const active = park.id === themeId;
          const Emblem = park.Emblem;
          const hasScene = Boolean(park.Scene || park.sceneImage);
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
              aria-label={`${park.displayName} ${park.designation}${
                available ? "" : " (coming soon)"
              }`}
              style={
                {
                  "--card-gold": park.palette.gold,
                  "--card-primary": park.palette.primary,
                } as CSSProperties
              }
            >
              <span className="park-card__art">
                {hasScene ? (
                  <ParkScene theme={park} className="park-card__scene" />
                ) : (
                  <Emblem className="park-card__scene" />
                )}
                <span className="park-card__scrim" aria-hidden="true" />
                <span className="park-card__plate">
                  <span className="park-card__desig">{park.designation}</span>
                  <span className="park-card__name">{park.displayName}</span>
                </span>
                {active && <span className="park-card__badge">Selected</span>}
                {!available && <span className="park-card__ribbon">Coming Soon</span>}
              </span>
              <span className="park-card__body">
                <span className="park-card__tagline">{park.tagline}</span>
                <span className="park-card__swatches" aria-hidden="true">
                  {SWATCH_KEYS.map((k) => (
                    <span
                      key={k}
                      className="park-card__swatch"
                      style={{ background: park.palette[k] }}
                    />
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
