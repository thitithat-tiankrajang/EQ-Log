import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let openSheetCount = 0;
let bodyOverflowBeforeSheets = "";

/**
 * Bottom sheet on phones, centered dialog on desktop. Replaces every
 * window.prompt/confirm/alert so dialogs stay in-theme and work inside
 * in-app browsers that block native popups.
 */
export function Sheet({
  open,
  title,
  dismissible = true,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  dismissible?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    if (openSheetCount === 0) {
      bodyOverflowBeforeSheets = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openSheetCount += 1;
    const appRoot = document.getElementById("root");
    if (appRoot) appRoot.inert = true;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? dialogRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (dismissible && event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
      );
      if (items.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      openSheetCount = Math.max(0, openSheetCount - 1);
      if (openSheetCount === 0) {
        document.body.style.overflow = bodyOverflowBeforeSheets;
        if (appRoot) appRoot.inert = false;
      }
      window.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus();
    };
  }, [dismissible, open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="ui-sheet-backdrop">
      {dismissible && (
        <button
          className="ui-sheet-dismiss"
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
        />
      )}
      <div
        ref={dialogRef}
        className="ui-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="ui-sheet-head">
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <button type="button" className="ui-sheet-close" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </header>
        <div className="ui-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation for destructive actions: states the consequence first, the
 * destructive button is red, Cancel is always visible.
 */
export function ConfirmSheet({
  open,
  title,
  consequence,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} title={title} onClose={onCancel}>
      <p className="ui-confirm-consequence">{consequence}</p>
      <div className="ui-sheet-actions">
        <button type="button" className="ui-button-danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="ui-button-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** Rename / short-text prompt as a Sheet (replaces window.prompt). */
export function TextPromptSheet({
  open,
  title,
  label,
  initialValue,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  if (!open) return null;
  return (
    <Sheet open={open} title={title} onClose={onCancel}>
      <form
        className="ui-prompt-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const value = String(data.get("value") ?? "").trim();
          if (value) onSubmit(value);
        }}
      >
        <label className="ui-prompt-field">
          <span>{label}</span>
          <input name="value" defaultValue={initialValue} autoComplete="off" />
        </label>
        <div className="ui-sheet-actions">
          <button type="submit" className="ui-button-primary">
            {submitLabel}
          </button>
          <button type="button" className="ui-button-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
