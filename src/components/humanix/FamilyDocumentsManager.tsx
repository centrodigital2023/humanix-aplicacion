import { useEffect, useRef, useState } from "react";
import {
  IdCard,
  UploadCloud,
  Loader2,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type DocType =
  | "id_document"
  | "utility_bill"
  | "patient_id"
  | "medical_history"
  | "authorization"
  | "insurance"
  | "other";
type DocStatus = "pending" | "approved" | "rejected";

type Doc = {
  id: string;
  doc_type: DocType;
  file_url: string;
  file_name: string | null;
  status: DocStatus;
  reviewer_note: string | null;
  ai_verified?: boolean | null;
  ai_score?: number | null;
  ai_notes?: string | null;
  created_at: string;
};

const TYPES: {
  value: DocType;
  label: string;
  icon: React.ReactNode;
  hint: string;
  required?: boolean;
}[] = [
  {
    value: "id_document",
    label: "Tu cédula",
    icon: <IdCard className="h-4 w-4" />,
    hint: "Frente y reverso. La IA valida que sea real.",
    required: true,
  },
];

export function FamilyDocumentsManager({ userId }: { userId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busyType, setBusyType] = useState<DocType | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const inputRefs = useRef<Record<DocType, HTMLInputElement | null>>({
    id_document: null,
    utility_bill: null,
    patient_id: null,
    medical_history: null,
    authorization: null,
    insurance: null,
    other: null,
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("family_documents" as never)
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (active && data) setDocs(data as unknown as Doc[]);
    })();

    // Realtime
    const channel = supabase
      .channel(`family-docs-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "family_documents", filter: `user_id=eq.${userId}` },
        (payload) => {
          setDocs((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((d) => d.id !== (payload.old as { id: string }).id);
            }
            const row = payload.new as unknown as Doc;
            const exists = prev.some((d) => d.id === row.id);
            return exists ? prev.map((d) => (d.id === row.id ? row : d)) : [row, ...prev];
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const upload = async (type: DocType, file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Máximo 15MB");
      return;
    }
    setBusyType(type);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/${type}-${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("family-docs")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { data: row, error } = await supabase
        .from("family_documents" as never)
        .insert({ user_id: userId, doc_type: type, file_url: path, file_name: file.name } as never)
        .select()
        .single();
      if (error) throw error;
      const newDoc = row as unknown as Doc;
      toast.success("Documento subido. Verificando con IA…");

      const { data: signed } = await supabase.storage
        .from("family-docs")
        .createSignedUrl(path, 120);
      if (!signed?.signedUrl) {
        toast.warning("No se pudo verificar automáticamente. Quedó pendiente.");
        return;
      }

      setVerifyingId(newDoc.id);
      try {
        const { data: vr, error: ve } = await supabase.functions.invoke("document-verifier", {
          body: { file_url: signed.signedUrl, mime_type: file.type, doc_type: type },
        });
        if (ve) throw ve;
        const v = vr?.verification;
        if (!v) throw new Error("Sin respuesta de verificación");
        const isValid = !!v.is_valid && Number(v.confidence ?? 0) >= 60;
        const newStatus: DocStatus = isValid ? "pending" : "rejected";
        const updates = {
          ai_verified: isValid,
          ai_score: typeof v.confidence === "number" ? v.confidence : null,
          ai_notes: v.reason ?? null,
          ai_extracted: v.extracted ?? null,
          reviewer_note: !isValid ? (v.reason ?? "Documento rechazado por IA") : null,
          status: newStatus,
        };
        await supabase
          .from("family_documents" as never)
          .update(updates as never)
          .eq("id", newDoc.id);
        if (isValid) {
          toast.success(`✅ Verificado por IA (${Math.round(v.confidence)}%)`);
        } else {
          toast.error(`❌ Rechazado: ${v.reason ?? "no coincide con el tipo declarado"}`);
        }
      } catch (e) {
        console.warn("[verify]", e);
        toast.warning("Documento subido. La verificación IA no estuvo disponible.");
      } finally {
        setVerifyingId(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al subir");
    } finally {
      setBusyType(null);
    }
  };

  const openDoc = async (doc: Doc) => {
    try {
      const path = extractPath(doc.file_url);
      if (!path) throw new Error("Ruta no válida");
      const { data, error } = await supabase.storage.from("family-docs").createSignedUrl(path, 60);
      if (error || !data?.signedUrl) throw error ?? new Error("No se pudo abrir");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir el documento");
    }
  };

  const remove = async (doc: Doc) => {
    if (!confirm("¿Eliminar este documento?")) return;
    try {
      const path = extractPath(doc.file_url);
      if (path) await supabase.storage.from("family-docs").remove([path]);
      await supabase
        .from("family_documents" as never)
        .delete()
        .eq("id", doc.id);
      toast.success("Eliminado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  const docsByType = (t: DocType) => docs.filter((d) => d.doc_type === t);
  const hasDoc = (t: DocType) => docs.some((d) => d.doc_type === t && d.status !== "rejected");
  const requiredMissing = TYPES.filter((t) => t.required && !hasDoc(t.value)).length;

  return (
    <div className="space-y-4">
      {requiredMissing > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-amber-700 dark:text-amber-400">
            Te faltan <strong>{requiredMissing}</strong> documento(s) obligatorio(s) para mayor
            confianza.
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {TYPES.map((t) => {
          const items = docsByType(t.value);
          const busy = busyType === t.value;
          return (
            <div key={t.value} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center text-foreground">
                    {t.icon}
                  </span>
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      {t.label}
                      {t.required && <span className="text-[10px] text-rose-500">*</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{t.hint}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="glass"
                  disabled={busy}
                  onClick={() => inputRefs.current[t.value]?.click()}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1.5 text-xs">Subir</span>
                </Button>
                <input
                  ref={(el) => {
                    inputRefs.current[t.value] = el;
                  }}
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(t.value, f);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-fuchsia-neural">
                <Sparkles className="h-3 w-3" /> Verificación automática con IA
              </p>
              {items.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {items.map((d) => (
                    <li key={d.id} className="text-xs bg-muted/30 rounded px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => openDoc(d)}
                          className="truncate flex-1 text-left hover:underline"
                        >
                          {d.file_name || "Documento"}
                        </button>
                        {verifyingId === d.id && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                        <StatusBadge status={d.status} aiVerified={d.ai_verified ?? false} />
                        <button
                          onClick={() => remove(d)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Eliminar documento"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {d.ai_notes && (
                        <p
                          className={`mt-1 text-[10.5px] ${
                            d.status === "rejected" ? "text-rose-600" : "text-muted-foreground"
                          }`}
                        >
                          {d.status === "rejected" ? "❌ " : "🤖 "}
                          {d.ai_notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status, aiVerified }: { status: DocStatus; aiVerified: boolean }) {
  const map = {
    pending: {
      icon: <Clock className="h-3 w-3" />,
      label: aiVerified ? "IA ✓" : "Pendiente",
      cls: aiVerified ? "bg-biosensor/10 text-biosensor" : "bg-amber-500/10 text-amber-600",
    },
    approved: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Aprobado",
      cls: "bg-emerald-500/10 text-emerald-600",
    },
    rejected: {
      icon: <XCircle className="h-3 w-3" />,
      label: "Rechazado",
      cls: "bg-rose-500/10 text-rose-600",
    },
  } as const;
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${s.cls} whitespace-nowrap`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

function extractPath(stored: string): string | null {
  if (!stored) return null;
  if (!stored.includes("://")) return stored;
  try {
    const url = new URL(stored);
    const idx = url.pathname.indexOf("/family-docs/");
    return idx >= 0 ? url.pathname.slice(idx + "/family-docs/".length) : null;
  } catch {
    return null;
  }
}
