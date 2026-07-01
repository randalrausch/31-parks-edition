/**
 * Build-time registry of raster park artwork.
 *
 * Drop images into `src/assets/parks/` named `<id>-scene.<ext>` (table
 * background) and/or `<id>-back.<ext>` (card back), where `<id>` is the park's
 * theme id (e.g. "glacier", "yellowstone"). Vite discovers them at build time
 * via glob, so:
 *   • if a file is present, the theme uses it (hashed + optimized by Vite);
 *   • if it's absent, the lookup returns undefined and the UI falls back to the
 *     vector art — with no 404 and no console noise.
 *
 * After adding a new image, restart the dev server (or rebuild) so the glob
 * picks it up.
 */
const sceneModules = import.meta.glob("./assets/parks/*-scene.{jpg,jpeg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const backModules = import.meta.glob("./assets/parks/*-back.{jpg,jpeg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function find(map: Record<string, string>, id: string, suffix: string): string | undefined {
  const key = Object.keys(map).find((k) => k.split("/").pop()!.startsWith(`${id}-${suffix}.`));
  return key ? map[key] : undefined;
}

export const parkSceneImage = (id: string) => find(sceneModules, id, "scene");
export const parkBackImage = (id: string) => find(backModules, id, "back");
