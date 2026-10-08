import { useMemo, useState } from "react";
import {
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  Link2,
  Loader2,
  Mail,
  Phone,
  Sparkles,
  User,
  UserMinus,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findRelatedTickets, FIRST_RESPONSE_HOURS, normalizePriority } from "@/lib/pqrsRules";
import { functionErrorMessage } from "./errors";
import {
  PRIORITY_LABEL,
  SAFETY_LABEL,
  SENTIMENT_LABEL,
  STATUS_LABEL,
  TOPIC_LABEL,
  TYPE_LABEL,
  relativeTime,
  shortDate,
} from "./format";
import type { TicketInsight } from "./insights";
import { ReplyEditor } from "./ReplyEditor";
import { TicketTimeline } from "./TicketTimeline";
import type { TicketRow } from "./types";

const sb = supabase as unknown as SupabaseClient;

const SLA_STYLE = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  at_risk: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  breached: "border-red-500/40 bg-red-500/10 text-red-700",
  closed: "border-border bg-muted text-muted-foreground",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
} as const;

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-600 text-white",
  high: "bg-copper text-copper-foreground",
  normal: "bg-secondary text-secondary-foreground",
  low: "bg-muted text-muted-foreground",
};

interface Props {
  ticket: TicketRow;
  insight: TicketInsight;
  allTickets: TicketRow[];
  userId: string;
  staffNames: Map<string, string>;
  now: number;
  onChanged: () => void;
}

export function TicketCard({
  ticket,
  insight,
  allTickets,
  userId,
  staffNames,
  now,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [version, setVersion] = useState(0);
  const { sla } = insight;
  const priority = ticket.ai_priority ? normalizePriority(ticket.ai_priority) : null;
  const mine = ticket.assigned_to === userId;

  const related = useMemo(() => {
    if (!open) return [];
    const base = (t: TicketRow) => ({
      id: t.id,
      subject: t.subject,
      description: t.description,
      contact_email: t.contact_email,
      contact_phone: t.contact_phone,
      user_id: t.user_id,
      created_at: t.created_at,
    });
    const byId = new Map(allTickets.map((t) => [t.id, t]));
    return findRelatedTickets(base(ticket), allTickets.map(base)).flatMap((r) => {
      const t = byId.get(r.id);
      return t ? [{ ...r, ticket: t }] : [];
    });
  }, [open, ticket, allTickets]);

  const patch = async (fields: Record<string, unknown>, okMessage?: string) => {
    const { error } = await sb.from("pqrs_tickets").update(fields).eq("id", ticket.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (okMessage) toast.success(okMessage);
    setVersion((v) => v + 1);
    onChanged();
    return true;
  };

  const classify = async () => {
    setClassifying(true);
    const { error } = await supabase.functions.invoke("pqrs-classifier", {
      body: { ticket_id: ticket.id },
    });
    setClassifying(false);
    if (error) {
      toast.error(await functionErrorMessage(error, "No se pudo clasificar"));
      return;
    }
    toast.success("Ticket clasificado por IA");
    onChanged();
  };

  const markDuplicate = async (primary: TicketRow) => {
    if (
      !window.confirm(
        `¿Marcar ${ticket.radicado} como duplicado de ${primary.radicado} y cerrarlo?`,
      )
    )
      return;
    await patch(
      {
        duplicate_of: primary.id,
        status: "closed",
        resolution: `Duplicado de ${primary.radicado}. Se atiende en esa solicitud.`,
      },
      "Marcado como duplicado",
    );
  };

  const legalText =
    sla.legalState === "closed"
      ? "Cerrado"
      : sla.legalState === "breached"
        ? `Plazo vencido hace ${Math.abs(sla.legalRemainingBusinessDays)} día(s) hábil(es)`
        : sla.legalRemainingBusinessDays === 0
          ? "Vence hoy"
          : `Vence en ${sla.legalRemainingBusinessDays} día(s) hábil(es) · ${shortDate(sla.legalDueAt)}`;

  const firstText =
    sla.firstResponseState === "done"
      ? ticket.first_response_at
        ? `Atendido ${relativeTime(ticket.first_response_at, now)}`
        : "En trámite"
      : sla.firstResponseState === "closed"
        ? null
        : sla.firstResponseState === "breached"
          ? `Sin primera respuesta (objetivo ${FIRST_RESPONSE_HOURS[priority ?? "normal"]} h)`
          : `Primera respuesta antes de ${shortDate(sla.firstResponseDueAt)}`;

  const critical = ticket.safety_level === "critical";

  return (
    <Card
      className={`p-5 ${critical && insight.active ? "border-red-500/50 bg-red-500/[0.03]" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {ticket.radicado ?? "sin radicado"}
            </span>
            <h3 className="font-semibold">{ticket.subject}</h3>
            <Badge variant="outline" className="text-[10px]">
              {TYPE_LABEL[ticket.type ?? ""] ?? ticket.type}
            </Badge>
            {priority ? (
              <Badge className={`text-[10px] ${PRIORITY_BADGE[priority]}`}>
                {PRIORITY_LABEL[priority]}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Sin clasificar
              </Badge>
            )}
            {ticket.ai_category && (
              <Badge variant="outline" className="text-[10px]">
                {TOPIC_LABEL[ticket.ai_category] ?? ticket.ai_category}
              </Badge>
            )}
            {ticket.ai_sentiment &&
              (ticket.ai_sentiment === "negative" || ticket.ai_sentiment === "very_negative") && (
                <Badge variant="outline" className="text-[10px]">
                  {SENTIMENT_LABEL[ticket.ai_sentiment]}
                </Badge>
              )}
            {ticket.duplicate_of && (
              <Badge variant="outline" className="text-[10px]">
                Duplicado
              </Badge>
            )}
          </div>

          {ticket.safety_level && ticket.safety_level !== "none" && (
            <p
              role={critical ? "alert" : undefined}
              className={`mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                critical
                  ? "border-red-500/50 bg-red-500/10 text-red-700"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700"
              }`}
            >
              <AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" />
              {critical ? "Seguridad crítica" : "Seguridad por revisar"}:{" "}
              {(ticket.safety_categories ?? []).map((c) => SAFETY_LABEL[c] ?? c).join(", ") ||
                "señales detectadas"}
            </p>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            {ticket.contact_name || "Anónimo"} · {relativeTime(ticket.created_at, now)}
            {ticket.assigned_to &&
              ` · ${mine ? "asignado a ti" : `asignado a ${staffNames.get(ticket.assigned_to) ?? "otra persona"}`}`}
          </p>
          <p className="mt-1 line-clamp-3 text-xs text-foreground/80">
            {ticket.ai_summary || ticket.description}
          </p>

          {insight.active && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className={`rounded-full border px-2 py-0.5 ${SLA_STYLE[sla.legalState]}`}>
                  {legalText}
                </span>
                {firstText && (
                  <span
                    className={`rounded-full border px-2 py-0.5 ${SLA_STYLE[sla.firstResponseState]}`}
                  >
                    {firstText}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Progress
                  value={sla.riskScore}
                  className="h-1.5 w-28"
                  aria-label={`Riesgo de incumplimiento ${sla.riskScore} de 100`}
                />
                <span className="text-[11px] text-muted-foreground">
                  Riesgo de incumplimiento {sla.riskScore}/100
                  {sla.reasons.length > 0 && ` · ${sla.reasons.slice(0, 2).join(" · ")}`}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <Select
            value={ticket.status}
            onValueChange={(v) => patch({ status: v }, "Estado actualizado")}
          >
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Estado del ticket">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              patch(
                { assigned_to: mine ? null : userId },
                mine ? "Asignación retirada" : "Caso asignado a ti",
              )
            }
          >
            {mine ? (
              <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <User className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {mine ? "Soltar caso" : "Asignarme"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={classify}
            disabled={classifying}
            className="gap-1.5"
          >
            {classifying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-biosensor" aria-hidden="true" />
            )}
            {ticket.ai_summary ? "Reclasificar" : "Clasificar IA"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="gap-1"
          >
            {open ? "Ocultar" : "Gestionar"}{" "}
            {open ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-5 border-t border-border pt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Solicitud completa
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{ticket.description}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {ticket.contact_email && (
                <a
                  href={`mailto:${ticket.contact_email}`}
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" /> {ticket.contact_email}
                </a>
              )}
              {ticket.contact_phone && (
                <a
                  href={`tel:${ticket.contact_phone}`}
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {ticket.contact_phone}
                </a>
              )}
            </div>
          </div>

          {related.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Solicitudes relacionadas
              </p>
              <ul className="mt-1 space-y-1.5">
                {related.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-xs"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-muted-foreground">{r.ticket.radicado}</span>{" "}
                      {r.ticket.subject}{" "}
                      <span className="text-muted-foreground">
                        · {Math.round(r.score * 100)}% de similitud ·{" "}
                        {r.reason === "same_contact_similar_text"
                          ? "mismo contacto y tema"
                          : r.reason === "same_contact"
                            ? "mismo contacto"
                            : "texto similar"}
                        {r.probableDuplicate ? " · probable duplicado" : ""}
                      </span>
                    </span>
                    {insight.active && !ticket.duplicate_of && (
                      <Button size="sm" variant="outline" onClick={() => markDuplicate(r.ticket)}>
                        Es duplicado de este
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Sugerencia automática: la fusión siempre la decide una persona.
              </p>
            </div>
          )}

          <ReplyEditor
            key={`${ticket.id}-${ticket.status}-${ticket.resolution ? 1 : 0}`}
            ticket={ticket}
            onChanged={onChanged}
          />
          <TicketTimeline ticketId={ticket.id} refreshKey={version} />
        </div>
      )}
    </Card>
  );
}
