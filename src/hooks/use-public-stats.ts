import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PublicStats = {
  verified_professionals: number;
  online_now: number;
  total_clients: number;
  new_this_month: number;
  completed_services: number;
};

const FALLBACK: PublicStats = {
  verified_professionals: 0,
  online_now: 0,
  total_clients: 0,
  new_this_month: 0,
  completed_services: 0,
};

export function usePublicStats() {
  const [stats, setStats] = useState<PublicStats>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("public_stats" as never)
        .select("*")
        .single<PublicStats>();
      if (!error && data) setStats(data);
    } catch {
      // keep fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();

    const suffix = Math.random().toString(36).slice(2, 8);
    const channel = supabase
      .channel(`public_stats_${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "professional_profiles" }, fetch)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, fetch)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetch]);

  return { stats, loading };
}
