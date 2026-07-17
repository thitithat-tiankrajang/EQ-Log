import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

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
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (dismissible && event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [dismissible, open, onClose]);

  if (!open) return null;
  return (
    <div
      className="ui-sheet-backdrop"
      role="presentation"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className="ui-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ui-sheet-head">
          <h2>{title}</h2>
          {dismissible && (
            <button type="button" className="ui-sheet-close" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </header>
        <div className="ui-sheet-body">{children}</div>
      </div>
    </div>
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
          <input name="value" defaultValue={initialValue} autoFocus autoComplete="off" />
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
