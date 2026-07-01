/**
 * Lightweight modal overlay used by Help, Settings/Park Picker, and Victory.
 * Accessible: it's a labelled dialog that moves focus inside on open, traps Tab
 * within the panel, restores focus to the trigger on close, locks background
 * scroll, and closes on backdrop click or Escape.
 */
import { useEffect, useRef, type ReactNode } from "react";
import "./Modal.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional extra class on the panel for variant styling. */
  variant?: string;
  labelledBy?: string;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, children, variant, labelledBy }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus(); // move focus into the dialog

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Keep Tab focus inside the dialog.
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    // The backdrop click-to-close is a convenience only: the dialog is fully
    // keyboard-operable via Escape (handled above), a focus trap, and the close
    // button below, so the mouse-only backdrop handler needs no key listener.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div className="modal" onClick={onClose}>
      {/* Stop backdrop clicks that land on the panel from closing the dialog;
          the dialog itself is keyboard-operable (Escape + focus trap + button). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        ref={panelRef}
        className={["modal__panel", variant].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal__close" type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
