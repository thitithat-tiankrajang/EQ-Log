import { useEffect, useState } from "react";
import {
  listMembers,
  loadMembers,
  subscribeMembers,
  type Member,
} from "../../../members";
import { isSupabaseConfigured } from "../../../supabaseClient";

export function useMembersCatalog(userId: string | null) {
  const [members, setMembers] = useState<Member[]>(() =>
    isSupabaseConfigured ? [] : listMembers(),
  );
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh(showLoading = false) {
      if (showLoading) setLoading(true);
      try {
        const next = await loadMembers(userId);
        if (!active) return;
        setMembers(next);
        setError(null);
      } catch (loadError) {
        if (!active) return;
        setMembers([]);
        setError(loadError instanceof Error ? loadError.message : "Unable to load members.");
      } finally {
        if (active && showLoading) setLoading(false);
      }
    }

    setMembers(isSupabaseConfigured ? [] : listMembers());
    void refresh(true);
    const unsubscribe = subscribeMembers(userId, () => void refresh());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId]);

  return { error, loading, members, setMembers };
}
