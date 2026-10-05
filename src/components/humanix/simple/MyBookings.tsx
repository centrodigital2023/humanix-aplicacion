// "Mis pedidos": servicios activos de la familia, con el mismo indicador de
// pasos y un botón grande al seguimiento en el mapa. Se actualiza en vivo.
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { ACTIVE_STATUSES } from "@/lib/family-journey";
import { JourneySteps } from "./JourneySteps";

type Row = {
  id: string;
  status: string;
  scheduled_at: string;
  total_amount: number;
  professional_id: string;
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

export function MyBookings({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("service_bookings")
      .select("id, status, scheduled_at, total_amount, professional_id")
      .eq("client_id", userId)
      .in("status", [...ACTIVE_STATUSES])
      .order("scheduled_at", { ascending: true })
      .limit(5);
    const list = (data ?? []) as Row[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.professional_id))];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("public_profiles_safe")
        .select("user_id, full_name")
        .in("user_id", ids);
      setNames(Object.fromEntries((profs ?? []).map((p) => [p.user_id ?? "", p.full_name ?? ""])));
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
    <section aria-labelledby="my-bookings-title" className="space-y-3">
      <h2 id="my-bookings-title" className="font-display text-2xl font-bold">
        Mis pedidos
      </h2>
      <ul className="space-y-3">
        {rows.map((r) => {
          const name = names[r.professional_id] || "Tu profesional";
          return (
            <li
              key={r.id}
              className="rounded-[2rem] border-2 border-trust/20 bg-card p-5 shadow-lg shadow-trust/5"
            >
              <JourneySteps status={r.status} proName={name} compact />
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
                  Ver en el mapa
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
