import type { MouseEvent, ReactNode } from "react";
import {
  ChevronRight,
  KeyRound,
  SlidersHorizontal,
  Swords,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";
import {
  CREATE_CHOICES,
  ONLINE_CREATE_CHOICES,
  createChoiceRoute,
  type CreateChoice,
  type CreateRoute,
} from "../../../features/rooms/create/createChoices";
import { useLocale } from "../../../i18n/LocaleProvider";
import type { MessageKey } from "../../../i18n/translate";
import { navigate, routeToHash, type Route } from "../../../router";
import { isSupabaseConfigured } from "../../../supabaseClient";
import { isPlainClick } from "../../ui/isPlainClick";

const CHOICE_ICONS: Record<CreateChoice, ReactNode> = {
  match: <Swords size={20} />,
  host: <UserCog size={20} />,
  passplay: <Users size={20} />,
  solo: <UserRound size={20} />,
  custom: <SlidersHorizontal size={20} />,
};

const CHOICE_COPY: Record<CreateChoice, { title: MessageKey; description: MessageKey }> = {
  match: { title: "create.choice.match.title", description: "create.choice.match.description" },
  host: { title: "create.choice.host.title", description: "create.choice.host.description" },
  passplay: {
    title: "create.choice.passplay.title",
    description: "create.choice.passplay.description",
  },
  solo: { title: "create.choice.solo.title", description: "create.choice.solo.description" },
  custom: { title: "create.choice.custom.title", description: "create.choice.custom.description" },
};

/**
 * The Create choices as ordinary links, so every choice is also an address:
 * the (+) sheet and the `#/create` page show the same list, and a choice opens
 * its settings form in the space the player came from.
 */
export function CreateChooser({
  context,
  disabled = false,
  showIntro = false,
  replace = false,
  onChoose,
}: {
  context: CreateRoute;
  /** Creating is not possible here at all; the reason is shown by the caller. */
  disabled?: boolean;
  showIntro?: boolean;
  /** Make the choice in place of the current history entry, as a step of the
   *  same page rather than a page of its own. */
  replace?: boolean;
  onChoose?: () => void;
}) {
  const { t } = useLocale();
  function follow(route: Route) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      onChoose?.();
      if (!replace || !isPlainClick(event)) return;
      event.preventDefault();
      navigate(route, true);
    };
  }
  return (
    <div className="eq-create-chooser">
      {showIntro && <p className="eq-create-chooser-intro">{t("create.intro")}</p>}
      <ul className="eq-create-options" aria-label={t("create.choices")}>
        {CREATE_CHOICES.map((choice) => {
          const needsOnline = ONLINE_CREATE_CHOICES.includes(choice) && !isSupabaseConfigured;
          const route = createChoiceRoute(context, choice);
          const unavailable = disabled || needsOnline;
          const content = (
            <>
              <span className="eq-create-option-icon" aria-hidden="true">
                {CHOICE_ICONS[choice]}
              </span>
              <span className="eq-create-option-copy">
                <strong>{t(CHOICE_COPY[choice].title)}</strong>
                <span>{t(CHOICE_COPY[choice].description)}</span>
                {needsOnline && <small>{t("create.needsOnline")}</small>}
              </span>
              {!unavailable && (
                <ChevronRight className="eq-create-option-arrow" size={18} aria-hidden="true" />
              )}
            </>
          );
          return (
            <li key={choice} data-choice={choice}>
              {unavailable ? (
                <span className="eq-create-option" aria-disabled="true">
                  {content}
                </span>
              ) : (
                <a className="eq-create-option" href={routeToHash(route)} onClick={follow(route)}>
                  {content}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <a
        className="eq-create-join"
        href={routeToHash({ kind: "join", visibility: context.visibility })}
        onClick={onChoose}
      >
        <KeyRound size={17} aria-hidden="true" />
        <span>{t("create.join")}</span>
      </a>
    </div>
  );
}
