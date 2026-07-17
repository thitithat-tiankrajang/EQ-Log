import { useEffect, useState } from "react";
import { loadRegisteredPlayers, type RegisteredPlayer } from "../../../profiles";
import { isSupabaseConfigured } from "../../../supabaseClient";

export function useRegisteredPlayersCatalog(enabled: boolean) {
  const [players, setPlayers] = useState<RegisteredPlayer[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured && enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured || !enabled) {
      setPlayers([]);
      setLoading(false);
      setError(null);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    void loadRegisteredPlayers()
      .then((next) => {
        if (!active) return;
        setPlayers(next);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setPlayers([]);
        setError(loadError instanceof Error ? loadError.message : "Unable to load player directory.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  return { error, loading, players };
}
