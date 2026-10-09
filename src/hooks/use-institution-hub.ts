import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { subscribeOpenOffersPing, useProBundle } from "@/hooks/use-opportunity-feed";
import {
  applyOfferFilters,
  normalizeOfferRow,
  rankOffers,
  summarizeOffers,
  type InstitutionOfferRow,
  type OfferFilters,
} from "@/lib/institutionOffers";
import {
  normalizeInboxRow,
  normalizeMyApplication,
  type InboxRow,
  type MyApplicationRow,
} from "@/lib/institutionApplications";
import { parseContractTerms } from "@/lib/contractTemplate";
import { parseReadiness } from "@/lib/contractIdentity";

// Funciones y tablas nuevas aún no están en los tipos generados (se regeneran tras aplicar la migración).
const sb = supabase as unknown as SupabaseClient;

export const instKeys = {
  offers: (uid: string) => ["inst", "offers", uid] as const,
  myApps: (uid: string) => ["inst", "my-apps", uid] as const,
  inbox: (uid: string) => ["inst", "inbox", uid] as const,
  contracts: (uid: string) => ["inst", "contracts", uid] as const,
  contract: (id: string) => ["inst", "contract", id] as const,
  readiness: (contractId: string, uid: string) => ["inst", "readiness", contractId, uid] as const,
  integrity: (contractId: string) => ["inst", "integrity", contractId] as const,
  reputation: (id: string) => ["inst", "reputation", id] as const,
  coverage: (uid: string) => ["inst", "coverage", uid] as const,
  supply: (city: string, specialty: string) => ["inst", "supply", city, specialty] as const,
  team: (uid: string) => ["inst", "team", uid] as const,
};

/** Agrupa avisos seguidos en una sola recarga. */
function useDebouncedInvalidate(keys: ReadonlyArray<readonly unknown[]>, delay = 1200) {
  const qc = useQueryClient();
  const serialized = JSON.stringify(keys);
  return useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const k of JSON.parse(serialized) as unknown[][]) {
          void qc.invalidateQueries({ queryKey: k });
        }
      }, delay);
    };
    run.cancel = () => clearTimeout(timer);
    return run;
  }, [qc, serialized, delay]);
}

// ─── Profesional ─────────────────────────────────────────────────────────────

/**
 * Postulación al valor publicado (todos los turnos abiertos). Toda la validación vive en el servidor:
 * rol, cruces de agenda, cupo, mensaje y negociación según el plan.
 */
export async function applyToPublishedOffer(offerId: string): Promise<string> {
  const { data, error } = await sb.rpc("apply_to_offer", { p_offer_id: offerId });
  if (error) throw error;
  return data as string;
}

/** Ofertas abiertas de instituciones (sin dirección ni teléfono) con avisos en vivo del servidor. */
export function useInstitutionOffers(userId: string | null | undefined) {
  const refresh = useDebouncedInvalidate(
    userId ? [instKeys.offers(userId), instKeys.myApps(userId)] : [],
  );
  const query = useQuery({
    queryKey: instKeys.offers(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("list_open_institution_offers", { p_limit: 300 });
      if (error) throw error;
      return (data ?? []) as InstitutionOfferRow[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    // El servidor emite «hay cambios» (sin datos); los datos se piden por el RPC seguro.
    const unsubscribe = subscribeOpenOffersPing(refresh);
    const mine = sb
      .channel(`inst_offers_apps_${userId}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "applications",
          filter: `professional_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      refresh.cancel();
      unsubscribe();
      void sb.removeChannel(mine);
    };
  }, [userId, refresh]);

  return query;
}

/** Turnos de instituciones puntuados con el perfil y la agenda del profesional. */
export function useInstitutionFeed(userId: string | null | undefined, filters?: OfferFilters) {
  const offers = useInstitutionOffers(userId);
  const bundle = useProBundle(userId);

  const model = useMemo(() => {
    if (!offers.data || !bundle.data) return null;
    const normalized = offers.data.map(normalizeOfferRow);
    const ranked = rankOffers(normalized, bundle.data.pro);
    return {
      offers: normalized,
      ranked,
      visible: filters ? applyOfferFilters(ranked, filters) : ranked,
      summary: summarizeOffers(ranked),
      bundle: bundle.data,
    };
  }, [offers.data, bundle.data, filters]);

  return {
    model,
    isLoading: offers.isLoading || bundle.isLoading,
    error: (offers.error ?? bundle.error) as Error | null,
    refetch: () => {
      void offers.refetch();
      void bundle.refetch();
    },
  };
}

/** Postulaciones del profesional a ofertas de instituciones, con el estado de cada contrato. */
export function useMyOfferApplications(userId: string | null | undefined) {
  const refresh = useDebouncedInvalidate(
    userId ? [instKeys.myApps(userId), instKeys.contracts(userId)] : [],
  );
  const query = useQuery({
    queryKey: instKeys.myApps(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("my_offer_applications", { p_limit: 100 });
      if (error) throw error;
      return ((data ?? []) as MyApplicationRow[]).map(normalizeMyApplication);
    },
  });
  useEffect(() => {
    if (!userId) return;
    const channel = sb
      .channel(`inst_my_apps_${userId}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "applications",
          filter: `professional_id=eq.${userId}`,
        },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "smart_contracts" }, refresh)
      .subscribe();
    return () => {
      refresh.cancel();
      void sb.removeChannel(channel);
    };
  }, [userId, refresh]);
  return query;
}

/** Reputación agregada de una institución (≥ 3 calificaciones por dimensión; sin comentarios). */
export function useInstitutionReputation(
  institutionId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: instKeys.reputation(institutionId ?? ""),
    enabled: enabled && !!institutionId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("institution_reputation", {
        p_institution: institutionId,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            ratings_count: number | null;
            stars_avg: number | null;
            completed_services: number | null;
            dimensions: Array<{ dimension: string; average: number; ratings: number }> | null;
          }
        | undefined;
      return row ?? { ratings_count: 0, stars_avg: null, completed_services: 0, dimensions: [] };
    },
  });
}

// ─── Institución ─────────────────────────────────────────────────────────────

/** Buzón de postulaciones de la institución con avisos en vivo. */
export function useInstitutionInbox(userId: string | null | undefined) {
  const refresh = useDebouncedInvalidate(
    userId ? [instKeys.inbox(userId), instKeys.coverage(userId), instKeys.contracts(userId)] : [],
  );
  const query = useQuery({
    queryKey: instKeys.inbox(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("institution_application_inbox", { p_limit: 200 });
      if (error) throw error;
      return ((data ?? []) as InboxRow[]).map(normalizeInboxRow);
    },
  });
  useEffect(() => {
    if (!userId) return;
    // RLS limita lo que llega: solo cambios de postulaciones a las ofertas de esta institución.
    const channel = sb
      .channel(`inst_inbox_${userId}_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "smart_contracts" }, refresh)
      .subscribe();
    return () => {
      refresh.cancel();
      void sb.removeChannel(channel);
    };
  }, [userId, refresh]);
  return query;
}

export interface CoverageRawOffer {
  id: string;
  title: string;
  city: string;
  modality: string;
  amount: number;
  status: string;
  is_urgent: boolean | null;
  specialty_required: string | null;
  service_area: string | null;
  job_offer_shifts: Array<{
    id: string;
    starts_at: string;
    ends_at: string;
    positions: number;
    filled: number;
    status: string;
  }> | null;
}

/** Ofertas propias con su agenda (RLS: solo las de la institución). */
export function useCoverageOffers(userId: string | null | undefined) {
  const refresh = useDebouncedInvalidate(userId ? [instKeys.coverage(userId)] : []);
  const query = useQuery({
    queryKey: instKeys.coverage(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("job_offers")
        .select(
          "id, title, city, modality, amount, status, is_urgent, specialty_required, service_area, job_offer_shifts(id, starts_at, ends_at, positions, filled, status)",
        )
        .eq("posted_by", userId)
        .in("status", ["open", "filled"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as CoverageRawOffer[];
    },
  });
  useEffect(() => {
    if (!userId) return;
    const channel = sb
      .channel(`inst_cov_${userId}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_offers", filter: `posted_by=eq.${userId}` },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "job_offer_shifts" }, refresh)
      .subscribe();
    return () => {
      refresh.cancel();
      void sb.removeChannel(channel);
    };
  }, [userId, refresh]);
  return query;
}

/** Cuántos profesionales disponibles hay cerca (null si la muestra es menor a 5). */
export function useSupplySnapshot(city: string | null, specialty: string | null, enabled: boolean) {
  return useQuery({
    queryKey: instKeys.supply(city ?? "", specialty ?? ""),
    enabled: enabled && !!city,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("market_supply_snapshot", {
        p_city: city,
        p_specialty: specialty,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { professionals: number | null; rethus_verified: number | null }
        | undefined;
      return { professionals: row?.professionals ?? null, verified: row?.rethus_verified ?? null };
    },
  });
}

/** Profesionales del «equipo de confianza» de la institución (care_favorites). */
export function useTeamCount(userId: string | null | undefined) {
  return useQuery({
    queryKey: instKeys.team(userId ?? ""),
    enabled: !!userId,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { count, error } = await sb
        .from("care_favorites")
        .select("professional_id", { count: "exact", head: true })
        .eq("client_id", userId);
      if (error) return 0;
      return count ?? 0;
    },
  });
}

// ─── Contratos (ambas partes) ────────────────────────────────────────────────

export interface ContractListRow {
  contract_id: string;
  contract_no: string;
  status: string;
  total_amount: number;
  version: number;
  signature_deadline: string;
  created_at: string;
  my_party: "institution" | "professional";
  counterpart_name: string;
  offer_title: string | null;
  first_shift: string | null;
  shifts: number;
  first_booking_id: string | null;
  i_signed: boolean;
  other_signed: boolean;
}

export function useMySmartContracts(userId: string | null | undefined) {
  const refresh = useDebouncedInvalidate(userId ? [instKeys.contracts(userId)] : []);
  const query = useQuery({
    queryKey: instKeys.contracts(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("my_smart_contracts", { p_limit: 100 });
      if (error) throw error;
      return (data ?? []) as ContractListRow[];
    },
  });
  useEffect(() => {
    if (!userId) return;
    const channel = sb
      .channel(`inst_contracts_${userId}_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "smart_contracts" }, refresh)
      .subscribe();
    return () => {
      refresh.cancel();
      void sb.removeChannel(channel);
    };
  }, [userId, refresh]);
  return query;
}

export interface ContractDetail {
  id: string;
  contract_no: string;
  status: string;
  version: number;
  template_version: string;
  total_amount: number;
  signature_deadline: string;
  created_at: string;
  activated_at: string | null;
  institution_user_id: string;
  professional_id: string;
  terms_hash: string;
  terms: ReturnType<typeof parseContractTerms>;
  shifts: Array<{
    id: string;
    shift_no: number;
    booking_id: string | null;
    starts_at: string;
    ends_at: string;
    hours: number;
    amount: number;
    status: string;
  }>;
  signatures: Array<{
    party: "institution" | "professional";
    signer_id: string;
    signer_name: string;
    signer_identity: string;
    identity_method: string;
    signed_at: string;
    signature_hash: string;
    terms_hash: string;
    body_hash: string;
  }>;
  events: Array<{
    seq: number;
    event: string;
    actor_role: string | null;
    created_at: string;
    hash: string;
  }>;
}

/** Contrato completo con turnos, firmas y cadena de eventos (RLS: solo las partes). */
export function useSmartContract(contractId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: instKeys.contract(contractId ?? ""),
    enabled: enabled && !!contractId,
    queryFn: async (): Promise<ContractDetail | null> => {
      const { data, error } = await sb
        .from("smart_contracts")
        .select(
          "id, contract_no, status, version, template_version, total_amount, signature_deadline, created_at, activated_at, institution_user_id, professional_id, terms_hash, terms, smart_contract_shifts(id, shift_no, booking_id, starts_at, ends_at, hours, amount, status), smart_contract_signatures(party, signer_id, signer_name, signer_identity, identity_method, signed_at, signature_hash, terms_hash, body_hash), smart_contract_events(seq, event, actor_role, created_at, hash)",
        )
        .eq("id", contractId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as Record<string, unknown>;
      const shifts = ((row.smart_contract_shifts as ContractDetail["shifts"]) ?? [])
        .slice()
        .sort((a, b) => a.shift_no - b.shift_no);
      const events = ((row.smart_contract_events as ContractDetail["events"]) ?? [])
        .slice()
        .sort((a, b) => a.seq - b.seq);
      return {
        id: row.id as string,
        contract_no: row.contract_no as string,
        status: row.status as string,
        version: Number(row.version),
        template_version: row.template_version as string,
        total_amount: Number(row.total_amount),
        signature_deadline: row.signature_deadline as string,
        created_at: row.created_at as string,
        activated_at: (row.activated_at as string | null) ?? null,
        institution_user_id: row.institution_user_id as string,
        professional_id: row.professional_id as string,
        terms_hash: row.terms_hash as string,
        terms: parseContractTerms(row.terms),
        shifts,
        signatures: (row.smart_contract_signatures as ContractDetail["signatures"]) ?? [],
        events,
      };
    },
  });

  useEffect(() => {
    if (!contractId || !enabled) return;
    const channel = sb
      .channel(`inst_contract_${contractId}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "smart_contracts", filter: `id=eq.${contractId}` },
        () => void qc.invalidateQueries({ queryKey: instKeys.contract(contractId) }),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [contractId, enabled, qc]);

  return query;
}

/** Verificaciones de identidad de quien firma (RETHUS / NIT / representante legal). */
export function useSignerReadiness(
  contractId: string | null | undefined,
  userId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: instKeys.readiness(contractId ?? "", userId ?? ""),
    enabled: enabled && !!contractId && !!userId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("contract_signer_readiness", {
        p_contract_id: contractId,
        p_user: userId,
      });
      if (error) throw error;
      return parseReadiness(data);
    },
  });
}

/** Recalcula en el servidor la huella de los términos, la cadena de eventos y cada firma. */
export function useContractIntegrity(contractId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: instKeys.integrity(contractId ?? ""),
    enabled: enabled && !!contractId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("verify_contract_integrity", {
        p_contract_id: contractId,
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        terms_hash_ok: boolean;
        events_ok: boolean;
        signatures_ok: boolean;
        event_count: number;
        terms_hash: string;
        checked_at: string;
      };
    },
  });
}
