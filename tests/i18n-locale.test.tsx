import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LanguageSwitch } from "../src/components/ui/LanguageSwitch";
import { STORAGE_KEYS } from "../src/constants/storage";
import { LocaleProvider, useLocale } from "../src/i18n/LocaleProvider";
import {
  DEFAULT_LOCALE,
  chooseLocale,
  getActiveLocale,
  readStoredLocale,
  resetActiveLocale,
} from "../src/i18n/locale";

function setBrowserLanguage(language: string) {
  Object.defineProperty(window.navigator, "language", { configurable: true, value: language });
  Object.defineProperty(window.navigator, "languages", { configurable: true, value: [language] });
}

function ErrorText() {
  const { t } = useLocale();
  return <p>{t("errors.generic")}</p>;
}

/** A fresh page load: nothing in memory, only what storage kept. */
function reload() {
  resetActiveLocale();
}

beforeEach(() => {
  window.localStorage.clear();
  reload();
  document.documentElement.lang = "en";
});

afterEach(() => {
  cleanup();
  setBrowserLanguage("en-US");
});

describe("first visit", () => {
  it("is English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(getActiveLocale()).toBe("en");
  });

  it("stays English even when the browser prefers Thai", () => {
    setBrowserLanguage("th-TH");
    reload();
    expect(getActiveLocale()).toBe("en");
    render(
      <LocaleProvider>
        <ErrorText />
      </LocaleProvider>,
    );
    expect(screen.getByText("Something went wrong. Please try again.")).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
  });

  it("does not store anything until the player chooses", () => {
    setBrowserLanguage("th-TH");
    render(
      <LocaleProvider>
        <ErrorText />
      </LocaleProvider>,
    );
    expect(window.localStorage.getItem(STORAGE_KEYS.locale)).toBeNull();
  });
});

describe("an explicit choice", () => {
  it("to Thai is applied at once and remembered after a reload", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <LocaleProvider>
        <LanguageSwitch />
        <ErrorText />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "ไทย" }));
    expect(screen.getByText("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")).toBeVisible();
    expect(screen.getByRole("button", { name: "ไทย" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.lang).toBe("th");
    expect(readStoredLocale()).toBe("th");

    unmount();
    reload();
    render(
      <LocaleProvider>
        <ErrorText />
      </LocaleProvider>,
    );
    expect(screen.getByText("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง")).toBeVisible();
  });

  it("to English is remembered too, and wins over a Thai browser", async () => {
    chooseLocale("th");
    setBrowserLanguage("th-TH");
    reload();
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LanguageSwitch />
      </LocaleProvider>,
    );
    expect(screen.getByRole("group", { name: "ภาษา" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(readStoredLocale()).toBe("en");
    reload();
    expect(getActiveLocale()).toBe("en");
  });

  it("names each language in itself", () => {
    render(
      <LocaleProvider>
        <LanguageSwitch />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("lang", "en");
    expect(screen.getByRole("button", { name: "ไทย" })).toHaveAttribute("lang", "th");
  });
});

describe("unreadable storage", () => {
  it("ignores an unknown stored value", () => {
    window.localStorage.setItem(STORAGE_KEYS.locale, "fr");
    reload();
    expect(getActiveLocale()).toBe("en");
  });

  it("falls back to English when storage throws", () => {
    const storage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      reload();
      expect(getActiveLocale()).toBe("en");
      expect(() => chooseLocale("th")).not.toThrow();
      expect(getActiveLocale()).toBe("th");
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    }
  });
});
