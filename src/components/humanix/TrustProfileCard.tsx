import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  FileCheck2,
  FileWarning,
  Loader2,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  User as UserIcon,
  Maximize2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import { MapModal } from "./MapModal";

const sb = supabase as unknown as SupabaseClient;

type Role = "family" | "professional";

type BaseProfile = {
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
};
type ProInfo = {
  avg_rating: number | null;
  total_jobs: number | null;
  specialty: string | null;
  home_city: string | null;
  lat: number | null;
  lng: number | null;
  verified: boolean | null;
  rethus_verified: boolean | null;
  trust_score: number | null;
  years_experience: number | null;
};
type FamilyInfo = {
  default_address: string | null;
  default_lat: number | null;
  default_lng: number | null;
  patient_relation: string | null;
  emergency_contact_name: string | null;
};
type DocRow = {
  id: string;
  doc_type: string;
  status: string;
  ai_verified: boolean | null;
  ai_score: number | null;
};

const DOC_LABEL: Record<string, string> = {
  cedula: "Cédula / DNI",
  id_document: "Cédula / DNI",
  rethus: "RETHUS",
  diploma: "Diploma",
  cv: "Hoja de vida",
  utility_bill: "Servicios públicos",
  work_reference: "Referencia laboral",
  family_reference: "Referencia familiar",
  antecedentes: "Antecedentes",
  judicial: "Antecedentes judiciales",
  other: "Otro",
};

function initialsFrom(name: string | null | undefined): string {
  if (!name) return "··";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "··";
}

function StarRow({ rating, jobs }: { rating: number | null; jobs: number | null }) {
  const r = rating ?? 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center">
        {Array.from({ length: 5 }).map((_, i) => {
          const filled = i + 1 <= Math.round(r);
          return (
            <Star
              key={i}
              className={`h-3.5 w-3.5 ${filled ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"}`}
            />
          );
        })}
      </div>
      <span className="text-xs font-semibold">{r > 0 ? r.toFixed(1) : "Sin calificaciones"}</span>
      {jobs && jobs > 0 ? (
        <span className="text-[10px] text-muted-foreground">· {jobs} servicios</span>
      ) : null}
    </div>
  );
}

function MapPreview({
  lat,
  lng,
  address,
}: {
  lat: number | null;
  lng: number | null;
  address: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  if (lat != null && lng != null) {
    const d = 0.006;
    const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
    
    return (
      <>
        <div
          className="rounded-xl overflow-hidden border border-border bg-muted group cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setExpanded(true)}
        >
          <iframe
            title="Ubicación del servicio"
            src={src}
            className="w-full h-24"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <div className="px-3 py-2 text-[11px] text-muted-foreground flex items-start justify-between gap-1.5 bg-card">
            <div className="flex items-start gap-1.5">
              <MapPin className="h-3 w-3 text-fuchsia-neural mt-0.5 shrink-0" />
              <span className="line-clamp-1">{address ?? "Ubicación aproximada"}</span>
            </div>
            <Maximize2 className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        <MapModal
          open={expanded}
          onOpenChange={setExpanded}
          title="Ubicación del servicio"
        >
          <iframe
            title="Ubicación del servicio - expandido"
            src={src}
            className="w-full h-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </MapModal>
      </>
    );
  }
  
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 h-28 flex flex-col items-center justify-center p-3 text-center">
      <MapPin className="h-5 w-5 text-muted-foreground mb-1" />
      <p className="text-xs text-muted-foreground line-clamp-2">
        {address ?? "Ubicación no declarada"}
      </p>
      <p className="text-[10px] text-muted-foreground/70 mt-1">
        Se compartirá al confirmar el servicio
      </p>
    </div>
  );
}

export function TrustProfileCard({
  userId,
  role,
  highlightAddress,
  compact,
}: {
  userId: string;
  role: Role;
  highlightAddress?: string | null;
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [base, setBase] = useState<BaseProfile | null>(null);
  const [pro, setPro] = useState<ProInfo | null>(null);
  const [fam, setFam] = useState<FamilyInfo | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [rating, setRating] = useState<{ avg: number; count: number }>({ avg: 0, count: 0 });
  const [bookings, setBookings] = useState<number>(0);
  const [aiVerdict, setAiVerdict] = useState<{
    confidence: "alta" | "media" | "baja";
    score: number;
    reasons: string[];
    caution?: string;
    summary: string;
  } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const baseP = sb
        .from("profiles")
        .select("full_name, avatar_url, city")
        .eq("user_id", userId)
        .maybeSingle();

      const detailP =
        role === "professional"
          ? sb
              .from("professional_profiles")
              .select(
                "avg_rating, total_jobs, specialty, home_city, lat, lng, verified, rethus_verified, trust_score, years_experience",
              )
              .eq("user_id", userId)
              .maybeSingle()
          : sb
              .from("family_profiles")
              .select(
                "default_address, default_lat, default_lng, patient_relation, emergency_contact_name",
              )
              .eq("user_id", userId)
              .maybeSingle();

      const docsP = sb
        .from(role === "professional" ? "professional_documents" : "family_documents")
        .select("id, doc_type, status, ai_verified, ai_score")
        .eq("user_id", userId);

      const ratingsP = sb
        .from("service_ratings")
        .select("stars")
        .eq("rated_id", userId);

      const bookingsP = sb
        .from("service_bookings")
        .select("id", { count: "exact", head: true })
        .eq(role === "professional" ? "professional_id" : "client_id", userId)
        .eq("status", "completed");

      const [baseR, detailR, docsR, ratingsR, bookingsR] = await Promise.all([
        baseP,
        detailP,
        docsP,
        ratingsP,
        bookingsP,
      ]);
      if (!active) return;

      setBase((baseR.data ?? null) as BaseProfile | null);
      if (role === "professional") setPro((detailR.data ?? null) as ProInfo | null);
      else setFam((detailR.data ?? null) as FamilyInfo | null);

      setDocs((docsR.data ?? []) as DocRow[]);

      const stars = ((ratingsR.data ?? []) as { stars: number }[]).map((r) => r.stars);
      if (stars.length > 0) {
        setRating({ avg: stars.reduce((a, b) => a + b, 0) / stars.length, count: stars.length });
      } else {
        setRating({ avg: 0, count: 0 });
      }
      setBookings(bookingsR.count ?? 0);
      setLoading(false);
    })();

    const ch = sb
      .channel(`trust_profile_${userId}_${role}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "service_ratings", filter: `rated_id=eq.${userId}` },
        async () => {
          const { data } = await sb.from("service_ratings").select("stars").eq("rated_id", userId);
          const stars = ((data ?? []) as { stars: number }[]).map((r) => r.stars);
          if (!active) return;
          setRating(
            stars.length > 0
              ? { avg: stars.reduce((a, b) => a + b, 0) / stars.length, count: stars.length }
              : { avg: 0, count: 0 },
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: role === "professional" ? "professional_documents" : "family_documents",
          filter: `user_id=eq.${userId}`,
        },
        async () => {
          const { data } = await sb
            .from(role === "professional" ? "professional_documents" : "family_documents")
            .select("id, doc_type, status, ai_verified, ai_score")
            .eq("user_id", userId);
          if (!active) return;
          setDocs((data ?? []) as DocRow[]);
        },
      )
      .subscribe();

    return () => {
      active = false;
      sb.removeChannel(ch);
    };
  }, [userId, role]);

  // Real AI verdict via trust-verdict edge function (Gemini)
  useEffect(() => {
    if (loading) return;
    let active = true;
    setAiLoading(true);
    const snapshot = {
      role,
      name_masked: base?.full_name ? base.full_name.split(" ").map((p, i) => (i === 0 ? p : (p[0] ?? "") + "."))
        .join(" ") : null,
      city: base?.city ?? null,
      has_address: Boolean(
        role === "professional" ? pro?.home_city : fam?.default_address,
      ),
      rating_avg: rating.count > 0 ? Number(rating.avg.toFixed(2)) : pro?.avg_rating ?? null,
      rating_count: rating.count,
      completed_bookings: bookings,
      specialty: role === "professional" ? pro?.specialty ?? null : null,
      years_experience: role === "professional" ? pro?.years_experience ?? null : null,
      rethus_verified: role === "professional" ? pro?.rethus_verified === true : null,
      verified: role === "professional" ? pro?.verified === true : null,
      trust_score: role === "professional" ? pro?.trust_score ?? null : null,
      docs_approved: docs.filter((d) => d.status === "approved" || d.ai_verified === true)
        .map((d) => d.doc_type),
      docs_pending: docs.filter((d) => d.status === "pending" || d.status === "review").length,
      docs_avg_ai_score:
        docs.length > 0
          ? Math.round(docs.reduce((s, d) => s + (d.ai_score ?? 0), 0) / docs.length)
          : 0,
    };
    (async () => {
      try {
        // Only call the IA verdict when the visitor is authenticated.
        // Anonymous visitors see the heuristic fallback (avoids 401s from
        // trust-verdict which requires a JWT).
        const { data: sessionData } = await sb.auth.getSession();
        if (!sessionData?.session) {
          if (active) setAiLoading(false);
          return;
        }
        const { data, error } = await sb.functions.invoke("trust-verdict", {
          body: { snapshot },
        });
        if (!active) return;
        if (error) throw error;
        const result = (data as { result?: typeof aiVerdict } | null)?.result ?? null;
        if (result) setAiVerdict(result);
      } catch {
        // Silently fall back to heuristic verdict below.
      } finally {
        if (active) setAiLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, userId, role]);

  const approvedDocs = useMemo(
    () => docs.filter((d) => d.status === "approved" || d.ai_verified === true),
    [docs],
  );
  const pendingDocs = useMemo(
    () => docs.filter((d) => d.status === "pending" || d.status === "review"),
    [docs],
  );

  const verdict = useMemo(() => {
    if (loading) return { label: "Analizando…", tone: "neutral" as const, icon: Loader2 };
    const approvedCount = approvedDocs.length;
    const totalDocs = docs.length;
    const avgAi =
      docs.length > 0
        ? docs.reduce((s, d) => s + (d.ai_score ?? 0), 0) / docs.length
        : 0;
    const rethus = role === "professional" ? pro?.rethus_verified === true : true;

    if (approvedCount >= 3 && avgAi >= 75 && rethus) {
      return {
        label: "Verificado por IA · Alta confianza",
        tone: "good" as const,
        icon: ShieldCheck,
      };
    }
    if (approvedCount >= 1 && avgAi >= 50) {
      return {
        label: "Perfil parcialmente verificado",
        tone: "warn" as const,
        icon: Sparkles,
      };
    }
    if (totalDocs === 0) {
      return {
        label: "Sin documentos cargados aún",
        tone: "warn" as const,
        icon: ShieldAlert,
      };
    }
    return {
      label: "Pendiente de revisión IA",
      tone: "neutral" as const,
      icon: Sparkles,
    };
  }, [loading, approvedDocs.length, docs, pro, role]);

  const fullName = base?.full_name ?? (role === "professional" ? "Profesional Humanix" : "Familia Humanix");
  const locLat = role === "professional" ? pro?.lat ?? null : fam?.default_lat ?? null;
  const locLng = role === "professional" ? pro?.lng ?? null : fam?.default_lng ?? null;
  const locAddr =
    highlightAddress ??
    (role === "professional" ? pro?.home_city ?? base?.city ?? null : fam?.default_address ?? base?.city ?? null);

  const VerdictIcon = verdict.icon;

  return (
    <div
      className={`rounded-2xl border border-border bg-card overflow-hidden ${compact ? "" : "shadow-sm"}`}
    >
      <div className="bg-gradient-to-br from-biosensor/10 via-fuchsia-neural/5 to-copper/10 p-4 border-b border-border">
        <div className="flex items-start gap-3">
          <div className="h-14 w-14 rounded-full bg-card border-2 border-biosensor/40 overflow-hidden flex items-center justify-center shrink-0">
            {base?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={base.avatar_url}
                alt={fullName}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="text-lg font-bold text-biosensor">{initialsFrom(fullName)}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-semibold text-sm truncate">{fullName}</p>
              {role === "professional" && pro?.verified ? (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] border-biosensor/40 text-biosensor"
                >
                  <BadgeCheck className="h-3 w-3 mr-0.5" /> Verificado
                </Badge>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {role === "professional"
                ? `${pro?.specialty ?? "Cuidador profesional"} · ${pro?.years_experience ?? 0} años exp.`
                : `Familia${fam?.patient_relation ? ` · cuida a su ${fam.patient_relation}` : ""}`}
            </p>
            <div className="mt-1.5">
              <StarRow
                rating={rating.count > 0 ? rating.avg : pro?.avg_rating ?? null}
                jobs={bookings || pro?.total_jobs || rating.count}
              />
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
          Cargando perfil de confianza…
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Ubicación del servicio
            </p>
            <MapPreview lat={locLat} lng={locLng} address={locAddr} />
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
              <FileCheck2 className="h-3 w-3" /> Documentos aprobados ({approvedDocs.length})
            </p>
            {approvedDocs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                Aún no hay documentos con sello de verificación.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {approvedDocs.slice(0, 6).map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-1.5 rounded-lg border border-biosensor/30 bg-biosensor/5 px-2 py-1.5"
                  >
                    <BadgeCheck className="h-3.5 w-3.5 text-biosensor shrink-0" />
                    <span className="text-[11px] truncate">
                      {DOC_LABEL[d.doc_type] ?? d.doc_type}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {pendingDocs.length > 0 ? (
              <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <FileWarning className="h-3 w-3" /> {pendingDocs.length} en revisión
              </p>
            ) : null}
          </div>

          <div
            className={`rounded-xl border p-3 ${
              (aiVerdict?.confidence ?? (verdict.tone === "good" ? "alta" : "media")) === "alta"
                ? "border-biosensor/40 bg-biosensor/5"
                : (aiVerdict?.confidence ?? "media") === "media"
                  ? "border-copper/40 bg-copper/5"
                  : "border-rose-500/40 bg-rose-500/5"
            }`}
          >
            <div className="flex items-start gap-2">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                  (aiVerdict?.confidence ?? (verdict.tone === "good" ? "alta" : "media")) === "alta"
                    ? "bg-biosensor/15 text-biosensor"
                    : (aiVerdict?.confidence ?? "media") === "media"
                      ? "bg-copper/15 text-copper"
                      : "bg-rose-500/15 text-rose-600"
                }`}
              >
                {aiLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <VerdictIcon className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Inspector de seguridad IA
                  </p>
                  {aiVerdict ? (
                    <span className="text-[10px] font-bold text-biosensor">
                      {aiVerdict.score}/100
                    </span>
                  ) : null}
                </div>
                <p className="text-xs font-semibold capitalize">
                  {aiVerdict
                    ? `Confianza ${aiVerdict.confidence}`
                    : aiLoading
                      ? "Analizando con IA…"
                      : verdict.label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {aiVerdict?.summary ??
                    (role === "professional"
                      ? "Credenciales cruzadas con RETHUS, documentos y reputación de servicios previos."
                      : "Historial de trato, pagos y referencias contrastado con la comunidad.")}
                </p>
                {aiVerdict?.reasons && aiVerdict.reasons.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {aiVerdict.reasons.slice(0, 3).map((r, i) => (
                      <li
                        key={i}
                        className="text-[10px] text-muted-foreground inline-flex items-start gap-1"
                      >
                        <BadgeCheck className="h-2.5 w-2.5 text-biosensor mt-0.5 shrink-0" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {aiVerdict?.caution ? (
                  <p className="mt-1.5 text-[10px] text-copper inline-flex items-start gap-1">
                    <FileWarning className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                    <span>{aiVerdict.caution}</span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {role === "professional" && pro?.trust_score != null ? (
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> Trust score
              </span>
              <span className="text-xs font-bold text-biosensor">{pro.trust_score}/100</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function TrustProfileCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="h-12 w-12 rounded-full bg-muted animate-pulse" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-muted rounded w-2/3 animate-pulse" />
        <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
      </div>
      <UserIcon className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}
