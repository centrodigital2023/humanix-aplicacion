import { useEffect, useState } from "react";
import { Sparkles, Loader2, Brain, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Status = "missing" | "ready" | "outdated";

export function AiFingerprintCard({ userId }: { userId: string }) {
  const [status, setStatus] = useState<Status>("missing");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const [{ data: emb }, { data: prof }] = await Promise.all([
      supabase.from("profile_embeddings").select("updated_at").eq("user_id", userId).maybeSingle(),
      supabase
        .from("professional_profiles")
        .select("updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (!emb) {
      setStatus("missing");
      setUpdatedAt(null);
    } else {
      setUpdatedAt(emb.updated_at);
      if (prof?.updated_at && new Date(prof.updated_at) > new Date(emb.updated_at)) {
        setStatus("outdated");
      } else {
        setStatus("ready");
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const generate = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("embed-profile", {
        body: { user_id: userId },
      });
      if (error) throw error;
      toast.success("✨ Tu huella IA está activa. Ahora apareces en matches semánticos.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo generar la huella IA");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card/95 p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-fuchsia-neural/10 text-fuchsia-neural flex items-center justify-center shrink-0">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              Huella IA semántica
              {status === "ready" && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-biosensor/10 text-biosensor border border-biosensor/30">
                  <CheckCircle2 className="h-3 w-3" /> Activa
                </span>
              )}
              {status === "outdated" && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-copper/10 text-copper border border-copper/30">
                  Desactualizada
                </span>
              )}
              {status === "missing" && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                  Sin generar
                </span>
              )}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-md">
              Convertimos tu perfil en un vector que la IA usa para encontrar las ofertas más
              afines, incluso cuando las palabras no coinciden exactamente.
            </p>
            {updatedAt && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Última actualización: {new Date(updatedAt).toLocaleString("es-CO")}
              </p>
            )}
          </div>
        </div>
        <Button onClick={generate} disabled={busy || loading} variant="hero" size="sm">
          {busy ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1.5" />
          )}
          {status === "missing" ? "Generar huella IA" : "Regenerar"}
        </Button>
      </div>
    </div>
  );
}
