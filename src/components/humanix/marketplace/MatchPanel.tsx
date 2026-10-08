import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Loader2, Send, Sparkles, Star } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { explainMatch, type OfferRow, type SuggestedPro } from "@/lib/marketplaceInsights";
import { initials } from "./format";

const sb = supabase as unknown as SupabaseClient;

export function MatchPanel({ offer }: { offer: OfferRow }) {
  const [pros, setPros] = useState<SuggestedPro[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    let active = true;
    setPros(null);
    setError(null);
    sb.rpc("suggest_professionals_for_offer", { p_offer_id: offer.id, p_limit: 8 }).then(
      ({ data, error: rpcError }) => {
        if (!active) return;
        if (rpcError) {
          setError(rpcError.message);
          setPros([]);
          return;
        }
        setPros((data ?? []) as SuggestedPro[]);
      },
    );
    return () => {
      active = false;
    };
  }, [offer.id]);

  const explained = useMemo(
    () => (pros ?? []).map((p) => ({ pro: p, ...explainMatch(offer, p) })),
    [pros, offer],
  );
  const onlyRules = (pros ?? []).length > 0 && (pros ?? []).every((p) => p.source === "reglas");

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });

  const invite = async () => {
    if (!selected.size) return;
    setInviting(true);
    const { data, error: rpcError } = await sb.rpc("invite_matching_professionals", {
      p_offer_id: offer.id,
      p_user_ids: [...selected],
    });
    setInviting(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    const sent = Number(data ?? 0);
    toast.success(`${sent} invitación(es) enviada(s)`);
    if (sent < selected.size)
      toast.info("Algunos ya habían sido invitados o alcanzaron su límite diario de invitaciones.");
    setSelected(new Set());
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-biosensor">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Profesionales sugeridos
        </p>
        {!!explained.length && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set(explained.slice(0, 3).map((e) => e.pro.user_id)))}
            >
              Elegir los 3 mejores
            </Button>
            <Button
              size="sm"
              onClick={invite}
              disabled={!selected.size || inviting}
              className="gap-1.5"
            >
              {inviting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Invitar ({selected.size})
            </Button>
          </div>
        )}
      </div>

      {pros === null && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Buscando candidatos…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          No se pudo calcular el matchmaking: {error}
        </p>
      )}
      {pros && !error && pros.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No hay profesionales publicados que cumplan al menos la especialidad o la zona de esta
          oferta.
        </p>
      )}
      {onlyRules && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Esta oferta aún no tiene representación semántica (embedding): las sugerencias usan reglas
          de especialidad, zona, disponibilidad, RETHUS y calificación.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {explained.map(({ pro, reasons, cautions }) => (
          <li key={pro.user_id} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(pro.user_id)}
                onChange={() => toggle(pro.user_id)}
                aria-label={`Seleccionar a ${pro.full_name ?? "profesional"}`}
              />
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {pro.avatar_url ? (
                  <img src={pro.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  initials(pro.full_name)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/profesional/$proId"
                    params={{ proId: pro.user_id }}
                    className="text-sm font-semibold hover:underline"
                  >
                    {pro.full_name ?? "Profesional"}
                  </Link>
                  <Badge className="text-[10px]">{pro.final_score}% compatible</Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {pro.source === "reglas" ? "Reglas" : "IA + reglas"}
                  </Badge>
                  {pro.avg_rating ? (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />{" "}
                      {Number(pro.avg_rating).toFixed(1)}
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {pro.specialty ?? "Sin especialidad"} · {pro.home_city ?? "Sin ciudad"}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {reasons.map((r) => (
                    <li
                      key={r}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700"
                    >
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {r}
                    </li>
                  ))}
                  {cautions.map((c) => (
                    <li
                      key={c}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700"
                    >
                      <AlertCircle className="h-3 w-3" aria-hidden="true" /> {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
