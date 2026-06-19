import { useState } from "react";
import {
  Loader2,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Save,
  Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Validation = {
  is_publishable: boolean;
  score: number;
  critical_errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
  ai_summary: string;
};

export function PublishGate({
  userId,
  profilePayload,
  published,
  onSaved,
  onPublished,
}: {
  userId: string;
  profilePayload: Record<string, unknown>;
  published: boolean;
  onSaved: () => Promise<void> | void;
  onPublished: () => Promise<void> | void;
}) {
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [validation, setValidation] = useState<Validation | null>(null);

  const validateAndPublish = async (publish: boolean) => {
    if (!userId) return;
    setValidating(true);
    setValidation(null);
    try {
      // Cargar documentos y referencias
      const client = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: string) => Promise<{ data: Record<string, unknown>[] | null }>;
          };
        };
      };
      const [docsR, refsR] = await Promise.all([
        client
          .from("professional_documents")
          .select("doc_type, status, ai_verified, ai_score, ai_notes, ai_extracted")
          .eq("user_id", userId),
        client
          .from("professional_references")
          .select("ref_type, full_name, phone, relation")
          .eq("user_id", userId),
      ]);

      const { data, error } = await supabase.functions.invoke("profile-holistic-validator", {
        body: {
          profile: profilePayload,
          documents: docsR.data ?? [],
          references: refsR.data ?? [],
        },
      });
      if (error) throw error;
      const v = data?.validation as Validation | undefined;
      if (!v) throw new Error("Sin respuesta de IA");
      setValidation(v);

      // Guardar validación
      const insertClient = supabase as unknown as {
        from: (t: string) => {
          insert: (row: Record<string, unknown>) => {
            select: () => { single: () => Promise<{ data: { id: string } | null }> };
          };
        };
      };
      const { data: vrow } = await insertClient
        .from("profile_validations")
        .insert({
          user_id: userId,
          is_publishable: v.is_publishable,
          score: v.score,
          critical_errors: v.critical_errors,
          warnings: v.warnings,
          ai_summary: v.ai_summary,
        })
        .select()
        .single();

      if (publish && v.is_publishable) {
        setPublishing(true);
        const { data: pubData, error: pubErr } = await (
          supabase as unknown as {
            rpc: (
              fn: string,
              args: Record<string, unknown>,
            ) => Promise<{ data: { ok: boolean; errors?: string[] } | null; error: unknown }>;
          }
        ).rpc("publish_profile", { _validation_id: vrow?.id ?? null });
        if (pubErr || !pubData?.ok) {
          const msg =
            pubData?.errors?.join(" ") ??
            (pubErr instanceof Error ? pubErr.message : "No se pudo publicar.");
          toast.error(msg);
        } else {
          toast.success("🎉 Tu perfil está publicado y visible.");
          await onPublished();
        }
      } else if (publish) {
        toast.error("No puedes publicar aún. Corrige los errores marcados.");
      } else {
        toast.success(
          v.critical_errors.length === 0
            ? "✅ Validación OK. Puedes publicar."
            : `Encontramos ${v.critical_errors.length} error(es) que bloquean la publicación.`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en validación");
    } finally {
      setValidating(false);
      setPublishing(false);
    }
  };

  const busy = validating || publishing;

  return (
    <div className="rounded-2xl border border-border bg-card/95 p-6">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="h-5 w-5 text-biosensor" />
        <h2 className="font-semibold">Validación final IA y publicación</h2>
        {published && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
            Publicado
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        La IA cruza tus datos del formulario con todos los documentos subidos y las referencias para
        detectar incoherencias. Solo te dejamos publicar si no hay errores graves.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onSaved} variant="glass" disabled={busy}>
          <Save className="h-4 w-4 mr-1.5" /> Guardar
        </Button>
        <Button onClick={() => validateAndPublish(false)} variant="glass" disabled={busy}>
          {validating && !publishing ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1.5" />
          )}
          Validar con IA
        </Button>
        <Button onClick={() => validateAndPublish(true)} variant="hero" disabled={busy}>
          {publishing ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-1.5" />
          )}
          {published ? "Re-publicar" : "Publicar perfil"}
        </Button>
      </div>

      {validation && (
        <div className="mt-5 space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`text-3xl font-bold ${validation.is_publishable ? "text-emerald-600" : "text-rose-600"}`}
            >
              {Math.round(validation.score)}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
            {validation.is_publishable ? (
              <span className="ml-auto text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600">
                ✅ Listo para publicar
              </span>
            ) : (
              <span className="ml-auto text-xs px-2 py-1 rounded-full bg-rose-500/10 text-rose-600">
                🚫 Publicación bloqueada
              </span>
            )}
          </div>
          {validation.ai_summary && (
            <p className="text-sm bg-muted/30 p-3 rounded-lg">{validation.ai_summary}</p>
          )}
          {validation.critical_errors.length > 0 && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <p className="text-xs uppercase tracking-wide text-rose-600 font-semibold mb-2 inline-flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> Errores que bloquean publicación
              </p>
              <ul className="space-y-1.5">
                {validation.critical_errors.map((e, i) => (
                  <li key={i} className="text-sm text-rose-700 dark:text-rose-300">
                    <strong>{e.field}:</strong> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2 inline-flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Advertencias (no bloquean)
              </p>
              <ul className="space-y-1.5">
                {validation.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-300">
                    <strong>{w.field}:</strong> {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
