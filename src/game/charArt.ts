/**
 * Build-time registry of AI character portrait images (cropped from the
 * aggregate art into src/assets/chars/<id>.webp). Returns undefined for any
 * character without a portrait, so the UI falls back to the emoji.
 */
const charModules = import.meta.glob("../assets/chars/*.{webp,png,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function characterImage(id: string): string | undefined {
  const key = Object.keys(charModules).find((k) =>
    k.split("/").pop()!.startsWith(`${id}.`),
  );
  return key ? charModules[key] : undefined;
}
