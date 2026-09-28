import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { applyDocumentLocale, chooseLocale, getActiveLocale, type Locale } from "./locale";
import {
  formatNumber as formatLocaleNumber,
  translate,
  type MessageKey,
  type MessageParams,
} from "./translate";

export type LocaleValue = {
  locale: Locale;
  /** The player's explicit choice: applied at once and remembered. */
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  formatNumber: (value: number) => string;
};

function valueFor(locale: Locale, setLocale: (locale: Locale) => void): LocaleValue {
  return {
    locale,
    setLocale,
    t: (key, params) => translate(locale, key, params),
    formatNumber: (value) => formatLocaleNumber(locale, value),
  };
}

// Outside a provider (isolated component tests) the active language is read at
// each call; choosing one is remembered but re-renders nothing.
const LocaleContext = createContext<LocaleValue>({
  get locale() {
    return getActiveLocale();
  },
  setLocale: chooseLocale,
  t: (key, params) => translate(getActiveLocale(), key, params),
  formatNumber: (value) => formatLocaleNumber(getActiveLocale(), value),
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getActiveLocale);

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    chooseLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo(() => valueFor(locale, setLocale), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}
