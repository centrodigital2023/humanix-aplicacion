import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  Camera,
  IdCard,
  MapPin,
  Phone,
  FileText,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Sparkles,
  UploadCloud,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { FamilyDocumentsManager } from "@/components/humanix/FamilyDocumentsManager";

type Props = {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
};

type RequirementKey = "avatar" | "id_number" | "address" | "emergency" | "id_document";

type Requirement = {
  key: RequirementKey;
  label: string;
  short: string;
  icon: typeof ShieldCheck;
  done: boolean;
  hint: string;
  step: "avatar" | "id" | "address" | "emergency" | "docs";
};

/**
 * Tarjeta inteligente de completitud del perfil familiar.
 * Muestra progreso en tiempo real, qué falta con iconos, y lleva al onboarding.
 */
export function SmartProfileCard({ userId, fullName, avatarUrl }: Props) {
  const [loading, setLoading] = useState(true);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const [famRes, docsRes] = await Promise.all([
        supabase
          .from("family_profiles")
          .select("id_number, default_address, emergency_contact_phone, habeas_data_accepted")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("family_documents" as never)
          .select("doc_type,status")
          .eq("user_id", userId),
      ]);
      if (!active) return;
      const fam = famRes.data as
        | {
            id_number: string | null;
            default_address: string | null;
            emergency_contact_phone: string | null;
            habeas_data_accepted: boolean | null;
          }
        | null;
      const docs = ((docsRes.data ?? []) as Array<{ doc_type: string; status: string }>).filter(
        (d) => d.status !== "rejected",
      );
      const has = (t: string) => docs.some((d) => d.doc_type === t);

      const list: Requirement[] = [
        {
          key: "avatar",
          label: "Foto de perfil",
          short: "Foto",
          icon: Camera,
          done: !!avatarUrl,
          hint: "Tu cara ayuda a que los profesionales confíen en ti.",
          step: "avatar",
        },
        {
          key: "id_number",
          label: "Cédula",
          short: "Cédula",
          icon: IdCard,
          done: !!fam?.id_number,
          hint: "Número de identificación oficial.",
          step: "id",
        },
        {
          key: "address",
          label: "Dirección",
          short: "Dirección",
          icon: MapPin,
          done: !!fam?.default_address,
          hint: "Dónde recibirás el servicio.",
          step: "address",
        },
        {
          key: "emergency",
          label: "Contacto de emergencia",
          short: "Emergencia",
          icon: Phone,
          done: !!fam?.emergency_contact_phone,
          hint: "Un familiar que pueda responder en caso de urgencia.",
          step: "emergency",
        },
        {
          key: "id_document",
          label: "Cédula digital",
          short: "Cédula IA",
          icon: FileText,
          done: has("id_document"),
          hint: "Foto frente y reverso — la IA valida que sea real.",
          step: "docs",
        },
      ];
      setReqs(list);
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel(`fam-profile-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "family_profiles", filter: `user_id=eq.${userId}` },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "family_documents", filter: `user_id=eq.${userId}` },
        load,
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, avatarUrl]);

  if (loading) {
    return (
      <Card className="p-5 flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Analizando tu perfil…
      </Card>
    );
  }

  const done = reqs.filter((r) => r.done).length;
  const total = reqs.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = done === total;

  // Tono cromático segun progreso
  const tone = complete
    ? { ring: "stroke-biosensor", text: "text-biosensor", soft: "bg-biosensor/10", border: "border-biosensor/30" }
    : percent >= 50
      ? { ring: "stroke-copper", text: "text-copper", soft: "bg-copper/10", border: "border-copper/30" }
      : { ring: "stroke-fuchsia-neural", text: "text-fuchsia-neural", soft: "bg-fuchsia-neural/10", border: "border-fuchsia-neural/30" };

  const circumference = 2 * Math.PI * 28;
  const dash = (percent / 100) * circumference;

  return (
    <Card className="overflow-hidden border border-border/60 bg-card/80 backdrop-blur-sm">
      {/* Hero: anillo de progreso + copy */}
      <div className="relative p-5 sm:p-6">
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-32 ${tone.soft} opacity-60 blur-2xl`}
          aria-hidden
        />
        <div className="relative flex items-center gap-4 sm:gap-5">
          {/* Anillo SVG */}
          <div className="relative shrink-0">
            <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
              <circle cx="36" cy="36" r="28" className="stroke-muted/40" strokeWidth="6" fill="none" />
              <circle
                cx="36"
                cy="36"
                r="28"
                className={`${tone.ring} transition-all duration-700`}
                strokeWidth="6"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${dash} ${circumference}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {complete ? (
                <ShieldCheck className={`h-6 w-6 ${tone.text}`} />
              ) : (
                <span className={`text-base font-semibold ${tone.text}`}>{percent}%</span>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${tone.text}`}>
              {complete ? "Perfil verificado ✓" : "Tu perfil familiar"}
            </p>
          </div>
        </div>

        {/* Acciones */}
        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <Button variant={complete ? "outline" : "hero"} asChild className="flex-1 sm:flex-none">
            <Link to="/dashboard/familia/onboarding" search={{ step: undefined }}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              {complete ? "Editar perfil" : "Completar ahora"}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setDocsOpen((v) => !v)}
            className="flex-1 sm:flex-none justify-between sm:justify-start text-sm"
            aria-expanded={docsOpen}
          >
            <span className="inline-flex items-center gap-1.5">
              <UploadCloud className="h-4 w-4" />
              Adjuntar documentos
            </span>
            {docsOpen ? (
              <ChevronUp className="h-4 w-4 ml-1 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 ml-1 text-muted-foreground" />
            )}
          </Button>
        </div>

        {/* Trust line — sutil */}
        {complete && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-biosensor" />
            Verificado por IA · RETHUS cruzado · Documentos auditados
          </p>
        )}
      </div>

      {/* Documentos colapsable */}
      {docsOpen && (
        <div className="border-t border-border/60 bg-muted/20 p-4 sm:p-5">
          <FamilyDocumentsManager userId={userId} />
        </div>
      )}
    </Card>
  );
}
