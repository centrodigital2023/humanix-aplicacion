// SOS: envío del aviso, contacto de emergencia y lista de alertas en vivo.
//
// Todo lo que decide la seguridad vive en la base (20261012160000_sos_familiar.sql y 20261012170000_sos_feed.sql): quién puede
// pulsar el SOS de quién, la guarda anti-abuso, a quién se avisa dentro de la app y quién puede ver y atender cada alerta. Estos
// hooks solo piden y presentan. Tablas y funciones nuevas aún no están en los tipos generados, por eso el cliente se tipa a mano.

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  SOS_ACTION_STATUS,
  classifySosError,
  isCoord,
  sortSosAlerts,
  type SosAction,
  type SosAlertRow,
  type SosStatus,
} from "@/lib/sos";

const sb = supabase as unknown as SupabaseClient;

export const sosKeys = {
  alerts: (uid: string) => ["sos", "alerts", uid] as const,
  contact: (uid: string) => ["sos", "contact", uid] as const,
};

// ─── Ubicación ───────────────────────────────────────────────────────────────

export interface Place {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
}

const NO_PLACE: Place = { lat: null, lng: null, accuracy: null };

/** Posición del dispositivo (máx. 4 s). Sin permiso o sin GPS devuelve nulos: el SOS se envía igual. */
export function getCurrentPlace(timeoutMs = 4000): Promise<Place> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(NO_PLACE);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const { latitude: lat, longitude: lng, accuracy } = p.coords;
        resolve(
          isCoord(lat, lng)
            ? { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null }
            : NO_PLACE,
        );
      },
      () => resolve(NO_PLACE),
      { timeout: timeoutMs, enableHighAccuracy: true, maximumAge: 10_000 },
    );
  });
}

// ─── Envío ───────────────────────────────────────────────────────────────────

export interface SosSendResult {
  status: SosStatus;
  place: Place;
  /** A cuántas personas avisó la base dentro de la app (lo cuenta ella, no el cliente). */
  inappNotified: number;
  /** La función de WhatsApp ya confirmó su envío (solo si el aviso automático está configurado). */
  whatsappAuto: boolean;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envía el SOS. La base aplica las reglas (quién, cuántos, con qué datos) y avisa; aquí solo se arma el alta con la ubicación y,
 * pasado un instante, se relee la fila UNA vez para decirle a la persona a cuántas personas se avisó de verdad.
 */
export async function sendSos(input: {
  patientId: string;
  bookingId?: string | null;
  /** Para pruebas: sustituye la lectura del GPS. */
  place?: Place;
}): Promise<SosSendResult> {
  const place = input.place ?? (await getCurrentPlace());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "denied", place, inappNotified: 0, whatsappAuto: false };

  const { data, error } = await sb
    .from("clinical_alerts")
    .insert({
      patient_id: input.patientId,
      booking_id: input.bookingId ?? null,
      alert_type: "sos_manual",
      severity: "critical",
      status: "active",
      lat: place.lat,
      lng: place.lng,
      accuracy_m: place.accuracy,
      triggered_by: user.id,
    })
    .select("id")
    .single();
  if (error) {
    // El detalle técnico va a la consola: en una emergencia la persona necesita saber qué hacer, no leer un error de la base.
    console.error("[sendSos]", error);
    return { status: classifySosError(error), place, inappNotified: 0, whatsappAuto: false };
  }

  // La base cuenta los avisos justo después del alta (disparador): se relee una vez, y otra más tarde por si el WhatsApp
  // automático (si está configurado) tarda un poco más.
  let inappNotified = 0;
  let whatsappAuto = false;
  for (const delay of [1200, 3000]) {
    await wait(delay);
    const { data: row } = await sb
      .from("clinical_alerts")
      .select("inapp_notified, notified_whatsapp")
      .eq("id", (data as { id: string }).id)
      .maybeSingle();
    if (row) {
      inappNotified = Number((row as { inapp_notified?: number }).inapp_notified ?? 0);
      whatsappAuto = !!(row as { notified_whatsapp?: boolean }).notified_whatsapp;
      if (whatsappAuto) break;
    }
  }
  return { status: "sent", place, inappNotified, whatsappAuto };
}

// ─── Contacto de emergencia ──────────────────────────────────────────────────

export interface EmergencyContact {
  name: string | null;
  phone: string | null;
  patientName: string | null;
}

/** Contacto de emergencia que la familia guardó en su perfil (solo lo lee su dueña). */
export function useEmergencyContact(patientId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: sosKeys.contact(patientId ?? ""),
    enabled: !!patientId && enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EmergencyContact | null> => {
      const { data, error } = await sb
        .from("family_profiles")
        .select("emergency_contact_name, emergency_contact_phone, patient_name")
        .eq("user_id", patientId)
        .maybeSingle();
      if (error || !data) return null;
      const r = data as {
        emergency_contact_name?: string;
        emergency_contact_phone?: string;
        patient_name?: string;
      };
      return {
        name: r.emergency_contact_name ?? null,
        phone: r.emergency_contact_phone ?? null,
        patientName: r.patient_name ?? null,
      };
    },
  });
}

// ─── Lista de alertas ────────────────────────────────────────────────────────

/** `42883` (función inexistente) o `PGRST202`: la base aún no tiene la lista; no es un fallo para la persona. */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42883" ||
    err.code === "PGRST202" ||
    /could not find the function/i.test(err.message ?? "")
  );
}

/**
 * Alertas SOS que quien mira puede ver (círculo, profesional del servicio, institución, la propia persona). En vivo: Realtime
 * avisa cuando cambia una alerta (`clinical_alerts`, ya filtrada por las políticas) o llega un aviso nuevo a la campana.
 */
export function useSosAlerts(userId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: sosKeys.alerts(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<SosAlertRow[]> => {
      const { data, error } = await sb.rpc("my_sos_alerts", { p_limit: 20 });
      if (error) {
        if (isMissingFunction(error)) return [];
        throw error;
      }
      return sortSosAlerts((data ?? []) as SosAlertRow[]);
    },
  });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: sosKeys.alerts(userId ?? "") });
  }, [qc, userId]);
  useRealtimeRefresh(
    "sos-alerts",
    [
      { table: "clinical_alerts" },
      { table: "notifications", event: "INSERT", filter: `user_id=eq.${userId}` },
    ],
    refresh,
    !!userId && enabled,
  );
  return query;
}

/** Atender una alerta: «ya voy», resuelta o falsa alarma. La base pone quién y cuándo, y no deja reabrir una cerrada. */
export function useSosAction(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; action: SosAction }) => {
      const { data, error } = await sb
        .from("clinical_alerts")
        .update({ status: SOS_ACTION_STATUS[input.action] })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("No tienes permiso para atender esta alerta.");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: sosKeys.alerts(userId ?? "") });
    },
  });
}
