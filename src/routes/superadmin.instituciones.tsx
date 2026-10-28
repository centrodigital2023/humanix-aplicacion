// Validación de documentos institucionales de las EPS/IPS: el superadmin abre cada archivo y lo aprueba o rechaza con una nota.
// Con cámara de comercio y RUT aprobados, la base marca la institución como verificada
// (trigger hx_inst_docs_sync_verified; los obligatorios están en hx_inst_docs_complete).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  FileCheck,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { DocStatusBadge } from "@/components/humanix/InstitutionDocumentsManager";
import { useSuperadmin } from "@/hooks/use-superadmin";
import { friendlyError } from "@/lib/friendlyError";
import { buildSeo } from "@/lib/seo";
import {
  INSTITUTION_DOCS_BUCKET,
  INSTITUTION_DOC_TYPES,
  institutionDocLabel,
  institutionDocPath,
  missingApprovedDocs,
  type InstitutionDocument,
} from "@/lib/institutionDocuments";

const sb = supabase as unknown as SupabaseClient;

const NAV: NavItem[] = [
  { label: "Control Center", to: "/superadmin", icon: LayoutDashboard },
  { label: "Documentos EPS/IPS", to: "/superadmin/instituciones", icon: Building2 },
  { label: "Anti-fraude", to: "/superadmin/fraude", icon: ShieldAlert },
  { label: "Auditoría", to: "/superadmin/auditoria", icon: ScrollText },
  { label: "Evaluador", to: "/evaluador", icon: FileCheck },
];

type Institution = {
  user_id: string;
  institution_name: string | null;
  institution_type: string | null;
  nit: string | null;
  city: string | null;
  legal_representative_name: string | null;
  verified: boolean | null;
};

type Filter = "pending" | "all";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/superadmin/instituciones")({
  head: () =>
    buildSeo({
      title: "Documentos EPS/IPS · Superadmin",
      path: "/superadmin/instituciones",
      noindex: true,
    }),
  component: InstitucionesPage,
});

function InstitucionesPage() {
  const { user, logout } = useSuperadmin();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [docs, setDocs] = useState<InstitutionDocument[]>([]);
  const [fetching, setFetching] = useState(true);
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const [{ data: profs, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
        sb
          .from("institution_profiles")
          .select(
            "user_id, institution_name, institution_type, nit, city, legal_representative_name, verified",
          )
          .order("institution_name"),
        sb.from("institution_documents").select("*").order("created_at", { ascending: false }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setInstitutions((profs ?? []) as Institution[]);
      setDocs((rows ?? []) as InstitutionDocument[]);
    } catch (e) {
      toast.error(friendlyError(e, "No pudimos cargar las instituciones"));
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
    const channel = sb
      .channel("superadmin-institution-docs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "institution_documents" },
        () => void load(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [user, load]);

  const docsByInst = useMemo(() => {
    const m = new Map<string, InstitutionDocument[]>();
    for (const d of docs) m.set(d.user_id, [...(m.get(d.user_id) ?? []), d]);
    return m;
  }, [docs]);

  const pendingCount = docs.filter((d) => d.status === "pending").length;
  const verifiedCount = institutions.filter((i) => i.verified).length;

  const visible = institutions.filter((i) =>
    filter === "all" ? true : (docsByInst.get(i.user_id) ?? []).some((d) => d.status === "pending"),
  );

  const openDoc = async (doc: InstitutionDocument) => {
    try {
      const path = institutionDocPath(doc.file_url);
      if (!path)
        throw new Error(
          "El archivo no se guardó bien; pide a la institución que lo suba de nuevo.",
        );
      const { data, error } = await sb.storage
        .from(INSTITUTION_DOCS_BUCKET)
        .createSignedUrl(path, 120);
      if (error || !data?.signedUrl) throw error ?? new Error("No se pudo abrir");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(friendlyError(e, "No se pudo abrir el documento"));
    }
  };

  const review = async (doc: InstitutionDocument, status: "approved" | "rejected") => {
    const note = (notes[doc.id] ?? "").trim();
    if (status === "rejected" && !note) {
      toast.error("Escribe el motivo del rechazo para que la institución sepa qué corregir.");
      return;
    }
    setBusyId(doc.id);
    try {
      const { error } = await sb
        .from("institution_documents")
        .update({ status, reviewer_note: status === "rejected" ? note : note || null })
        .eq("id", doc.id);
      if (error) throw error;
      toast.success(status === "approved" ? "Documento aprobado" : "Documento rechazado");
      setNotes((p) => ({ ...p, [doc.id]: "" }));
      await load();
    } catch (e) {
      toast.error(friendlyError(e, "No se pudo guardar la revisión"));
    } finally {
      setBusyId(null);
    }
  };

  if (!user) return null;

  return (
    <AppShell nav={NAV} title="Documentos EPS/IPS" user={user} onLogout={logout}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={filter === "pending" ? "default" : "outline"}
            onClick={() => setFilter("pending")}
          >
            Por revisar ({pendingCount})
          </Button>
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            Todas ({institutions.length})
          </Button>
          <span className="text-xs text-muted-foreground ml-1">
            {verifiedCount} verificada{verifiedCount === 1 ? "" : "s"}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()}>
            <RefreshCw className={`h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Obligatorios para verificar:{" "}
          {INSTITUTION_DOC_TYPES.filter((t) => t.required)
            .map((t) => t.label)
            .join(", ")}
          . Al aprobarlos, la institución sale verificada en el mapa y en sus ofertas.
        </p>

        {fetching && institutions.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando…
          </Card>
        ) : visible.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            {filter === "pending"
              ? "No hay documentos pendientes de revisión."
              : "Aún no hay instituciones registradas."}
          </Card>
        ) : (
          visible.map((inst) => {
            const instDocs = docsByInst.get(inst.user_id) ?? [];
            const missing = missingApprovedDocs(instDocs);
            return (
              <Card key={inst.user_id} className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {inst.institution_name || "Institución sin nombre"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        inst.institution_type?.toUpperCase(),
                        inst.nit && `NIT ${inst.nit}`,
                        inst.city,
                        inst.legal_representative_name && `Rep. ${inst.legal_representative_name}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {inst.verified ? (
                    <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-600/30">
                      <ShieldCheck className="h-3 w-3 mr-1" /> Verificada
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-600/15 text-amber-700 border-amber-600/30">
                      Faltan {missing.length} obligatorio{missing.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>

                {instDocs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No ha subido documentos.</p>
                ) : (
                  <ul className="space-y-2">
                    {instDocs.map((d) => (
                      <li key={d.id} className="rounded-lg border border-border p-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{institutionDocLabel(d.doc_type)}</span>
                          <button
                            type="button"
                            onClick={() => openDoc(d)}
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1 truncate max-w-[16rem]"
                          >
                            {d.file_name || "Ver archivo"} <ExternalLink className="h-3 w-3" />
                          </button>
                          <span className="ml-auto text-xs">
                            <DocStatusBadge status={d.status} />
                          </span>
                        </div>
                        {d.reviewer_note && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Nota: {d.reviewer_note}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            className="h-8 text-xs flex-1 min-w-[12rem]"
                            placeholder="Nota para la institución (obligatoria si rechazas)"
                            value={notes[d.id] ?? ""}
                            onChange={(e) => setNotes((p) => ({ ...p, [d.id]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === d.id || d.status === "approved"}
                            onClick={() => review(d, "approved")}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Aprobar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === d.id || d.status === "rejected"}
                            onClick={() => review(d, "rejected")}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1 text-rose-600" /> Rechazar
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
