import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Sparkles, TrendingUp } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { computePqrsKpis } from "@/lib/pqrsKpis";
import { categoryTrends, normalizeText, toCsv } from "@/lib/pqrsRules";
import { functionErrorMessage } from "./errors";
import {
  PRIORITY_LABEL,
  SAFETY_LABEL,
  SENTIMENT_LABEL,
  STATUS_LABEL,
  TOPIC_LABEL,
  TYPE_LABEL,
  formatHours,
  formatPct,
} from "./format";
import type { TicketInsight } from "./insights";
import { TicketCard } from "./TicketCard";
import type { TicketRow } from "./types";

const sb = supabase as unknown as SupabaseClient;
const PAGE = 20;
const BATCH_LIMIT = 20;

type Filter = "active" | "critical" | "sla" | "unassigned" | "mine" | "closed" | "all";
type Sort = "risk" | "recent";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "active", label: "Activos" },
  { id: "critical", label: "Críticos" },
  { id: "sla", label: "Vencidos o en riesgo" },
  { id: "unassigned", label: "Sin asignar" },
  { id: "mine", label: "Mis casos" },
  { id: "closed", label: "Cerrados" },
  { id: "all", label: "Todos" },
];

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "bad";
}) {
  return (
    <Card className="p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 font-display text-xl font-bold ${tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : ""}`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

interface Props {
  tickets: TicketRow[];
  insights: Map<string, TicketInsight>;
  userId: string;
  search: string;
  now: number;
  onChanged: () => void;
}

export function PqrsPanel({ tickets, insights, userId, search, now, onChanged }: Props) {
  const [filter, setFilter] = useState<Filter>("active");
  const [sort, setSort] = useState<Sort>("risk");
  const [limit, setLimit] = useState(PAGE);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  // Nombres de quienes tienen casos asignados (para no mostrar identificadores).
  const assignedIds = useMemo(
    () => [...new Set(tickets.map((t) => t.assigned_to).filter((x): x is string => !!x))],
    [tickets],
  );
  useEffect(() => {
    if (!assignedIds.length) return;
    let active = true;
    sb.from("profiles")
      .select("user_id,full_name,email")
      .in("user_id", assignedIds)
      .then(({ data }) => {
        if (!active) return;
        setStaffNames(
          new Map(
            (
              (data ?? []) as Array<{
                user_id: string;
                full_name: string | null;
                email: string | null;
              }>
            ).map((p) => [p.user_id, p.full_name ?? p.email ?? "otra persona"]),
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [assignedIds]);

  const q = normalizeText(search);
  const searched = useMemo(
    () =>
      tickets.filter(
        (t) =>
          !q ||
          normalizeText(
            `${t.subject} ${t.radicado ?? ""} ${t.contact_name ?? ""} ${t.contact_email ?? ""} ${t.ai_summary ?? ""}`,
          ).includes(q),
      ),
    [tickets, q],
  );

  const kpis = useMemo(() => computePqrsKpis(tickets, now), [tickets, now]);
  const trends = useMemo(
    () =>
      categoryTrends(tickets, now)
        .filter((t) => t.current > 0)
        .slice(0, 5),
    [tickets, now],
  );

  const matches = (t: TicketRow, f: Filter) => {
    const i = insights.get(t.id);
    if (!i) return false;
    switch (f) {
      case "active":
        return i.active;
      case "critical":
        return i.active && (t.safety_level === "critical" || t.ai_priority === "urgent");
      case "sla":
        return i.active && (i.sla.legalState === "breached" || i.sla.legalState === "at_risk");
      case "unassigned":
        return i.active && !t.assigned_to;
      case "mine":
        return i.active && t.assigned_to === userId;
      case "closed":
        return !i.active;
      default:
        return true;
    }
  };

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, searched.filter((t) => matches(t, f.id)).length]),
      ) as Record<Filter, number>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searched, insights, userId],
  );

  const visible = useMemo(() => {
    const list = searched.filter((t) => matches(t, filter));
    // Las señales de seguridad críticas van siempre primero; después, por riesgo de incumplimiento.
    const safetyFirst = (t: TicketRow) =>
      insights.get(t.id)?.active && t.safety_level === "critical" ? 1 : 0;
    return list.sort((a, b) =>
      sort === "risk"
        ? safetyFirst(b) - safetyFirst(a) ||
          (insights.get(b.id)?.sla.riskScore ?? 0) - (insights.get(a.id)?.sla.riskScore ?? 0) ||
          b.created_at.localeCompare(a.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, insights, filter, sort, userId]);

  const unclassified = useMemo(
    () => tickets.filter((t) => insights.get(t.id)?.active && !t.ai_summary),
    [tickets, insights],
  );

  const classifyPending = async () => {
    const queue = unclassified.slice(0, BATCH_LIMIT);
    if (!queue.length) return;
    if (
      !window.confirm(
        `Se clasificarán ${queue.length} ticket(s) con IA (1 crédito IA cada uno). ¿Continuar?`,
      )
    )
      return;
    setBatch({ done: 0, total: queue.length });
    let ok = 0;
    for (const t of queue) {
      const { error } = await supabase.functions.invoke("pqrs-classifier", {
        body: { ticket_id: t.id },
      });
      if (error) {
        toast.error(
          `Se detuvo la clasificación: ${await functionErrorMessage(error, "error de la IA")}`,
        );
        break;
      }
      ok++;
      setBatch({ done: ok, total: queue.length });
    }
    setBatch(null);
    if (ok) toast.success(`${ok} ticket(s) clasificados`);
    onChanged();
  };

  const exportCsv = () => {
    const rows = visible.map((t) => {
      const sla = insights.get(t.id)?.sla;
      return {
        radicado: t.radicado,
        creado: t.created_at,
        tipo: TYPE_LABEL[t.type ?? ""] ?? t.type,
        tema: TOPIC_LABEL[t.ai_category ?? ""] ?? t.ai_category,
        prioridad: PRIORITY_LABEL[t.ai_priority ?? ""] ?? "",
        sentimiento: SENTIMENT_LABEL[t.ai_sentiment ?? ""] ?? "",
        seguridad: (t.safety_categories ?? []).map((c) => SAFETY_LABEL[c] ?? c).join("; "),
        estado: STATUS_LABEL[t.status] ?? t.status,
        vence: sla?.legalDueAt,
        primera_respuesta: t.first_response_at,
        resuelto: t.resolved_at,
        nombre: t.contact_name,
        correo: t.contact_email,
        telefono: t.contact_phone,
        asunto: t.subject,
        resumen: t.ai_summary,
      };
    });
    const csv = toCsv(rows, [
      { key: "radicado", header: "Radicado" },
      { key: "creado", header: "Creado" },
      { key: "tipo", header: "Tipo" },
      { key: "tema", header: "Tema" },
      { key: "prioridad", header: "Prioridad" },
      { key: "sentimiento", header: "Sentimiento" },
      { key: "seguridad", header: "Señales de seguridad" },
      { key: "estado", header: "Estado" },
      { key: "vence", header: "Plazo de respuesta" },
      { key: "primera_respuesta", header: "Primera respuesta" },
      { key: "resuelto", header: "Resuelto" },
      { key: "nombre", header: "Nombre" },
      { key: "correo", header: "Correo" },
      { key: "telefono", header: "Teléfono" },
      { key: "asunto", header: "Asunto" },
      { key: "resumen", header: "Resumen" },
    ]);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pqrs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(
      `${rows.length} solicitud(es) exportadas. Contienen datos personales: trátalas conforme a Habeas Data.`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Activos" value={String(kpis.active)} />
        <Stat
          label="Plazo vencido"
          value={String(kpis.breached)}
          tone={kpis.breached ? "bad" : undefined}
        />
        <Stat
          label="En riesgo"
          value={String(kpis.atRisk)}
          tone={kpis.atRisk ? "warn" : undefined}
        />
        <Stat
          label="Mediana 1.ª respuesta"
          value={formatHours(kpis.medianFirstResponseHours)}
          sub={`${kpis.sampleFirstResponse} casos`}
        />
        <Stat
          label="Resueltos a tiempo"
          value={formatPct(kpis.onTimeRate)}
          sub={`${kpis.sampleResolved} cerrados`}
        />
        <Stat
          label="Borradores IA sin editar"
          value={formatPct(kpis.draftAcceptRate)}
          sub={`${kpis.sampleDrafts} con borrador`}
        />
      </div>

      {trends.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Últimos 7 días:
          </span>
          {trends.map((t) => (
            <span
              key={t.key}
              className={`rounded-full border px-2.5 py-0.5 ${t.spike ? "border-red-500/40 bg-red-500/10 text-red-700" : "border-border"}`}
            >
              {TOPIC_LABEL[t.key] ?? TYPE_LABEL[t.key] ?? t.key} · {t.current}
              {t.changePct !== null
                ? ` (${t.changePct >= 0 ? "+" : ""}${t.changePct}%)`
                : t.previous === 0 && t.current > 0
                  ? " (nuevo)"
                  : ""}
              {t.spike ? " ▲ pico" : ""}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar PQRS">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setLimit(PAGE);
              }}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === f.id
                  ? "border-biosensor bg-biosensor/10 text-biosensor"
                  : "border-border hover:bg-muted"
              }`}
            >
              {f.label} <span className="text-muted-foreground">({counts[f.id]})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Ordenar por
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="risk">Seguridad y riesgo de incumplimiento</option>
              <option value="recent">Más recientes</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={classifyPending}
            disabled={!unclassified.length || !!batch}
            className="gap-1.5"
          >
            {batch ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-biosensor" aria-hidden="true" />
            )}
            {batch
              ? `Clasificando ${batch.done}/${batch.total}…`
              : `Clasificar pendientes (${unclassified.length})`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={!visible.length}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Exportar CSV
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {tickets.length === 0 ? (
            <>
              Aún no hay solicitudes. Las personas pueden radicarlas desde{" "}
              <strong>/contacto</strong> y llegan aquí con su plazo, su prioridad y sus señales de
              seguridad.
            </>
          ) : (
            "Ninguna solicitud coincide con este filtro."
          )}
        </Card>
      ) : (
        <>
          {visible.slice(0, limit).map((t) => {
            const insight = insights.get(t.id);
            if (!insight) return null;
            return (
              <TicketCard
                key={t.id}
                ticket={t}
                insight={insight}
                allTickets={tickets}
                userId={userId}
                staffNames={staffNames}
                now={now}
                onChanged={onChanged}
              />
            );
          })}
          {visible.length > limit && (
            <div className="text-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar más ({visible.length - limit} restantes)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
