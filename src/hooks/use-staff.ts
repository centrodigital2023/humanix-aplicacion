// Personal de la institución — datos con TanStack Query y avisos en vivo de Realtime (sin sondeo).
//   · useStaffContext: lo que la PERSONA DEL EQUIPO necesita (institución, módulos, estado, plan) vía `my_staff_context()`.
//   · useTeamMembers / useTeamActivity: lo que lee la INSTITUCIÓN (su lista de personal y lo que hizo cada quien), por RLS.
// Las tablas se publican en Realtime (migración 20261013130000): llegan solo los cambios que RLS deja ver a cada quien.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { describeMemberAction } from "@/lib/institutionMembers";
import {
  parseStaffContext,
  toActivityItem,
  toTeamMember,
  type ActionRow,
  type ActivityItem,
  type MemberRow,
  type StaffContext,
  type TeamMember,
} from "@/lib/staffPanel";

// La tabla y la función del personal aún no están en los tipos generados (se regeneran con la base de datos).
const sb = supabase as unknown as SupabaseClient;

export const staffKeys = {
  context: (uid: string) => ["staff", "context", uid] as const,
  members: (institutionId: string) => ["staff", "members", institutionId] as const,
  activity: (institutionId: string) => ["staff", "activity", institutionId] as const,
};

const suffix = () => Math.random().toString(36).slice(2, 8);

/**
 * Contexto de la persona del equipo. Se vuelve a pedir al volver a la pestaña y cuando cambia su fila (la suspenden, le cambian
 * módulos) o la institución pierde el plan. `my_staff_context()` anota el «último acceso»; ese cambio propio no se vuelve a pedir.
 */
export function useStaffContext(userId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const lastFetchRef = useRef(0);
  const query = useQuery({
    queryKey: staffKeys.context(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<StaffContext | null> => {
      lastFetchRef.current = Date.now();
      const { data, error } = await sb.rpc("my_staff_context");
      if (error) throw error;
      return parseStaffContext(data);
    },
  });

  useEffect(() => {
    if (!userId || !enabled) return;
    const channel = sb
      .channel(`staff_ctx_${userId}_${suffix()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "institution_members",
          filter: `member_user_id=eq.${userId}`,
        },
        () => {
          // El aviso de nuestro propio «último acceso» llega justo después de pedir el contexto: no hace falta repetirlo.
          if (Date.now() - lastFetchRef.current < 4_000) return;
          void qc.invalidateQueries({ queryKey: staffKeys.context(userId) });
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [userId, enabled, qc]);

  return query;
}

/** La lista de personal de la institución (RLS: solo la suya) con avisos en vivo. */
export function useTeamMembers(institutionId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: staffKeys.members(institutionId ?? ""),
    enabled: !!institutionId,
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await sb
        .from("institution_members")
        .select(
          "id, member_user_id, username, display_name, job_title, modules, status, last_seen_at, created_at",
        )
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as MemberRow[]).map(toTeamMember);
    },
  });

  useEffect(() => {
    if (!institutionId) return;
    const channel = sb
      .channel(`staff_members_${institutionId}_${suffix()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "institution_members",
          filter: `institution_id=eq.${institutionId}`,
        },
        () => void qc.invalidateQueries({ queryKey: staffKeys.members(institutionId) }),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [institutionId, qc]);

  return query;
}

/** Lo último que hizo el personal (RLS: solo la institución dueña) con avisos en vivo. */
export function useTeamActivity(institutionId: string | null | undefined, limit = 30) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...staffKeys.activity(institutionId ?? ""), limit],
    enabled: !!institutionId,
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await sb
        .from("institution_member_actions")
        .select("id, member_user_id, member_name, action, target_table, created_at")
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as ActionRow[]).map((r) => toActivityItem(r, describeMemberAction));
    },
  });

  useEffect(() => {
    if (!institutionId) return;
    const channel = sb
      .channel(`staff_actions_${institutionId}_${suffix()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "institution_member_actions",
          filter: `institution_id=eq.${institutionId}`,
        },
        () => void qc.invalidateQueries({ queryKey: staffKeys.activity(institutionId) }),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [institutionId, qc]);

  return query;
}
