import { STORAGE_KEYS } from "../constants/storage";

export const LOCALES = ["en", "th"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Every first visit is English, whatever language the browser reports. Thai is
 * shown only after the player explicitly chooses it, and that choice is the
 * only thing ever remembered: `navigator.language` is deliberately never read.
 */
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "th";
}

/** The player's explicit choice, if one was made and storage can be read. */
export function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.locale);
    return isLocale(stored) ? stored : null;
  } catch {
    // Private windows and blocked site data: behave as a first visit.
    return null;
  }
}

function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.locale, locale);
  } catch {
    // The choice still applies for this page; it just is not remembered.
  }
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

let active: Locale | null = null;

/**
 * The language in use right now. Code outside React (errors thrown from
 * repositories, for example) reads it here; components read it through
 * `useLocale`, which keeps the two in step.
 */
export function getActiveLocale(): Locale {
  if (active === null) active = readStoredLocale() ?? DEFAULT_LOCALE;
  return active;
}

/** An explicit choice by the player: applied at once and remembered. */
export function chooseLocale(locale: Locale): void {
  active = locale;
  storeLocale(locale);
  applyDocumentLocale(locale);
}

/** Forget the in-memory language so the next read starts again from storage. */
export function resetActiveLocale(): void {
  active = null;
}
