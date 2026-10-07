// Dashboard de inversionistas — solo superadmin. Muestra KPIs y todas las respuestas.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/superadmin/validacion" as any)({
  head: () => ({ meta: [{ name: "robots", content: "noindex,nofollow" }] }),
  component: InvestorDashboard,
});

type Row = {
  id: string;
  created_at: string;
  profile_type: string;
  full_name: string | null;
  email: string | null;
  whatsapp: string | null;
  willingness_pct: number;
  total_score: number;
  promo_code: string | null;
  premium_activated: boolean;
};

const PROFILE_LABEL: Record<string, string> = {
  familia: "Familia / Usuario",
  ips_eps: "IPS / EPS",
  profesional: "Profesional",
};

function validationLevel(score: number) {
  if (score >= 22) return { label: "Altamente Validada", color: "bg-ok/15 text-ok" };
  if (score >= 15) return { label: "Ajustar", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
  return { label: "Reevaluar", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" };
}

function InvestorDashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await (supabase as any)
        .from("validation_responses")
        .select(
          "id, created_at, profile_type, full_name, email, whatsapp, willingness_pct, total_score, promo_code, premium_activated",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (active) setRows((data as Row[]) ?? []);
    })();
    return () => { active = false; };
  }, []);

  if (rows === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── KPIs ────────────────────────────────────────────────────────────────
  const total = rows.length;
  const avgScore = total ? +(rows.reduce((s, r) => s + r.total_score, 0) / total).toFixed(1) : 0;
  const avgWTP = total ? +(rows.reduce((s, r) => s + (r.willingness_pct ?? 0), 0) / total).toFixed(0) : 0;
  const premiumCount = rows.filter((r) => r.premium_activated).length;

  const byProfile = ["familia", "ips_eps", "profesional"].map((key) => {
    const subset = rows.filter((r) => r.profile_type === key);
    return {
      key,
      count: subset.length,
      pct: total ? Math.round((subset.length / total) * 100) : 0,
      avgScore: subset.length
        ? +(subset.reduce((s, r) => s + r.total_score, 0) / subset.length).toFixed(1)
        : 0,
    };
  });

  const KPIS = [
    { emoji: "📋", label: "Total respuestas", value: total.toLocaleString("es-CO") },
    { emoji: "🎯", label: "Puntaje promedio", value: `${avgScore} / 30` },
    { emoji: "💳", label: "Disposición a pagar", value: `${avgWTP}%` },
    { emoji: "🎁", label: "Premium activado", value: premiumCount.toLocaleString("es-CO") },
  ];

  return (
    <div className="min-h-screen bg-canvas p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-7xl">
        <h1 className="font-display text-3xl font-bold text-trust sm:text-4xl">
          📊 Resumen Inversionistas
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Worksheet de validación MLP — Humanix.lat
        </p>

        {/* KPI cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KPIS.map((k) => (
            <div
              key={k.label}
              className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm"
            >
              <p className="text-2xl" aria-hidden="true">{k.emoji}</p>
              <p className="mt-2 font-display text-3xl font-bold text-trust">{k.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Profile breakdown */}
        <div className="mt-6 rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          <h2 className="font-bold text-lg mb-4">Desglose por perfil</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {byProfile.map((p) => (
              <div key={p.key} className="rounded-2xl bg-muted/50 p-4">
                <p className="font-bold">{PROFILE_LABEL[p.key]}</p>
                <p className="font-display text-2xl font-bold text-trust mt-1">{p.count}</p>
                <p className="text-sm text-muted-foreground">{p.pct}% · Score medio {p.avgScore}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Full table */}
        <div className="mt-6 rounded-[1.5rem] border border-border bg-card shadow-sm overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="font-bold text-lg">Respuestas Validación</h2>
            <p className="text-sm text-muted-foreground">{total} registros totales</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Fecha", "Perfil", "Nombre / Contacto", "WTP %", "Score", "Nivel", "Premium"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-bold text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const lv = validationLevel(r.total_score);
                  return (
                    <tr key={r.id} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {PROFILE_LABEL[r.profile_type] ?? r.profile_type}
                      </td>
                      <td className="px-4 py-3 max-w-48">
                        <p className="font-semibold truncate">{r.full_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.email ?? r.whatsapp ?? "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-bold text-trust">{r.willingness_pct}%</td>
                      <td className="px-4 py-3 font-display text-xl font-bold text-trust">
                        {r.total_score}
                        <span className="text-xs font-normal text-muted-foreground"> /30</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-0.5 text-xs font-bold whitespace-nowrap ${lv.color}`}>
                          {lv.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.premium_activated ? (
                          <span className="text-ok font-bold">✅ Activo</span>
                        ) : r.promo_code ? (
                          <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{r.promo_code}</code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Aún no hay respuestas. Comparte el link <strong>/validacion</strong> para comenzar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
