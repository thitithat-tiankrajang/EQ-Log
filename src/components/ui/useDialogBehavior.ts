import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Keyboard and focus behaviour for the in-game dialogs (result, assignment,
 * turn log, analysis). Escape closes, Tab is trapped inside the dialog, and
 * focus returns to whatever opened it.
 *
 * `Sheet` keeps its own copy of this because it additionally portals to
 * <body>, locks page scroll, and marks #root inert. The play dialogs render
 * *inside* #root, so inerting the root would disable the dialog itself — hence
 * this narrower hook rather than one shared implementation.
 */
export function useDialogBehavior<T extends HTMLElement>({
  open = true,
  onClose,
  dismissible = true,
}: {
  open?: boolean;
  onClose: () => void;
  dismissible?: boolean;
}) {
  const dialogRef = useRef<T | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Read the newest onClose without making it an effect dependency: an inline
  // arrow from the caller would otherwise re-run setup on every render and
  // yank focus back to the first control mid-interaction.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? dialogRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (dismissible && event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
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
      window.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus();
    };
  }, [dismissible, open]);

  return dialogRef;
}
