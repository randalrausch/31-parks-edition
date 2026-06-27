/**
 * Park theme context. Holds the active park, exposes a setter for the Park
 * Picker, and projects the active palette onto CSS custom properties so the
 * entire UI recolors instantly when the park changes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ParkTheme } from "../types";
import { DEFAULT_THEME_ID, THEMES_BY_ID, PLAYABLE_THEMES } from "../themes";

/** Pick a random playable park so each new session opens on a different theme. */
function randomPlayableId(): string {
  if (PLAYABLE_THEMES.length === 0) return DEFAULT_THEME_ID;
  return PLAYABLE_THEMES[Math.floor(Math.random() * PLAYABLE_THEMES.length)].id;
}

interface ThemeContextValue {
  theme: ParkTheme;
  themeId: string;
  setThemeId: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ParkThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(randomPlayableId);
  const theme = THEMES_BY_ID[themeId] ?? THEMES_BY_ID[DEFAULT_THEME_ID];

  const setThemeId = useCallback((id: string) => {
    const next = THEMES_BY_ID[id];
    // Only playable parks can become active; "coming-soon" stays a preview.
    if (next && next.status === "available") setThemeIdState(id);
  }, []);

  const styleVars = useMemo(() => {
    const p = theme.palette;
    return {
      "--c-base": p.base,
      "--c-surface": p.surface,
      "--c-primary": p.primary,
      "--c-secondary": p.secondary,
      "--c-soft": p.soft,
      "--c-cream": p.cream,
      "--c-gold": p.gold,
      "--c-ember": p.ember,
      "--c-draw": p.draw,
    } as React.CSSProperties;
  }, [theme]);

  const value = useMemo(
    () => ({ theme, themeId, setThemeId }),
    [theme, themeId, setThemeId],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div className="theme-root" data-park={themeId} style={styleVars}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ParkThemeProvider");
  return ctx;
}
