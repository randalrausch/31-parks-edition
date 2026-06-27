/**
 * Lightweight modal overlay used by Help, Settings/Park Picker, and Victory.
 * Closes on backdrop click or Escape; locks nothing else (prototype scope).
 */
import { useEffect, type ReactNode } from "react";
import "./Modal.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional extra class on the panel for variant styling. */
  variant?: string;
  labelledBy?: string;
}

export default function Modal({
  open,
  onClose,
  children,
  variant,
  labelledBy,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={onClose}
    >
      <div
        className={["modal__panel", variant].filter(Boolean).join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal__close"
          type="button"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
