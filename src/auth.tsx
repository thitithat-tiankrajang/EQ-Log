import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogOut } from "lucide-react";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { PROFILE_LOAD_TIMEOUT_MS } from "./constants/network";

export type ProfileStatus = "pending" | "approved" | "blocked";

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  status: ProfileStatus;
  is_admin: boolean;
  region_id: string | null;
  region_name: string | null;
};

type AuthValue = {
  configured: boolean;
  loading: boolean;
  profileLoading: boolean;
  profileError: string | null;
  session: Session | null;
  profile: Profile | null;
  userId: string | null;
  isApproved: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  saveDisplayName: (name: string) => Promise<{ error?: string }>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const profileRequestRef = useRef(0);
  /** Who the profile on screen belongs to, so a refresh for that same person can
   *  be told apart from a sign-in that needs the account checked. */
  const loadedProfileUserIdRef = useRef<string | null>(null);

  /**
   * Fetch the account profile.
   *
   * `silent` refreshes it WITHOUT raising `profileLoading`, and the distinction
   * matters far more than it looks: `AuthGate` renders a splash instead of its
   * children while that flag is up, so raising it unmounts the entire
   * application and mounts a brand new one when it clears.
   *
   * That is the right thing to do when there is nothing to show yet. It is the
   * wrong thing to do for a token refresh — which Supabase performs whenever the
   * tab regains focus. Returning to the tab therefore tore the game down and
   * rebuilt it: every ref reset, the position re-seeded from cache, and the
   * shell committed that seed back as a NEW REVISION. A revision the player
   * never caused, which then retired the analysis they were watching and left
   * the server computing an answer nobody could see any more.
   */
  async function loadProfile(userId: string, options: { silent?: boolean } = {}) {
    if (!supabase) return;
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    if (!options.silent) setProfileLoading(true);
    setProfileError(null);
    try {
      let result = await withTimeout(supabase.rpc("get_my_profile"), PROFILE_LOAD_TIMEOUT_MS);
      if (
        result.error &&
        /PGRST202|42883|get_my_profile/i.test(`${result.error.code ?? ""} ${result.error.message}`)
      ) {
        result = await withTimeout(
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          PROFILE_LOAD_TIMEOUT_MS,
        );
      }
      if (profileRequestRef.current !== requestId) return;
      if (result.error) {
        loadedProfileUserIdRef.current = null;
        setProfile(null);
        setProfileError(result.error.message);
        return;
      }
      const profileData = Array.isArray(result.data) ? result.data[0] : result.data;
      loadedProfileUserIdRef.current = profileData ? userId : null;
      setProfile((profileData as Profile | null) ?? null);
    } catch (error) {
      if (profileRequestRef.current !== requestId) return;
      loadedProfileUserIdRef.current = null;
      setProfile(null);
      setProfileError(error instanceof Error ? error.message : "Unable to load account profile.");
    } finally {
      // Only lower the flag this call raised. A silent refresh never raised it,
      // and clearing it here would end a blocking load that is still running.
      if (profileRequestRef.current === requestId && !options.silent) setProfileLoading(false);
    }
  }

  function clearProfile() {
    profileRequestRef.current += 1;
    loadedProfileUserIdRef.current = null;
    setProfile(null);
    setProfileError(null);
    setProfileLoading(false);
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session) await loadProfile(data.session.user.id);
        else clearProfile();
      })
      .catch((error: Error) => {
        if (!active) return;
        clearProfile();
        setProfileError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setLoading(false);
      setSession(nextSession);
      if (!nextSession) {
        clearProfile();
        return;
      }
      // Still the same signed-in person, so their profile is still on screen and
      // still valid. Refresh it in the background rather than taking the app
      // down to ask a question that is already answered — `TOKEN_REFRESHED`
      // fires every time the tab regains focus, and blocking on it is what made
      // switching tabs mid-game destructive.
      const silent = loadedProfileUserIdRef.current === nextSession.user.id;
      void loadProfile(nextSession.user.id, { silent });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthValue = {
    configured: isSupabaseConfigured,
    loading,
    profileLoading,
    profileError,
    session,
    profile,
    userId: session?.user.id ?? null,
    isApproved: profile?.status === "approved",
    async signInWithGoogle() {
      if (!supabase) return;
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
    },
    async signOut() {
      if (!supabase) return;
      await supabase.auth.signOut();
      clearProfile();
    },
    async saveDisplayName(name: string) {
      if (!supabase || !session) return { error: "Not signed in" };
      const trimmed = name.trim();
      if (trimmed.length < 2) return { error: "Name must be at least 2 characters" };
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmed })
        .eq("id", session.user.id);
      if (error) {
        return {
          error: /duplicate|unique/i.test(error.message)
            ? "That name is already taken"
            : error.message,
        };
      }
      await loadProfile(session.user.id);
      return {};
    },
    async refreshProfile() {
      if (session) await loadProfile(session.user.id);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Renders children only for approved users. When Supabase is not configured the
// app runs as-is (local-only mode) so nothing breaks before setup.
export function AuthGate({ children }: { children: ReactNode }) {
  const { configured, loading, profileError, profileLoading, session, profile } = useAuth();
  if (!configured) return <>{children}</>;
  if (loading) return <AuthSplash text="Loading…" />;
  if (!session) return <SignInRequired />;
  if (profileLoading) return <AuthSplash text="Checking account…" />;
  if (profileError) {
    return (
      <AuthMessage
        title="Unable to verify account"
        body="Your account could not be verified. Sign out and try again."
      />
    );
  }
  if (!profile || !profile.display_name) return <RegisterName />;
  if (profile.status === "blocked") {
    return (
      <AuthMessage
        title="Account blocked"
        body="Your account has been blocked. Please contact an admin."
      />
    );
  }
  if (profile.status !== "approved" && !profile.is_admin) {
    return (
      <AuthMessage
        title="Approval pending"
        body="An administrator must approve your account before you can access games."
      />
    );
  }
  return <>{children}</>;
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="eq-auth-shell">
      <section className="eq-auth-card">
        <p className="eq-eyebrow">Equation Math Lab</p>
        {children}
      </section>
    </main>
  );
}

function AuthSplash({ text }: { text: string }) {
  return (
    <main className="eq-auth-shell">
      <div className="eq-auth-splash" role="status">
        {text}
      </div>
    </main>
  );
}

function SignInRequired() {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell>
      <h1>Sign in required</h1>
      <p className="eq-auth-sub">Sign in with an approved member account to access games.</p>
      <button
        className="eq-button eq-button-primary"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signInWithGoogle();
          } finally {
            setBusy(false);
          }
        }}
      >
        <GoogleMark /> Sign in with Google
      </button>
    </AuthShell>
  );
}

function RegisterName() {
  const { saveDisplayName, signOut } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell>
      <h1>Choose your name</h1>
      <p className="eq-auth-sub">Pick a unique username shown on your rooms.</p>
      <label className="eq-field">
        Display name
        <input
          value={name}
          maxLength={24}
          placeholder="e.g. Namfon"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error && (
        <p className="eq-form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="eq-button eq-button-primary"
        type="button"
        disabled={busy || name.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await saveDisplayName(name);
          setBusy(false);
          if (result.error) setError(result.error);
        }}
      >
        Continue
      </button>
      <button className="eq-text-button" type="button" onClick={signOut}>
        Sign out
      </button>
    </AuthShell>
  );
}

function AuthMessage({ title, body }: { title: string; body: string }) {
  const { signOut } = useAuth();
  return (
    <AuthShell>
      <h1>{title}</h1>
      <p className="eq-auth-sub">{body}</p>
      <button className="eq-text-button" type="button" onClick={signOut}>
        Sign out
      </button>
    </AuthShell>
  );
}

// Account chip for the lobby header (renders nothing in local-only mode).
export function AccountChip() {
  const {
    configured,
    loading,
    profile,
    profileError,
    profileLoading,
    session,
    signInWithGoogle,
    signOut,
  } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!configured) return null;
  if (loading)
    return (
      <div className="eq-account-chip" role="status">
        <span className="eq-account-name">Loading account…</span>
      </div>
    );
  if (!session) {
    return (
      <button
        className="eq-utility-button"
        aria-label="Sign in to play"
        disabled={busy}
        type="button"
        onClick={async () => {
          setBusy(true);
          try {
            await signInWithGoogle();
          } finally {
            setBusy(false);
          }
        }}
      >
        <GoogleMark />
        <span className="eq-utility-label">Sign in to play</span>
      </button>
    );
  }
  if (profileLoading)
    return (
      <div className="eq-account-chip" role="status">
        <span className="eq-account-name">Setting up account…</span>
      </div>
    );
  if (profileError)
    return (
      <div className="eq-account-chip">
        <span className="eq-account-name">Account check failed</span>
      </div>
    );
  if (!profile)
    return (
      <div className="eq-account-chip">
        <span className="eq-account-name">Choose a name to play</span>
      </div>
    );
  const label = profile.display_name ?? "Account";
  return (
    <div className="eq-account-chip">
      <span className="eq-account-avatar">{(label ?? "?").slice(0, 1).toUpperCase()}</span>
      <span className="eq-account-name">
        {label}
        {profile.status !== "approved" && <em> · {profile.status}</em>}
        {profile.is_admin && <em> · admin</em>}
      </span>
      <button className="eq-account-signout" type="button" aria-label="Sign out" onClick={signOut}>
        <LogOut size={16} />
      </button>
    </div>
  );
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Profile check timed out. You can keep using the room while it retries."));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
