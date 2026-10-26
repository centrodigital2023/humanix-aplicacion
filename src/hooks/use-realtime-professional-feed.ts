import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pendingBookingsKey } from "@/hooks/use-pending-bookings";
import { playAlertSound, showSystemNotification } from "@/lib/alertSound";
import {
  isRecent,
  liveAlertFromBooking,
  liveAlertFromNotification,
  pushAlert,
  type LiveAlert,
  type NotificationRow,
  type PendingBookingRow,
} from "@/lib/serviceFlow";

const DISMISSED_KEY = "humanix-dismissed-live-alerts";

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(keys: Set<string>) {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys].slice(-100)));
  } catch {
    /* sin almacenamiento: solo se olvida al recargar */
  }
}

type BookingRow = PendingBookingRow & { status: string };

/**
 * Alertas en vivo de toda la app (montado una sola vez en la raíz).
 *
 * - Profesional: cada solicitud nueva (familia o EPS/IPS) llega al instante por dos vías que comparten
 *   clave —el aviso de `notifications` y el INSERT en `service_bookings`—, así basta con que llegue una.
 *   Si la solicitud deja de estar pendiente (la aceptó, la cancelaron), la alerta se va sola.
 * - Familia, EPS/IPS y círculo: Aceptado, En camino, Cuidando, Terminado y alertas del parte.
 * - Al (re)conectar se recupera lo perdido: solicitudes aún pendientes y avisos de los últimos minutos.
 *
 * Realtime respeta RLS: cada quien solo recibe sus filas.
 */
export function useRealtimeProfessionalFeed(userId: string | null, isProfessional: boolean) {
  const qc = useQueryClient();
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const stackRef = useRef<LiveAlert[]>([]);
  const dismissedRef = useRef<Set<string>>(new Set());
  const announcedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    dismissedRef.current = loadDismissed();
  }, []);

  const commit = (next: LiveAlert[]) => {
    stackRef.current = next;
    setAlerts(next);
  };

  const add = useCallback((alert: LiveAlert, announce: boolean) => {
    const next = pushAlert(stackRef.current, alert, dismissedRef.current);
    if (next === stackRef.current) return;
    commit(next);
    if (announce && !announcedRef.current.has(alert.key)) {
      announcedRef.current.add(alert.key);
      playAlertSound(alert.tone);
      showSystemNotification(alert.title, alert.body, alert.link);
    }
  }, []);

  const remove = useCallback((key: string) => {
    if (!stackRef.current.some((a) => a.key === key)) return;
    commit(stackRef.current.filter((a) => a.key !== key));
  }, []);

  const dismiss = useCallback(
    (key: string) => {
      dismissedRef.current.add(key);
      saveDismissed(dismissedRef.current);
      remove(key);
    },
    [remove],
  );

  useEffect(() => {
    if (!userId) {
      commit([]);
      return;
    }
    let active = true;

    const catchUp = async () => {
      const now = Date.now();
      const since = new Date(now - 15 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("notifications")
        .select("id, type, title, body, link, meta, read_at, created_at")
        .eq("user_id", userId)
        .is("read_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(20);
      if (!active) return;
      for (const n of (recent ?? []) as NotificationRow[]) {
        const alert = liveAlertFromNotification(n);
        if (alert) add(alert, isRecent(n.created_at, now, 2 * 60 * 1000));
      }
      if (!isProfessional) return;
      const { data: pending } = await supabase
        .from("service_bookings")
        .select("id, duration_hours, total_amount, payment_mode, created_at")
        .eq("professional_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(10);
      if (!active) return;
      for (const b of (pending ?? []) as PendingBookingRow[]) {
        add(liveAlertFromBooking(b), isRecent(b.created_at, now, 2 * 60 * 1000));
      }
    };

    // Nombre único por montaje: supabase-js reutiliza canales por nombre (StrictMode, reconexión).
    let channel = supabase
      .channel(`live-feed-${userId}-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const alert = liveAlertFromNotification(payload.new as NotificationRow);
          if (alert) add(alert, true);
        },
      );

    if (isProfessional) {
      channel = channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "service_bookings",
            filter: `professional_id=eq.${userId}`,
          },
          (payload) => {
            const row = payload.new as BookingRow;
            void qc.invalidateQueries({ queryKey: pendingBookingsKey(userId) });
            if (row.status === "pending") add(liveAlertFromBooking(row), true);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "service_bookings",
            filter: `professional_id=eq.${userId}`,
          },
          (payload) => {
            const row = payload.new as BookingRow;
            void qc.invalidateQueries({ queryKey: pendingBookingsKey(userId) });
            if (row.status !== "pending") remove(`request:${row.id}`);
          },
        );
    }

    channel.subscribe((status) => {
      // Cierra el hueco entre montar y suscribirse, y recupera lo perdido tras reconectar.
      if (status === "SUBSCRIBED") void catchUp();
    });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [userId, isProfessional, add, remove, qc]);

  return { alerts, dismiss, remove };
}
