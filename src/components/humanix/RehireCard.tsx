import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, Repeat } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const sb = supabase as unknown as SupabaseClient;

interface Props {
  clientId: string;
  professionalId: string;
  professionalName?: string;
}

export function RehireCard({ clientId, professionalId, professionalName }: Props) {
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    sb.from("care_favorites")
      .select("professional_id")
      .eq("client_id", clientId)
      .eq("professional_id", professionalId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setFavorite(Boolean(data));
      });
    return () => {
      active = false;
    };
  }, [clientId, professionalId]);

  const toggle = async () => {
    setBusy(true);
    const query = favorite
      ? sb
          .from("care_favorites")
          .delete()
          .eq("client_id", clientId)
          .eq("professional_id", professionalId)
      : sb.from("care_favorites").insert({ client_id: clientId, professional_id: professionalId });
    const { error } = await query;
    setBusy(false);
    if (error) {
      toast.error("No se pudo actualizar tu lista de favoritos");
      return;
    }
    setFavorite(!favorite);
    toast.success(favorite ? "Quitado de favoritos" : "Guardado en tu círculo de cuidado");
  };

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5">
      <h3 className="font-semibold">
        ¿Quieres volver a contar con {professionalName ?? "este profesional"}?
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Guárdalo en tu círculo de cuidado o solicita un nuevo servicio con un clic.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/profesional/$proId" params={{ proId: professionalId }}>
            <Repeat className="h-4 w-4 mr-1.5" /> Volver a contratar
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={toggle} disabled={busy || favorite === null}>
          <Heart
            className={`h-4 w-4 mr-1.5 ${favorite ? "fill-current text-fuchsia-neural" : ""}`}
          />
          {favorite ? "En favoritos" : "Guardar como favorito"}
        </Button>
      </div>
    </div>
  );
}
