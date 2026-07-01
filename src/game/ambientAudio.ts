/**
 * Per-park ambient audio. Drop a loop into `src/assets/audio/<park-id>.mp3`
 * (e.g. glacier.mp3 = wind + distant waterfall, yellowstone.mp3 = geyser
 * rumble, theodoreroosevelt.mp3 = prairie breeze). Files are discovered at
 * build time; if none exist the hook is a silent no-op.
 *
 * Browsers block autoplay, so playback only starts once `enabled` is turned on
 * by a user gesture (the home-screen sound toggle). Changing parks crossfades.
 */
import { useEffect, useRef } from "react";

const audioModules = import.meta.glob("../assets/audio/*.{mp3,ogg,m4a}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function audioFor(id: string): string | undefined {
  const key = Object.keys(audioModules).find((k) => k.split("/").pop()!.startsWith(`${id}.`));
  return key ? audioModules[key] : undefined;
}

export const hasAmbientAudio = Object.keys(audioModules).length > 0;

const TARGET_VOLUME = 0.4;

export function useAmbientAudio(themeId: string, enabled: boolean) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const url = audioFor(themeId);
    if (!enabled || !url) {
      // fade out + pause
      const el = elRef.current;
      if (el) {
        clearInterval(fadeRef.current);
        fadeRef.current = setInterval(() => {
          el.volume = Math.max(0, el.volume - 0.05);
          if (el.volume <= 0.001) {
            el.pause();
            clearInterval(fadeRef.current);
          }
        }, 40);
      }
      return;
    }

    let el = elRef.current;
    if (!el) {
      el = new Audio();
      el.loop = true;
      el.volume = 0;
      elRef.current = el;
    }
    if (!el.src.endsWith(url)) {
      el.src = url;
    }
    el.play().catch(() => {
      /* gesture not yet granted — ignored */
    });
    clearInterval(fadeRef.current);
    fadeRef.current = setInterval(() => {
      el!.volume = Math.min(TARGET_VOLUME, el!.volume + 0.04);
      if (el!.volume >= TARGET_VOLUME) clearInterval(fadeRef.current);
    }, 40);

    return () => clearInterval(fadeRef.current);
  }, [themeId, enabled]);

  // Stop audio when the component using the hook unmounts.
  useEffect(() => {
    return () => {
      clearInterval(fadeRef.current);
      elRef.current?.pause();
    };
  }, []);
}
