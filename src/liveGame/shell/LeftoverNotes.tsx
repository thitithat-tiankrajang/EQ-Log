import { useEffect, useState } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import { useWorkspaceUser } from "./workspaceUser";
import { leftoverNotes, scheduleGameDelete, cancelGameDelete } from "./workspace";

/**
 * A player who was away when their game finished meets their private Notes
 * again the first time they open its completed-game page; leaving the page
 * deletes them. Read from this browser only — never from the Replay.
 */
export function LeftoverNotes({ gameId }: { gameId: string }) {
  const { t } = useLocale();
  const userId = useWorkspaceUser();
  const [notes] = useState(() => leftoverNotes(userId, gameId));
  useEffect(() => {
    if (notes.length === 0) return;
    cancelGameDelete(userId, gameId);
    return () => scheduleGameDelete(userId, gameId);
  }, [notes.length, userId, gameId]);
  if (notes.length === 0) return null;
  return (
    <section className="eq-leftover-notes" aria-label={t("live.notes.title")}>
      <h3>{t("live.notes.title")}</h3>
      {notes.map((item) => (
        <pre key={item.slot}>{item.notes}</pre>
      ))}
      <p>{t("live.notes.finished")}</p>
    </section>
  );
}
