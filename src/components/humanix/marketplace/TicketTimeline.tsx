import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABEL, relativeTime } from "./format";

const sb = supabase as unknown as SupabaseClient;

interface EventRow {
  id: string;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

function describe(e: EventRow): string {
  switch (e.event_type) {
    case "assigned":
      return e.to_value ? "Caso asignado" : "Asignación retirada";
    case "status_changed":
      return `Estado: ${STATUS_LABEL[e.from_value ?? ""] ?? e.from_value} → ${STATUS_LABEL[e.to_value ?? ""] ?? e.to_value}`;
    case "merged":
      return "Marcado como duplicado de otra solicitud";
    case "resolution_saved":
      return e.meta?.draft_used
        ? e.meta?.draft_edited
          ? "Respuesta guardada (borrador IA editado)"
          : "Respuesta guardada (borrador IA sin editar)"
        : "Respuesta guardada";
    default:
      return e.event_type;
  }
}

export function TicketTimeline({ ticketId, refreshKey }: { ticketId: string; refreshKey: number }) {
  const [events, setEvents] = useState<EventRow[] | null>(null);

  useEffect(() => {
    let active = true;
    sb.from("pqrs_ticket_events")
      .select("id,event_type,from_value,to_value,meta,created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (active) setEvents((data ?? []) as EventRow[]);
      });
    return () => {
      active = false;
    };
  }, [ticketId, refreshKey]);

  if (events === null) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Historial
      </p>
      {events.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Sin movimientos registrados.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {events.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 text-[11px]">
              <span>{describe(e)}</span>
              <span className="shrink-0 text-muted-foreground">{relativeTime(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
