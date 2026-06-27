/**
 * Renders a park's table background. Prefers the raster `sceneImage` (a
 * WPA-style painting in src/assets/parks/); if that's missing or fails to load,
 * it gracefully falls back to the vector `Scene`. This lets real artwork drop in
 * with zero code changes while never leaving a blank table.
 */
import { useState } from "react";
import type { ParkTheme } from "../types";

export default function ParkScene({
  theme,
  className,
}: {
  theme: ParkTheme;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const Scene = theme.Scene;

  if (theme.sceneImage && !failed) {
    return (
      <img
        className={className}
        src={theme.sceneImage}
        alt=""
        aria-hidden="true"
        style={{ objectFit: "cover", width: "100%", height: "100%" }}
        onError={() => setFailed(true)}
      />
    );
  }
  return Scene ? <Scene className={className} /> : null;
}
