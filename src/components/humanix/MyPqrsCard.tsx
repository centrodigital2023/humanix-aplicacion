// PQRS desde el panel: la cuenta radica una petición, queja, reclamo o sugerencia (llega al equipo de Humanix, que la atiende desde
// el panel de superadmin) y sigue su estado aquí mismo. El formulario es el mismo de la página pública, con los datos de la cuenta
// ya puestos; la lectura de «Mis solicitudes» pasa por `my_pqrs_tickets` y solo trae lo que le corresponde a quien consulta.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Clock, LifeBuoy, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { PqrsForm } from "@/components/humanix/PqrsForm";
import { pqrsKeys, useMyPqrs, type MyPqrsTicket } from "@/hooks/use-my-pqrs";
import { formatLongDate } from "@/lib/formatDate";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  open: "Recibida",
  in_progress: "En trámite",
  resolved: "Resuelta",
  closed: "Cerrada",
};

const STATUS_CLASS: Record<string, string> = {
  open: "border-trust/40 bg-trust/10 text-trust",
  in_progress: "border-warn/40 bg-warn/10 text-warn",
  resolved: "border-ok/40 bg-ok/10 text-ok",
  closed: "border-border bg-muted text-muted-foreground",
};

const TYPE_LABEL: Record<string, string> = {
  peticion: "Petición",
  consulta: "Consulta",
  queja: "Queja",
  reclamo: "Reclamo",
  sugerencia: "Sugerencia",
  denuncia: "Denuncia",
};

function TicketRow({ t }: { t: MyPqrsTicket }) {
  const closed = t.status === "resolved" || t.status === "closed";
  const when = closed ? formatLongDate(t.resolved_at) : formatLongDate(t.due_at);
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{t.radicado ?? "Sin radicado"}</span>
        <span className="text-xs text-muted-foreground">{TYPE_LABEL[t.type] ?? t.type}</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
            STATUS_CLASS[t.status] ?? STATUS_CLASS.closed,
          )}
        >
          {STATUS_LABEL[t.status] ?? t.status}
        </span>
      </div>
      {t.subject && <p className="text-sm">{t.subject}</p>}
      {when && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {closed ? (
            <CheckCircle2 className="h-3 w-3 text-ok" aria-hidden />
          ) : (
            <Clock className="h-3 w-3" aria-hidden />
          )}
          {closed ? `Resuelta el ${when}` : `Respuesta a más tardar el ${when}`}
        </p>
      )}
      {closed && t.resolution && (
        <p className="rounded-lg bg-muted/60 p-2 text-xs leading-relaxed">{t.resolution}</p>
      )}
    </li>
  );
}

export function MyPqrsCard({
  userId,
  name,
  email,
  className,
}: {
  userId: string;
  name?: string | null;
  email?: string | null;
  className?: string;
}) {
  const qc = useQueryClient();
  const tickets = useMyPqrs(userId);
  const [open, setOpen] = useState(false);
  const list = tickets.data ?? [];
  const openCount = list.filter((t) => t.status === "open" || t.status === "in_progress").length;

  return (
    <Card
      className={cn("space-y-3 p-4 sm:p-5", className)}
      aria-label="Peticiones, quejas y sugerencias"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <LifeBuoy className="h-4 w-4 text-trust" aria-hidden />
            Peticiones, quejas y sugerencias
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Escríbele directamente al equipo de Humanix. Te damos un radicado y puedes seguir el
            estado aquí.
            {openCount > 0 ? ` Tienes ${openCount} en trámite.` : ""}
          </p>
        </div>
      </div>

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between sm:w-auto">
            <span className="inline-flex items-center gap-1.5">
              <MessageSquareText className="h-4 w-4" aria-hidden />
              Nueva solicitud
            </span>
            <ChevronDown
              className={cn("ml-2 h-4 w-4 transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <PqrsForm
            defaults={{
              name: name && !name.includes("@") ? name : "",
              email: email ?? "",
            }}
            onReceipt={() => void qc.invalidateQueries({ queryKey: pqrsKeys.mine(userId) })}
          />
        </CollapsibleContent>
      </Collapsible>

      {tickets.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Aún no has enviado solicitudes.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {list.map((t) => (
            <TicketRow key={t.id} t={t} />
          ))}
        </ul>
      )}
    </Card>
  );
}
