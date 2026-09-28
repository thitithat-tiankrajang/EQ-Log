import { useLocale } from "../../i18n/LocaleProvider";
import { LOCALES } from "../../i18n/locale";

/**
 * The player's explicit language choice. Each language is named in itself, so
 * a player who cannot read the current language can still find their own.
 */
export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="eq-segmented-control" role="group" aria-label={t("common.language.label")}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          className={locale === option ? "is-active" : ""}
          aria-pressed={locale === option}
          onClick={() => setLocale(option)}
        >
          {t(`common.language.${option}`)}
        </button>
      ))}
    </div>
  );
}
