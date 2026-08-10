import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Check,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { AccountChip, useAuth, type Profile } from "./auth";
import { navigate, type AdminSection } from "./router";
import { ApplicationShell } from "./app/shells/ApplicationShell";
import { ConfirmSheet, TextPromptSheet } from "./components/ui/Sheet";
import { SelectControl } from "./components/ui/SelectControl";

type Region = { id: string; name: string };

export function AdminButton() {
  const { profile } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!profile?.is_admin || !supabase) return;
    let active = true;
    void supabase.rpc("list_profiles_admin").then(({ data }) => {
      if (active) {
        setPendingCount(
          Array.isArray(data) ? data.filter((row) => row.status === "pending").length : 0,
        );
      }
    });
    return () => {
      active = false;
    };
  }, [profile?.is_admin]);

  if (!profile?.is_admin) return null;
  return (
    <a className="eq-utility-link" href="#/admin/users">
      <Shield aria-hidden size={16} />
      <span>Admin</span>
      {pendingCount > 0 && <span className="eq-notification-badge">{pendingCount}</span>}
    </a>
  );
}

export function AdminPage({ section }: { section: AdminSection }) {
  const { profile, userId } = useAuth();
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function load() {
    if (!supabase) return;
    setError(null);
    let profilesResult = await supabase.rpc("list_profiles_admin");
    if (
      profilesResult.error &&
      /PGRST202|42883|list_profiles_admin/i.test(
        `${profilesResult.error.code ?? ""} ${profilesResult.error.message}`,
      )
    ) {
      profilesResult = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: true });
    }
    const regionsResult = await supabase.rpc("list_regions_admin");
    const loadError = profilesResult.error ?? regionsResult.error;
    if (loadError) {
      setError(
        /PGRST202|42883|list_regions_admin|regions/i.test(
          `${loadError.code ?? ""} ${loadError.message}`,
        )
          ? "Region management is not enabled yet. Run the region visibility migration."
          : loadError.message,
      );
    }
    setRows((profilesResult.data as Profile[] | null) ?? []);
    setRegions((regionsResult.data as Region[] | null) ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function patchProfile(
    target: Profile,
    fields: Partial<Pick<Profile, "status" | "is_admin" | "region_id">>,
  ) {
    if (!supabase) return;
    setBusyId(target.id);
    setError(null);
    const next = { ...target, ...fields };
    const { error: updateError } = await supabase.rpc("update_profile_admin", {
      target_profile_id: target.id,
      next_status: next.status,
      next_is_admin: next.is_admin,
      next_region_id: next.region_id ?? null,
    });
    if (updateError) {
      setError(
        /PGRST202|42883|update_profile_admin/i.test(
          `${updateError.code ?? ""} ${updateError.message}`,
        )
          ? "Secure access management is not enabled yet. Run the region visibility migration."
          : updateError.message,
      );
    } else await load();
    setBusyId(null);
  }

  if (!profile?.is_admin) {
    return (
      <ApplicationShell title="Admin" actions={<AccountChip />}>
        <section className="eq-state eq-state-access">
          <div>
            <h2>Admin access required</h2>
            <p>This page is available only to approved administrators.</p>
            <a className="eq-button eq-button-primary" href="#/public/rooms">
              Return to Public
            </a>
          </div>
        </section>
      </ApplicationShell>
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = (rows ?? []).filter((row) =>
    [row.display_name ?? "", row.email, row.region_name ?? "", row.status]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );

  return (
    <ApplicationShell
      eyebrow="Administration"
      title={section === "users" ? "People & access" : "Regions"}
      description={
        section === "users"
          ? "Approve accounts, assign regions, and manage administrator access."
          : "Create and maintain the private workspaces available to your community."
      }
      actions={<AccountChip />}
      onBack={() => navigate({ kind: "home", visibility: "public", section: "rooms" })}
      secondaryNavigation={<AdminNavigation active={section} />}
    >
      {error && (
        <div className="eq-alert eq-alert-error" role="alert">
          <span>{error}</span>
          <button
            className="eq-button eq-button-secondary"
            type="button"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      )}

      {section === "users" ? (
        <section className="eq-section eq-feature-section" aria-labelledby="admin-users-title">
          <div className="eq-section-heading eq-section-heading-actions">
            <div>
              <span className="eq-eyebrow">Directory</span>
              <h2 id="admin-users-title">Accounts</h2>
              <p>
                {rows?.length ?? 0} accounts · {regions.length} regions
              </p>
            </div>
            <button
              className="eq-button eq-button-secondary"
              type="button"
              onClick={() => void load()}
            >
              <RefreshCw aria-hidden size={16} /> Refresh
            </button>
          </div>
          <label className="eq-search-field">
            <Search aria-hidden size={17} />
            <span className="eq-visually-hidden">Search accounts</span>
            <input
              type="search"
              placeholder="Search name, email, region, or status"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {rows === null ? (
            <AdminRowsSkeleton />
          ) : filteredRows.length === 0 ? (
            <div className="eq-state">
              <h3>No accounts found</h3>
              <p>Try a different search.</p>
            </div>
          ) : (
            <div className="eq-admin-users">
              {filteredRows.map((row) => (
                <AdminUserRow
                  key={row.id}
                  profile={row}
                  busy={busyId === row.id}
                  isSelf={row.id === userId}
                  regions={regions}
                  onPatch={patchProfile}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <RegionsPage regions={regions} userId={userId} onError={setError} onReload={load} />
      )}
    </ApplicationShell>
  );
}

function AdminNavigation({ active }: { active: AdminSection }) {
  return (
    <nav className="eq-page-nav" aria-label="Admin sections">
      <a
        className={active === "users" ? "is-active" : ""}
        href="#/admin/users"
        aria-current={active === "users" ? "page" : undefined}
      >
        <ShieldCheck size={17} /> People & access
      </a>
      <a
        className={active === "regions" ? "is-active" : ""}
        href="#/admin/regions"
        aria-current={active === "regions" ? "page" : undefined}
      >
        <MapPin size={17} /> Regions
      </a>
    </nav>
  );
}

function AdminUserRow({
  profile,
  busy,
  isSelf,
  regions,
  onPatch,
}: {
  profile: Profile;
  busy: boolean;
  isSelf: boolean;
  regions: Region[];
  onPatch: (
    profile: Profile,
    fields: Partial<Pick<Profile, "status" | "is_admin" | "region_id">>,
  ) => void;
}) {
  return (
    <article className="eq-admin-user">
      <div className="eq-admin-identity">
        <span className="eq-avatar" aria-hidden>
          {(profile.display_name || profile.email).slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{profile.display_name ?? "Name not set"}</strong>
          <small>{profile.email}</small>
        </div>
      </div>
      <span className={`eq-status eq-status-${profile.status}`}>{profile.status}</span>
      <div className="eq-compact-field">
        <span id={`admin-region-${profile.id}-label`}>Region</span>
        <SelectControl<string>
          id={`admin-region-${profile.id}`}
          ariaLabelledBy={`admin-region-${profile.id}-label`}
          disabled={busy}
          value={profile.region_id ?? ""}
          options={[
            { value: "", label: "Not assigned" },
            ...regions.map((region) => ({ value: region.id, label: region.name })),
          ]}
          onChange={(value) => onPatch(profile, { region_id: value || null })}
        />
      </div>
      <div className="eq-admin-row-actions">
        {profile.status !== "approved" && (
          <button
            className="eq-button eq-button-primary"
            type="button"
            disabled={busy}
            onClick={() => onPatch(profile, { status: "approved" })}
          >
            <Check size={15} /> Approve
          </button>
        )}
        {profile.status !== "blocked" && !isSelf && (
          <button
            className="eq-button eq-button-danger"
            type="button"
            disabled={busy}
            onClick={() => onPatch(profile, { status: "blocked" })}
          >
            <Ban size={15} /> Block
          </button>
        )}
        {!isSelf && (
          <button
            className="eq-button eq-button-secondary"
            type="button"
            disabled={busy}
            onClick={() => onPatch(profile, { is_admin: !profile.is_admin })}
          >
            <ShieldCheck size={15} /> {profile.is_admin ? "Revoke admin" : "Make admin"}
          </button>
        )}
      </div>
    </article>
  );
}

function RegionsPage({
  regions,
  userId,
  onError,
  onReload,
}: {
  regions: Region[];
  userId: string | null;
  onError: (message: string | null) => void;
  onReload: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Region | null>(null);
  const [deleting, setDeleting] = useState<Region | null>(null);
  const sortedRegions = useMemo(
    () => [...regions].sort((a, b) => a.name.localeCompare(b.name)),
    [regions],
  );

  async function createRegion() {
    if (!supabase || !name.trim()) return;
    setBusy(true);
    onError(null);
    const { error } = await supabase
      .from("regions")
      .insert({ name: name.trim(), created_by: userId });
    if (error) onError(error.message);
    else {
      setName("");
      await onReload();
    }
    setBusy(false);
  }

  async function renameRegion(region: Region, nextName: string) {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase
      .from("regions")
      .update({ name: nextName.trim() })
      .eq("id", region.id);
    if (error) onError(error.message);
    else await onReload();
    setBusy(false);
  }

  async function deleteRegion(region: Region) {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from("regions").delete().eq("id", region.id);
    if (error) onError("This region cannot be deleted while rooms still belong to it.");
    else await onReload();
    setBusy(false);
  }

  return (
    <section className="eq-admin-regions" aria-labelledby="regions-title">
      <div className="eq-section eq-region-create">
        <div className="eq-section-heading">
          <div>
            <span className="eq-eyebrow">New workspace</span>
            <h2 id="regions-title">Create a region</h2>
          </div>
        </div>
        <form
          className="eq-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createRegion();
          }}
        >
          <label className="eq-field">
            <span>Region name</span>
            <input
              maxLength={48}
              placeholder="e.g. Bangkok North"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button
            className="eq-button eq-button-primary"
            type="submit"
            disabled={busy || !name.trim()}
          >
            <Plus size={16} /> Add region
          </button>
        </form>
      </div>
      <section className="eq-section">
        <div className="eq-section-heading">
          <div>
            <span className="eq-eyebrow">Directory</span>
            <h2>Existing regions</h2>
          </div>
          <span className="eq-count">{regions.length}</span>
        </div>
        {sortedRegions.length === 0 ? (
          <div className="eq-state">
            <h3>No regions yet</h3>
            <p>Create the first private workspace above.</p>
          </div>
        ) : (
          <div className="eq-region-list">
            {sortedRegions.map((region) => (
              <article className="eq-region-row" key={region.id}>
                <span className="eq-state-icon">
                  <MapPin size={18} />
                </span>
                <div>
                  <strong>{region.name}</strong>
                  <small>Private game space</small>
                </div>
                <div className="eq-region-actions">
                  <button
                    className="eq-icon-button"
                    type="button"
                    aria-label={`Rename ${region.name}`}
                    onClick={() => setRenaming(region)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="eq-icon-button is-danger"
                    type="button"
                    aria-label={`Delete ${region.name}`}
                    onClick={() => setDeleting(region)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <TextPromptSheet
        open={Boolean(renaming)}
        title="Rename region"
        label="Region name"
        initialValue={renaming?.name ?? ""}
        submitLabel="Save name"
        onCancel={() => setRenaming(null)}
        onSubmit={(nextName) => {
          const region = renaming;
          setRenaming(null);
          if (region) void renameRegion(region, nextName);
        }}
      />
      <ConfirmSheet
        open={Boolean(deleting)}
        title="Delete region"
        consequence={`Delete ${deleting?.name ?? "this region"}? Members will become unassigned. Regions with existing rooms cannot be deleted.`}
        confirmLabel="Delete region"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const region = deleting;
          setDeleting(null);
          if (region) void deleteRegion(region);
        }}
      />
    </section>
  );
}

function AdminRowsSkeleton() {
  return (
    <div className="eq-skeleton-list" aria-label="Loading accounts" role="status">
      {[0, 1, 2].map((item) => (
        <span key={item} />
      ))}
    </div>
  );
}
