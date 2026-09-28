import type { ReactNode } from "react";
import { ChevronRight, FolderLock, Globe2, MapPin, Sparkles, Trophy } from "lucide-react";
import { ApplicationShell } from "../../../app/shells/ApplicationShell";
import { AccountChip, useAuth } from "../../../auth";
import { useLocale } from "../../../i18n/LocaleProvider";
import { routeToHash } from "../../../router";

/**
 * The Learn centre: where a player goes to examine a position or look back at
 * a finished game. It lists only what exists today and leads to the pages that
 * own it — Study for positions, the History lists and the private library for
 * finished games. Stage is an Arena activity, shown here as a way to test what
 * was learned, not as a learning tool.
 */
export function LearnPage() {
  const { t } = useLocale();
  const { profile } = useAuth();

  return (
    <ApplicationShell
      title={t("learn.title")}
      description={t("learn.description")}
      routeKey="learn"
      actions={<AccountChip />}
    >
      <section className="eq-section eq-learn-section" aria-labelledby="learn-examine-heading">
        <h2 id="learn-examine-heading">{t("learn.examine.heading")}</h2>
        <ul className="eq-learn-links">
          <LearnLink
            href={routeToHash({ kind: "study" })}
            icon={<Sparkles size={20} />}
            label={t("learn.examine.study")}
            hint={t("learn.examine.studyHint")}
            primary
          />
        </ul>
        <p className="eq-learn-note">{t("learn.examine.inGame")}</p>
      </section>

      <section className="eq-section eq-learn-section" aria-labelledby="learn-review-heading">
        <h2 id="learn-review-heading">{t("learn.review.heading")}</h2>
        <ul className="eq-learn-links">
          <LearnLink
            href={routeToHash({ kind: "home", visibility: "public", section: "history" })}
            icon={<Globe2 size={20} />}
            label={t("learn.review.public")}
            hint={t("learn.review.publicHint")}
          />
          {profile?.region_id && (
            <LearnLink
              href={routeToHash({ kind: "home", visibility: "region", section: "history" })}
              icon={<MapPin size={20} />}
              label={t("learn.review.region")}
              hint={t("learn.review.regionHint")}
            />
          )}
          <LearnLink
            href={routeToHash({ kind: "private", folderId: null })}
            icon={<FolderLock size={20} />}
            label={t("learn.review.saved")}
            hint={t("learn.review.savedHint")}
          />
        </ul>
      </section>

      <section className="eq-section eq-learn-section" aria-labelledby="learn-arena-heading">
        <span className="eq-eyebrow">{t("learn.arena.eyebrow")}</span>
        <h2 id="learn-arena-heading">{t("learn.arena.heading")}</h2>
        <ul className="eq-learn-links">
          <LearnLink
            href={routeToHash({ kind: "stage" })}
            icon={<Trophy size={20} />}
            label={t("learn.arena.stage")}
            hint={t("learn.arena.stageHint")}
          />
        </ul>
      </section>
    </ApplicationShell>
  );
}

function LearnLink({
  href,
  icon,
  label,
  hint,
  primary = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  hint: string;
  primary?: boolean;
}) {
  return (
    <li>
      <a className={`eq-learn-link${primary ? " is-primary" : ""}`} href={href}>
        <span className="eq-learn-link-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="eq-learn-link-copy">
          <strong>{label}</strong>
          <small>{hint}</small>
        </span>
        <ChevronRight className="eq-learn-link-arrow" size={18} aria-hidden="true" />
      </a>
    </li>
  );
}
