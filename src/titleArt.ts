/**
 * Optional title/logo image for the home screen. Drop a file named
 * `title.<ext>` (png/webp/jpg/svg) into `src/assets/` and it's used as the
 * home-page header; otherwise the home page falls back to styled text.
 * Restart the dev server after adding the file so Vite's glob picks it up.
 */
const titleModules = import.meta.glob(
  "./assets/title.{png,jpg,jpeg,webp,svg}",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
) as Record<string, string>;

export const titleImage: string | undefined = Object.values(titleModules)[0];
