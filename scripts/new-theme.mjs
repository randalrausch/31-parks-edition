#!/usr/bin/env node
/**
 * Scaffolds a new park theme: prints a ready-to-paste entry for src/themes.ts
 * and reminds you where the art goes. See docs/THEMES.md for the full guide.
 *
 *   node scripts/new-theme.mjs <id> "<Display Name>"
 *   node scripts/new-theme.mjs yosemite "Yosemite"
 */
const [, , rawId, ...nameParts] = process.argv;
const id = (rawId || "").trim();
const displayName = nameParts.join(" ").trim() || (id ? id.replace(/-/g, " ") : "");

if (!/^[a-z][a-z0-9-]*$/.test(id) || !displayName) {
  console.error('Usage: node scripts/new-theme.mjs <kebab-id> "<Display Name>"');
  console.error('Example: node scripts/new-theme.mjs yosemite "Yosemite"');
  process.exit(1);
}

const constName = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Theme";
const emblemId = id.replace(/[^a-z0-9]/g, "").slice(0, 4);

const entry = `export const ${constName}: ParkTheme = {
  id: "${id}",
  displayName: "${displayName}",
  designation: "National Park",
  tagline: "TODO: a one-line WPA-poster tagline.",
  status: "available",
  palette: {
    base: "#15211a",
    surface: "#223026",
    primary: "#3f6135",
    secondary: "#7d8a5a",
    soft: "#b6b487",
    cream: "#f4e3b2",
    gold: "#d6a84f",
    ember: "#c9571c",
    draw: "#3f6135",
  },
  sceneImage: parkSceneImage("${id}"),
  backImage: parkBackImage("${id}"),
  Emblem: makePosterEmblem({
    id: "${emblemId}",
    skyTop: "#9fb8c4",
    skyBottom: "#e3e3cf",
    land: "#1d2a1f",
    peak: "#5f7a66",
  }),
  avatars: [
    { key: "mountain", Art: MountainAvatar },
    { key: "ranger", Art: RangerAvatar },
  ],
  victoryMessage: "TODO: a celebratory one-liner for the winner.",
};`;

console.log(`\nNew theme scaffold: ${displayName} (${id})\n`);
console.log("1) Add this art to src/assets/parks/ (any of .jpg/.png/.webp):");
console.log(`     ${id}-scene.jpg   (table background, ~1600x1000 landscape)`);
console.log(`     ${id}-back.jpg    (card back, ~600x840 portrait — optional)\n`);
console.log("2) Paste this entry into src/themes.ts (above PARK_THEMES):\n");
console.log(entry + "\n");
console.log("3) Add it to the PARK_THEMES array:");
console.log(`     export const PARK_THEMES: ParkTheme[] = [ …, ${constName} ];\n`);
console.log("4) Restart the dev server, then pick it in Settings → Theme.");
console.log("   Full guide: docs/THEMES.md\n");
