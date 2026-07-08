/**
 * Home / setup screen — game-first.
 *
 * 31 is the game; National Parks is the skin. So the page leads with the title,
 * a short explanation, and Learn-to-Play / History links, then game setup:
 * variable humans + AI with PER-AI difficulty, and the house rules. The park
 * theme is intentionally low-key — a random park is chosen on load and can be
 * changed from the Settings (gear) menu, not from a big picker on the page.
 */
import { useState } from "react";
import { useTheme } from "./ParkThemeProvider";
import ParkPicker from "./ParkPicker";
import HelpPanel from "./HelpPanel";
import HistoryPanel from "./HistoryPanel";
import About from "./About";
import Modal from "./Modal";
import HeroBackground from "./HeroBackground";
import { StarDivider } from "../art/Glyphs";
import { titleImage } from "../titleArt";
import { useAmbientAudio, hasAmbientAudio } from "../game/ambientAudio";
import { useSoundEnabled } from "../game/soundPrefs";
import { multiplayerEnabled } from "../game/multiplayerConfig";
import { DEFAULT_OPTIONS, type AITraits, type GameOptions } from "../game/engine";
import { AI_CHARACTERS, CHARACTERS_BY_ID, TRAIT_KEYS } from "../game/aiCharacters";
import { characterImage } from "../game/charArt";
import type { GameConfig, PlayerConfig } from "../game/useGame";
import "./SetupScreen.css";

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

const AVATAR_POOL = ["ranger", "goat", "bison", "geyser", "moose", "mountain"];

/** All character ids in random order (Fisher–Yates). */
function shuffledCharIds(): string[] {
  const ids = AI_CHARACTERS.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!]; // i and j are both in-bounds
  }
  return ids;
}

/** Five pips per trait (filled = value). */
function TraitBars({ traits }: { traits: AITraits }) {
  return (
    <div className="trait-bars">
      {TRAIT_KEYS.map((k) => (
        <div className="trait-bars__row" key={k}>
          <span className="trait-bars__label">{k}</span>
          <span className="trait-bars__pips">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={`trait-bars__pip${n <= traits[k] ? " trait-bars__pip--on" : ""}`}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="stepper">
      <span className="stepper__label">{label}</span>
      <div className="stepper__controls">
        <button
          type="button"
          className="stepper__btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Fewer ${label}`}
        >
          −
        </button>
        <span className="stepper__value">{value}</span>
        <button
          type="button"
          className="stepper__btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`More ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function Seg<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`seg__btn${value === o.id ? " seg__btn--active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="toggle-row">
      <span className="toggle-row__text">
        <span className="toggle-row__label">{label}</span>
        <span className="toggle-row__hint">{hint}</span>
      </span>
      <Seg
        ariaLabel={label}
        value={on ? "on" : "off"}
        onChange={(v) => {
          if ((v === "on") !== on) onToggle();
        }}
        options={[
          { id: "on", label: "On" },
          { id: "off", label: "Off" },
        ]}
      />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="setup__sectitle">
      <StarDivider className="setup__sectitle-rule" />
      <h2>{children}</h2>
      <StarDivider className="setup__sectitle-rule" />
    </div>
  );
}

export default function SetupScreen({
  onStart,
  onCreateOnline,
  onJoinOnline,
}: {
  onStart: (c: GameConfig) => void;
  /** Create an online game from the current config (multiplayer only). */
  onCreateOnline?: (c: import("../game/gameApi").CreateConfig) => void;
  /** Open the join-by-code modal (multiplayer only). */
  onJoinOnline?: () => void;
}) {
  const { theme, themeId } = useTheme();
  const [humans, setHumans] = useState(1);
  // Each AI slot holds a chosen character id — randomized on load, all distinct
  // (only one of any character can play at a time).
  const [aiCharIds, setAiCharIds] = useState<string[]>(() => shuffledCharIds().slice(0, 3));
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [names, setNames] = useState<string[]>(Array(MAX_PLAYERS).fill(""));
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [ambientOn, setAmbientOn] = useState(false);
  useAmbientAudio(themeId, ambientOn);
  const [soundOn, setSoundOn] = useSoundEnabled();

  const ai = aiCharIds.length;
  const total = humans + ai;
  const tooFew = total < MIN_PLAYERS;

  const setAiCount = (n: number) =>
    setAiCharIds((prev) => {
      if (n <= prev.length) return prev.slice(0, n);
      // Fill new slots with random characters not already in play.
      const used = new Set(prev);
      const avail = shuffledCharIds().filter((id) => !used.has(id));
      const next = [...prev];
      while (next.length < n && avail.length) next.push(avail.shift()!);
      return next;
    });
  // Picking a character already in another slot swaps them, keeping all distinct.
  const setAiChar = (i: number, id: string) =>
    setAiCharIds((prev) => {
      const j = prev.indexOf(id);
      const next = [...prev];
      if (j !== -1 && j !== i) next[j] = prev[i]!;
      next[i] = id;
      return next;
    });
  const setName = (i: number, v: string) => setNames((p) => p.map((n, j) => (j === i ? v : n)));
  const toggle = (key: keyof GameOptions) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  const start = () => {
    if (tooFew) return;
    const players: PlayerConfig[] = [];
    for (let i = 0; i < humans; i++) {
      players.push({
        name: names[i]?.trim() || `Player ${i + 1}`,
        isAI: false,
        avatarKey: AVATAR_POOL[i % AVATAR_POOL.length]!,
      });
    }
    aiCharIds.forEach((id) => {
      const c = CHARACTERS_BY_ID[id] ?? AI_CHARACTERS[0]!;
      players.push({
        name: c.name,
        isAI: true,
        avatarKey: "ranger",
        emoji: c.emoji,
        image: characterImage(c.id),
        traits: c.traits,
      });
    });
    onStart({ players, options });
  };

  const createOnline = () => {
    if (!onCreateOnline) return;
    onCreateOnline({
      creatorName: names[0]?.trim() || "Player 1",
      humans: Math.max(1, humans),
      ai: aiCharIds.map((id) => {
        const c = CHARACTERS_BY_ID[id] ?? AI_CHARACTERS[0]!;
        return {
          name: c.name,
          avatarKey: "ranger",
          emoji: c.emoji,
          image: characterImage(c.id),
          traits: c.traits,
        };
      }),
      options,
    });
  };

  return (
    <div className="setup">
      <HeroBackground themeId={themeId} />

      <div className="setup__panel">
        {/* Tools: theme settings + ambient sound */}
        <div className="setup__tools setup__arr setup__arr--1">
          {hasAmbientAudio && (
            <button
              className={`setup__tool${ambientOn ? " setup__tool--on" : ""}`}
              type="button"
              onClick={() => setAmbientOn((v) => !v)}
              aria-label={ambientOn ? "Mute ambience" : "Play ambience"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 9v6h4l5 4V5L8 9H4z"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                {ambientOn ? (
                  <path
                    d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M17 9.5l4 5M21 9.5l-4 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
          )}
          <button
            className="setup__tool"
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Theme settings"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
              <path
                d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Plaque: NPS-style bronze-and-wood badge with the 31 logo */}
        <div className="setup__plaque setup__arr setup__arr--1">
          {titleImage ? (
            <img className="setup__title-img" src={titleImage} alt="31 — National Parks Edition" />
          ) : (
            <div className="setup__title-fallback">
              <span className="setup__title-31">31</span>
              <span className="setup__title-sub">National Parks Edition</span>
            </div>
          )}
        </div>

        {/* What is 31 */}
        <p className="setup__about setup__arr setup__arr--3">
          <strong>31</strong> is a fast, classic card game. Draw and discard to build the highest
          total in a single suit — as close to <strong>31</strong> as you can. Knock when you're
          confident; each deal the lowest hand loses a token. The last player with a token wins.
        </p>

        <div className="setup__links setup__arr setup__arr--3">
          <button className="setup__link" type="button" onClick={() => setHelpOpen(true)}>
            Learn to Play →
          </button>
          <span className="setup__link-sep">·</span>
          <button className="setup__link" type="button" onClick={() => setHistoryOpen(true)}>
            History of 31 →
          </button>
        </div>

        {/* Players */}
        <section className="setup__section setup__arr setup__arr--4">
          <SectionTitle>Players</SectionTitle>
          <div className="setup__counts">
            <Stepper
              label="Humans"
              value={humans}
              min={0}
              max={MAX_PLAYERS - ai}
              onChange={setHumans}
            />
            <Stepper
              label="AI Opponents"
              value={ai}
              min={0}
              max={MAX_PLAYERS - humans}
              onChange={setAiCount}
            />
          </div>

          {humans > 0 && (
            <div className="setup__names">
              <span className="setup__sublabel">Player names (optional)</span>
              <div className="setup__names-grid">
                {Array.from({ length: humans }).map((_, i) => (
                  <input
                    key={i}
                    className="setup__name"
                    value={names[i]}
                    maxLength={14}
                    placeholder={`Player ${i + 1}`}
                    onChange={(e) => setName(i, e.target.value)}
                  />
                ))}
              </div>
            </div>
          )}

          {ai > 0 && (
            <div className="setup__ai">
              <span className="setup__sublabel">Choose your opponents</span>
              <div className="setup__ai-list">
                {aiCharIds.map((id, i) => {
                  const c = CHARACTERS_BY_ID[id] ?? AI_CHARACTERS[0]!;
                  return (
                    <div className="ai-card" key={i}>
                      <div className="ai-card__head">
                        {characterImage(c.id) ? (
                          <img className="ai-card__portrait" src={characterImage(c.id)} alt="" />
                        ) : (
                          <span className="ai-card__emoji">{c.emoji}</span>
                        )}
                        <select
                          className="ai-card__select"
                          value={id}
                          onChange={(e) => setAiChar(i, e.target.value)}
                          aria-label={`Opponent ${i + 1}`}
                        >
                          {AI_CHARACTERS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.emoji} {opt.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="ai-card__park">{c.homePark} National Park</div>
                      <div className="ai-card__style">{c.style}</div>
                      <div className="ai-card__phrase">“{c.catchPhrase}”</div>
                      <TraitBars traits={c.traits} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className={`setup__count-note${tooFew ? " setup__count-note--warn" : ""}`}>
            {tooFew
              ? "Add at least 2 players."
              : `${total} players · ${humans} human${humans === 1 ? "" : "s"}, ${ai} AI`}
          </p>
        </section>

        {/* House rules */}
        <section className="setup__section setup__arr setup__arr--4">
          <SectionTitle>House Rules</SectionTitle>
          <div className="setup__rules">
            <Toggle
              label="Grace"
              hint="Lose your last token and play on for one more deal."
              on={options.grace}
              onToggle={() => toggle("grace")}
            />
            <Toggle
              label="Three of a Kind"
              hint="A matching trio scores 30½ — beats everything but 31."
              on={options.threeOfAKind}
              onToggle={() => toggle("threeOfAKind")}
            />
            <Toggle
              label="Knock Penalty"
              hint="Knock and finish lowest? Lose two tokens, not one."
              on={options.knockPenalty}
              onToggle={() => toggle("knockPenalty")}
            />
            <Toggle
              label="Full Action History"
              hint="Let everyone review the whole deal's moves, not just since their last turn."
              on={options.fullHistory}
              onToggle={() => toggle("fullHistory")}
            />
          </div>
        </section>

        {/* Per-device preferences — not part of the shared game options, so
            each player sets their own and can change it mid-game too. */}
        <section className="setup__section setup__arr setup__arr--4">
          <SectionTitle>Your Device</SectionTitle>
          <div className="setup__rules">
            <Toggle
              label="Sound"
              hint="Card, knock, and coin effects — just for this device."
              on={soundOn}
              onToggle={() => setSoundOn(!soundOn)}
            />
          </div>
        </section>

        <button
          className="setup__start setup__arr setup__arr--5"
          type="button"
          onClick={start}
          disabled={tooFew}
        >
          Start Solo Adventure
        </button>

        {multiplayerEnabled && onCreateOnline && (
          <div className="setup__online setup__arr setup__arr--5">
            <button className="setup__online-btn" type="button" onClick={createOnline}>
              Create Online Game
            </button>
            <button
              className="setup__online-btn setup__online-btn--ghost"
              type="button"
              onClick={onJoinOnline}
            >
              Join with Code
            </button>
          </div>
        )}

        <footer className="setup__footer">
          <button type="button" className="setup__about-link" onClick={() => setAboutOpen(true)}>
            About
          </button>
        </footer>
      </div>

      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} labelledBy="set-title">
        <h2 id="set-title" className="setup__modal-title">
          Theme
        </h2>
        <p className="setup__modal-note">
          Currently playing <strong>{theme.displayName}</strong>. Pick a park — you can also switch
          mid-game.
        </p>
        <ParkPicker heading={false} onPick={() => setSettingsOpen(false)} />
      </Modal>
    </div>
  );
}
