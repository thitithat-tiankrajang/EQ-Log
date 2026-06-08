import { useEffect, useState } from "react";
import { Ban, Check, RotateCcw, Shield, ShieldCheck, X } from "lucide-react";
import { supabase } from "./supabaseClient";
import { useAuth, type Profile } from "./auth";

// Button shown in the lobby header for admins; opens the approvals panel.
export function AdminButton() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!profile?.is_admin || !supabase) return;
    let active = true;
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => {
        if (active) setPendingCount(count ?? 0);
      });
    return () => {
      active = false;
    };
  }, [profile?.is_admin, open]);

  if (!profile?.is_admin) return null;

  return (
    <>
      <button className="icon-button admin-open" type="button" onClick={() => setOpen(true)}>
        <Shield size={16} />
        Approvals
        {pendingCount > 0 && <span className="admin-badge">{pendingCount}</span>}
      </button>
      {open && <AdminPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function AdminPanel({ onClose }: { onClose: () => void }) {
  const { userId } = useAuth();
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    const { data, error: err } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });
    if (err) setError(err.message);
    setRows((data as Profile[]) ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(id: string, fields: Partial<Pick<Profile, "status" | "is_admin">>) {
    if (!supabase) return;
    setBusyId(id);
    setError(null);
    const { error: err } = await supabase.from("profiles").update(fields).eq("id", id);
    if (err) setError(err.message);
    await load();
    setBusyId(null);
  }

  const pending = (rows ?? []).filter((row) => row.status === "pending");
  const members = (rows ?? []).filter((row) => row.status !== "pending");

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-modal="true"
        className="admin-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">Admin</span>
            <h2>Account approvals</h2>
          </div>
          <div className="admin-head-actions">
            <button className="icon-button" type="button" onClick={load}>
              <RotateCcw size={16} />
              Refresh
            </button>
            <button className="icon-button" type="button" onClick={onClose}>
              <X size={18} />
              Close
            </button>
          </div>
        </header>

        <div className="admin-body">
          {error && <p className="auth-error">{error}</p>}
          {rows === null ? (
            <p className="empty-text">Loading…</p>
          ) : (
            <>
              <h3 className="admin-section">Pending · {pending.length}</h3>
              {pending.length === 0 && <p className="empty-text">No accounts waiting for approval.</p>}
              {pending.map((row) => (
                <AdminRow
                  key={row.id}
                  profile={row}
                  busy={busyId === row.id}
                  isSelf={row.id === userId}
                  onPatch={patch}
                />
              ))}

              <h3 className="admin-section">Members · {members.length}</h3>
              {members.map((row) => (
                <AdminRow
                  key={row.id}
                  profile={row}
                  busy={busyId === row.id}
                  isSelf={row.id === userId}
                  onPatch={patch}
                />
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function AdminRow({
  profile,
  busy,
  isSelf,
  onPatch,
}: {
  profile: Profile;
  busy: boolean;
  isSelf: boolean;
  onPatch: (id: string, fields: Partial<Pick<Profile, "status" | "is_admin">>) => void;
}) {
  return (
    <div className="admin-row">
      <div className="admin-id">
        <strong>
          {profile.display_name ?? "(no name yet)"}
          {profile.is_admin && <em> · admin</em>}
          {isSelf && <em> · you</em>}
        </strong>
        <span>{profile.email}</span>
      </div>
      <span className={`admin-status admin-status-${profile.status}`}>{profile.status}</span>
      <div className="admin-actions">
        {profile.status !== "approved" && (
          <button type="button" disabled={busy} onClick={() => onPatch(profile.id, { status: "approved" })}>
            <Check size={14} />
            Approve
          </button>
        )}
        {profile.status !== "blocked" && !isSelf && (
          <button
            className="danger"
            type="button"
            disabled={busy}
            onClick={() => onPatch(profile.id, { status: "blocked" })}
          >
            <Ban size={14} />
            Block
          </button>
        )}
        {!isSelf && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPatch(profile.id, { is_admin: !profile.is_admin })}
          >
            <ShieldCheck size={14} />
            {profile.is_admin ? "Revoke admin" : "Make admin"}
          </button>
        )}
      </div>
    </div>
  );
}
