import { useState, type ReactNode } from "react";
import {
  Coffee,
  Flag,
  LogOut,
  Menu,
  Pause,
  Pencil,
  Play,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useLocale } from "../../i18n/LocaleProvider";
import { BottomSheet, ConfirmBottomSheet, PromptBottomSheet } from "./BottomSheet";
import type { HostedAction } from "../hostedAdmin";
import type { LiveControl } from "../controls";
import type { ShellModel } from "./model";

/** The mute switch sits in plain view: one press, remembered. Muted reads as a pressed, struck-through speaker. */
export function SoundToggle({ on, onToggle }: { on: boolean; onToggle(): void }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className={`lg-icon-btn lg-ctl lg-sound-btn${on ? "" : " is-muted"}`}
      aria-pressed={!on}
      aria-label={on ? t("live.match.mute") : t("live.match.unmute")}
      title={on ? t("live.match.mute") : t("live.match.unmute")}
      onClick={onToggle}
    >
      {on ? (
        <Volume2 size={19} strokeWidth={2.2} aria-hidden="true" />
      ) : (
        <VolumeX size={19} strokeWidth={2.2} aria-hidden="true" />
      )}
    </button>
  );
}

function Item({
  icon,
  label,
  detail,
  danger,
  disabled,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      className={`lg-menu-item${danger ? " is-danger" : ""}`}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon}
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
    </button>
  );
}

/**
 * Match-level controls: Coffee Break, pause, rename, leave, host lifecycle and
 * Surrender. Kept apart from the turn actions; Surrender sits last, behind its
 * own confirmation. Semantics are the server's, unchanged.
 */
export function MatchControls({
  model,
  busy,
  onControl,
  onHosted,
  onSurrender,
  onLeave,
}: {
  model: ShellModel;
  busy: boolean;
  onControl(action: LiveControl): void;
  onHosted(action: HostedAction): void;
  onSurrender(): void;
  onLeave(coffee: boolean): void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"surrender" | "finish" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const caps = model.caps.match;
  const close = (then: () => void) => () => {
    setOpen(false);
    then();
  };
  const pauseBlocked = model.pause.blockedUntil !== null && model.pause.blockedUntil > Date.now();
  return (
    <>
      <button
        type="button"
        className="lg-icon-btn lg-ctl lg-match-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("live.match.open")}
        onClick={() => setOpen(true)}
      >
        <Menu size={19} strokeWidth={2.2} aria-hidden="true" />
        <span className="lg-match-label">{t("live.match.title")}</span>
      </button>
      <BottomSheet
        open={open}
        title={t("live.match.title")}
        onClose={() => setOpen(false)}
        peek={false}
      >
        <div className="lg-menu">
          {caps.coffee && (
            <Item
              icon={<Coffee size={18} aria-hidden="true" />}
              label={t("live.match.coffee")}
              disabled={busy}
              onSelect={close(() => onLeave(true))}
            />
          )}
          {caps.requestPause && (
            <Item
              icon={<Pause size={18} aria-hidden="true" />}
              label={t("live.match.requestPause")}
              detail={
                model.pause.outgoing
                  ? t("live.pause.waiting")
                  : pauseBlocked
                    ? t("live.match.pauseBlocked")
                    : undefined
              }
              disabled={busy || model.pause.outgoing || pauseBlocked}
              onSelect={close(() => onControl({ kind: "request-pause" }))}
            />
          )}
          {caps.resumeDirect && (
            <Item
              icon={<Play size={18} aria-hidden="true" />}
              label={t("live.pause.resume")}
              disabled={busy}
              onSelect={close(() => onControl({ kind: "resume-direct" }))}
            />
          )}
          {caps.hostLifecycle && (
            <>
              <Item
                icon={
                  model.paused ? (
                    <Play size={18} aria-hidden="true" />
                  ) : (
                    <Pause size={18} aria-hidden="true" />
                  )
                }
                label={model.paused ? t("live.match.hostResume") : t("live.match.hostPause")}
                disabled={busy}
                onSelect={close(() => onHosted({ kind: model.paused ? "resume" : "pause" }))}
              />
              <Item
                icon={<Square size={18} aria-hidden="true" />}
                label={t("live.match.finish")}
                disabled={busy}
                onSelect={close(() => setConfirm("finish"))}
              />
            </>
          )}
          {caps.rename && (
            <Item
              icon={<Pencil size={18} aria-hidden="true" />}
              label={t("live.match.rename")}
              disabled={busy}
              onSelect={close(() => setRenaming(true))}
            />
          )}
          <Item
            icon={<LogOut size={18} aria-hidden="true" />}
            label={
              caps.saveExit
                ? t("live.match.saveExit")
                : model.ranked
                  ? t("live.match.backRanked")
                  : t("live.match.leave")
            }
            disabled={busy}
            onSelect={close(() => onLeave(false))}
          />
          {caps.surrender && (
            <div className="lg-menu-danger">
              <Item
                icon={<Flag size={18} aria-hidden="true" />}
                label={t("live.match.surrender")}
                danger
                disabled={busy}
                onSelect={close(() => setConfirm("surrender"))}
              />
            </div>
          )}
        </div>
      </BottomSheet>
      <ConfirmBottomSheet
        open={confirm === "surrender"}
        title={t("live.match.surrenderTitle")}
        consequence={t("live.match.surrenderConsequence")}
        confirmLabel={t("live.match.surrender")}
        cancelLabel={t("live.actions.cancel")}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          onSurrender();
        }}
      />
      <ConfirmBottomSheet
        open={confirm === "finish"}
        title={t("live.match.finish")}
        consequence={t("live.match.finishConsequence")}
        confirmLabel={t("live.match.finish")}
        cancelLabel={t("live.actions.cancel")}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          onHosted({ kind: "finish" });
        }}
      />
      {caps.rename && model.live && (
        <PromptBottomSheet
          open={renaming}
          title={t("live.match.rename")}
          label={t("live.match.renameLabel")}
          initialValue={model.live.name}
          submitLabel={t("live.match.rename")}
          cancelLabel={t("live.actions.cancel")}
          onCancel={() => setRenaming(false)}
          onSubmit={(name) => {
            setRenaming(false);
            onControl({ kind: "rename", name });
          }}
        />
      )}
    </>
  );
}
