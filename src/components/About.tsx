/**
 * About dialog — keeps version/build/credits off the play surfaces but one click
 * away. Shows the frontend version + commit, the LIVE backend (it asks the
 * backend to identify itself, so it always reflects what's actually serving —
 * Supabase today, Azure later), where the site is hosted, and license/links.
 */
import { useEffect, useState } from "react";
import Modal from "./Modal";
import {
  multiplayerEnabled,
  fetchBackendInfo,
  backendCompatible,
  type BackendInfo,
} from "../game/multiplayerConfig";
import "./About.css";

const REPO = "https://github.com/randalrausch/31-parks-edition";

/** Best-effort label for where the frontend is hosted, from the hostname. */
function hostLabel(): string {
  if (typeof window === "undefined") return "—";
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return "Local dev";
  if (h.endsWith(".netlify.app")) return "Netlify";
  if (h.endsWith(".azurestaticapps.net")) return "Azure Static Web Apps";
  if (h.endsWith(".pages.dev")) return "Cloudflare Pages";
  if (h.endsWith(".vercel.app")) return "Vercel";
  if (h.endsWith(".github.io")) return "GitHub Pages";
  return h; // custom domain
}

type Backend =
  | { kind: "off" }
  | { kind: "checking" }
  | { kind: "unreachable" }
  | { kind: "live"; info: BackendInfo };

export default function About({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [backend, setBackend] = useState<Backend>(
    multiplayerEnabled ? { kind: "checking" } : { kind: "off" },
  );

  useEffect(() => {
    if (!open || !multiplayerEnabled) return;
    let cancelled = false;
    setBackend({ kind: "checking" });
    fetchBackendInfo().then((info) => {
      if (cancelled) return;
      setBackend(info ? { kind: "live", info } : { kind: "unreachable" });
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const backendText =
    backend.kind === "off"
      ? "Not configured (solo & pass-and-play only)"
      : backend.kind === "checking"
        ? "Checking…"
        : backend.kind === "unreachable"
          ? "Unreachable"
          : `${backend.info.provider} · v${backend.info.version}`;

  // A live backend on a different wire protocol means this tab is out of date.
  const outOfDate = backend.kind === "live" && !backendCompatible(backend.info);

  return (
    <Modal open={open} onClose={onClose} labelledBy="about-title">
      <div className="about">
        <h2 id="about-title" className="about__title">
          31 · National Parks Edition
        </h2>
        <p className="about__tagline">A vintage WPA-poster take on the classic card game 31.</p>

        <dl className="about__rows">
          <div className="about__row">
            <dt>Frontend</dt>
            <dd>
              v{__APP_VERSION__} · {__GIT_SHA__}
            </dd>
          </div>
          <div className="about__row">
            <dt>Backend</dt>
            <dd>
              {backendText}
              {outOfDate && (
                <>
                  {" "}
                  · <strong>update available — refresh to play online</strong>
                </>
              )}
            </dd>
          </div>
          <div className="about__row">
            <dt>Hosting</dt>
            <dd>{hostLabel()}</dd>
          </div>
          <div className="about__row">
            <dt>Author</dt>
            <dd>Randy Rausch</dd>
          </div>
          <div className="about__row">
            <dt>License</dt>
            <dd>MIT</dd>
          </div>
        </dl>

        <div className="about__links">
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            Source code
          </a>
          <a href={`${REPO}/issues/new`} target="_blank" rel="noopener noreferrer">
            Report an issue
          </a>
        </div>
      </div>
    </Modal>
  );
}
