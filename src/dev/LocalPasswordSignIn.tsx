import { useState, type FormEvent } from "react";
import { supabase } from "../supabaseClient";

/** Genuine Auth only. AuthProvider receives the session through its usual listener. */
export default function LocalPasswordSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supabase) return;
    setBusy(true);
    setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) setError(result.error.message);
    } catch {
      setError("Local sign-in failed. Check that the disposable backend is running.");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <form className="eq-local-sign-in" aria-label="Disposable local sign-in" onSubmit={signIn}>
      <p className="eq-auth-footnote">
        Local development · Sign in with your disposable account. Google is disabled on this stack.
      </p>
      <label className="eq-field">
        Local email
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="eq-field">
        Local password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error && (
        <p className="eq-form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="eq-button eq-button-primary"
        type="submit"
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Signing in…" : "Sign in locally"}
      </button>
    </form>
  );
}
