// Documentos institucionales que sube la EPS/IPS. Se guardan en el bucket privado «institution-docs» y quedan
// «En revisión» hasta que el superadmin los aprueba o rechaza en /superadmin/instituciones.
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileCheck,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { supabase as _sb } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendlyError";
import { confirmAction } from "@/components/humanix/ConfirmHost";
import {
  INSTITUTION_DOCS_BUCKET,
  INSTITUTION_DOC_STATUS_LABEL,
  INSTITUTION_DOC_TYPES,
  institutionDocPath,
  missingApprovedDocs,
  type InstitutionDocStatus,
  type InstitutionDocType,
  type InstitutionDocument,
} from "@/lib/institutionDocuments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase: any = _sb;

export function InstitutionDocumentsManager({
  userId,
  verified,
  onDocsChange,
}: {
  userId: string;
  verified: boolean;
  onDocsChange?: (docs: InstitutionDocument[]) => void;
}) {
  const [docs, setDocs] = useState<InstitutionDocument[]>([]);
  const [busyType, setBusyType] = useState<InstitutionDocType | null>(null);
  const inputRefs = useRef<Partial<Record<InstitutionDocType, HTMLInputElement | null>>>({});

  useEffect(() => {
    onDocsChange?.(docs);
  }, [docs, onDocsChange]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("institution_documents")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (active && data) setDocs(data as InstitutionDocument[]);
    };
    void load();

    const channel = supabase
      .channel(`institution-docs-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "institution_documents",
          filter: `user_id=eq.${userId}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const upload = async (type: InstitutionDocType, file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Máximo 15 MB");
      return;
    }
    setBusyType(type);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/${type}-${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(INSTITUTION_DOCS_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { data: row, error } = await supabase
        .from("institution_documents")
        .insert({ user_id: userId, doc_type: type, file_url: path, file_name: file.name })
        .select()
        .single();
      if (error) {
        await supabase.storage.from(INSTITUTION_DOCS_BUCKET).remove([path]);
        throw error;
      }
      setDocs((prev) =>
        prev.some((d) => d.id === row.id) ? prev : [row as InstitutionDocument, ...prev],
      );
      toast.success("Documento cargado. Humanix lo revisará pronto.");
    } catch (e) {
      toast.error(friendlyError(e, "No pudimos subir el documento"));
    } finally {
      setBusyType(null);
    }
  };

  const openDoc = async (doc: InstitutionDocument) => {
    try {
      const path = institutionDocPath(doc.file_url);
      if (!path) throw new Error("Este archivo no se guardó bien. Súbelo de nuevo.");
      const { data, error } = await supabase.storage
        .from(INSTITUTION_DOCS_BUCKET)
        .createSignedUrl(path, 60);
      if (error || !data?.signedUrl) throw error ?? new Error("No se pudo abrir");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(friendlyError(e, "No se pudo abrir el documento"));
    }
  };

  const remove = async (doc: InstitutionDocument) => {
    if (
      !(await confirmAction({
        title: "¿Eliminar este documento?",
        description:
          doc.status === "approved"
            ? "Ya fue aprobado. Si lo eliminas, tu institución puede perder la verificación."
            : "Podrás subir otro cuando quieras.",
        confirmLabel: "Eliminar",
        destructive: true,
      }))
    )
      return;
    try {
      const path = institutionDocPath(doc.file_url);
      if (path) await supabase.storage.from(INSTITUTION_DOCS_BUCKET).remove([path]);
      const { error } = await supabase.from("institution_documents").delete().eq("id", doc.id);
      if (error) throw error;
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success("Documento eliminado");
    } catch (e) {
      toast.error(friendlyError(e, "Error al eliminar"));
    }
  };

  const missing = missingApprovedDocs(docs);

  return (
    <div className="space-y-3">
      {verified ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-emerald-700 dark:text-emerald-400">
            Institución verificada por Humanix.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-amber-700 dark:text-amber-400">
            Sube los documentos marcados con <strong>*</strong>. Cuando Humanix apruebe los{" "}
            {INSTITUTION_DOC_TYPES.filter((t) => t.required).length} obligatorios, tu institución
            queda verificada.
            {missing.length > 0 && ` Faltan ${missing.length} por aprobar.`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {INSTITUTION_DOC_TYPES.map((t) => {
          const items = docs.filter((d) => d.doc_type === t.value);
          const busy = busyType === t.value;
          return (
            <div key={t.value} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <FileCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {t.label}
                      {t.required && <span className="ml-1 text-rose-500">*</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{t.hint}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
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
                  accept=".pdf,.jpg,.jpeg,.png,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(t.value, f);
                    e.target.value = "";
                  }}
                />
              </div>
              {items.length > 0 && (
                <ul className="mt-2 space-y-1.5">
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
                        <DocStatusBadge status={d.status} />
                        <button
                          type="button"
                          onClick={() => remove(d)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Eliminar documento"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {d.status === "rejected" && d.reviewer_note && (
                        <p className="mt-1 text-[11px] text-rose-600">❌ {d.reviewer_note}</p>
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

export function DocStatusBadge({ status }: { status: InstitutionDocStatus }) {
  const map = {
    pending: { icon: <Clock className="h-3 w-3" />, cls: "bg-amber-500/10 text-amber-600" },
    approved: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      cls: "bg-emerald-500/10 text-emerald-600",
    },
    rejected: { icon: <XCircle className="h-3 w-3" />, cls: "bg-rose-500/10 text-rose-600" },
  } as const;
  const s = map[status] ?? map.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${s.cls} whitespace-nowrap`}
    >
      {s.icon}
      {INSTITUTION_DOC_STATUS_LABEL[status] ?? status}
    </span>
  );
}
