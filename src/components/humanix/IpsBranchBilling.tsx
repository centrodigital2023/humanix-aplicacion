/**
 * IpsBranchBilling — Plan IPS Mejorado: cobro por sucursales
 * ----------------------------------------------------------------------------
 * Permite a una institución (red de IPS/clínicas) gestionar sus sedes y ver,
 * en vivo, cuánto le cuesta su plan según el número de sedes activas:
 *   COP 299.000 base (incluye 1 sede + 10 profesionales)
 *   + COP  50.000 por cada sede adicional
 *   + COP   5.000 por cada profesional adicional sobre el cupo incluido
 *
 * Backend: institution_branches (migración 20260606150000_institution_branches.sql)
 * Cálculo: useInstitutionBilling() → src/lib/plans.ts (INSTITUTION_BILLING)
 */
import { useEffect, useState } from "react";
import {
  Building2,
  Plus,
  MapPin,
  Trash2,
  Crown,
  Loader2,
  Sparkles,
  CalendarRange,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useInstitutionBilling } from "@/hooks/use-institution-billing";
import { COP } from "@/lib/plans";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

interface Branch {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  is_main: boolean;
  status: "active" | "inactive";
}

export function IpsBranchBilling({ institutionId }: { institutionId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await sb
      .from("institution_branches")
      .select("id, name, city, address, is_main, status")
      .eq("institution_id", institutionId)
      .order("is_main", { ascending: false })
      .order("created_at", { ascending: true });
    setBranches((data as Branch[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = sb
      .channel(`branches:${institutionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "institution_branches", filter: `institution_id=eq.${institutionId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  const activeBranches = branches.filter((b) => b.status === "active").length;
  const billing = useInstitutionBilling(Math.max(1, activeBranches), 10, "monthly");

  // Mantener el contador de sedes sincronizado con el real de la BD
  useEffect(() => {
    if (activeBranches > 0) billing.setBranches(activeBranches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranches]);

  const addBranch = async () => {
    if (!name.trim()) {
      toast.error("Ingresa un nombre para la sede");
      return;
    }
    setSaving(true);
    try {
      const { error } = await sb.from("institution_branches").insert({
        institution_id: institutionId,
        name: name.trim(),
        city: city.trim() || null,
        address: address.trim() || null,
        is_main: false,
      });
      if (error) throw error;
      toast.success("Sede agregada. Tu plan se recalculó automáticamente.");
      setOpen(false);
      setName("");
      setCity("");
      setAddress("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo agregar la sede");
    } finally {
      setSaving(false);
    }
  };

  const removeBranch = async (branch: Branch) => {
    if (branch.is_main) {
      toast.error("La sede principal no se puede eliminar");
      return;
    }
    if (!confirm(`¿Eliminar la sede "${branch.name}"? Tu plan se recalculará.`)) return;
    try {
      const { error } = await sb.from("institution_branches").delete().eq("id", branch.id);
      if (error) throw error;
      toast.success("Sede eliminada");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  };

  return (
    <div className="space-y-4">
      {/* Hero del plan */}
      <Card className="relative overflow-hidden p-5 border-fuchsia-neural/20 bg-gradient-to-br from-fuchsia-neural/10 via-background to-biosensor/5">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-fuchsia-neural/10 blur-3xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-fuchsia-neural/15 flex items-center justify-center flex-shrink-0">
              <Crown className="h-5 w-5 text-fuchsia-neural" />
            </div>
            <div>
              <p className="text-sm font-bold font-display flex items-center gap-1.5">
                Plan IPS Mejorado
                <Badge variant="outline" className="text-[10px] gap-1 border-fuchsia-neural/30 text-fuchsia-neural">
                  <Sparkles className="h-3 w-3" /> Cobro por sucursales
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {COP(299_000)} base (1 sede) + {COP(50_000)} por cada sede adicional
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold font-display tabular-nums text-fuchsia-neural">
              {billing.totalFormatted}
            </p>
            <p className="text-[10px] text-muted-foreground">/mes · {activeBranches} sede{activeBranches !== 1 ? "s" : ""} activa{activeBranches !== 1 ? "s" : ""}</p>
          </div>
        </div>
      </Card>

      {/* Desglose de facturación */}
      <Card className="p-4 space-y-2.5">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" /> Desglose mensual
        </p>
        <div className="space-y-1.5">
          {billing.breakdown.lines.map((line, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{line.label}</span>
              <span className={cn("font-medium tabular-nums", line.amountCOP < 0 && "text-emerald-600")}>
                {line.amountCOP < 0 ? "−" : ""}{COP(Math.abs(line.amountCOP))}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
            <span className="font-semibold">Total</span>
            <span className="font-bold tabular-nums text-fuchsia-neural">{billing.totalFormatted}</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-1">
          <ShieldCheck className="h-3 w-3" />
          Prueba gratuita de {billing.trialDays} días · {billing.graceDays} días de gracia ante mora
        </p>
      </Card>

      {/* Listado de sedes */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Sedes ({branches.length})
          </p>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Agregar sede
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-fuchsia-neural" /> Nueva sede
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  Cada sede adicional se cobra a {COP(50_000)}/mes y aparece como un tenant propio en tu Dashboard EPS (KPIs, agenda y cumplimiento independientes).
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Nombre de la sede</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: IPS Norte — Medellín" className="h-9 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Ciudad</Label>
                    <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Medellín" className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Dirección</Label>
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Cra 45 #12-30" className="h-9 text-sm" />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={addBranch} disabled={saving} className="w-full gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Agregar sede
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-1.5">
            {branches.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border bg-card">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0",
                    b.is_main ? "bg-fuchsia-neural/10 text-fuchsia-neural" : "bg-muted/50 text-muted-foreground",
                  )}>
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-semibold truncate">{b.name}</p>
                      {b.is_main && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-fuchsia-neural/30 text-fuchsia-neural">
                          Principal
                        </Badge>
                      )}
                    </div>
                    {(b.city || b.address) && (
                      <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5" /> {[b.address, b.city].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                {!b.is_main && (
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600" onClick={() => removeBranch(b)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
