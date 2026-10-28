// "Mis pedidos": servicios activos de la familia o de la EPS/IPS (desde «Pedido» hasta «Cuidando»), con el mismo
// indicador de pasos y un botón grande al seguimiento. Se actualiza en vivo. Como en inDrive, mientras el pedido
// espera respuesta se ve cuánto lleva esperando y, si tarda, la opción de pedir a otro profesional.
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, MapPin, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchPublicProfessionals } from "@/hooks/use-public-professionals";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { useNow } from "@/hooks/use-now";
import { ACTIVE_STATUSES } from "@/lib/family-journey";
import { isWaitingTooLong, waitingLabel } from "@/lib/serviceFlow";
import { JourneySteps } from "./JourneySteps";

type Row = {
  id: string;
  status: string;
  scheduled_at: string;
  created_at: string;
  total_amount: number;
  professional_id: string;
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

/** En vivo primero (Cuidando, En camino), luego aceptados y al final los que esperan respuesta. */
const RANK: Record<string, number> = { in_progress: 0, in_route: 1, confirmed: 2, pending: 3 };

export function MyBookings({ userId, title = "Mis pedidos" }: { userId: string; title?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const now = useNow(30_000);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("service_bookings")
      .select("id, status, scheduled_at, created_at, total_amount, professional_id")
      .eq("client_id", userId)
      .in("status", [...ACTIVE_STATUSES])
      .order("scheduled_at", { ascending: true })
      .limit(8);
    const list = ((data ?? []) as Row[]).sort(
      (a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9),
    );
    setRows(list);
    const ids = [...new Set(list.map((r) => r.professional_id))];
    if (ids.length) {
      // Nombres por la función segura del directorio (la vista antigua solo mostraba a quien ya se había contratado).
      const profs = await fetchPublicProfessionals({ ids }).catch(() => []);
      setNames(Object.fromEntries(profs.map((p) => [p.user_id, p.full_name ?? ""])));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh(
    `my-bookings-${userId}`,
    [{ table: "service_bookings", filter: `client_id=eq.${userId}` }],
    load,
  );

  if (rows.length === 0) return null;

  return (
    <section
      id="mis-pedidos"
      aria-labelledby="my-bookings-title"
      className="scroll-mt-44 space-y-3"
    >
      <h2
        id="my-bookings-title"
        className="flex items-center gap-2 font-display text-2xl font-bold"
      >
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" />
        </span>
        {title}
      </h2>
      <ul className="space-y-3" aria-live="polite">
        {rows.map((r) => {
          const name = names[r.professional_id] || "Tu profesional";
          const pending = r.status === "pending";
          const tooLong = isWaitingTooLong(r.status, r.created_at, now);
          return (
            <li
              key={r.id}
              className="rounded-[2rem] border-2 border-trust/20 bg-card p-5 shadow-lg shadow-trust/5"
            >
              <JourneySteps status={r.status} proName={name} compact />
              {pending && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  Enviado {waitingLabel(r.created_at, now)} · te avisamos al instante
                </p>
              )}
              {tooLong && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-copper/30 bg-copper/5 p-3">
                  <p className="text-sm">
                    ¿{name.split(" ")[0]} no responde? Puedes pedirle a otro profesional cercano.
                  </p>
                  <Link
                    to="/buscar"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-copper/40 bg-card px-4 text-sm font-bold text-copper active:scale-95"
                  >
                    <Search className="h-4 w-4" aria-hidden="true" /> Pedir a otro
                  </Link>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-base text-muted-foreground">
                  {new Date(r.scheduled_at).toLocaleString("es-CO", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · <strong className="text-foreground">{COP(r.total_amount)}</strong>
                </p>
                <Link
                  to="/servicio/$bookingId"
                  params={{ bookingId: r.id }}
                  className="inline-flex min-h-14 items-center gap-2 rounded-2xl bg-trust px-5 text-base font-bold text-trust-foreground shadow-md active:scale-95"
                >
                  <MapPin className="h-5 w-5" aria-hidden="true" />
                  {pending ? "Ver pedido" : "Seguir en vivo"}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
